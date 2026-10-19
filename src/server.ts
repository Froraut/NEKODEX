import { createAgentOAuthMcpControlRoutes } from './agent-tools/oauth-mcp-control';
import { createAgentOAuthMcpToolsProvider } from './agent-tools/oauth-mcp-provider';
import { createLauncherOAuthMcpBridge } from './agent-tools/oauth-mcp-bridge';
import { ConversationHistoryStore } from "./conversation-history";
import { conversationHistoryRequest } from "./conversation-history/http";
import { AgentModeStore, AgentModeRuntime, activeTaskEvidence, createAgentModeRoutes, createLocalResponsesExecutionPort, createOwnedNativeExecutionPort, createAgentExecutionRouter } from "./agent-mode";
import { createLauncherNativeBridge } from "./agent-mode/launcher-native-bridge";
import { createAgentNativeControlRoutes } from "./agent-mode/native-control";
import { createAgentRemoteControlRoutes } from "./agent-tools/remote-control";
import { createLauncherRemoteBridge } from "./remote-workspace/launcher-bridge";
import { createAgentRemoteToolsProvider, type AgentRemoteToolsProvider } from "./remote-workspace/agent-tools";
import { AGENT_REMOTE_DESCRIPTOR_FILE } from "../launcher/electron/agent-remote-descriptor.cjs";
import { AGENT_NATIVE_DESCRIPTOR_FILE } from "../launcher/electron/agent-native-descriptor.cjs";
import { createAgentToolsComposition, type AgentToolsComposition } from "./agent-tools/composition";
import { browserCompanionRequest, createAgentBrowserToolsProvider, createBrowserCompanionRuntime, type AgentBrowserToolsProvider, type BrowserCompanionRuntime } from "./browser-companion";
import type { ToolScope } from "./agent-tools/types";
import type { AgentTask } from "./agent-mode/types";
import { createAgentDesktopToolsProvider, type AgentDesktopToolsProvider } from "./browser-companion/agent-desktop-tools";
import { resolveDesktopPropertyEvidence } from "./browser-companion/desktop-outcome";
import { resolveBrowserTextTransitionEvidence } from "./browser-companion/outcome-observer";
import { createMacosDesktopProvider } from "./browser-companion/macos-desktop";
import { resolveDesktopHelper, type PinnedDesktopHelper } from "./browser-companion/desktop-helper-path";
import { resolveSkillPdfHelper, type PinnedSkillPdfHelper } from "./agent-tools/skill-pdf-helper-path";
import { createLauncherPythonBuildSelectionBridge } from "./execution-environments/launcher-python-build-selection";
import type { PythonBuildSelection } from "./execution-environments/python-build";
import type { VmRuntimeSelection } from './execution-environments/executor';
import { createVmExportControlRoutes } from './execution-environments/control';
import { createLauncherVmExportBridge } from './execution-environments/launcher-export';
import { createVmExportTools } from './execution-environments/export-tools';
import { AGENT_VM_EXPORT_DESCRIPTOR_FILE } from '../launcher/electron/agent-vm-descriptor.cjs';
import { release as osRelease } from "node:os";
import { createLocalControlApiRoutes } from "./local-control-api";
import { createAgentWorkspaceSnapshots } from "./agent-workspace/store";
import { createAgentWorkspaceEvidence } from "./agent-workspace/evidence";
import { externalClientContext, type ExternalClientContext } from "./external-client-context";
import { localApiKey } from "./local-api-access";
import { chatCompletionApiKey, chatCompletionRequestGuard, chatCompletionErrorResponse, chatCompletionModels, chatCompletionRequest } from "./chat-completions/http";
import { activeChatCompletionTurns, type ChatCompletionExecutor } from "./chat-completions/runtime";
import { NativeChatCompletionBridge } from "./chat-completions/native-bridge";
import { ChatCompletionError } from "./chat-completions/contract";
import { ClaudeMessagesGateway } from "./messages";
import { claudeGatewayModelsResponse, isClaudeGatewayModelsRequest } from "./messages/models";
import { MAX_CHATGPT_BROWSER_TABS } from "./adapters/chatgpt-web/concurrency";
import { chatGptWebTraceId, chatGptWebExecutionNamespace, createChatGptWebAdapter } from "./adapters/chatgpt-web";
import { normalizeNativeDelegation } from "./adapters/chatgpt-web/native-delegation";
import { validateChatGptWebInputImage } from "./adapters/chatgpt-web/input-image-validation";
import { closeChatGptBrowserWorkers } from "./adapters/chatgpt-web/browser-worker";
import { closeTurnBrokers, TurnBroker } from "./adapters/chatgpt-web/turn-broker";
import { configureTurnBrokerEventLog } from "./adapters/chatgpt-web/turn-broker-diagnostics";
import { rejectUnparseableChatGptToolResults } from "./adapters/chatgpt-web/rejected-tool-results";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { chatGptTurnSessions, chatGptTurnExecutionKey } from "./adapters/chatgpt-web/turn-execution";
import {
  activeStructuredCompactionCount,
  cancelAllStructuredCompactions,
  cancelStructuredCompactionNativeTurn,
  beginCancelStructuredCompactionTrace,
} from "./adapters/chatgpt-web/compaction-handoff";
import { ChatGptWebAdapterError, chatGptBrowserTabClosedError } from "./adapters/chatgpt-web/adapter-error";
import {
  CHATGPT_TURN_REVISION_CONFLICT_MESSAGE,
  extractChatGptTurnIdentity,
  extractCodexTurnIdentityFromBody,
  extractChatGptCompactionSourceRevision,
  isCodexComposerPrediction,
  chatGptTurnUserRevisionHistory,
} from "./adapters/chatgpt-web/environment";
import { rememberCompactionContinuation } from "./adapters/chatgpt-web/compaction-continuation";
import { clearRetryableTurnHandoff, rememberRetryableTurnFailure } from "./adapters/chatgpt-web/retry-continuation";
import { bridgeToResponsesSSE, buildResponseJSON, formatErrorResponse } from "./bridge";
import type { AccountCapabilityFields, AppConfig } from "./config";
import { getConfigDir, providerConfig } from "./config";
import { parseChatGptWebProModelVersion, type ChatGptWebProModelVersion } from "./chatgpt-web-models";
import { AsyncEventQueue } from "./event-queue";
import { createInternalJsonRequest, readJsonRequestBody } from "./http-body";
import { httpStatusFromTerminalError } from "./lib/errors";
import { join } from "node:path";
import { augmentNativeModelCatalog } from "./model-catalog";
import { pickerCatalogAgeMs, refreshPickerCatalog } from "./codex-picker-catalog";
import { startNativeUsageDelivery } from "./native-usage-telemetry";
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
  newestChatGptWebProFamily,
  availableChatGptWebModelRoutes,
  requireChatGptWebModelRoute,
  type ChatGptWebModelRoute,
} from "./chatgpt-web-models";
import type { ChatGptWebCompactionModel } from "./chatgpt-web-compaction-policy";
import { forwardNativeCodexRequest, type NativeFetch, type NativeImageEndpoint } from "./native-passthrough";
import type { NativeCodexEndpoint } from "./native-request-preparation";
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

import { HttpTurnCounter, type NativeCodexTurnIdentity } from "./http-turn-lifecycle";
import { ServerAdmission, TUNNEL_UNAVAILABLE_REASON_PATTERN, webAdmissionFailureMessage } from "./server-admission";
import { inferenceRoutePolicy, type InferenceRoutePolicy } from "./server-route-policy";

type ChatGptWebAdapterFactory = (provider: CodexProviderConfig) => ProviderAdapter;

export interface ResponseRequestOptions {
  /** Native passthrough remains available independently of the browser/tool broker. */
  webAdmission?: () => Response | undefined;
  fetchUpstream?: NativeFetch;
  hermesContext?: HermesContext;
  clientContext?: ExternalClientContext;
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
  const route = requireChatGptWebModelRoute(parsed.modelId, config, parsed.options.reasoning);
  parsed.requestedModel = route.slug;
  if (route.interactionMode === "automatic" && route.modelFamily) parsed._chatgptModelFamily = route.modelFamily;
  else delete parsed._chatgptModelFamily;
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

/** An error's `code` when it is a short identifier that is safe to report. */
function safeErrorCode(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code) ? code : undefined;
}

const PICKER_CATALOG_REFRESH_MS = 10 * 60_000;

function modelCatalogFailure(stage: ModelCatalogFailure["stage"], error: unknown): ModelCatalogFailure {
  const code = safeErrorCode(error);
  return { stage, ...(code !== undefined ? { code } : {}) };
}

function upstreamFailure(error: unknown): Response {
  return formatErrorResponse(502, "upstream_error", error instanceof Error ? error.message : String(error));
}

async function forwardNativeOr502(
  req: Request,
  endpoint: NativeCodexEndpoint,
  fetchUpstream?: NativeFetch,
  decodedBody?: unknown,
): Promise<Response> {
  try {
    return await forwardNativeCodexRequest(req, endpoint, fetchUpstream, decodedBody);
  } catch (error) {
    return upstreamFailure(error);
  }
}

/** Bind native turn identity from the request body; a malformed identity releases the native replay body. */
function bindBodyTurnIdentity(
  raw: unknown,
  nativeRequest: Request,
  options: Pick<ResponseRequestOptions, "onTurnIdentity">,
): Response | undefined {
  try {
    const identity = extractCodexTurnIdentityFromBody(raw);
    if (identity.threadId && identity.turnId) {
      options.onTurnIdentity?.({ threadId: identity.threadId, turnId: identity.turnId });
    }
  } catch (error) {
    void nativeRequest.body?.cancel().catch(() => {});
    return formatErrorResponse(400, "invalid_request_error", error instanceof Error ? error.message : String(error));
  }
  return undefined;
}

function lunaCompactionDisabled(): Response {
  return formatErrorResponse(
    409,
    "invalid_request_error",
    "ChatGPT Web Luna uses a rolling checkpoint on every completed browser turn; separate Codex compaction is disabled for this route.",
  );
}

const WEB_BLOCK_REPLAY_MS = 10 * 60_000;
interface BlockedWebTurn { message: string; at: number; status: number; type: string; code: string; upstreamStatus?: number }
const blockedWebTraces = new Map<string, BlockedWebTurn>();
function rememberWebTurnBlock(traceId: string, message: string,
  failure: Omit<BlockedWebTurn, "message" | "at"> = { status: 400, type: "invalid_request_error", code: "account_not_ready" }): void {
  const now = Date.now();
  for (const [key, value] of blockedWebTraces) {
    if (now - value.at > WEB_BLOCK_REPLAY_MS || blockedWebTraces.size > 256) blockedWebTraces.delete(key);
  }
  blockedWebTraces.set(traceId, { message, at: now, ...failure });
}
function takeRecentWebTurnBlock(traceId: string): BlockedWebTurn | undefined {
  const entry = blockedWebTraces.get(traceId);
  if (!entry) return undefined;
  // Consume it: Codex's automatic replay ends here, while a later deliberate retry reaches the
  // launcher again, which re-checks the account and retains any rejected submission's ownership.
  blockedWebTraces.delete(traceId);
  return Date.now() - entry.at <= WEB_BLOCK_REPLAY_MS ? entry : undefined;
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
    return upstreamFailure(error);
  }
  if (!upstream.ok) {
    // A local rejection (for example a missing Bearer) never reached the provider.
    onFailure?.({ stage: sent ? "upstream" : "request" });
    return upstream;
  }
  let catalog: Record<string, unknown>;
  let native: unknown;
  try {
    native = await upstream.json();
    catalog = augmentNativeModelCatalog(native, config, contextOverride?.());
  } catch (error) {
    onFailure?.(modelCatalogFailure("catalog", error));
    return formatErrorResponse(502, "invalid_response_error", error instanceof Error ? error.message : String(error));
  }
  try {
    refreshPickerCatalog(native, config, contextOverride?.());
  } catch (error) {
    console.error(`[chatgpt-web] Codex picker catalog refresh failed: ${error instanceof Error ? error.message : String(error)}`);
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
  return forwardNativeOr502(req, "alpha/search", fetchUpstream);
}

async function nativeImagesRequest(
  req: Request,
  endpoint: NativeImageEndpoint,
  fetchUpstream?: NativeFetch,
): Promise<Response> {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length <= "Bearer ".length) {
    void req.body?.cancel().catch(() => {});
    return formatErrorResponse(401, "authentication_error", "Native image requests require incoming Codex Bearer authorization");
  }
  return forwardNativeOr502(req, endpoint, fetchUpstream);
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

/**
 * A rejected follow-up never reaches the adapter. Answer the dispatched calls whose results it
 * carried, so the waiting ChatGPT tool requests fail now instead of at the MCP deadline.
 */
async function settleRejectedToolResults(raw: unknown, message: string): Promise<void> {
  try {
    await rejectUnparseableChatGptToolResults(raw, message);
  } catch (error) {
    console.error(`[chatgpt-web] could not settle tool calls of a rejected request: ${
      error instanceof Error ? error.message : String(error)}`);
  }
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
  if (typeof requestedModel === "string" && isChatGptWebModelSlug(requestedModel) && isCodexComposerPrediction(raw)) {
    // A next-message suggestion would run a full ChatGPT Web turn on the task's model (Pro
    // included), spending the account's limits and a browser tab. Decline it before any lifecycle,
    // admission or browser work; Codex treats a failed prediction as no suggestion.
    void nativeRequest.body?.cancel().catch(() => {});
    console.info(`[chatgpt-web] composer_prediction declined model=${requestedModel}`);
    return formatErrorResponse(400, "invalid_request_error",
      "Next-message predictions are not run on ChatGPT Web models; no ChatGPT message was sent.");
  }
  const identityRejection = bindBodyTurnIdentity(raw, nativeRequest, options);
  if (identityRejection) return identityRejection;
  if (typeof requestedModel === "string" && !isChatGptWebModelSlug(requestedModel)) {
    return forwardNativeOr502(nativeRequest, "responses", options.fetchUpstream, raw);
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
    const delegated = options.clientContext || options.hermesContext ? undefined : normalizeNativeDelegation(parsed);
    if (delegated) parsed = parseRequest(delegated, { allowWebSubagents: config.allowWebSubagents });
    if (options.hermesContext) parsed._hermesContext = options.hermesContext;
    if (options.clientContext) parsed._clientContext = options.clientContext;
    route = routeChatGptWebRequest(parsed, config);
    const identity = extractChatGptTurnIdentity(parsed);
    if (identity.threadId && identity.turnId) {
      options.onTurnIdentity?.({ threadId: identity.threadId, turnId: identity.turnId });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await settleRejectedToolResults(raw, message);
    return formatErrorResponse(400, "invalid_request_error", message);
  }
  const invalidWebImage = findInvalidChatGptWebInputImage(parsed);
  if (invalidWebImage) {
    await settleRejectedToolResults(raw, invalidWebImage);
    return formatErrorResponse(400, "invalid_request_error", invalidWebImage);
  }
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
  // Unpinned Pro ("Follow ChatGPT") runs the newest discovered Pro model, as ChatGPT's Latest row
  // does, rather than whichever row an earlier turn on another model left selected.
  if (route.interactionMode === "automatic" && route.adapterEffort === "max" && !route.modelFamily
    && !requestConfig.proModelVersion && !parsed._chatgptModelFamily) {
    const newest = newestChatGptWebProFamily(requestConfig);
    if (newest) parsed._chatgptModelFamily = newest;
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
  const compactionItem = compaction && parsed._compactionResponseFormat !== "message";
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
    if (!identity.threadId || !identity.turnId || !Array.isArray(response.output)) return;
    const items = response.output.filter(item => item?.type === (compactionItem ? "compaction" : "message"));
    if (items.length !== 1 || (compactionItem && response.output.length !== 1)) return;
    const item = items[0];
    const summary = compactionItem
      ? (typeof item?.encrypted_content === "string" ? decodeCompactionSummary(item.encrypted_content) : null)
      : (item?.role === "assistant" && Array.isArray(item.content)
        ? item.content.filter((part: { type?: string; text?: unknown }) => part.type === "output_text" && typeof part.text === "string")
          .map((part: { text: string }) => part.text).join("")
        : null);
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
  if (compaction && route.backendModel === CHATGPT_WEB_LUNA_BACKEND_MODEL) return lunaCompactionDisabled();
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
  if (externalClientContext(parsed) && !parsed.context.tools?.length && provider.chatgptWeb) {
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
  const notReady = traceId ? takeRecentWebTurnBlock(traceId) : undefined;
  if (notReady) {
    // The account was unready or the browser rejected this exact turn. Codex retries unknown
    // streamed codes and HTTP 403. HTTP 400 marks this replay invalid; retain the real provider
    // status and permission-error code in the body instead of relabelling it as a prompt fault.
    return Response.json({ error: { type: notReady.type, code: notReady.code, message: notReady.message,
      ...(notReady.upstreamStatus !== undefined ? { upstream_status: notReady.upstreamStatus } : {}) } },
      { status: notReady.status });
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
      if (traceId && event.type === "error" && event.code === "account_not_ready") {
        rememberWebTurnBlock(traceId, event.message);
      }
      if (traceId && event.type === "error" && event.code === "chatgpt_security_check"
        && event.retryable === false && event.status === 403) {
        // Codex retries unknown streamed error codes even when retryable is false.
        // Its replay must stop before another browser send; the provider's 403 stays in the body.
        rememberWebTurnBlock(traceId, event.message,
          { status: 400, type: "permission_error", code: event.code, upstreamStatus: 403 });
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
      const notReady = error instanceof ChatGptWebAdapterError && error.code === "account_not_ready";
      const event: AdapterEvent = notReady
        ? { type: "error", message: error.message, status: error.status, errorType: error.errorType, code: error.code, retryable: false }
        : { type: "error", message: error instanceof Error ? error.message : String(error) };
      if (traceId && notReady) rememberWebTurnBlock(traceId, error.message);
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
        ...(compactionItem ? { compaction: true } : {}),
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
    ...(compactionItem ? { compaction: true } : {}),
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
  const identityRejection = bindBodyTurnIdentity(raw, nativeRequest, options);
  if (identityRejection) return identityRejection;
  if (typeof raw.model !== "string" || !raw.model) {
    void nativeRequest.body?.cancel().catch(() => {});
    return formatErrorResponse(400, "invalid_request_error", "Compaction request requires a model");
  }
  if (!isChatGptWebModelSlug(raw.model)) {
    return forwardNativeOr502(nativeRequest, "responses/compact", options.fetchUpstream, raw);
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
  if (route.backendModel === CHATGPT_WEB_LUNA_BACKEND_MODEL) return lunaCompactionDisabled();
  const input = Array.isArray(raw.input) ? raw.input : [];
  const internal = createInternalJsonRequest(req, "http://127.0.0.1/v1/responses", {
    ...raw, stream: false, input: [...input, { type: "compaction_trigger" }],
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
  if (inferenceRoutePolicy(req.method, url.pathname)?.requiresJson
    || (req.method === "POST" && url.pathname === "/hermes/v1/responses")) {
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
    apiKey?: string;
    chatCompletionExecutor?: ChatCompletionExecutor;
    adapterFactory?: ChatGptWebAdapterFactory;
    readProModelVersion?: () => ChatGptWebProModelVersion | undefined;
    readCompactionModel?: () => ChatGptWebCompactionModel | undefined;
    /** The account's current ChatGPT capability evidence, which the launcher refreshes while running. */
    readAccountCapabilities?: () => AccountCapabilityFields;
    /** Trusted DEV harness pin. Packaged CLI resolves its own sibling native helper. */
    desktopHelper?: PinnedDesktopHelper;
    pdfHelper?: PinnedSkillPdfHelper;
    /** Trusted fixed development or publisher-signed production VM artifact selection. */
    vmRuntimeSelection?: VmRuntimeSelection;
    /** Trusted main-selected immutable source/build snapshots, never renderer filesystem paths. */
    resolvePythonBuildSelection?: (selectionId: string, scope: ToolScope) => PythonBuildSelection | Promise<PythonBuildSelection>;
    /** Trusted launcher/fixture profile identity, independent of browser readiness. */
    nativeLauncherProfile?: "production" | "development";
  } = {},
): Bun.Server<undefined> & { disposeSignalHandlers(): void } {
  if (config.purpose === "dev-harness") {
    throw new Error("DEV harness configuration cannot start a Responses listener");
  }
  const historyHome = getConfigDir();
  let historyStore: ConversationHistoryStore | undefined;
  const getHistoryStore = () => historyStore ??= new ConversationHistoryStore({ coreHome: historyHome, trustedCurrentScope: taskId => nativeHistoryScope(taskId) });
  // Standalone Agent mode has its own task owner and private store. Typical inference never opens it.
  let agentRuntime: AgentModeRuntime | undefined;
  let agentRoutes: ReturnType<typeof createAgentModeRoutes> | undefined;
  const nativeBridge = createLauncherNativeBridge({ descriptorPath: join(historyHome, "runtime", AGENT_NATIVE_DESCRIPTOR_FILE),
    expectedProfile: dependencies.nativeLauncherProfile ?? (process.env.CODEX_CHATGPT_WEB_LAUNCHER_PROFILE === "development" ? "development" : "production") });
  const nativeHistoryScope = (taskId: string) => {
    try {
      const task = agentRuntime?.store.getTask(taskId), execution = task?.execution;
      if (!task || execution?.provider !== "owned-native") return null;
      const source = nativeBridge.models().find(row => row.provider === "owned-native" && row.id === execution.model && row.admissionId === execution.admissionId)?.historySource;
      return source ? { ...source, taskId: task.id, generation: task.generation } : null;
    } catch { return null; }
  };
  type NativeInvalidation = { task: Parameters<typeof nativeBridge.invalidateTask>[0]; pending?: Promise<void>; failed: boolean };
  const nativeInvalidations = new Map<string, NativeInvalidation>();
  const invalidateNativeTask = (task: NativeInvalidation["task"], retry = false): void => {
    const key = JSON.stringify([task.id, task.familyId, task.generation]);
    let entry = nativeInvalidations.get(key);
    if (entry && (!retry || entry.pending)) return;
    if (!entry) { entry = { task: structuredClone(task), failed: false }; nativeInvalidations.set(key, entry); }
    const current = entry;
    current.failed = false;
    // Observe failures without discarding the exact cleanup scope or creating an unhandled
    // rejection. Shutdown retries this cleanup only; it never repeats an inference offer.
    current.pending = nativeBridge.invalidateTask(current.task).then(() => { nativeInvalidations.delete(key); }, () => { current.failed = true; })
      .finally(() => { current.pending = undefined; });
  };
  const nativeControlRoutes = createAgentNativeControlRoutes({ runtime: () => { getAgentRoutes(); return agentRuntime!; }, authorize: request => controlAuthorized(request) });
  const remoteControlRoutes = createAgentRemoteControlRoutes({ runtime: () => { getAgentRoutes(); return agentRuntime!; }, tools: () => getAgentTools(),
    authorize: request => controlAuthorized(request), canStart: () => !stopPrepared && acceptingAgentTools() });
  const oauthMcpControlRoutes = createAgentOAuthMcpControlRoutes({ runtime: () => { getAgentRoutes(); return agentRuntime!; }, tools: () => getAgentTools(),
    authorize: request => controlAuthorized(request), canStart: () => !stopPrepared && acceptingAgentTools() });
  const vmExportControlRoutes = createVmExportControlRoutes({ runtime: () => { getAgentRoutes(); return agentRuntime!; }, tools: () => getAgentTools(),
    authorize: request => controlAuthorized(request), canStart: () => !stopPrepared && acceptingAgentTools() });
  const pythonBuildSelections = config.browserHost === "launcher" ? createLauncherPythonBuildSelectionBridge({
    descriptorPath: join(historyHome, "runtime", "launcher-agent-python-build.json"),
    expectedProfile: dependencies.nativeLauncherProfile ?? (process.env.CODEX_CHATGPT_WEB_LAUNCHER_PROFILE === "development" ? "development" : "production"),
  }) : undefined;
  let agentTools: AgentToolsComposition | undefined;
  let browserCompanion: BrowserCompanionRuntime | undefined;
  let agentBrowserTools: AgentBrowserToolsProvider | undefined;
  let agentDesktopTools: AgentDesktopToolsProvider | undefined;
  let agentRemoteTools: AgentRemoteToolsProvider | undefined;
  let localControlRoutes: ReturnType<typeof createLocalControlApiRoutes> | undefined;
  let agentSnapshots: ReturnType<typeof createAgentWorkspaceSnapshots> | undefined;
  let agentEvidence: ReturnType<typeof createAgentWorkspaceEvidence> | undefined;
  startNativeUsageDelivery();
  const startedAt = Date.now();
  // Model discovery runs in the launcher while this daemon serves Codex. Each catalog build and
  // each request resolves its routes from the capability evidence saved at that moment.
  const liveConfig = (): AppConfig => {
    if (!dependencies.readAccountCapabilities) return config;
    try {
      return { ...config, ...dependencies.readAccountCapabilities() };
    } catch (error) {
      console.error(`[chatgpt-web] saved account capabilities are unreadable; using the startup evidence: ${error instanceof Error ? error.message : String(error)}`);
      return config;
    }
  };
  const instanceId = randomUUID();
  const backgroundRuntime = process.env.CODEX_CHATGPT_WEB_BACKGROUND_RUNTIME === "1";
  let launcherDetached = false;
  const turnBroker = config.mode === "full" ? TurnBroker.forSocket(config.brokerSocketPath) : undefined;
  // A background daemon runs with stdio ignored; keep broker lifecycle evidence on disk instead.
  if (turnBroker && backgroundRuntime) {
    configureTurnBrokerEventLog(join(getConfigDir(), "diagnostics", "turn-broker-events.jsonl"));
  }
  let brokerState: "not-required" | "starting" | "ready" | "failed" = turnBroker
    ? "starting"
    : "not-required";
  let brokerFailureCode: string | undefined;
  const admission = new ServerAdmission();
  // Launcher-owned Full mode reports tunnel readiness separately from the local listener.
  // Standalone hosts retain their existing tunnel service contract.
  const requiresTunnelSignal = config.mode === "full" && config.browserHost === "launcher";
  let tunnelReady = !requiresTunnelSignal;
  let accountTunnelStatuses: Array<{ account_id: string; interaction_mode: string; tunnel_id: string; ready: boolean;
    reason?: string; detail?: string }> = [];
  // The launcher's cause for an unready tunnel, e.g. "openai_unreachable" while
  // tunnel-client runs but cannot poll OpenAI. Explains refused Web admission.
  let tunnelUnavailableReason: string | null = null;
  let tunnelStatusRevision = 0;
  const brokerReady = () => !turnBroker || brokerState === "ready";
  const acceptingNative = () => admission.accepting;
  // Local task setup and already approved tools do not depend on Web transport.
  // Detach/drain still prevent new local work; model offers keep the Web gate.
  const acceptingAgentTools = () => admission.accepting && !launcherDetached;
  const acceptingTurns = () => admission.accepting && !launcherDetached && brokerReady() && tunnelReady;
  const admissionFailure = () => formatErrorResponse(
    503,
    "server_error",
    webAdmissionFailureMessage({ draining: admission.draining, launcherDetached,
      brokerReady: brokerReady(), tunnelUnavailableReason: tunnelReady ? null : tunnelUnavailableReason }),
  );
  if (config.mode === "full") {
    turnBroker!.setExternalOwnersAccepted(false);
    void turnBroker!.listen().then(() => {
      brokerState = "ready";
      turnBroker!.setExternalOwnersAccepted(acceptingTurns());
    }, error => {
      brokerState = "failed";
      brokerFailureCode = safeErrorCode(error) ?? "broker_listen_failed";
      turnBroker!.setExternalOwnersAccepted(false);
      console.error(
        `[chatgpt-web] turn broker endpoint is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
  let shutdownPromise: Promise<void> | undefined;
  let shutdownStage: "idle" | "cancelling" | "native_cleanup" | "listener_close" | "resource_cleanup" | "failed" | "closed" = "idle";
  let shutdownErrorCode: "shutdown_cleanup_failed" | null = null;
  let successfulModelCatalogRequests = 0;
  let lastSuccessfulModelCatalogRequestAt: string | null = null;
  let modelCatalogRequests = 0;
  let lastModelCatalogResult: {
    request: number; at: string; status: number; failure?: ModelCatalogFailure;
  } | null = null;
  // Codex stops requesting /v1/models once it reads the picker catalog file, so ordinary
  // authenticated Codex traffic refreshes that file with the same account credentials.
  let pickerRefreshStartedAt = 0;
  let pickerRefreshInFlight = false;
  const refreshPickerCatalogFromTraffic = (req: Request): void => {
    const now = Date.now();
    const age = pickerCatalogAgeMs(now);
    if (age === undefined || age < PICKER_CATALOG_REFRESH_MS || pickerRefreshInFlight
      || now - pickerRefreshStartedAt < PICKER_CATALOG_REFRESH_MS
      || !req.headers.get("authorization")?.startsWith("Bearer ")) return;
    pickerRefreshInFlight = true;
    pickerRefreshStartedAt = now;
    const headers = new Headers(req.headers);
    for (const name of ["content-type", "content-length", "content-encoding", "transfer-encoding", "accept"]) headers.delete(name);
    const probe = new Request(new URL("/v1/models", req.url), { method: "GET", headers });
    void (async () => {
      const current = liveConfig();
      const catalogConfig = { ...current, subagentProtocol: readCodexSubagentProtocol(current.subagentProtocol) };
      await modelsRequest(probe, catalogConfig, dependencies.fetchUpstream, readCodexModelContextOverride);
    })().catch(error => {
      console.error(`[chatgpt-web] Codex picker catalog background refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => { pickerRefreshInFlight = false; });
  };
  const httpTurns = new HttpTurnCounter();
  const hermes = new HermesIntegration();
  const claude = new ClaudeMessagesGateway((request, settings, options) =>
    responseRequest(request, settings, dependencies.adapterFactory, { ...options, rememberState: false }));
  const apiExecutionKey = (body: Record<string, unknown>, settings: AppConfig, context: ExternalClientContext) => {
    const parsed = parseRequest(body);
    parsed._clientContext = context;
    routeChatGptWebRequest(parsed, settings);
    return `${chatGptWebExecutionNamespace(providerConfig(settings))}:${chatGptTurnExecutionKey(parsed)}`;
  };
  const apiTools = new NativeChatCompletionBridge((request, settings, clientContext) =>
    responseRequest(request, settings, dependencies.adapterFactory, { clientContext, rememberState: false }), Date.now, {
      isLive: (body, callIds, settings, context) => {
        const session = chatGptTurnSessions.find(apiExecutionKey(body, settings, context));
        return Boolean(session?.isActive() && callIds.every(id => session.hasOutstanding(id)));
      },
      retire: async (body, settings, context) => { await chatGptTurnSessions.retireAndWait(apiExecutionKey(body, settings, context)); },
    });
  const activity = () => ({
    active_http_turns: httpTurns.count(),
    active_web_http_turns: httpTurns.webCount(),
    active_browser_turns: chatGptTurnSessions.activeCount() + activeChatCompletionTurns() + (turnBroker?.externalOwnerActiveCount() ?? 0),
    active_compaction_runs: activeStructuredCompactionCount(),
    active_agent_turns: agentRuntime?.activeCount ?? 0,
    active_agent_tools: agentTools?.activeCount ?? 0,
  });
  const controlAuthorized = (req: Request): boolean => {
    const header = req.headers.get("authorization") ?? "";
    const expected = Buffer.from(`Bearer ${config.controlToken}`);
    const actual = Buffer.from(header);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  // Resolve through both the task's retained reference and the private tool journal.
  // A caller-supplied receipt key cannot select another task's canonical output.
  const canonicalTaskToolOutcome = (task: AgentTask, receiptKey: string) => {
    const retained = agentRuntime?.store.effectiveToolOutcomes(task.id).find(outcome => outcome.idempotencyKey === receiptKey
      && outcome.scope.taskId === task.id && outcome.scope.generation === task.generation);
    if (!retained) return undefined;
    const sourcePrefix = retained.tool.split("/")[0];
    if (sourcePrefix !== "browser" && sourcePrefix !== "desktop") return undefined;
    const canonical = getAgentTools().getEvidenceOutcomeBySourceEvent(`${sourcePrefix}:${createHash("sha256").update(receiptKey).digest("hex")}`);
    return canonical && canonical.idempotencyKey === receiptKey && canonical.tool === retained.tool
      && canonical.scope.taskId === task.id && canonical.scope.generation === task.generation
      && canonical.scope.toolCallId === retained.scope.toolCallId ? canonical : undefined;
  };
  const getAgentRoutes = () => {
    if (agentRoutes) return agentRoutes;
    const models = () => [...availableChatGptWebModelRoutes(liveConfig())
      .filter(route => route.interactionMode === "automatic")
      .map(route => ({ id: route.slug, label: route.displayName, accepting: acceptingTurns() })),
      ...(config.browserHost === "launcher" ? nativeBridge.models() : [])];
    const store = new AgentModeStore(join(historyHome, "agent-mode", "state.sqlite"));
    // A PID proven absent is a stopped-owner receipt. A live/reused/inaccessible PID remains
    // unresolved; neither elapsed time nor opening this page authorizes taking its task.
    for (const task of store.listTasks()) if (task.ownerId) {
      const match = /^agent:([1-9]\d*):[a-f0-9-]+$/.exec(task.ownerId);
      if (!match) continue;
      const pid = Number(match[1]);
      if (!Number.isSafeInteger(pid) || pid === process.pid) continue;
      try { process.kill(pid, 0); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") store.recoverOwner(task.id, { ownerId: task.ownerId, stopped: true, receiptId: `recovery:${randomUUID()}` });
      }
    }
    const webExecution = createLocalResponsesExecutionPort({ models,
      endpoint: () => `http://127.0.0.1:${server.port}/v1/responses`,
      requestHeaders: request => ({ authorization: `Bearer ${config.controlToken}`, "x-nekodex-agent-dispatch": request.dispatch.id }),
      tools: { discover: (scope, options) => getAgentTools().toolsPort.discover(scope, options) },
      selectedSkills: request => getAgentTools().selectedSkillContent({ taskId: request.task.id, generation: request.task.generation, toolCallId: request.dispatch.id }),
      // This route offers configured Web models only. A control bearer is never native OAuth.
    });
    const nativeExecution = createOwnedNativeExecutionPort({ models, bridge: nativeBridge,
      claimTransport: (request, digest) => agentRuntime!.claimNativeTransport(request, digest),
      tools: { discover: (scope, options) => getAgentTools().toolsPort.discover(scope, options) },
      history: { lease: (scope, offer) => getHistoryStore().ownedNative.lease(scope, offer),
        recordFinal: input => getHistoryStore().ownedNative.recordFinal(input), release: lease => historyStore?.ownedNative.release(lease),
        transcript: { subscribe: (scope, offer) => getHistoryStore().transcript.subscribe(scope, offer),
          recordEvent: input => getHistoryStore().transcript.recordEvent(input), release: lease => historyStore?.transcript.release(lease) } },
      selectedSkills: request => getAgentTools().selectedSkillContent({ taskId: request.task.id, generation: request.task.generation, toolCallId: request.dispatch.id }) });
    const executionPort = createAgentExecutionRouter({ localResponses: webExecution, ownedNative: nativeExecution });
    agentRuntime = new AgentModeRuntime({ store, models, executionPort,
      ownerId: `agent:${process.pid}:${instanceId}`,
      canStart: () => acceptingAgentTools() && (acceptingTurns() || nativeBridge.models().some(row => row.available === true && row.accepting !== false)),
      canExecute: task => acceptingAgentTools() && (task.execution?.provider === "owned-native"
        ? nativeBridge.models().some(row => row.id === task.execution?.model && task.execution?.provider === "owned-native" && row.admissionId === task.execution.admissionId && row.available === true && row.accepting !== false)
        : acceptingTurns()),
      beforeOffer: async ({ task, dispatch }) => {
        if (task.workspaceSnapshotGrant === undefined || task.workspaceSnapshotGrant === null) return;
        await getAgentSnapshots().beforeTurn({ task, generation: dispatch.generation, dispatchId: dispatch.id });
      }, snapshotReceipts: task => task.workspaceSnapshotGrant === undefined ? [] : getAgentSnapshots().listTask(task.id),
      lookupToolOutcome: key => getAgentTools().receipt(key),
      reconcileToolReceipt: request => getAgentTools().reconcileReceipt(request),
      onTaskScopeInvalidated: taskId => {
        agentTools?.invalidateTaskTools(taskId);
        const task = store.getTask(taskId);
        if (task.execution?.provider === "owned-native") invalidateNativeTask(task);
      },
      beforeVerify: task => {
        for (const evidence of activeTaskEvidence(task)) {
          if (evidence.observer === "workspace-file-observer-v1") getAgentEvidence().assertCurrent(task, evidence);
          if (evidence.observer === "selected-macos-application-property-v1") getAgentDesktopTools().assertPropertyEvidenceCurrent(task, evidence);
        }
      }, workspaceEvidenceReferences: task => task.evidence.some(evidence => evidence.observer === "workspace-file-observer-v1") ? getAgentEvidence().listTask(task.id) : [],
      toolsAvailable: () => getAgentTools().status().config.enabled || Boolean(agentBrowserTools?.status().bindings.some(binding => {
        const scope = { taskId: binding.taskId, generation: binding.generation, toolCallId: 'capability-status' };
        const status = agentBrowserTools!.status(scope);
        return isAgentScopeActive(scope) && status.available && status.bound;
      })) || Boolean(agentDesktopTools?.status().available && agentDesktopTools.status().bindings.some(binding =>
        isAgentScopeActive({ taskId: binding.taskId, generation: binding.generation, toolCallId: 'capability-status' })))
        || Boolean(agentRemoteTools?.status().available && agentRemoteTools.status().bindings.some(binding =>
          isAgentScopeActive({ taskId: binding.taskId, generation: binding.generation, toolCallId: 'capability-status' })))
        || getAgentTools().vmNetworkStatus().grants.some(row => !row.revoked && isAgentScopeActive({ taskId: row.grant.scope.taskId, generation: row.grant.scope.generation, toolCallId: 'network-capability-status' }))
        || getAgentTools().hasSkillResourceTools() || getAgentTools().hasSkillScriptTools() || getAgentTools().hasVmShellTools(agentRuntime?.store.listTasks().map(task => ({ taskId: task.id, generation: task.generation, toolCallId: 'vm-export-discovery' })) ?? []) });
    agentRoutes = createAgentModeRoutes({ runtime: agentRuntime, authorize: controlAuthorized,
      observeWorkspaceEvidence: (task, proof) => getAgentEvidence().observe(task, proof),
      resolveEvidence: (task, reference) => {
        if (reference.sourceEventId.startsWith("workspace-file:")) return getAgentEvidence().resolve(task, reference);
        if (reference.sourceEventId.startsWith("desktop-property:")) return resolveDesktopPropertyEvidence(task, reference, sourceEventId => {
          const retained = agentRuntime!.store.effectiveToolOutcomes(task.id).find(outcome => outcome.scope.generation === task.generation
            && sourceEventId === `desktop-property:${createHash("sha256").update(outcome.idempotencyKey).digest("hex")}`);
          return retained ? canonicalTaskToolOutcome(task, retained.idempotencyKey) : undefined;
        });
        if (reference.sourceEventId.startsWith("browser-transition:")) return resolveBrowserTextTransitionEvidence(task, reference,
          receiptKey => canonicalTaskToolOutcome(task, receiptKey));
        if (["mcp:", "browser:", "desktop:"].some(prefix => reference.sourceEventId.startsWith(prefix))) return getAgentTools().resolveEvidence(task, reference);
        throw new Error("Unsupported observed evidence source");
      } });
    return agentRoutes;
  };
  const isAgentScopeActive = (scope: ToolScope) => {
    if (!agentRuntime) return false;
    try { const task = agentRuntime.store.getTask(scope.taskId); return task.generation === scope.generation && ["ready", "running", "awaiting_input"].includes(task.status); }
    catch { return false; }
  };
  const getAgentBrowserTools = () => agentBrowserTools ??= createAgentBrowserToolsProvider({
    provider: () => browserCompanion?.browserProvider(), isScopeActive: isAgentScopeActive,
  });
  const getAgentDesktopTools = () => agentDesktopTools ??= createAgentDesktopToolsProvider({
    isScopeActive: isAgentScopeActive,
    createProvider: () => {
      if (process.platform !== 'darwin' || Number(osRelease().split('.')[0]) < 23) throw new Error('Native desktop tools require macOS 14 or newer');
      const helper = resolveDesktopHelper({ explicit: dependencies.desktopHelper });
      if (!helper) throw new Error('The native desktop helper is unavailable in this runtime layout');
      return createMacosDesktopProvider({ helperExecutable: helper.executable, helperSha256: helper.sha256,
        isScopeActive: isAgentScopeActive });
    },
  });
  const getAgentRemoteTools = () => agentRemoteTools ??= createAgentRemoteToolsProvider({
    bridge: createLauncherRemoteBridge({ descriptorPath: join(historyHome, 'runtime', AGENT_REMOTE_DESCRIPTOR_FILE),
      expectedProfile: dependencies.nativeLauncherProfile ?? (process.env.CODEX_CHATGPT_WEB_LAUNCHER_PROFILE === 'development' ? 'development' : 'production') }),
    isScopeActive: isAgentScopeActive,
    resolveTaskScope: taskId => { try { const task = agentRuntime?.store.getTask(taskId); return task ? { taskId: task.id, familyId: task.familyId, generation: task.generation, revision: task.revision } : undefined; } catch { return undefined; } },
  });
  const getAgentTools = () => agentTools ??= createAgentToolsComposition({ home: historyHome, authorize: controlAuthorized, canStart: acceptingAgentTools,
    browserTools: getAgentBrowserTools(),
    oauthMcpTools: config.browserHost === 'launcher' ? createAgentOAuthMcpToolsProvider({
      bridge: createLauncherOAuthMcpBridge({ descriptorPath: join(historyHome, 'runtime', 'launcher-agent-oauth-mcp.json'),
        expectedProfile: dependencies.nativeLauncherProfile ?? (process.env.CODEX_CHATGPT_WEB_LAUNCHER_PROFILE === 'development' ? 'development' : 'production') }),
      isScopeActive: isAgentScopeActive,
    }) : undefined,
    desktopTools: getAgentDesktopTools(),
    remoteTools: config.browserHost === 'launcher' ? getAgentRemoteTools() : undefined,
    pdfHelper: resolveSkillPdfHelper({ explicit: dependencies.pdfHelper }),
    resolvePythonBuildSelection: dependencies.resolvePythonBuildSelection ?? pythonBuildSelections?.resolvePythonBuildSelection,
    vmRuntimeSelection: dependencies.vmRuntimeSelection?.production || dependencies.nativeLauncherProfile === 'development' || process.env.CODEX_CHATGPT_WEB_LAUNCHER_PROFILE === 'development' ? dependencies.vmRuntimeSelection : undefined,
    vmExport: config.browserHost === 'launcher' ? createVmExportTools(createLauncherVmExportBridge({ descriptorPath: join(historyHome, 'runtime', AGENT_VM_EXPORT_DESCRIPTOR_FILE),
      expectedProfile: dependencies.nativeLauncherProfile ?? (process.env.CODEX_CHATGPT_WEB_LAUNCHER_PROFILE === 'development' ? 'development' : 'production') })) : undefined,
    isScopeActive: isAgentScopeActive, resolveToolCall: scope => agentRuntime?.resolveToolCall(scope),
    resolveSavedVmCalls: scope => {
      if (!agentRuntime) return [];
      const result: Omit<import('./agent-tools/types').ToolInvocation, 'grantId'>[] = [];
      for (const row of agentRuntime.store.listDispatches(scope.taskId)) {
        if (row.generation > scope.generation || row.state !== 'settled') continue;
        for (const call of row.result?.continuation?.pending ?? []) {
          if (call.tool !== 'vm-shell/run') continue;
          const originalScope = { taskId: scope.taskId, generation: row.generation, toolCallId: call.toolCallId }, resolved = agentRuntime.store.resolveSavedToolCall(originalScope);
          if (resolved?.tool === 'vm-shell/run') result.push({ scope: originalScope, ...resolved });
        }
      }
      return result;
    },
    onOutcome: outcome => { if (!agentRuntime) throw new Error("Agent task owner unavailable"); agentRuntime.recordToolOutcome(outcome); },
  });
  const getAgentSnapshots = () => agentSnapshots ??= createAgentWorkspaceSnapshots({ storagePath: join(historyHome, "agent-workspace", "task-snapshots.sqlite"), keyPath: join(historyHome, "agent-workspace", "grant-key") });
  const getAgentEvidence = () => agentEvidence ??= createAgentWorkspaceEvidence({ storagePath: join(historyHome, "agent-workspace", "evidence.sqlite"), keyPath: join(historyHome, "agent-workspace", "grant-key") });
  const getLocalControlRoutes = (): ReturnType<typeof createLocalControlApiRoutes> => localControlRoutes ??= createLocalControlApiRoutes({ coreHome: historyHome,
    authorizeAdmin: controlAuthorized, localGuard: localHttpRequestRejection, port: (): number => server.port!, peerAddress: request => server.requestIP(request)?.address,
    sources: {
      status: () => ({ version: VERSION, ready: admission.accepting, activeHttpTurns: httpTurns.count(), activeAgentTasks: agentRuntime?.activeCount ?? 0 }),
      agentTasks: () => agentRuntime?.store.listTasks().map(task => ({ id: task.id, state: task.status, kind: "agent", mode: task.mode, familyId: task.familyId, generation: task.generation, revision: task.revision, createdAt: task.createdAt, updatedAt: task.updatedAt })),
      history: () => historyStore,
    }, agentAction: input => {
      if (stopPrepared) throw new Error("Agent runtime is draining");
      getAgentRoutes(); return agentRuntime!.executeScopedAction(input);
    }, agentActionReceipt: input => {
      // Observation must not initialize execution or perform stopped-owner recovery.
      if (!agentRuntime) throw new Error("Agent action receipt source is unavailable");
      return agentRuntime.store.readCommandResult(input.taskId, input.actionId, "scoped_action", input)?.result;
    },
  });
  const trackInference = (
    req: Request,
    policy: InferenceRoutePolicy,
    run: Parameters<HttpTurnCounter["track"]>[0],
  ): Promise<Response> | Response => {
    if (!(policy.admission === "web" ? acceptingTurns() : acceptingNative())) return admissionFailure();
    return httpTurns.track(run, req.signal, process.platform, policy.endpoint);
  };
  const modelPreferenceReaders = (): Pick<ResponseRequestOptions, "readProModelVersion" | "readCompactionModel"> => ({
    ...(dependencies.readProModelVersion ? { readProModelVersion: dependencies.readProModelVersion } : {}),
    ...(dependencies.readCompactionModel ? { readCompactionModel: dependencies.readCompactionModel } : {}),
  });
  const responseOptions = (
    bindIdentity: (identity: NativeCodexTurnIdentity) => void,
    bindWeb: () => void,
  ): ResponseRequestOptions => ({
    onTurnIdentity: bindIdentity,
    webAdmission: () => {
      if (!acceptingTurns()) return admissionFailure();
      bindWeb();
      return undefined;
    },
    fetchUpstream: dependencies.fetchUpstream,
    ...modelPreferenceReaders(),
  });
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    idleTimeout: 0,
    // Unexpected exceptions must still produce a JSON error; Bun's default handler would return an
    // HTML page (in development) that includes stack and filesystem details.
    error(error) {
      console.error("[server] unhandled request error", error instanceof Error ? error.message : String(error));
      return formatErrorResponse(500, "server_error", "Internal bridge error");
    },
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);
      const policy = inferenceRoutePolicy(req.method, url.pathname);
      const rejection = localHttpRequestRejection(req, url, server.port!);
      if (rejection) return rejection;
      if (url.pathname.startsWith("/api/v1/") || url.pathname.startsWith("/admin/local-control-api") || /^Bearer nk-read-/i.test(req.headers.get("authorization") ?? "")) {
        const response = await getLocalControlRoutes()(req); if (response) return response;
      }
      if (url.pathname === "/admin/browser-companion") {
        if (!controlAuthorized(req)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        return browserCompanionRequest(req, () => browserCompanion ??= createBrowserCompanionRuntime());
      }
      if (url.pathname === "/admin/agent-tools") {
        if (!controlAuthorized(req)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        return (await getAgentTools().handle(req))!;
      }
      if (url.pathname === "/admin/agent-mode") {
        if (!controlAuthorized(req)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        if (stopPrepared) {
          try {
            const body = await readJsonRequestBody(req.clone(), 768 * 1024, 768 * 1024) as { action?: unknown };
            if (!["status", "list", "get", "reconcile-tool"].includes(String(body.action))) return Response.json({ ok: false, error: "runtime_draining" }, { status: 409 });
          } catch { return Response.json({ ok: false, error: "invalid_request" }, { status: 400 }); }
        }
        return (await getAgentRoutes()(req))!;
      }
      if (url.pathname === "/admin/agent-native") return nativeControlRoutes(req);
      if (url.pathname === "/admin/agent-oauth-mcp") return oauthMcpControlRoutes(req);
      if (url.pathname === "/admin/agent-remote") return remoteControlRoutes(req);
      if (url.pathname === '/admin/agent-vm-export') return vmExportControlRoutes(req);
      const localApiRequest = url.pathname === "/v1/chat/completions" || url.pathname.startsWith("/v1/messages")
        || url.pathname.startsWith("/claude/") || req.headers.has("x-api-key")
        || /^Bearer sk-local-/i.test(req.headers.get("authorization") ?? "");
      if (localApiRequest) {
        let key: string | undefined;
        try { key = chatCompletionApiKey(config, dependencies.apiKey ?? localApiKey() ?? ""); }
        catch { return chatCompletionErrorResponse(new ChatCompletionError("Local API configuration is unavailable", 503, "api_configuration_unavailable")); }
        const guard = chatCompletionRequestGuard(req, url.pathname, key, server.port!, server.requestIP(req)?.address);
        if (guard) return guard;
        if (url.pathname === "/v1/models" || url.pathname === "/claude/v1/models") return isClaudeGatewayModelsRequest(req)
          ? claudeGatewayModelsResponse(liveConfig()) : chatCompletionModels(liveConfig());
        if (url.pathname.endsWith("/messages/count_tokens")) return claude.countTokens(req);
        if (!acceptingTurns()) return admissionFailure();
        return httpTurns.track((signal, _identity, bindWeb) => {
          bindWeb();
          if (url.pathname.endsWith("/messages")) return claude.respond(new Request(req, { signal }), liveConfig());
          return chatCompletionRequest(req, liveConfig(), signal, dependencies.chatCompletionExecutor, apiTools);
        }, req.signal, process.platform, "responses");
      }
      if (url.pathname.startsWith("/hermes/")) {
        if (!hermes.authorized(req)) return formatErrorResponse(401, "authentication_error", "Add the Hermes provider from Setup to authorize this local connection.");
        if (req.method === "GET" && url.pathname === "/hermes/v1/models") return hermes.models(liveConfig());
        if (req.method === "POST" && url.pathname === "/hermes/v1/responses") {
          if (!acceptingTurns()) return admissionFailure();
          return httpTurns.track((signal, _bindIdentity, bindWeb) => {
            bindWeb();
            return hermes.respond(new Request(req, { signal }), liveConfig(),
            (request, hermesContext, onCompletedResponse) => responseRequest(request, liveConfig(), dependencies.adapterFactory, {
              hermesContext, onCompletedResponse, rememberState: false,
              ...modelPreferenceReaders(),
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
          port: server.port,
          uptime: (Date.now() - startedAt) / 1_000,
          accepting_turns: acceptingTurns(),
          native_accepting_turns: acceptingNative(),
          web_accepting_turns: acceptingTurns(),
          draining: admission.draining,
          shutdown_stage: shutdownStage,
          shutdown_error_code: shutdownErrorCode,
          broker_ready: brokerReady(),
          broker_state: brokerState,
          tunnel_ready: tunnelReady,
          ...(!tunnelReady && tunnelUnavailableReason ? { tunnel_unavailable_reason: tunnelUnavailableReason } : {}),
          ...(config.accountTunnelMode === true ? { account_tunnels: accountTunnelStatuses } : {}),
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
      if (req.method === "POST" && url.pathname === "/admin/conversation-history") {
        if (!controlAuthorized(req)) return new Response("Unauthorized", { status: 401 });
        return conversationHistoryRequest(req, getHistoryStore, { resolveOwnedNativeScope: input => {
          getAgentRoutes();
          const task = agentRuntime!.store.getTask(input.taskId);
          if (task.familyId !== input.scope.familyId || task.generation !== input.scope.generation || task.revision !== input.scope.revision) throw new Error("History task generation changed");
          if (stopPrepared && ["owned-native-consent", "transcript-native-consent"].includes(input.action) && input.enabled !== false) throw new Error("Native history admission is draining");
          return nativeHistoryScope(task.id);
        } });
      }
      if (req.method === "POST" && url.pathname === "/admin/runtime-session") {
        if (!controlAuthorized(req)) return new Response("Unauthorized", { status: 401 });
        let body: { action?: unknown; instanceId?: unknown };
        try { body = await readJsonRequestBody(req, 4096, 4096) as typeof body; }
        catch { return new Response("Invalid runtime session request", { status: 400 }); }
        if (!body || typeof body.action !== "string" || !["status", "attach", "detach"].includes(body.action)
          || body.instanceId !== instanceId) return new Response("Runtime identity changed", { status: 409 });
        if (body.action === "detach") {
          // Close Web/local-tool admission before inspecting owners. Native HTTP streams do not depend
          // on Electron and must neither be drained nor cancelled by an interface exit.
          const previous = launcherDetached;
          launcherDetached = true;
          turnBroker?.setExternalOwnersAccepted(false);
          const current = activity();
          if (!backgroundRuntime || !nativeNetworkBackgroundReady() || admission.draining
            || current.active_web_http_turns || current.active_browser_turns || current.active_compaction_runs
            || current.active_agent_turns || current.active_agent_tools) {
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
        try { body = await readJsonRequestBody(req, 65536, 65536); } catch {
          return formatErrorResponse(400, "invalid_request_error", "Tunnel readiness requires a boolean and a positive revision");
        }
        if (!body || typeof body !== "object" || Array.isArray(body)
          || typeof (body as { ready?: unknown }).ready !== "boolean"
          || !Number.isSafeInteger((body as { revision?: unknown }).revision)
          || ((body as { revision: number }).revision < 1)) {
          return formatErrorResponse(400, "invalid_request_error", "Tunnel readiness requires a boolean and a positive revision");
        }
        const update = body as { ready: boolean; revision: number; account_tunnels?: unknown;
          reason?: unknown; detail?: unknown };
        const causeIsValid = (item: { reason?: unknown; detail?: unknown }) =>
          (item.reason === undefined || typeof item.reason === "string" && TUNNEL_UNAVAILABLE_REASON_PATTERN.test(item.reason))
          && (item.detail === undefined || typeof item.detail === "string" && item.detail.length <= 500);
        if (!causeIsValid(update)) {
          return formatErrorResponse(400, "invalid_request_error", "Tunnel readiness cause must be a short reason code and detail");
        }
        if (config.accountTunnelMode === true && update.account_tunnels === undefined) {
          return formatErrorResponse(400, 'invalid_request_error', 'Account tunnel mode requires account-scoped readiness');
        }
        if (update.account_tunnels !== undefined) {
          if (!Array.isArray(update.account_tunnels) || update.account_tunnels.length > 64
            || update.account_tunnels.some(item => !item || typeof item !== 'object'
              || typeof item.account_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.account_id)
              || (item.interaction_mode !== 'automatic' && item.interaction_mode !== 'manual')
              || typeof item.tunnel_id !== 'string' || !/^tunnel_[a-f0-9]{32}$/.test(item.tunnel_id) || typeof item.ready !== 'boolean'
              || !causeIsValid(item))
            || new Set(update.account_tunnels.map(item => `${item.account_id}:${item.interaction_mode}`)).size !== update.account_tunnels.length
            || new Set(update.account_tunnels.map(item => item.tunnel_id)).size !== update.account_tunnels.length
            || update.ready !== update.account_tunnels.some(item => item.ready === true)) {
            return formatErrorResponse(400, 'invalid_request_error', 'Account tunnel readiness must contain distinct owners and an accurate aggregate');
          }
        }
        const applied = update.revision > tunnelStatusRevision;
        if (applied) {
          tunnelStatusRevision = update.revision;
          tunnelReady = !requiresTunnelSignal || update.ready;
          accountTunnelStatuses = Array.isArray(update.account_tunnels)
            ? update.account_tunnels.map(item => ({ account_id: item.account_id,
              interaction_mode: item.interaction_mode, tunnel_id: item.tunnel_id, ready: item.ready,
              ...(!item.ready && typeof item.reason === "string" ? { reason: item.reason } : {}),
              ...(!item.ready && typeof item.detail === "string" ? { detail: item.detail } : {}) })) : [];
          // One distinct reported cause (inactive-mode bindings carry none) names the refusal.
          const causes = update.ready ? [] : [...new Set((accountTunnelStatuses.length
            ? accountTunnelStatuses.map(item => item.reason) : [update.reason])
            .filter((reason): reason is string => typeof reason === "string"))];
          tunnelUnavailableReason = causes.length === 1 ? causes[0]! : null;
          turnBroker?.setExternalOwnersAccepted(acceptingTurns());
        }
        return Response.json({ status: "ok", native_accepting_turns: acceptingNative(),
          web_accepting_turns: acceptingTurns(), tunnel_ready: tunnelReady, broker_ready: brokerReady(),
          applied, tunnel_status_revision: tunnelStatusRevision });
      }
      if (req.method === "POST" && (url.pathname === "/admin/drain" || url.pathname === "/admin/resume")) {
        if (!controlAuthorized(req)) return new Response("Unauthorized", { status: 401 });
        if (url.pathname === "/admin/drain") admission.drain();
        else if (!admission.resume()) {
          return Response.json({ status: "refused", reason: "Runtime shutdown is committed",
            accepting_turns: false, native_accepting_turns: false, web_accepting_turns: false,
            draining: true, ...activity() }, { status: 409 });
        }
        turnBroker?.setExternalOwnersAccepted(acceptingTurns());
        return Response.json({
          status: "ok",
          accepting_turns: acceptingTurns(),
          native_accepting_turns: acceptingNative(),
          web_accepting_turns: acceptingTurns(),
          draining: admission.draining,
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
        const compactionCancellation = beginCancelStructuredCompactionTrace(traceId, reason);
        const browserCancellation = chatGptTurnSessions.beginCancelTrace(traceId, reason);
        const cancelledBrokerTurns = turnBroker?.revokeTrace(traceId, reason) ?? 0;
        const settlement = Promise.all([browserCancellation.settlement, compactionCancellation.settlement]);
        // Explicit tab close must acknowledge revoked authority before the Launcher destroys its
        // document. Lease failure still waits for physical settlement before reporting cleanup.
        let settlementError: string | undefined;
        if (leaseFailure) {
          // Authority is already revoked; a cleanup failure must not turn the cancellation into a 500.
          try { await settlement; } catch (error) {
            settlementError = error instanceof Error ? error.message : String(error);
            console.error(`[chatgpt-web] cancelled turn cleanup failed: ${settlementError}`);
          }
        } else void settlement.catch(error => console.error(`[chatgpt-web] cancelled turn cleanup failed: ${error instanceof Error ? error.message : String(error)}`));
        return Response.json({
          status: "ok",
          trace_id: traceId,
          cancelled_browser_turns: browserCancellation.cancelled,
          cancelled_broker_turns: cancelledBrokerTurns,
          cancelled_compaction_runs: compactionCancellation.cancelled,
          ...(settlementError ? { settlement_error: "cleanup_failed" } : {}),
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
        if (!admission.draining || current.active_http_turns > 0 || current.active_browser_turns > 0 || current.active_agent_turns > 0 || current.active_agent_tools > 0
          || current.active_compaction_runs > 0) {
          return Response.json(
            {
              status: "refused",
              accepting_turns: admission.accepting,
              ...current,
            },
            { status: 409 },
          );
        }
        admission.beginShutdown();
        turnBroker?.setExternalOwnersAccepted(false);
        setTimeout(shutdown, 0);
        return Response.json({ status: "ok", accepting_turns: false, ...current });
      }
      if (policy?.endpoint === "models") {
        return trackInference(req, policy, async signal => {
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
              ...liveConfig(),
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
        });
      }
      if (req.method === "GET" && url.pathname === "/v1/responses") {
        return new Response("Responses WebSocket transport is not enabled on this local route", {
          status: 426,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
      if (policy?.endpoint === "responses" || policy?.endpoint === "compact") {
        let agentContext: ExternalClientContext | undefined;
        const agentDispatchId = req.headers.get("x-nekodex-agent-dispatch");
        if (agentDispatchId) {
          if (policy.endpoint !== "responses" || !controlAuthorized(req) || !agentRuntime) return formatErrorResponse(403, "permission_error", "Agent Responses authority is unavailable");
          try {
            const dispatch = agentRuntime.store.getDispatch(agentDispatchId);
            const task = agentRuntime.store.getTask(dispatch.taskId);
            const body = await readJsonRequestBody(req.clone(), 768 * 1024, 768 * 1024) as { model?: unknown };
            if (dispatch.ownerId !== agentRuntime.runner.ownerId || dispatch.generation !== task.generation || dispatch.state !== "offered" || task.status !== "running"
              || task.execution?.provider !== "local-responses" || typeof body.model !== "string" || body.model !== task.execution.model || !isChatGptWebModelSlug(body.model)) throw new Error("Agent dispatch scope changed");
            agentRuntime.store.claimTransport(dispatch.id, agentRuntime.runner.ownerId, createHash("sha256").update(JSON.stringify(body)).digest("hex"));
            const source = dispatch.continuationOf ? agentRuntime.store.getDispatch(dispatch.continuationOf).result?.continuation : undefined;
            agentContext = { producer: "agent", threadId: `agent_thread_${createHash("sha256").update(task.id).digest("hex")}`,
              turnId: `agent_turn_${source?.rootDispatchId ?? dispatch.id}`, root: join(historyHome, "agent-mode", "virtual") };
          } catch { return formatErrorResponse(403, "permission_error", "Agent Responses dispatch does not match its live owner"); }
        } else refreshPickerCatalogFromTraffic(req);
        const handler = policy.endpoint === "responses" ? responseRequest : compactRequest;
        return trackInference(req, policy, (signal, bindIdentity, bindWeb) => handler(
          new Request(req, { signal }), liveConfig(), dependencies.adapterFactory,
          { ...responseOptions(bindIdentity, bindWeb), ...(agentContext ? { clientContext: agentContext, rememberState: false } : {}) },
        ));
      }
      if (policy?.endpoint === "search") {
        return trackInference(req, policy,
          signal => nativeSearchRequest(new Request(req, { signal }), dependencies.fetchUpstream));
      }
      if (policy?.endpoint === "images/generations" || policy?.endpoint === "images/edits") {
        const endpoint = policy.endpoint;
        return trackInference(req, policy,
          signal => nativeImagesRequest(new Request(req, { signal }), endpoint, dependencies.fetchUpstream));
      }
      return new Response("Not found", { status: 404 });
    },
  });
  function shutdown(): void {
    admission.beginShutdown();
    if (shutdownPromise) return;
    shutdownStage = "cancelling";
    shutdownErrorCode = null;
    // Publish the attempt owner before invoking cancellation callbacks. Repeated signals
    // coalesce while it runs; failed cleanup remains draining and permits an explicit retry.
    shutdownPromise = Promise.resolve().then(async () => {
      turnBroker?.setExternalOwnersAccepted(false);
      const reason = new Error("Runtime shutting down");
      agentRuntime?.beginShutdown();
      // Revoke detached compaction owners before retiring their source sessions.
      const compactionCancellation = cancelAllStructuredCompactions(reason);
      chatGptTurnSessions.clear();
      turnBroker?.revokeExternalOwners();
      const httpCancellation = httpTurns.cancelAll(reason);
      flushResponseState();
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
    }).catch(error => {
      shutdownStage = "failed";
      shutdownErrorCode = "shutdown_cleanup_failed";
      process.exitCode = 1;
      console.error(`[codex-chatgpt-web] server shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
      // Only a terminal failed attempt releases ownership. Native receipts and the
      // authority listener remain intact until recovery makes a later cleanup succeed.
      shutdownPromise = undefined;
    });
  }
  function disposeSignalHandlers(): void {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
  }
  // Embedders stop the returned Bun server directly. Releasing this listener must also
  // release its process hooks, otherwise later signals act on already-stopped instances.
  const stop = server.stop.bind(server);
  let stopPrepared = false;
  let nativeShutdownPreparation: Promise<void> | undefined;
  let nativeShutdown = false;
  const prepareNativeShutdown = (): Promise<void> => nativeShutdownPreparation ??= (async () => {
    const runtime = agentRuntime!;
    // This bounds local observation, not Native inference or physical cleanup. A still-live
    // local operation leaves the authority listener and SQLite open for reconciliation.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const idle = await Promise.race([runtime.waitForIdle().then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 1_000); })]);
    if (timer) clearTimeout(timer);
    if (!idle) throw new Error("Agent operations have not settled; Native shutdown remains draining");
    for (const entry of nativeInvalidations.values()) if (entry.failed) invalidateNativeTask(entry.task, true);
    // Owner recovery publishes generation fences. Main validates them through this Bun
    // listener, which must remain alive until every exact physical owner has closed.
    runtime.finishShutdown();
    while (nativeInvalidations.size) {
      await Promise.all([...nativeInvalidations.values()].map(entry => entry.pending));
      if ([...nativeInvalidations.values()].some(entry => entry.failed)) throw new Error("Owned Native cleanup failed; shutdown remains draining");
    }
  })().catch(error => { nativeShutdownPreparation = undefined; throw error; });
  let ownedResourcesFinalizer: Promise<void> | undefined;
  const finalizeOwnedResources = (): Promise<void> => ownedResourcesFinalizer ??= (async () => {
      shutdownStage = "resource_cleanup";
      historyStore?.close();
      await browserCompanion?.close();
      await agentTools?.close();
      if (!agentRuntime) { agentSnapshots?.close(); agentEvidence?.close(); return; }
      // Abort-aware transports normally settle at once. A misbehaving injected port must not
      // hang listener shutdown or lose a late receipt by closing SQLite underneath its owner.
      const runtime = agentRuntime;
      const settled = runtime.waitForIdle();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const idle = await Promise.race([settled.then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 1_000); })]);
      if (timer) clearTimeout(timer);
      if (idle) { runtime.finishShutdown(); runtime.store.close(); agentSnapshots?.close(); agentEvidence?.close(); }
      else void settled.then(() => { runtime.finishShutdown(); runtime.store.close(); agentSnapshots?.close(); agentEvidence?.close(); });
  })();
  server.stop = (...args: Parameters<typeof stop>) => {
    if (!stopPrepared) {
      stopPrepared = true;
      admission.beginShutdown();
      agentRuntime?.beginShutdown();
      nativeShutdown = Boolean(agentRuntime && (nativeInvalidations.size || agentRuntime.store.listTasks().some(task => task.execution?.provider === "owned-native")));
    }
    // Every request still reaches Bun: stop(true) can escalate an earlier stop(false)
    // while that listener drains. Only the owned-resource finalizer is shared.
    shutdownErrorCode = null;
    const stopListener = () => { shutdownStage = "listener_close"; return stop(...args).finally(finalizeOwnedResources); };
    if (nativeShutdown) shutdownStage = "native_cleanup";
    const stopped = nativeShutdown ? prepareNativeShutdown().then(stopListener) : stopListener();
    return stopped.then(() => {
      shutdownStage = "closed";
      disposeSignalHandlers();
    }, error => {
      shutdownStage = "failed";
      shutdownErrorCode = "shutdown_cleanup_failed";
      throw error;
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return Object.assign(server, { disposeSignalHandlers });
}
