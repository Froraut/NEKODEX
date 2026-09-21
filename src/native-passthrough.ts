import { fetchNativeCodex } from "./native-network";
import { createResponseContinuationScopeFromBody } from "./responses/continuation-owner";
import { previousResponseReplayPrefixLength, resolvePreviousResponseInput } from "./responses/state";
import { readJsonRequestBody, readRequestBodyBytes } from "./http-body";
import {
  BRIDGE_COMPACTION_PREFIX,
  SUMMARY_PREFIX,
  decodeCompactionSummary,
} from "./responses/compaction";
import { BRIDGE_REASONING_PREFIX } from "./responses/reasoning-envelope";
import {
  enqueueNativeUsageTelemetry,
  type NativeReportedUsage,
  type NativeUsageFailureCategory,
  type NativeUsageOutcome,
} from "./native-usage-telemetry";

const CODEX_BACKEND = "https://chatgpt.com/backend-api/codex";
const FIRST_PARTY_CODEX_ORIGINATORS = new Set([
  "codex_cli_rs",
  "codex-tui",
  "codex_vscode",
  "codex_atlas",
  "codex_chatgpt_desktop",
]);
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

export type NativeFetch = (request: Request) => Promise<Response>;

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

function nativeDiagnosticId(value: string | null): string | undefined {
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
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

function endToEndHeaders(source: Headers): Headers {
  const hopByHopHeaders = new Set(HOP_BY_HOP_HEADERS);
  for (const name of (source.get("connection") ?? "").split(",")) {
    const normalized = name.trim().toLowerCase();
    if (normalized) hopByHopHeaders.add(normalized);
  }
  const headers = new Headers();
  for (const [name, value] of source) {
    if (!hopByHopHeaders.has(name.toLowerCase())) headers.append(name, value);
  }
  headers.delete("content-length");
  return headers;
}

/** Terminator every Responses SSE stream ends with; nothing after it carries meaning. */
const SSE_TERMINATOR = "data: [DONE]";
const MAX_TELEMETRY_SSE_FRAME_BYTES = 64 * 1024;
const MAX_TELEMETRY_JSON_BYTES = 256 * 1024;

interface NativeTerminalObservation {
  outcome: NativeUsageOutcome;
  reportedModelId: string | null;
  usage: NativeReportedUsage | null;
  failureCategory: NativeUsageFailureCategory | null;
}

function safeNativeModelId(value: unknown): string | null {
  return typeof value === "string"
    && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/.test(value)
    ? value
    : null;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function nativeReportedUsage(value: unknown): NativeReportedUsage | null {
  if (!isObject(value)) return null;
  const inputTokens = tokenCount(value.input_tokens);
  const outputTokens = tokenCount(value.output_tokens);
  const totalTokens = tokenCount(value.total_tokens);
  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined
    || totalTokens < inputTokens + outputTokens) return null;
  const inputDetails = isObject(value.input_tokens_details) ? value.input_tokens_details : undefined;
  const outputDetails = isObject(value.output_tokens_details) ? value.output_tokens_details : undefined;
  const cachedRaw = inputDetails?.cached_tokens;
  const reasoningRaw = outputDetails?.reasoning_tokens;
  const cachedInputTokens = tokenCount(cachedRaw);
  const reasoningOutputTokens = tokenCount(reasoningRaw);
  if ((cachedRaw !== undefined && cachedInputTokens === undefined)
    || (reasoningRaw !== undefined && reasoningOutputTokens === undefined)) return null;
  if ((cachedInputTokens !== undefined && cachedInputTokens > inputTokens)
    || (reasoningOutputTokens !== undefined && reasoningOutputTokens > outputTokens)) return null;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(reasoningOutputTokens === undefined ? {} : { reasoningOutputTokens }),
  };
}

function failureCategoryForHttp(status: number): NativeUsageFailureCategory | null {
  if (status === 401 || status === 403) return "http-auth";
  if (status === 429) return "http-rate-limit";
  if (status >= 500) return "http-server";
  if (status >= 300) return "http-client";
  return null;
}

function observeNativeTerminal(
  value: unknown,
  eventName?: string,
  standaloneJson = false,
): NativeTerminalObservation | undefined {
  if (!isObject(value)) return undefined;
  const response = isObject(value.response) ? value.response : value;
  const type = typeof value.type === "string" ? value.type : eventName;
  const rawStatus = typeof response.status === "string" ? response.status : undefined;
  const eventOutcome = type === "response.completed"
    ? "completed"
    : type === "response.incomplete"
      ? "incomplete"
      : type === "response.failed" || type === "error"
        ? "failed"
        : undefined;
  const outcome = eventOutcome ?? (standaloneJson
    ? rawStatus === "completed" ? "completed"
      : rawStatus === "incomplete" || rawStatus === "queued" || rawStatus === "in_progress" ? "incomplete"
        : rawStatus === "failed" ? "failed" : undefined
    : undefined);
  if (!outcome) return undefined;
  return {
    outcome,
    reportedModelId: safeNativeModelId(response.model),
    usage: nativeReportedUsage(response.usage),
    failureCategory: outcome === "failed" ? "protocol" : null,
  };
}

type NativeTelemetrySink = typeof enqueueNativeUsageTelemetry;

export function observeNativeResponseBody(
  body: ReadableStream<Uint8Array>,
  options: {
    endpoint: "responses" | "responses/compact";
    requestedModelId: string | null;
    startedAt: string;
    startedAtMs: number;
    httpStatus: number;
    eventStream: boolean;
    signal: AbortSignal;
  },
  report: NativeTelemetrySink = enqueueNativeUsageTelemetry,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let terminal: NativeTerminalObservation | undefined;
  let finalized = false;
  let inspectionDisabled = false;
  let lineBuffer = "";
  let lineCharacterCount = 0;
  let lineIsSingleCarriageReturn = false;
  let frameEvent: string | undefined;
  let frameData = "";
  let frameOversized = false;
  let jsonText = "";
  let jsonOversized = false;

  const finalize = (
    outcome: NativeUsageOutcome,
    category: NativeUsageFailureCategory | null,
  ): void => {
    if (finalized) return;
    finalized = true;
    const observation = terminal;
    try {
      report({
        endpoint: options.endpoint,
        requestedModelId: options.requestedModelId,
        reportedModelId: observation?.reportedModelId ?? null,
        startedAt: options.startedAt,
        durationMs: Math.max(0, Math.round(Date.now() - options.startedAtMs)),
        outcome,
        httpStatus: options.httpStatus,
        failureCategory: category,
        usageStatus: observation?.usage ? "reported" : "unreported",
        usage: observation?.usage ?? null,
      });
    } catch {
      // Telemetry reporting is isolated from native byte delivery.
    }
  };

  const finishFrame = (): void => {
    if (frameOversized && frameEvent) {
      terminal ??= observeNativeTerminal({ type: frameEvent }, frameEvent);
    } else if (frameData && frameData !== "[DONE]") {
      try {
        terminal ??= observeNativeTerminal(JSON.parse(frameData), frameEvent);
      } catch {
        // Unknown or partial frames carry no telemetry authority.
      }
    }
    frameEvent = undefined;
    frameData = "";
    frameOversized = false;
  };

  const inspectSseText = (text: string): void => {
    let offset = 0;
    while (offset < text.length) {
      const newline = text.indexOf("\n", offset);
      const end = newline < 0 ? text.length : newline;
      const segmentLength = end - offset;
      if (segmentLength > 0) {
        if (lineCharacterCount === 0 && segmentLength === 1 && text[offset] === "\r") {
          lineCharacterCount = 1;
          lineIsSingleCarriageReturn = true;
        } else {
          lineCharacterCount = 2;
          lineIsSingleCarriageReturn = false;
        }
      }
      if (!frameOversized) {
        const definitelyOversized = lineBuffer.length + segmentLength > MAX_TELEMETRY_SSE_FRAME_BYTES;
        const segment = definitelyOversized ? "" : text.slice(offset, end);
        if (definitelyOversized
          || Buffer.byteLength(lineBuffer, "utf8") + Buffer.byteLength(segment, "utf8")
            > MAX_TELEMETRY_SSE_FRAME_BYTES) {
          lineBuffer = "";
          frameOversized = true;
        } else lineBuffer += segment;
      }
      if (newline < 0) return;
      const blankLine = lineCharacterCount === 0 || lineIsSingleCarriageReturn;
      const line = frameOversized ? "" : lineBuffer.replace(/\r$/, "");
      lineBuffer = "";
      lineCharacterCount = 0;
      lineIsSingleCarriageReturn = false;
      offset = newline + 1;
      if (blankLine) {
        finishFrame();
        continue;
      }
      if (frameOversized) continue;
      if (line.startsWith("event:")) {
        if (!frameOversized) frameEvent = line.slice(6).trim().slice(0, 128);
        continue;
      }
      if (!line.startsWith("data:") || frameOversized) continue;
      const value = line.slice(5).trimStart();
      const next = frameData ? `${frameData}\n${value}` : value;
      if (Buffer.byteLength(next, "utf8") > MAX_TELEMETRY_SSE_FRAME_BYTES) {
        frameData = "";
        frameOversized = true;
      } else frameData = next;
    }
  };

  const inspectJsonText = (text: string): void => {
    if (jsonOversized) return;
    if (jsonText.length + text.length > MAX_TELEMETRY_JSON_BYTES) {
      jsonText = "";
      jsonOversized = true;
      return;
    }
    const next = jsonText + text;
    if (Buffer.byteLength(next, "utf8") > MAX_TELEMETRY_JSON_BYTES) {
      jsonText = "";
      jsonOversized = true;
    } else jsonText = next;
  };

  const finishInspection = (): void => {
    const trailing = decoder.decode();
    if (options.eventStream) {
      inspectSseText(trailing);
      if (lineBuffer) inspectSseText("\n");
      finishFrame();
    } else {
      inspectJsonText(trailing);
      if (!jsonOversized && jsonText) {
        try { terminal ??= observeNativeTerminal(JSON.parse(jsonText), undefined, true); }
        catch { /* Large/unrecognized JSON is deliberately not retained or interpreted. */ }
      }
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (terminal) finalize(terminal.outcome, terminal.failureCategory);
        else {
          const aborted = options.signal.aborted
            || (error instanceof DOMException && error.name === "AbortError");
          finalize(aborted ? "aborted" : "failed", aborted ? "aborted" : "stream");
        }
        controller.error(error);
        return;
      }
      if (chunk.done) {
        if (!inspectionDisabled) {
          try { finishInspection(); }
          catch { terminal = undefined; inspectionDisabled = true; }
        }
        const httpFailure = failureCategoryForHttp(options.httpStatus);
        const outcome = terminal?.outcome ?? (httpFailure ? "failed"
          : options.eventStream || inspectionDisabled ? "incomplete" : "completed");
        finalize(outcome, terminal?.failureCategory ?? httpFailure
          ?? ((options.eventStream || inspectionDisabled) ? "protocol" : null));
        controller.close();
        return;
      }
      if (!inspectionDisabled) {
        try {
          const text = decoder.decode(chunk.value, { stream: true });
          if (options.eventStream) inspectSseText(text);
          else inspectJsonText(text);
        } catch {
          // Disable authority from a broken inspector while forwarding this and all later bytes.
          terminal = undefined;
          inspectionDisabled = true;
        }
      }
      controller.enqueue(chunk.value);
    },
    async cancel(reason) {
      if (terminal) finalize(terminal.outcome, terminal.failureCategory);
      else finalize("aborted", "aborted");
      await reader.cancel(reason);
    },
  });
}

/**
 * ChatGPT's backend routinely resets the native Codex connection instead of closing it cleanly,
 * which Bun surfaces as ECONNRESET while reading the body. Passed through untouched that reaches
 * Codex as a truncated HTTP body and the opaque "error decoding response body".
 *
 * A reset that arrives after the stream already delivered `data: [DONE]` is an unclean TCP close on
 * a turn that finished: every byte the protocol defines has been forwarded, so the stream is closed
 * normally rather than failed. A reset before that genuinely truncated the turn and is still raised,
 * because inventing a terminal event there would tell Codex a turn ended when it did not.
 */
function withUncleanCloseTolerance(
  body: ReadableStream<Uint8Array>,
  isEventStream: boolean,
  onUncleanClose?: (bytes: number) => void,
): ReadableStream<Uint8Array> {
  if (!isEventStream) return body;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = "";
  let completed = false;
  let oversizedLine = false;
  let bytes = 0;
  const inspectLines = (text: string): void => {
    if (completed) return;
    let offset = 0;
    while (offset < text.length) {
      const newline = text.indexOf("\n", offset);
      const end = newline < 0 ? text.length : newline;
      if (!oversizedLine) {
        if (lineBuffer.length + end - offset > SSE_TERMINATOR.length + 1) {
          lineBuffer = "";
          oversizedLine = true;
        } else lineBuffer += text.slice(offset, end);
      }
      if (newline < 0) break;
      if (!oversizedLine && lineBuffer.replace(/\r$/, "") === SSE_TERMINATOR) completed = true;
      lineBuffer = "";
      oversizedLine = false;
      offset = newline + 1;
      if (completed) break;
    }
  };
  const inspectTrailingLine = (): void => {
    // A reset can arrive before the final line separator. Treat only an exact unterminated
    // terminator line as complete; text embedded in a JSON data payload must not qualify.
    if (lineBuffer.replace(/\r$/, "") === SSE_TERMINATOR) completed = true;
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          inspectLines(decoder.decode());
          inspectTrailingLine();
          controller.close();
          return;
        }
        bytes += chunk.value.byteLength;
        inspectLines(decoder.decode(chunk.value, { stream: true }));
        controller.enqueue(chunk.value);
      } catch (error) {
        inspectTrailingLine();
        if (!completed) {
          controller.error(error);
          return;
        }
        onUncleanClose?.(bytes);
        controller.close();
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export async function forwardNativeCodexRequest(
  request: Request,
  endpoint: NativeCodexEndpoint,
  fetchUpstream: NativeFetch = fetchNativeCodex,
  decodedBody?: unknown,
): Promise<Response> {
  const telemetryStartedAtMs = Date.now();
  const telemetryStartedAt = new Date(telemetryStartedAtMs).toISOString();
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length <= "Bearer ".length) {
    void request.body?.cancel().catch(() => {});
    throw new Error("Native Codex passthrough requires the incoming Bearer authorization");
  }

  const incomingUrl = new URL(request.url);
  if (endpoint === "models" && !incomingUrl.searchParams.has("client_version")) {
    const clientVersion = codexClientVersionFromUserAgent(request.headers.get("user-agent"));
    if (clientVersion) incomingUrl.searchParams.set("client_version", clientVersion);
  }
  const headers = endToEndHeaders(request.headers);
  if (endpoint === "models") headers.delete("if-none-match");
  const method = endpoint === "models" ? "GET" : "POST";
  const imageRequest = endpoint === "images/generations" || endpoint === "images/edits";
  let compactionRequest = endpoint === "responses/compact";
  let model: string | undefined;
  let body: BodyInit | undefined;
  if (imageRequest) {
    // Standalone image requests use their own schema; never interpret them as Responses history.
    // Preserve Bun's existing 128 MiB listener budget for opaque image/multipart bodies.
    body = await readRequestBodyBytes(request, 128 * 1024 * 1024);
  } else if (method === "POST") {
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
      return localContinuationFailure(continuation.reason ?? "unavailable");
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
      headers.delete("content-encoding");
      body = JSON.stringify(scrubbed.value);
    } else {
      body = originalBody;
    }
  }
  const upstreamRequest = new Request(`${CODEX_BACKEND}/${endpoint}${incomingUrl.search}`, {
    method,
    headers,
    ...(body ? { body } : {}),
    signal: request.signal,
    // Preserve redirects as responses. Native POSTs create work and must not be replayed, while
    // every endpoint carries account-scoped headers that must stay on the exact trusted origin.
    redirect: "manual",
  });
  const telemetryEndpoint = endpoint === "responses" || endpoint === "responses/compact"
    ? (compactionRequest ? "responses/compact" : endpoint)
    : undefined;
  let upstream: Response;
  try {
    upstream = await fetchUpstream(upstreamRequest);
  } catch (error) {
    if (telemetryEndpoint) {
      const aborted = request.signal.aborted
        || (error instanceof DOMException && error.name === "AbortError");
      enqueueNativeUsageTelemetry({
        endpoint: telemetryEndpoint,
        requestedModelId: model ?? null,
        reportedModelId: null,
        startedAt: telemetryStartedAt,
        durationMs: Math.max(0, Math.round(Date.now() - telemetryStartedAtMs)),
        outcome: aborted ? "aborted" : "failed",
        httpStatus: 0,
        failureCategory: aborted ? "aborted" : "transport",
        usageStatus: "unreported",
        usage: null,
      });
    }
    throw error;
  }
  if (compactionRequest && !upstream.ok) {
    console.warn(`[codex-chatgpt-web] native_compaction_upstream_failed ${JSON.stringify({
      endpoint, model, status: upstream.status,
      requestId: nativeDiagnosticId(upstream.headers.get("x-request-id")),
      cfRay: nativeDiagnosticId(upstream.headers.get("cf-ray")),
    })}`);
  }
  const responseHeaders = endToEndHeaders(upstream.headers);
  // fetch exposes decompressed image JSON; retaining gzip/br would make Codex decode it twice.
  if (imageRequest) responseHeaders.delete("content-encoding");
  const isEventStream = (upstream.headers.get("content-type") ?? "")
    .toLowerCase()
    .includes("text/event-stream");
  const tolerantBody = upstream.body
    ? withUncleanCloseTolerance(upstream.body, isEventStream, bytes => {
        console.warn(
          `[codex-chatgpt-web] native_upstream_unclean_close endpoint=${endpoint} bytes=${bytes}`
          + " (turn had already completed; closing the client stream normally)",
        );
      })
    : upstream.body;
  let responseBody = tolerantBody;
  if (telemetryEndpoint) {
    if (tolerantBody) {
      responseBody = observeNativeResponseBody(tolerantBody, {
        endpoint: telemetryEndpoint,
        requestedModelId: model ?? null,
        startedAt: telemetryStartedAt,
        startedAtMs: telemetryStartedAtMs,
        httpStatus: upstream.status,
        eventStream: isEventStream,
        signal: request.signal,
      });
    } else {
      const failureCategory = failureCategoryForHttp(upstream.status);
      enqueueNativeUsageTelemetry({
        endpoint: telemetryEndpoint,
        requestedModelId: model ?? null,
        reportedModelId: null,
        startedAt: telemetryStartedAt,
        durationMs: Math.max(0, Math.round(Date.now() - telemetryStartedAtMs)),
        outcome: failureCategory ? "failed" : "completed",
        httpStatus: upstream.status,
        failureCategory,
        usageStatus: "unreported",
        usage: null,
      });
    }
  }
  return new Response(
    responseBody,
    {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    },
  );
}
