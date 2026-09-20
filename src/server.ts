import { MAX_CHATGPT_BROWSER_TABS } from "./adapters/chatgpt-web/concurrency";
import { chatGptWebTraceId, createChatGptWebAdapter } from "./adapters/chatgpt-web";
import { normalizeNativeDelegation } from "./adapters/chatgpt-web/native-delegation";
import { validateChatGptWebInputImage } from "./adapters/chatgpt-web/input-image-validation";
import { closeChatGptBrowserWorkers } from "./adapters/chatgpt-web/browser-worker";
import { closeTurnBrokers, TurnBroker } from "./adapters/chatgpt-web/turn-broker";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { chatGptTurnSessions } from "./adapters/chatgpt-web/turn-execution";
import {
  activeStructuredCompactionCount,
  cancelAllStructuredCompactions,
  cancelStructuredCompactionNativeTurn,
  cancelStructuredCompactionTrace,
} from "./adapters/chatgpt-web/compaction-handoff";
import { ChatGptWebAdapterError, chatGptBrowserTabClosedError } from "./adapters/chatgpt-web/adapter-error";
import {
  CHATGPT_TURN_REVISION_CONFLICT_MESSAGE,
  extractChatGptTurnIdentity,
  extractCodexTurnIdentityFromBody,
  extractChatGptCompactionSourceRevision,
  chatGptTurnUserRevisionHistory,
} from "./adapters/chatgpt-web/environment";
import { rememberCompactionContinuation } from "./adapters/chatgpt-web/compaction-continuation";
import { clearRetryableTurnHandoff, rememberRetryableTurnFailure } from "./adapters/chatgpt-web/retry-continuation";
import { bridgeToResponsesSSE, buildResponseJSON, formatErrorResponse } from "./bridge";
import type { AppConfig } from "./config";
import { providerConfig } from "./config";
import { parseChatGptWebProModelVersion, type ChatGptWebProModelVersion } from "./chatgpt-web-models";
import { AsyncEventQueue } from "./event-queue";
import { readJsonRequestBody } from "./http-body";
import { httpStatusFromTerminalError } from "./lib/errors";
import { createHash } from "node:crypto";
import { augmentNativeModelCatalog } from "./model-catalog";
import { fetchNativeCodex, nativeNetworkBackgroundReady } from "./native-network";
import {
  readCodexModelContextOverride,
  readCodexSubagentProtocol,
  type CodexModelContextOverride,
} from "./codex-integration";
import {
  CHATGPT_WEB_BACKEND_MODEL,
  CHATGPT_WEB_LUNA_BACKEND_MODEL,
  isChatGptWebModelSlug,
  requireChatGptWebModelRoute,
  type ChatGptWebModelRoute,
} from "./chatgpt-web-models";
import type { ChatGptWebCompactionModel } from "./chatgpt-web-compaction-policy";
import { forwardNativeCodexRequest, type NativeFetch, type NativeImageEndpoint } from "./native-passthrough";
import {
  buildCompactV1Output,
  COMPACT_PROMPT,
  decodeCompactionSummary,
  extractCompactUserMessages,
} from "./responses/compaction";
import { parseRequest } from "./responses/parser";
import { createResponseContinuationScopeFromBody } from "./responses/continuation-owner";
import {
  expandPreviousResponseInput,
  flushResponseState,
  previousResponseStateStatus,
  rememberResponseState,
} from "./responses/state";
import { namespacedToolName, type AdapterEvent, type CodexParsedRequest } from "./types";
import type { CodexProviderConfig } from "./types";
import type { ProviderAdapter } from "./adapters/base";
import { VERSION } from "./version";
import { HermesIntegration, type HermesContext } from "./hermes-integration";

type HttpTrackedEndpoint = "models" | "responses" | "compact" | "search" | "unspecified" | NativeImageEndpoint;

export interface NativeCodexTurnIdentity {
  threadId: string;
  turnId: string;
}

export interface HttpStreamFailureEvidence {
  httpTurnId: number;
  endpoint: HttpTrackedEndpoint;
  reader: "client" | "windows_lifecycle";
  platform: NodeJS.Platform;
  chunks: number;
  bytes: number;
  errorName: string;
  errorCode: string;
}

type HttpStreamFailureReporter = (evidence: HttpStreamFailureEvidence) => void;

function safeStreamErrorField(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value)
    ? value
    : fallback;
}

function streamFailureEvidence(
  error: unknown,
  httpTurnId: number,
  endpoint: HttpTrackedEndpoint,
  reader: HttpStreamFailureEvidence["reader"],
  platform: NodeJS.Platform,
  chunks: number,
  bytes: number,
): HttpStreamFailureEvidence {
  const candidate = error !== null && typeof error === "object"
    ? error as { name?: unknown; code?: unknown }
    : {};
  return {
    httpTurnId,
    endpoint,
    reader,
    platform,
    chunks,
    bytes,
    errorName: safeStreamErrorField(candidate.name, "Error"),
    errorCode: safeStreamErrorField(candidate.code, "unknown"),
  };
}

const reportHttpStreamFailure: HttpStreamFailureReporter = evidence => {
  console.warn(`[codex-chatgpt-web] http_stream_failed ${JSON.stringify(evidence)}`);
};

function emitHttpStreamFailure(
  reporter: HttpStreamFailureReporter,
  evidence: HttpStreamFailureEvidence,
): void {
  try {
    reporter(evidence);
  } catch {
    // Diagnostics are a side channel: they must never replace the source stream error or retain
    // HTTP turn ownership after the client has already observed that failure.
  }
}

export class HttpTurnCounter {
  private readonly active = new Map<number, {
    abort: AbortController;
    done: Promise<void>;
    finish: () => void;
    identity?: NativeCodexTurnIdentity;
    web?: boolean;
  }>();
  private readonly interrupted = new Map<string, unknown>();
  private nextId = 1;

  private identityKey(identity: NativeCodexTurnIdentity): string {
    return `${identity.threadId}\u0000${identity.turnId}`;
  }

  private rememberInterrupted(identity: NativeCodexTurnIdentity, reason: unknown): void {
    const key = this.identityKey(identity);
    this.interrupted.delete(key);
    this.interrupted.set(key, reason);
    while (this.interrupted.size > 1_024) {
      const oldest = this.interrupted.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.interrupted.delete(oldest);
    }
  }

  constructor(private readonly reportStreamFailure: HttpStreamFailureReporter = reportHttpStreamFailure) {}

  count(): number {
    return this.active.size;
  }

  webCount(): number {
    return [...this.active.values()].filter(turn => turn.web).length;
  }

  async cancelAll(reason: unknown = new Error("Active HTTP turns cancelled")): Promise<number> {
    const turns = [...this.active.values()];
    for (const turn of turns) {
      if (!turn.abort.signal.aborted) turn.abort.abort(reason);
    }
    await Promise.all(turns.map(turn => turn.done));
    return turns.length;
  }

  async cancelTurn(
    identity: NativeCodexTurnIdentity,
    reason: unknown = new DOMException("Codex turn interrupted", "AbortError"),
  ): Promise<number> {
    const cancellation = this.beginCancelTurn(identity, reason);
    await cancellation.settlement;
    return cancellation.cancelled;
  }

  beginCancelTurn(
    identity: NativeCodexTurnIdentity,
    reason: unknown = new DOMException("Codex turn interrupted", "AbortError"),
  ): { cancelled: number; settlement: Promise<void> } {
    this.rememberInterrupted(identity, reason);
    const turns = [...this.active.values()].filter(turn => (
      turn.identity?.threadId === identity.threadId && turn.identity.turnId === identity.turnId
    ));
    for (const turn of turns) {
      if (!turn.abort.signal.aborted) turn.abort.abort(reason);
    }
    return {
      cancelled: turns.length,
      settlement: Promise.all(turns.map(turn => turn.done)).then(() => undefined),
    };
  }

  async track(
    run: (
      signal: AbortSignal,
      bindIdentity: (identity: NativeCodexTurnIdentity) => void,
      bindWeb: () => void,
    ) => Promise<Response>,
    clientSignal?: AbortSignal,
    platform: NodeJS.Platform = process.platform,
    endpoint: HttpTrackedEndpoint = "unspecified",
  ): Promise<Response> {
    const id = this.nextId++;
    const abort = new AbortController();
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    const tracked: {
      abort: AbortController;
      done: Promise<void>;
      finish: () => void;
      identity?: NativeCodexTurnIdentity;
      web?: boolean;
    } = { abort, done, finish };
    this.active.set(id, tracked);
    let released = false;
    let clientAbortListener: (() => void) | undefined;
    let streamAbortListener: (() => void) | undefined;
    const release = () => {
      if (released) return;
      released = true;
      this.active.delete(id);
      if (clientSignal && clientAbortListener) {
        clientSignal.removeEventListener("abort", clientAbortListener);
        clientAbortListener = undefined;
      }
      if (streamAbortListener) abort.signal.removeEventListener("abort", streamAbortListener);
      finish();
    };
    clientAbortListener = () => abort.abort(clientSignal?.reason);
    if (clientSignal?.aborted) abort.abort(clientSignal.reason);
    else clientSignal?.addEventListener("abort", clientAbortListener, { once: true });

    try {
      const response = await run(abort.signal, identity => {
        if (!identity.threadId.trim() || !identity.turnId.trim()) {
          throw new Error("Native Codex turn identity must contain a threadId and turnId");
        }
        if (tracked.identity
          && (tracked.identity.threadId !== identity.threadId || tracked.identity.turnId !== identity.turnId)) {
          throw new Error("An HTTP request cannot change its native Codex turn identity");
        }
        tracked.identity = identity;
        const interruptedReason = this.interrupted.get(this.identityKey(identity));
        if (interruptedReason !== undefined && !abort.signal.aborted) abort.abort(interruptedReason);
      }, () => { tracked.web = true; });
      if (!response.body) {
        release();
        return response;
      }
      if (abort.signal.aborted) {
        await response.body.cancel(abort.signal.reason).catch(() => {});
        release();
        return new Response(null, { status: 499, statusText: "Client Closed Request" });
      }

      if (platform !== "win32") {
        // Bun's async-pull teardown bug is Windows-only. On Darwin/Linux, preserve the direct
        // pull chain: it keeps HTTP backpressure native and lets a client body cancellation reach
        // the original SSE reader without an eagerly drained tee branch racing the socket writer.
        const reader = response.body.getReader();
        const reportStreamFailure = this.reportStreamFailure;
        let chunks = 0;
        let bytes = 0;
        streamAbortListener = () => {
          void reader.cancel(abort.signal.reason).catch(() => {}).finally(release);
        };
        abort.signal.addEventListener("abort", streamAbortListener, { once: true });
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const chunk = await reader.read();
              if (chunk.done) {
                release();
                controller.close();
                return;
              }
              chunks += 1;
              bytes += chunk.value.byteLength;
              controller.enqueue(chunk.value);
            } catch (error) {
              if (!abort.signal.aborted) {
                emitHttpStreamFailure(reportStreamFailure, streamFailureEvidence(
                  error,
                  id,
                  endpoint,
                  "client",
                  platform,
                  chunks,
                  bytes,
                ));
              }
              release();
              controller.error(error);
            }
          },
          async cancel(reason) {
            try {
              await reader.cancel(reason);
            } finally {
              release();
            }
          },
        });
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }

      // Keep Bun's Windows response free of a custom async pull callback. A TransformStream
      // supplies a demand-driven native readable instead of teeing into an eager observer.
      // With zero readable high-water mark, upstream delivery waits for client demand.
      let chunks = 0;
      let bytes = 0;
      const delivery = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          chunks += 1;
          bytes += chunk.byteLength;
          controller.enqueue(chunk);
        },
      }, { highWaterMark: 64 * 1024, size: chunk => chunk?.byteLength ?? 0 }, { highWaterMark: 0 });
      void response.body.pipeTo(delivery.writable, { signal: abort.signal }).catch(error => {
        if (!abort.signal.aborted) {
          emitHttpStreamFailure(this.reportStreamFailure, streamFailureEvidence(
            error, id, endpoint, "windows_lifecycle", platform, chunks, bytes,
          ));
        }
      }).finally(release);
      const clientBody = delivery.readable;
      return new Response(clientBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      release();
      throw error;
    }
  }
}

type ChatGptWebAdapterFactory = (provider: CodexProviderConfig) => ProviderAdapter;

export interface ResponseRequestOptions {
  /** Native passthrough remains available independently of the browser/tool broker. */
  webAdmission?: () => Response | undefined;
  fetchUpstream?: NativeFetch;
  hermesContext?: HermesContext;
  onCompletedResponse?: (response: Record<string, unknown>) => void;
  /** DEV and other in-process harnesses can keep continuation state in their own canonical store. */
  rememberState?: boolean;
  /** Observe the exact production adapter stream when invoking the handler in-process. */
  onAdapterEvent?: (event: AdapterEvent) => void;
  /** Bind the physical HTTP stream to the exact native Codex turn that owns it. */
  onTurnIdentity?: (identity: NativeCodexTurnIdentity) => void;
  /** Read the live Pro preference only after this request resolves to the automatic Pro route. */
  readProModelVersion?: () => ChatGptWebProModelVersion | undefined;
  readCompactionModel?: () => ChatGptWebCompactionModel | undefined;
}

export function routeChatGptWebRequest(parsed: CodexParsedRequest, config: AppConfig): ChatGptWebModelRoute {
  const route = requireChatGptWebModelRoute(parsed.modelId, config);
  parsed.modelId = route.backendModel;
  // Zero Risk preserves a distinct backend identity. Its immutable Codex effort is only a
  // protocol/catalog value; the manual adapter must never reinterpret it as a ChatGPT selection.
  parsed.options.reasoning = route.interactionMode === "automatic"
    ? route.adapterEffort
    : route.codexEffort;
  return route;
}

/** Inspect the effective Web context, including restored continuation and delegated messages. */
function findInvalidChatGptWebInputImage(parsed: CodexParsedRequest): string | undefined {
  for (const [index, message] of parsed.context.messages.entries()) {
    if (typeof message.content === "string") continue;
    for (const part of message.content) {
      if (part.type !== "image") continue;
      const invalid = validateChatGptWebInputImage(part.imageUrl);
      if (invalid) {
        return `ChatGPT web input image in ${message.role} message ${index + 1} ${invalid}. `
          + "Inline the image bytes as a base64 data URL (png, jpeg, gif, or webp) before retrying.";
      }
    }
  }
  return undefined;
}

interface ModelCatalogFailure {
  stage: "config" | "request" | "transport" | "upstream" | "catalog";
  code?: string;
}

function modelCatalogFailure(stage: ModelCatalogFailure["stage"], error: unknown): ModelCatalogFailure {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return { stage, ...(typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code) ? { code } : {}) };
}

export async function modelsRequest(
  req: Request,
  config: AppConfig,
  fetchUpstream?: NativeFetch,
  contextOverride?: () => CodexModelContextOverride | undefined,
  onFailure?: (failure: ModelCatalogFailure) => void,
): Promise<Response> {
  let upstream: Response;
  let sent = false;
  try {
    upstream = await forwardNativeCodexRequest(req, "models", input => {
      sent = true;
      return (fetchUpstream ?? fetchNativeCodex)(input);
    });
  } catch (error) {
    onFailure?.(modelCatalogFailure(sent ? "transport" : "request", error));
    return formatErrorResponse(502, "upstream_error", error instanceof Error ? error.message : String(error));
  }
  if (!upstream.ok) {
    onFailure?.({ stage: "upstream" });
    return upstream;
  }
  let catalog: Record<string, unknown>;
  try {
    catalog = augmentNativeModelCatalog(await upstream.json(), config, contextOverride?.());
  } catch (error) {
    onFailure?.(modelCatalogFailure("catalog", error));
    return formatErrorResponse(502, "invalid_response_error", error instanceof Error ? error.message : String(error));
  }
  const body = JSON.stringify(catalog);
  const headers = new Headers(upstream.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  headers.set("etag", `W/\"${createHash("sha256").update(body).digest("base64url")}\"`);
  return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers });
}

export async function nativeSearchRequest(
  req: Request,
  fetchUpstream?: NativeFetch,
): Promise<Response> {
  try {
    return await forwardNativeCodexRequest(req, "alpha/search", fetchUpstream);
  } catch (error) {
    return formatErrorResponse(502, "upstream_error", error instanceof Error ? error.message : String(error));
  }
}

async function nativeImagesRequest(
  req: Request,
  endpoint: NativeImageEndpoint,
  fetchUpstream?: NativeFetch,
): Promise<Response> {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length <= "Bearer ".length) {
    return formatErrorResponse(401, "authentication_error", "Native image requests require incoming Codex Bearer authorization");
  }
  try {
    return await forwardNativeCodexRequest(req, endpoint, fetchUpstream);
  } catch (error) {
    return formatErrorResponse(502, "upstream_error", error instanceof Error ? error.message : String(error));
  }
}

function toolBridgeMaps(parsed: CodexParsedRequest): {
  toolNsMap: Map<string, { namespace: string; name: string }>;
  freeformToolNames: Set<string>;
  toolSearchToolNames: Set<string>;
} {
  const toolNsMap = new Map<string, { namespace: string; name: string }>();
  const freeformToolNames = new Set<string>();
  const toolSearchToolNames = new Set<string>();
  for (const tool of parsed.context.tools ?? []) {
    if (tool.namespace) toolNsMap.set(namespacedToolName(tool.namespace, tool.name), { namespace: tool.namespace, name: tool.name });
    if (tool.freeform) freeformToolNames.add(tool.name);
    if (tool.toolSearch) toolSearchToolNames.add(tool.name);
  }
  return { toolNsMap, freeformToolNames, toolSearchToolNames };
}

export async function responseRequest(
  req: Request,
  config: AppConfig,
  adapterFactory: ChatGptWebAdapterFactory = createChatGptWebAdapter,
  options: ResponseRequestOptions = {},
): Promise<Response> {
  const nativeRequest = req.clone();
  let raw: unknown;
  try {
    raw = await readJsonRequestBody(req);
  } catch (error) {
    void nativeRequest.body?.cancel().catch(() => {});
    return formatErrorResponse(
      400,
      "invalid_request_error",
      error instanceof Error ? error.message : "Request body must be valid JSON",
    );
  }
  const requestedModel = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as { model?: unknown }).model
    : undefined;
  try {
    const identity = extractCodexTurnIdentityFromBody(raw);
    if (identity.threadId && identity.turnId) {
      options.onTurnIdentity?.({ threadId: identity.threadId, turnId: identity.turnId });
    }
  } catch (error) {
    return formatErrorResponse(400, "invalid_request_error", error instanceof Error ? error.message : String(error));
  }
  if (typeof requestedModel === "string" && !isChatGptWebModelSlug(requestedModel)) {
    try {
      return await forwardNativeCodexRequest(nativeRequest, "responses", options.fetchUpstream, raw);
    } catch (error) {
      return formatErrorResponse(502, "upstream_error", error instanceof Error ? error.message : String(error));
    }
  }
  // The native byte-for-byte replay branch is unused for a Web request. Release its tee buffer
  // before the browser turn, which may stay active for minutes.
  void nativeRequest.body?.cancel().catch(() => {});
  const webRejection = options.webAdmission?.();
  if (webRejection) return webRejection;
  const requestedPreviousResponseId = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as { previous_response_id?: unknown }).previous_response_id
    : undefined;
  const continuationScope = createResponseContinuationScopeFromBody(raw);
  const expanded = expandPreviousResponseInput(raw, { scope: continuationScope });
  let parsed: CodexParsedRequest;
  let route: ChatGptWebModelRoute;
  try {
    parsed = parseRequest(expanded, { allowWebSubagents: config.allowWebSubagents });
    const delegated = normalizeNativeDelegation(parsed);
    if (delegated) parsed = parseRequest(delegated, { allowWebSubagents: config.allowWebSubagents });
    if (options.hermesContext) parsed._hermesContext = options.hermesContext;
    route = routeChatGptWebRequest(parsed, config);
    const identity = extractChatGptTurnIdentity(parsed);
    if (identity.threadId && identity.turnId) {
      options.onTurnIdentity?.({ threadId: identity.threadId, turnId: identity.turnId });
    }
  } catch (error) {
    return formatErrorResponse(400, "invalid_request_error", error instanceof Error ? error.message : String(error));
  }
  const invalidWebImage = findInvalidChatGptWebInputImage(parsed);
  if (invalidWebImage) return formatErrorResponse(400, "invalid_request_error", invalidWebImage);
  let requestConfig = config;
  if (route.interactionMode === "automatic" && route.adapterEffort === "max" && options.readProModelVersion) {
    requestConfig = { ...config };
    try {
      const proModelVersion = parseChatGptWebProModelVersion(options.readProModelVersion());
      if (proModelVersion === undefined) delete requestConfig.proModelVersion;
      else requestConfig.proModelVersion = proModelVersion;
    } catch {
      return formatErrorResponse(400, "invalid_request_error",
        "ChatGPT Pro model preference is invalid or unavailable. Open Settings and choose a Pro model.");
    }
  }
  if (parsed._opaqueMultiAgentV2Payload) {
    return formatErrorResponse(
      400,
      "invalid_request_error",
      "ChatGPT Web cannot read this encrypted cross-backend subagent payload. "
        + "Start a new Compatibility V1 task, or delegate from a Web model whose collaboration call uses the plaintext-delivery marker.",
    );
  }
  if (typeof requestedPreviousResponseId === "string" && expanded === raw) {
    const stateStatus = previousResponseStateStatus(requestedPreviousResponseId, { scope: continuationScope });
    const nonretained = stateStatus === "not-retained-too-large"
      ? " The bridge did not retain it because its continuation state exceeded the memory limit."
      : stateStatus === "not-retained-unserializable"
        ? " The bridge did not retain it because its continuation state was not serializable."
        : stateStatus === "not-retained-capacity"
          ? " The bridge did not retain it because the bounded continuation cache had no capacity."
          : stateStatus === "not-retained-snapshot-capacity"
            ? " The bridge could not retain it within the durable history limit."
          : stateStatus === "owner-mismatch" || stateStatus === "owner-unavailable"
            ? " Its saved ownership does not match this task."
          : "";
    return formatErrorResponse(
      409,
      "invalid_request_error",
      "Local continuation state for previous_response_id is unavailable; refusing to run ChatGPT Web with partial Codex context."
        + nonretained
        + " Compact the Codex task or start a new task before retrying.",
    );
  }

  const compaction = parsed._compactionRequest === true;
  if (compaction
    && route.interactionMode === "automatic"
    && route.backendModel === CHATGPT_WEB_BACKEND_MODEL
    && route.adapterEffort === "max"
    && options.readCompactionModel) {
    requestConfig = { ...requestConfig };
    const compactionModel = options.readCompactionModel();
    if (compactionModel === undefined) delete requestConfig.compactionModel;
    else requestConfig.compactionModel = compactionModel;
  }
  const rememberCompletedResponse = (response: Record<string, unknown>): void => {
    options.onCompletedResponse?.(response);
    if (!compaction) {
      if (options.rememberState !== false) {
        const retention = rememberResponseState(parsed._rawBody, response, { force: true, scope: continuationScope });
        if (retention.status === "not-retained") {
          console.warn(`[codex-chatgpt-web] continuation_state_not_retained reason=${retention.reason}`);
        }
      }
      return;
    }
    if (response.status !== "completed") return;
    const identity = extractChatGptTurnIdentity(parsed);
    if (!identity.threadId || !identity.turnId || !Array.isArray(response.output) || response.output.length !== 1) return;
    const item = response.output[0];
    if (item?.type !== "compaction" || typeof item.encrypted_content !== "string") return;
    const summary = decodeCompactionSummary(item.encrypted_content);
    if (!summary) return;
    const source = extractChatGptCompactionSourceRevision(parsed);
    const body = parsed._rawBody as { input?: unknown[] };
    // v1 installs the bounded user-message output, whereas v2 retains the original source.
    // Authenticate both exact producer-defined representations, never arbitrary rewrites.
    const v1Source = extractChatGptCompactionSourceRevision({
      ...parsed,
      _rawBody: { ...body, input: buildCompactV1Output(extractCompactUserMessages(body.input), summary) },
    });
    rememberCompactionContinuation(parsed, identity, [source, v1Source], summary);
  };
  if (compaction && route.backendModel === CHATGPT_WEB_LUNA_BACKEND_MODEL) {
    return formatErrorResponse(
      409,
      "invalid_request_error",
      "ChatGPT Web Luna uses a rolling checkpoint on every completed browser turn; separate Codex compaction is disabled for this route.",
    );
  }
  if (compaction) {
    // History compaction is a dedicated summarization turn. It must never bind the active Codex
    // tool bridge or continue an in-flight MCP round; the returned summary becomes the next turn's
    // replacement history through the Responses compaction contract.
    delete parsed.context.tools;
    delete parsed.options.toolChoice;
    delete parsed.options.parallelToolCalls;
    parsed.context.messages.push({ role: "user", content: COMPACT_PROMPT, timestamp: Date.now() });
  }

  const provider = providerConfig(requestConfig);
  if (options.hermesContext && !parsed.context.tools?.length && provider.chatgptWeb) {
    provider.chatgptWeb.localToolsEnabled = false;
  }
  // A Pro pin is part of retained-chat identity only for turns whose UI selection it changes.
  // Keeping it on High/Light would abandon otherwise compatible retained conversations.
  if (!(route.interactionMode === "automatic" && route.adapterEffort === "max")) {
    delete provider.chatgptWeb?.proModelVersion;
  }
  let traceId: string | undefined;
  try {
    traceId = chatGptWebTraceId(provider, parsed);
  } catch (error) {
    // A cancelled browser session can only exist after the adapter accepted canonical native
    // turn identity and user-revision metadata. Requests without that identity have no matching
    // trace tombstone; preserve the adapter's existing strict validation/error path below.
    const message = error instanceof Error ? error.message : String(error);
    if (message === CHATGPT_TURN_REVISION_CONFLICT_MESSAGE) {
      // Codex can reopen an interrupted task with only refreshed developer/skill context under a
      // new turn_id. Its last human prompt still belongs to the stopped turn and must not be
      // replayed as new work. HTTP 400 makes that malformed recovery request terminal instead of
      // allowing Codex to retry it as an upstream 502.
      return formatErrorResponse(400, "invalid_request_error", message);
    }
    if (!message.includes("requires native Codex turn_id metadata")
      && !message.includes("requires a current-turn user message")) throw error;
  }
  const cancelledError = traceId ? chatGptTurnSessions.cancelledError(traceId) : undefined;
  if (cancelledError) {
    // Codex retries unknown streamed response.failed codes. A replay after the user explicitly
    // closed the only browser document is instead a terminal client state: repeating that exact
    // request is invalid and must not recreate the DOM. Codex maps HTTP 400 to its non-retryable
    // InvalidRequest category while the body preserves the real client_cancelled classification.
    return new Response(JSON.stringify({
      error: {
        type: "client_closed_request",
        code: "client_cancelled",
        message: cancelledError.message,
      },
    }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const adapter = adapterFactory(provider);
  const queue = new AsyncEventQueue<AdapterEvent>(
    10_000,
    parsed.stream ? 32 * 1024 * 1024 : undefined,
    event => Buffer.byteLength(JSON.stringify(event), "utf8"),
  );
  const abort = new AbortController();
  let retryHandoffCommitted = false;
  const revokeRetryHandoff = () => {
    try {
      clearRetryableTurnHandoff(parsed, extractChatGptTurnIdentity(parsed));
    } catch {
      // Requests without native ChatGPT turn identity have no retry handoff to revoke.
    }
  };
  const onRequestAbort = () => {
    if (!retryHandoffCommitted) revokeRetryHandoff();
    abort.abort(req.signal.reason);
    queue.cancel();
  };
  if (req.signal.aborted) onRequestAbort();
  else req.signal.addEventListener("abort", onRequestAbort, { once: true });
  let eventDeliveryFailed = false;
  let collectedEventBytes = 0;
  let collectedEventCount = 0;
  const rememberRetryableHandoff = (event: AdapterEvent): void => {
    if (event.type !== "error" || event.retryable !== true || event.status !== 503 || abort.signal.aborted) return;
    retryHandoffCommitted = true;
    const source = chatGptTurnUserRevisionHistory(parsed).at(-1);
    if (source) rememberRetryableTurnFailure(parsed, extractChatGptTurnIdentity(parsed), source);
  };
  const deliverEvent = (event: AdapterEvent): void => {
    if (eventDeliveryFailed || abort.signal.aborted) return;
    try {
      if (!parsed.stream) {
        // Queue depth alone does not bound an already-drained non-streaming response.
        collectedEventBytes += Buffer.byteLength(JSON.stringify(event), "utf8");
        collectedEventCount += 1;
        if (collectedEventBytes > 32 * 1024 * 1024 || collectedEventCount > 100_000) {
          throw new Error("Non-streaming response event budget exceeded; use streaming for long turns");
        }
      }
      options.onAdapterEvent?.(event);
      queue.push(event);
    } catch (error) {
      // Producers also emit from timer/process callbacks outside runTurn's promise. Never
      // throw from that boundary, or try to enqueue an error into an already-full buffer.
      eventDeliveryFailed = true;
      queue.fail(error);
      abort.abort(error);
    }
  };
  const run = async () => {
    try {
      // The body may finish asynchronously after an operator shutdown scan. An already
      // cancelled observer must not register a new detached compaction/browser owner.
      abort.signal.throwIfAborted();
      await adapter.runTurn!(parsed, { headers: req.headers, abortSignal: abort.signal }, deliverEvent);
    } catch (error) {
      const event: AdapterEvent = { type: "error", message: error instanceof Error ? error.message : String(error) };
      deliverEvent(event);
    } finally {
      queue.close();
      req.signal.removeEventListener("abort", onRequestAbort);
    }
  };
  const maps = toolBridgeMaps(parsed);
  const responseModel = route.slug;

  if (parsed.stream) {
    void run();
    const stream = bridgeToResponsesSSE(
      queue,
      responseModel,
      maps.toolNsMap,
      maps.freeformToolNames,
      maps.toolSearchToolNames,
      () => {
        abort.abort();
        queue.cancel();
      },
      2_000,
      {
        hideThinkingSummary: parsed.options.hideThinkingSummary,
        ...(provider.chatgptWeb?.stallTimeoutSec !== undefined
          ? { stallTimeoutSec: provider.chatgptWeb.stallTimeoutSec }
          : {}),
        ...(compaction ? { compaction: true } : {}),
        onCompletedResponse: rememberCompletedResponse,
        onProcessedTerminalEvent: rememberRetryableHandoff,
        onClientCancel: revokeRetryHandoff,
      },
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const events: AdapterEvent[] = [];
  const collect = (async () => {
    try {
      for await (const event of queue) events.push(event);
    } catch (error) {
      events.length = 0;
      events.push({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  })();
  await Promise.all([run(), collect]);
  const json = buildResponseJSON(events, responseModel, {
    hideThinkingSummary: parsed.options.hideThinkingSummary,
    toolNsMap: maps.toolNsMap,
    freeformToolNames: maps.freeformToolNames,
    toolSearchToolNames: maps.toolSearchToolNames,
    ...(compaction ? { compaction: true } : {}),
  });
  for (const event of events) rememberRetryableHandoff(event);
  rememberCompletedResponse(json);
  return Response.json(json);
}

export async function compactRequest(
  req: Request,
  config: AppConfig,
  adapterFactory: ChatGptWebAdapterFactory = createChatGptWebAdapter,
  options: Pick<ResponseRequestOptions, "onTurnIdentity" | "readProModelVersion" | "readCompactionModel" | "webAdmission" | "fetchUpstream"> = {},
): Promise<Response> {
  const nativeRequest = req.clone();
  let raw: Record<string, unknown>;
  try {
    const parsed = await readJsonRequestBody(req);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    raw = parsed as Record<string, unknown>;
  } catch (error) {
    void nativeRequest.body?.cancel().catch(() => {});
    return formatErrorResponse(
      400,
      "invalid_request_error",
      error instanceof Error ? error.message : "Compaction request body must be a JSON object",
    );
  }
  const headerTurnMetadata = req.headers.get("x-codex-turn-metadata");
  if (headerTurnMetadata) {
    const existingMetadata = raw.client_metadata;
    const clientMetadata = existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata)
      ? existingMetadata as Record<string, unknown>
      : {};
    raw = {
      ...raw,
      client_metadata: {
        ...clientMetadata,
        // `/responses/compact` carries native turn authority in this canonical Codex header,
        // unlike ordinary `/responses` payloads where the same value also appears in the body.
        "x-codex-turn-metadata": headerTurnMetadata,
      },
    };
  }
  try {
    const identity = extractCodexTurnIdentityFromBody(raw);
    if (identity.threadId && identity.turnId) {
      options.onTurnIdentity?.({ threadId: identity.threadId, turnId: identity.turnId });
    }
  } catch (error) {
    return formatErrorResponse(400, "invalid_request_error", error instanceof Error ? error.message : String(error));
  }
  if (typeof raw.model !== "string" || !raw.model) {
    void nativeRequest.body?.cancel().catch(() => {});
    return formatErrorResponse(400, "invalid_request_error", "Compaction request requires a model");
  }
  if (!isChatGptWebModelSlug(raw.model)) {
    try {
      return await forwardNativeCodexRequest(nativeRequest, "responses/compact", options.fetchUpstream, raw);
    } catch (error) {
      return formatErrorResponse(502, "upstream_error", error instanceof Error ? error.message : String(error));
    }
  }
  void nativeRequest.body?.cancel().catch(() => {});
  const webRejection = options.webAdmission?.();
  if (webRejection) return webRejection;
  let route: ChatGptWebModelRoute;
  try {
    route = requireChatGptWebModelRoute(raw.model, config);
  } catch (error) {
    return formatErrorResponse(400, "invalid_request_error", error instanceof Error ? error.message : String(error));
  }
  if (route.backendModel === CHATGPT_WEB_LUNA_BACKEND_MODEL) {
    return formatErrorResponse(
      409,
      "invalid_request_error",
      "ChatGPT Web Luna uses a rolling checkpoint on every completed browser turn; separate Codex compaction is disabled for this route.",
    );
  }
  const input = Array.isArray(raw.input) ? raw.input : [];
  const headers = new Headers(req.headers);
  headers.set("content-type", "application/json");
  const internal = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...raw, stream: false, input: [...input, { type: "compaction_trigger" }] }),
    signal: req.signal,
  });
  const response = await responseRequest(internal, config, adapterFactory, options);
  if (!response.ok) return response;
  let body: {
    output?: unknown[];
    status?: unknown;
    error?: { message?: unknown; type?: unknown; code?: unknown } | null;
  };
  try {
    body = await response.json() as typeof body;
  } catch {
    return formatErrorResponse(502, "invalid_response_error", "Compaction turn returned invalid JSON");
  }
  if (body.error) {
    const error = {
      message: typeof body.error.message === "string" ? body.error.message : "Compaction turn failed",
      type: typeof body.error.type === "string" ? body.error.type : "upstream_error",
      code: typeof body.error.code === "string" ? body.error.code : null,
    };
    return Response.json(
      { error },
      { status: httpStatusFromTerminalError(error) },
    );
  }
  if (body.status !== "completed") {
    return formatErrorResponse(502, "upstream_error", `Compaction turn failed (status: ${String(body.status ?? "unknown")})`);
  }
  const items = (body.output ?? []).filter(
    (item): item is { type: "compaction"; encrypted_content?: string } =>
      Boolean(item && typeof item === "object" && (item as { type?: string }).type === "compaction"),
  );
  if (items.length !== 1) {
    return formatErrorResponse(502, "invalid_response_error", `Compaction turn produced ${items.length} compaction items; expected one`);
  }
  const summary = typeof items[0]!.encrypted_content === "string"
    ? decodeCompactionSummary(items[0]!.encrypted_content)
    : null;
  if (!summary?.trim()) {
    return formatErrorResponse(502, "invalid_response_error", "Compaction turn produced an empty summary");
  }
  return Response.json({ output: buildCompactV1Output(extractCompactUserMessages(input), summary) });
}

const JSON_REQUEST_PATHS = new Set([
  "/v1/responses",
  "/hermes/v1/responses",
  "/v1/responses/compact",
  "/v1/alpha/search",
]);

/**
 * Loopback is not itself a browser-origin boundary. Reject rebinding authorities and browser
 * cross-site requests before reading a body or starting any account-backed work. Native Codex
 * sends no Origin; it remains compatible without introducing a second bearer credential.
 */
function localHttpRequestRejection(req: Request, url: URL, port: number): Response | undefined {
  const authority = (req.headers.get("host") ?? "").toLowerCase();
  const allowedAuthorities = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (port === 80) {
    allowedAuthorities.add("127.0.0.1");
    allowedAuthorities.add("localhost");
  }
  if (!allowedAuthorities.has(authority)) {
    return formatErrorResponse(403, "permission_error", "The local bridge requires its exact loopback Host");
  }
  const origin = req.headers.get("origin");
  if (origin !== null && origin !== `http://${authority}`) {
    // URL.origin omits :80, so permit its canonical spelling when using the default HTTP port.
    const canonicalOrigin = new URL(`http://${authority}`).origin;
    if (origin !== canonicalOrigin) {
      return formatErrorResponse(403, "permission_error", "Cross-origin browser requests are not allowed");
    }
  }
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") {
    return formatErrorResponse(403, "permission_error", "Cross-site browser requests are not allowed");
  }
  if (req.method === "POST" && JSON_REQUEST_PATHS.has(url.pathname)) {
    const mediaType = (req.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
    if (mediaType !== "application/json") {
      return formatErrorResponse(415, "invalid_request_error", "This endpoint requires application/json");
    }
  }
  return undefined;
}

export function startServer(
  config: AppConfig,
  dependencies: {
    fetchUpstream?: NativeFetch;
    adapterFactory?: ChatGptWebAdapterFactory;
    readProModelVersion?: () => ChatGptWebProModelVersion | undefined;
  readCompactionModel?: () => ChatGptWebCompactionModel | undefined;
  } = {},
): Bun.Server<undefined> & { disposeSignalHandlers(): void } {
  if (config.purpose === "dev-harness") {
    throw new Error("DEV harness configuration cannot start a Responses listener");
  }
  const startedAt = Date.now();
  const instanceId = randomUUID();
  const backgroundRuntime = process.env.CODEX_CHATGPT_WEB_BACKGROUND_RUNTIME === "1";
  let launcherDetached = false;
  const turnBroker = config.mode === "full" ? TurnBroker.forSocket(config.brokerSocketPath) : undefined;
  let brokerState: "not-required" | "starting" | "ready" | "failed" = turnBroker
    ? "starting"
    : "not-required";
  let brokerFailureCode: string | undefined;
  let draining = false;
  // Launcher-owned Full mode reports tunnel readiness separately from the local listener.
  // Standalone hosts retain their existing tunnel service contract.
  const requiresTunnelSignal = config.mode === "full" && config.browserHost === "launcher";
  let tunnelReady = !requiresTunnelSignal;
  let tunnelStatusRevision = 0;
  const brokerReady = () => !turnBroker || brokerState === "ready";
  const acceptingNative = () => !draining;
  const acceptingTurns = () => !draining && !launcherDetached && brokerReady() && tunnelReady;
  const admissionFailure = () => formatErrorResponse(
    503,
    "server_error",
    draining
      ? "NEKODEX is restarting; retry after it is ready."
      : launcherDetached
        ? "Open NEKODEX to use ChatGPT Web. Native Codex models remain available in the background."
      : !brokerReady()
        ? "NEKODEX local-tool broker is not ready; native models remain available. Repair the tool connection before retrying this Web request."
        : "NEKODEX tool tunnel is not ready; native models remain available. Reconnect the tunnel before retrying this Web request.",
  );
  if (config.mode === "full") {
    turnBroker!.setExternalOwnersAccepted(false);
    void turnBroker!.listen().then(() => {
      brokerState = "ready";
      turnBroker!.setExternalOwnersAccepted(acceptingTurns());
    }, error => {
      brokerState = "failed";
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      brokerFailureCode = typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code)
        ? code
        : "broker_listen_failed";
      turnBroker!.setExternalOwnersAccepted(false);
      console.error(
        `[chatgpt-web] turn broker endpoint is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
  let shutdownPromise: Promise<void> | undefined;
  let successfulModelCatalogRequests = 0;
  let lastSuccessfulModelCatalogRequestAt: string | null = null;
  let modelCatalogRequests = 0;
  let lastModelCatalogResult: {
    request: number; at: string; status: number; failure?: ModelCatalogFailure;
  } | null = null;
  const httpTurns = new HttpTurnCounter();
  const hermes = new HermesIntegration();
  const activity = () => ({
    active_http_turns: httpTurns.count(),
    active_web_http_turns: httpTurns.webCount(),
    active_browser_turns: chatGptTurnSessions.activeCount() + (turnBroker?.externalOwnerActiveCount() ?? 0),
    active_compaction_runs: activeStructuredCompactionCount(),
  });
  const controlAuthorized = (req: Request): boolean => {
    const header = req.headers.get("authorization") ?? "";
    const expected = Buffer.from(`Bearer ${config.controlToken}`);
    const actual = Buffer.from(header);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const rejection = localHttpRequestRejection(req, url, server.port!);
      if (rejection) return rejection;
      if (url.pathname.startsWith("/hermes/")) {
        if (!hermes.authorized(req)) return formatErrorResponse(401, "authentication_error", "Add the Hermes provider from Setup to authorize this local connection.");
        if (req.method === "GET" && url.pathname === "/hermes/v1/models") return hermes.models(config);
        if (req.method === "POST" && url.pathname === "/hermes/v1/responses") {
          if (!acceptingTurns()) return admissionFailure();
          return httpTurns.track((signal, _bindIdentity, bindWeb) => {
            bindWeb();
            return hermes.respond(new Request(req, { signal }), config,
            (request, hermesContext, onCompletedResponse) => responseRequest(request, config, dependencies.adapterFactory, {
              hermesContext, onCompletedResponse, rememberState: false,
              ...(dependencies.readProModelVersion ? { readProModelVersion: dependencies.readProModelVersion } : {}),
              ...(dependencies.readCompactionModel ? { readCompactionModel: dependencies.readCompactionModel } : {}),
            }));
          }, req.signal, process.platform, "responses");
        }
        return formatErrorResponse(404, "invalid_request_error", "Hermes uses /hermes/v1/responses with transport codex_responses.");
      }
      if (req.method === "GET" && url.pathname === "/healthz") {
        return Response.json({
          status: "ok",
          service: "codex-chatgpt-web",
          version: VERSION,
          mode: config.mode,
          pid: process.pid,
          instance_id: instanceId,
          background_runtime: backgroundRuntime,
          launcher_detached: launcherDetached,
          port: config.port,
          uptime: (Date.now() - startedAt) / 1_000,
          accepting_turns: acceptingTurns(),
          native_accepting_turns: acceptingNative(),
          web_accepting_turns: acceptingTurns(),
          draining,
          broker_ready: brokerReady(),
          broker_state: brokerState,
          tunnel_ready: tunnelReady,
          tunnel_status_revision: tunnelStatusRevision,
          ...(brokerFailureCode ? { broker_failure_code: brokerFailureCode } : {}),
          browser_capacity: MAX_CHATGPT_BROWSER_TABS,
          model_catalog_requests: modelCatalogRequests,
          last_model_catalog_result: lastModelCatalogResult,
          successful_model_catalog_requests: successfulModelCatalogRequests,
          last_successful_model_catalog_request_at: lastSuccessfulModelCatalogRequestAt,
          ...activity(),
        });
      }
      if (req.method === "POST" && url.pathname === "/admin/runtime-session") {
        if (!controlAuthorized(req)) return new Response("Unauthorized", { status: 401 });
        let body: { action?: unknown; instanceId?: unknown };
        try { body = await readJsonRequestBody(req, 4096, 4096) as typeof body; }
        catch { return new Response("Invalid runtime session request", { status: 400 }); }
        if (!body || typeof body.action !== "string" || !["status", "attach", "detach"].includes(body.action)
          || body.instanceId !== instanceId) return new Response("Runtime identity changed", { status: 409 });
        if (body.action === "detach") {
          // Close Web admission before inspecting owners. Native HTTP streams do not depend
          // on Electron and must neither be drained nor cancelled by an interface exit.
          const previous = launcherDetached;
          launcherDetached = true;
          turnBroker?.setExternalOwnersAccepted(false);
          const current = activity();
          if (!backgroundRuntime || !nativeNetworkBackgroundReady() || draining
            || current.active_web_http_turns || current.active_browser_turns || current.active_compaction_runs) {
            launcherDetached = previous;
            turnBroker?.setExternalOwnersAccepted(acceptingTurns());
            return Response.json({ status: "refused", ...current }, { status: 409 });
          }
        } else if (body.action === "attach") {
          launcherDetached = false;
          // An attached interface must establish its own live tunnel observation.
          tunnelReady = !requiresTunnelSignal;
          turnBroker?.setExternalOwnersAccepted(acceptingTurns());
        }
        return Response.json({ status: "ok", service: "codex-chatgpt-web", version: VERSION,
          mode: config.mode, pid: process.pid, instance_id: instanceId,
          background_runtime: backgroundRuntime, background_network_ready: nativeNetworkBackgroundReady(),
          launcher_detached: launcherDetached, native_accepting_turns: acceptingNative(),
          web_accepting_turns: acceptingTurns(), ...activity() });
      }
      if (req.method === "POST" && url.pathname === "/admin/tunnel-status") {
        if (!controlAuthorized(req)) return new Response("Unauthorized", { status: 401 });
        let body: unknown;
        try { body = await readJsonRequestBody(req); } catch {
          return formatErrorResponse(400, "invalid_request_error", "Tunnel readiness requires a boolean and a positive revision");
        }
        if (!body || typeof body !== "object" || Array.isArray(body)
          || typeof (body as { ready?: unknown }).ready !== "boolean"
          || !Number.isSafeInteger((body as { revision?: unknown }).revision)
          || ((body as { revision: number }).revision < 1)) {
          return formatErrorResponse(400, "invalid_request_error", "Tunnel readiness requires a boolean and a positive revision");
        }
        const update = body as { ready: boolean; revision: number };
        const applied = update.revision > tunnelStatusRevision;
        if (applied) {
          tunnelStatusRevision = update.revision;
          tunnelReady = !requiresTunnelSignal || update.ready;
          turnBroker?.setExternalOwnersAccepted(acceptingTurns());
        }
        return Response.json({ status: "ok", native_accepting_turns: acceptingNative(),
          web_accepting_turns: acceptingTurns(), tunnel_ready: tunnelReady, broker_ready: brokerReady(),
          applied, tunnel_status_revision: tunnelStatusRevision });
      }
      if (req.method === "POST" && (url.pathname === "/admin/drain" || url.pathname === "/admin/resume")) {
        if (!controlAuthorized(req)) return new Response("Unauthorized", { status: 401 });
        draining = url.pathname === "/admin/drain";
        turnBroker?.setExternalOwnersAccepted(acceptingTurns());
        return Response.json({
          status: "ok",
          accepting_turns: acceptingTurns(),
          native_accepting_turns: acceptingNative(),
          web_accepting_turns: acceptingTurns(),
          draining,
          broker_ready: brokerReady(),
          broker_state: brokerState,
          tunnel_ready: tunnelReady,
          tunnel_status_revision: tunnelStatusRevision,
          ...activity(),
        });
      }
      if (req.method === "POST" && url.pathname === "/admin/cancel-turn") {
        if (!controlAuthorized(req)) return new Response("Unauthorized", { status: 401 });
        let traceId: string;
        let leaseFailure: "browser_surface_bootstrap_timeout" | "helper_heartbeat_expired" | undefined;
        try {
          const body = await readJsonRequestBody(req, 4_096, 4_096) as { traceId?: unknown; reason?: unknown };
          traceId = typeof body?.traceId === "string" ? body.traceId : "";
          if (!/^[A-Za-z0-9_-]{6,128}$/.test(traceId)) throw new Error("traceId is invalid");
          if (body.reason !== undefined) {
            if (body.reason !== "browser_surface_bootstrap_timeout" && body.reason !== "helper_heartbeat_expired") {
              throw new Error("Browser turn cancellation reason is invalid");
            }
            leaseFailure = body.reason;
          }
        } catch (error) {
          return Response.json(
            { status: "error", error: error instanceof Error ? error.message : String(error) },
            { status: 400 },
          );
        }
        const reason = leaseFailure
          ? new ChatGptWebAdapterError(
            leaseFailure === "browser_surface_bootstrap_timeout"
              ? "The ChatGPT browser turn did not finish browser setup before its lease expired. The turn was stopped."
              : "The ChatGPT browser helper stopped reporting progress and its lease expired. The turn was stopped.",
            { status: 504, errorType: "server_error", code: leaseFailure, retryable: false },
          )
          : chatGptBrowserTabClosedError();
        // Revoke the owner first. This prevents a compaction callback that observes its retained
        // source being cancelled below from starting a fresh fallback during operator shutdown.
        const compactionCancellation = cancelStructuredCompactionTrace(traceId, reason);
        const browserCancellation = chatGptTurnSessions.cancelTrace(traceId, reason);
        const [cancelledBrowserTurns, cancelledCompactionRuns] = await Promise.all([
          browserCancellation,
          compactionCancellation,
        ]);
        const cancelledBrokerTurns = turnBroker?.revokeTrace(traceId, reason) ?? 0;
        return Response.json({
          status: "ok",
          trace_id: traceId,
          cancelled_browser_turns: cancelledBrowserTurns,
          cancelled_broker_turns: cancelledBrokerTurns,
          cancelled_compaction_runs: cancelledCompactionRuns,
          ...activity(),
        });
      }
      if (req.method === "POST" && url.pathname === "/admin/interrupt-turn") {
        if (!controlAuthorized(req)) return new Response("Unauthorized", { status: 401 });
        let identity: NativeCodexTurnIdentity;
        try {
          const body = await readJsonRequestBody(req, 4_096, 4_096) as { threadId?: unknown; turnId?: unknown };
          const threadId = typeof body?.threadId === "string" ? body.threadId.trim() : "";
          const turnId = typeof body?.turnId === "string" ? body.turnId.trim() : "";
          if (!/^[A-Za-z0-9_-]{6,128}$/.test(threadId) || !/^[A-Za-z0-9_-]{6,128}$/.test(turnId)) {
            throw new Error("native Codex threadId or turnId is invalid");
          }
          identity = { threadId, turnId };
        } catch (error) {
          return Response.json(
            { status: "error", error: error instanceof Error ? error.message : String(error) },
            { status: 400 },
          );
        }
        const reason = new DOMException("Codex turn interrupted", "AbortError");
        const browserCancellation = chatGptTurnSessions.cancelNativeTurn(
          identity.threadId,
          identity.turnId,
          reason,
        );
        const compactionCancellation = cancelStructuredCompactionNativeTurn(
          identity.threadId,
          identity.turnId,
          reason,
        );
        const httpCancellation = httpTurns.beginCancelTurn(identity, reason);
        const settlement = Promise.allSettled([
          browserCancellation.settlement,
          compactionCancellation.settlement,
          httpCancellation.settlement,
        ]);
        void settlement.then(results => {
          for (const result of results) {
            if (result.status === "rejected") {
              console.error(
                `[chatgpt-web] interrupted turn cleanup failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
              );
            }
          }
        });
        return Response.json({
          status: "ok",
          cancelled_http_turns: httpCancellation.cancelled,
          cancelled_browser_turns: browserCancellation.cancelled,
          cancelled_compaction_runs: compactionCancellation.cancelled,
        });
      }
      if (req.method === "POST" && url.pathname === "/admin/cancel-turns") {
        if (!controlAuthorized(req)) return new Response("Unauthorized", { status: 401 });
        const reason = new Error("Active turn cancelled by launcher");
        // Abort shared compaction owners before clearing their retained source sessions. The
        // owner signal is the only cancellation boundary for a fresh fallback not in the session
        // registry.
        const compactionCancellation = cancelAllStructuredCompactions(reason);
        const cancelledBrowserTurns = chatGptTurnSessions.clear() + (turnBroker?.revokeExternalOwners() ?? 0);
        const [cancelledHttpTurns, cancelledCompactionRuns] = await Promise.all([
          httpTurns.cancelAll(reason),
          compactionCancellation,
        ]);
        return Response.json({
          status: "ok",
          cancelled_http_turns: cancelledHttpTurns,
          cancelled_browser_turns: cancelledBrowserTurns,
          cancelled_compaction_runs: cancelledCompactionRuns,
          ...activity(),
        });
      }
      if (req.method === "POST" && url.pathname === "/admin/shutdown") {
        if (!controlAuthorized(req)) return new Response("Unauthorized", { status: 401 });
        const current = activity();
        if (!draining || current.active_http_turns > 0 || current.active_browser_turns > 0
          || current.active_compaction_runs > 0) {
          return Response.json(
            {
              status: "refused",
              accepting_turns: !draining,
              ...current,
            },
            { status: 409 },
          );
        }
        setTimeout(shutdown, 0);
        return Response.json({ status: "ok", accepting_turns: false, ...current });
      }
      if (req.method === "GET" && url.pathname === "/v1/models") {
        if (!acceptingNative()) return admissionFailure();
        return httpTurns.track(async signal => {
          const request = ++modelCatalogRequests;
          const recordResult = (response: Response, failure?: ModelCatalogFailure): Response => {
            const result = { request, at: new Date().toISOString(), status: response.status, ...(failure ? { failure } : {}) };
            // A slower old request cannot overwrite a newer completed request.
            if (!lastModelCatalogResult || request > lastModelCatalogResult.request) lastModelCatalogResult = result;
            return response;
          };
          let catalogConfig: AppConfig;
          try {
            catalogConfig = {
              ...config,
              subagentProtocol: readCodexSubagentProtocol(config.subagentProtocol),
            };
          } catch (error) {
            return recordResult(formatErrorResponse(
              500,
              "server_error",
              `Could not resolve the installed subagent protocol: ${error instanceof Error ? error.message : String(error)}`,
            ), modelCatalogFailure("config", error));
          }
          let failure: ModelCatalogFailure | undefined;
          const response = await modelsRequest(
            new Request(req, { signal }),
            catalogConfig,
            dependencies.fetchUpstream,
            readCodexModelContextOverride,
            value => { failure = value; },
          );
          if (response.ok) {
            successfulModelCatalogRequests += 1;
            lastSuccessfulModelCatalogRequestAt = new Date().toISOString();
          }
          return recordResult(response, failure);
        }, req.signal, process.platform, "models");
      }
      if (req.method === "GET" && url.pathname === "/v1/responses") {
        return new Response("Responses WebSocket transport is not enabled on this local route", {
          status: 426,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
      if (req.method === "POST" && url.pathname === "/v1/responses") {
        if (!acceptingNative()) return admissionFailure();
        return httpTurns.track(
          (signal, bindIdentity, bindWeb) => responseRequest(
            new Request(req, { signal }),
            config,
            dependencies.adapterFactory,
            {
              onTurnIdentity: bindIdentity,
              webAdmission: () => {
                if (!acceptingTurns()) return admissionFailure();
                bindWeb();
                return undefined;
              },
              fetchUpstream: dependencies.fetchUpstream,
              ...(dependencies.readProModelVersion ? { readProModelVersion: dependencies.readProModelVersion } : {}),
              ...(dependencies.readCompactionModel ? { readCompactionModel: dependencies.readCompactionModel } : {}),
            },
          ),
          req.signal,
          process.platform,
          "responses",
        );
      }
      if (req.method === "POST" && url.pathname === "/v1/responses/compact") {
        if (!acceptingNative()) return admissionFailure();
        return httpTurns.track(
          (signal, bindIdentity, bindWeb) => compactRequest(
            new Request(req, { signal }),
            config,
            dependencies.adapterFactory,
            {
              onTurnIdentity: bindIdentity,
              webAdmission: () => {
                if (!acceptingTurns()) return admissionFailure();
                bindWeb();
                return undefined;
              },
              fetchUpstream: dependencies.fetchUpstream,
              ...(dependencies.readProModelVersion ? { readProModelVersion: dependencies.readProModelVersion } : {}),
              ...(dependencies.readCompactionModel ? { readCompactionModel: dependencies.readCompactionModel } : {}),
            },
          ),
          req.signal,
          process.platform,
          "compact",
        );
      }
      if (req.method === "POST" && url.pathname === "/v1/alpha/search") {
        if (!acceptingNative()) return admissionFailure();
        return httpTurns.track(
          signal => nativeSearchRequest(new Request(req, { signal }), dependencies.fetchUpstream),
          req.signal,
          process.platform,
          "search",
        );
      }
      if (req.method === "POST"
        && (url.pathname === "/v1/images/generations" || url.pathname === "/v1/images/edits")) {
        if (!acceptingNative()) return admissionFailure();
        const endpoint: NativeImageEndpoint = url.pathname === "/v1/images/generations"
          ? "images/generations"
          : "images/edits";
        return httpTurns.track(
          signal => nativeImagesRequest(new Request(req, { signal }), endpoint, dependencies.fetchUpstream),
          req.signal,
          process.platform,
          endpoint,
        );
      }
      return new Response("Not found", { status: 404 });
    },
  });
  function shutdown(): void {
    if (shutdownPromise) return;
    disposeSignalHandlers();
    draining = true;
    turnBroker?.setExternalOwnersAccepted(false);
    const reason = new Error("Runtime shutting down");
    // Signal-driven shutdown can arrive without an idle drain. Revoke detached compaction
    // owners before retiring their source sessions, otherwise a fallback can start fresh work.
    const compactionCancellation = cancelAllStructuredCompactions(reason);
    chatGptTurnSessions.clear();
    turnBroker?.revokeExternalOwners();
    const httpCancellation = httpTurns.cancelAll(reason);
    flushResponseState();
    shutdownPromise = (async () => {
      const results = await Promise.allSettled([
        compactionCancellation,
        httpCancellation,
        closeChatGptBrowserWorkers(),
        closeTurnBrokers(),
      ]);
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map(result => result.reason);
      if (failures.length > 0) {
        process.exitCode = 1;
        for (const failure of failures) {
          console.error(`[codex-chatgpt-web] shutdown cleanup failed: ${failure instanceof Error ? failure.message : String(failure)}`);
        }
      }
      await server.stop(true);
    })().catch(error => {
      process.exitCode = 1;
      console.error(`[codex-chatgpt-web] server shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  function disposeSignalHandlers(): void {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
  }
  // Embedders stop the returned Bun server directly. Releasing this listener must also
  // release its process hooks, otherwise later signals act on already-stopped instances.
  const stop = server.stop.bind(server);
  server.stop = (...args: Parameters<typeof stop>) => {
    disposeSignalHandlers();
    return stop(...args);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return Object.assign(server, { disposeSignalHandlers });
}
