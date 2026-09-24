import { createResponseContinuationScopeFromBody } from "./responses/continuation-owner";
import { previousResponseReplayPrefixLength, resolvePreviousResponseInput } from "./responses/state";
import { readJsonRequestBody, readRequestBodyBytes } from "./http-body";
import {
  BRIDGE_COMPACTION_PREFIX,
  SUMMARY_PREFIX,
  decodeCompactionSummary,
} from "./responses/compaction";
import { BRIDGE_REASONING_PREFIX } from "./responses/reasoning-envelope";
import { safeNativeModelId } from "./usage/native-contract";

const FIRST_PARTY_CODEX_ORIGINATORS = new Set([
  "codex_cli_rs",
  "codex-tui",
  "codex_vscode",
  "codex_atlas",
  "codex_chatgpt_desktop",
]);
export type NativeImageEndpoint = "images/generations" | "images/edits";
export type NativeCodexEndpoint = "models" | "responses" | "responses/compact" | "alpha/search" | NativeImageEndpoint;

type JsonObject = Record<string, unknown>;
type BridgeCompactionItem = JsonObject & { type: "compaction"; encrypted_content: string };

function localContinuationFailure(reason: string): Response {
  return new Response(JSON.stringify({
    error: {
      type: "invalid_request_error",
      code: `local_continuation_${reason.replaceAll("-", "_")}`,
      message: reason === "owner-mismatch"
        ? "Local continuation state belongs to a different Codex task or local response namespace."
        : reason === "owner-unavailable"
          ? "Local continuation ownership is unavailable; legacy state cannot be assigned to this Codex task."
          : "Local continuation state is no longer available; compact the Codex task or start a new task.",
    },
  }), {
    status: 409,
    headers: { "content-type": "application/json" },
  });
}

function firstPartyCodexOriginator(value: string): boolean {
  return FIRST_PARTY_CODEX_ORIGINATORS.has(value)
    || /^Codex [A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(value);
}

/**
 * Current Codex clients identify themselves as `<originator>/<cargo semver> (...)`. The models
 * backend requires the release-only `major.minor.patch` value even when the client is an alpha.
 * Derive it only from the documented first-party Codex prefix; an arbitrary browser or proxy
 * User-Agent is not evidence of a Codex version and leaves the original request untouched.
 */
export function codexClientVersionFromUserAgent(userAgent: string | null): string | undefined {
  if (!userAgent) return undefined;
  const separator = userAgent.indexOf("/");
  if (separator < 1) return undefined;
  const originator = userAgent.slice(0, separator);
  if (!firstPartyCodexOriginator(originator)) return undefined;
  const version = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+][0-9A-Za-z.-]+)?(?:\s|$)/
    .exec(userAgent.slice(separator + 1));
  return version ? `${version[1]}.${version[2]}.${version[3]}` : undefined;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBridgeReasoningItem(value: unknown): value is JsonObject {
  if (!isObject(value) || value.type !== "reasoning") return false;
  const encrypted = value.encrypted_content;
  if (typeof encrypted === "string" && encrypted.startsWith(BRIDGE_REASONING_PREFIX)) return true;
  return typeof value.id === "string"
    && /^rs_[0-9a-f]{32}$/i.test(value.id)
    && (encrypted === undefined || encrypted === null)
    && (Array.isArray(value.summary) || Array.isArray(value.content));
}

function isBridgeCompactionItem(value: unknown): value is BridgeCompactionItem {
  return isObject(value)
    && value.type === "compaction"
    && typeof value.encrypted_content === "string"
    && value.encrypted_content.startsWith(BRIDGE_COMPACTION_PREFIX);
}

/**
 * Response item ids are scoped to the backend that created them. A ChatGPT Web response is
 * generated locally, so replaying its `rs_*` id after switching back to native Codex makes the
 * official backend try to load an item it has never stored. The same boundary applies to local
 * `ocx1:` compaction checkpoints: preserve their decoded summary as a normal input message rather
 * than asking the official backend to decrypt a bridge-owned envelope. Once either artifact proves
 * that the history crossed providers, send the complete item content without provider-local ids.
 */
export function scrubBridgeArtifactsForNative(value: unknown): { value: unknown; changed: boolean } {
  if (!isObject(value)
    || !Array.isArray(value.input)
    || !value.input.some(item => isBridgeReasoningItem(item) || isBridgeCompactionItem(item))) {
    return { value, changed: false };
  }

  const input = value.input.flatMap(item => {
    if (!isObject(item)) return [item];
    const clean = { ...item };
    delete clean.id;
    if (isBridgeCompactionItem(clean)) {
      const summary = decodeCompactionSummary(clean.encrypted_content);
      if (summary === null) throw new Error("Invalid ChatGPT Web compaction checkpoint");
      return [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `${SUMMARY_PREFIX}\n\n${summary}` }],
      }];
    }
    if (clean.type !== "reasoning") return [clean];

    if (typeof clean.encrypted_content === "string"
      && clean.encrypted_content.startsWith(BRIDGE_REASONING_PREFIX)) {
      delete clean.encrypted_content;
    } else if (clean.encrypted_content === null) {
      delete clean.encrypted_content;
    }

    const hasSummary = Array.isArray(clean.summary) && clean.summary.length > 0;
    const hasContent = Array.isArray(clean.content) && clean.content.length > 0;
    const hasNativeEncryptedContent = typeof clean.encrypted_content === "string";
    return hasSummary || hasContent || hasNativeEncryptedContent ? [clean] : [];
  });
  const clean: JsonObject = { ...value, input };
  delete clean.previous_response_id;
  return { value: clean, changed: true };
}

/** Decoded metadata is local authority, not a reason to reserialize unchanged wire bytes. */
type NativePreparedBody =
  | { kind: "original"; body: Uint8Array<ArrayBuffer> | undefined }
  | { kind: "rewritten"; body: string };
export type NativeRequestPreparation =
  | (NativePreparedBody & { model: string | undefined; compactionRequest: boolean })
  | { kind: "rejected"; response: Response };

export async function prepareNativeRequestBody(
  request: Request,
  endpoint: NativeCodexEndpoint,
  decodedBody?: unknown,
): Promise<NativeRequestPreparation> {
  const imageRequest = endpoint === "images/generations" || endpoint === "images/edits";
  let compactionRequest = endpoint === "responses/compact";
  let model: string | undefined;
  let prepared: NativePreparedBody = { kind: "original", body: undefined };
  if (imageRequest) {
    // Standalone image requests use their own schema; never interpret them as Responses history.
    // Preserve Bun's existing 128 MiB listener budget for opaque image/multipart bodies.
    prepared = { kind: "original", body: await readRequestBodyBytes(request, 128 * 1024 * 1024) };
  } else if (endpoint !== "models") {
    const parseRequest = decodedBody === undefined ? request.clone() : undefined;
    let originalBody: Uint8Array<ArrayBuffer>;
    let parsedBody: unknown;
    try {
      originalBody = await readRequestBodyBytes(request);
      parsedBody = decodedBody === undefined ? await readJsonRequestBody(parseRequest!) : decodedBody;
    } finally {
      // If an upload is cancelled before parsing, its unused tee branch must not retain it.
      void parseRequest?.body?.cancel().catch(() => {});
    }
    if (isObject(parsedBody)) {
      model = safeNativeModelId(parsedBody.model) ?? undefined;
      const tail = Array.isArray(parsedBody.input) ? parsedBody.input.at(-1) : undefined;
      compactionRequest ||= endpoint === "responses" && isObject(tail) && tail.type === "compaction_trigger";
    }
    // The local cache contains Web-owned responses only. Native-owned IDs that are not
    // present retain their original upstream continuation and byte-for-byte request.
    const continuation = endpoint === "responses" || endpoint === "responses/compact"
      ? resolvePreviousResponseInput(parsedBody, {
          scope: createResponseContinuationScopeFromBody(parsedBody),
        })
      : { body: parsedBody, status: "not-requested" as const };
    // Unknown IDs may be genuine native-upstream responses and retain byte-for-byte passthrough.
    // Every more specific reason is local authority to fail closed before sending a naked delta.
    if (continuation.status === "unavailable" && continuation.reason !== "unavailable") {
      return { kind: "rejected", response: localContinuationFailure(continuation.reason ?? "unavailable") };
    }
    const expanded = continuation.body;
    const localContinuation = expanded !== parsedBody;
    const replayBody = localContinuation && isObject(expanded) ? { ...expanded } : expanded;
    if (localContinuation && isObject(replayBody)) {
      delete replayBody.previous_response_id;
      const prefixLength = previousResponseReplayPrefixLength(expanded);
      if (Array.isArray(replayBody.input)) replayBody.input = replayBody.input.map((item, index) => {
        if (index >= prefixLength || !isObject(item)) return item;
        const clean = { ...item };
        delete clean.id; // Locally restored Web output ids cannot be resolved by the native backend.
        return clean;
      });
    }
    const scrubbed = scrubBridgeArtifactsForNative(replayBody);
    if (scrubbed.changed || localContinuation) {
      prepared = { kind: "rewritten", body: JSON.stringify(scrubbed.value) };
    } else {
      prepared = { kind: "original", body: originalBody };
    }
  }
  return { ...prepared, model, compactionRequest };
}
