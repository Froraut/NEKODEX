// Adapted from Evanlau1798/codex-chatgpt-web; NEKODEX keeps admission in its account pool.
import { randomUUID } from "node:crypto";
import { providerConfig, type AppConfig } from "../config";
import { availableChatGptWebModelRoutes, requireChatGptWebModelRoute, CHATGPT_WEB_PLATFORM_RESERVE_TOKENS } from "../chatgpt-web-models";
import { estimateTokens } from "../lib/token-estimate";
import { ChatGptBrowserWorker, type BrowserTurn } from "../adapters/chatgpt-web/browser-worker";
import { assertChatGptWebInputWithinLimits } from "../adapters/chatgpt-web/browser-input-policy";
import { ChatGptPersistentBrowserStateError } from "../adapters/chatgpt-web/browser-personalization";
import { boundedChatText, ChatCompletionError, compileChatCompletion, wellFormedText, type ChatCompletionInput, type ChatCompletionResult } from "./contract";
import type { CodexProviderConfig } from "../types";

export type ChatCompletionExecutor = (input: ChatCompletionInput, config: AppConfig, signal: AbortSignal,
  onText: (delta: string) => void) => Promise<{ answer: string; limited?: boolean; result?: ChatCompletionResult }>;
const active = new Set<string>();
export const activeChatCompletionTurns = () => active.size;

export function chatCompletionRoutes(config: AppConfig) {
  return config.browserInteractionMode === "manual" ? []
    : availableChatGptWebModelRoutes(config).filter(route => route.interactionMode === "automatic");
}

export function resolveChatCompletionRoute(input: ChatCompletionInput, config: AppConfig) {
  try {
    const route = requireChatGptWebModelRoute(input.model, config, input.reasoningEffort);
    if (route.interactionMode !== "automatic") throw new Error();
    return route;
  } catch { throw new ChatCompletionError("This Web model or reasoning effort is unavailable", 400, "model_not_found", "model"); }
}

export function prepareChatCompletion(input: ChatCompletionInput, config: AppConfig) {
  const route = resolveChatCompletionRoute(input, config);
  const capabilities = { localToolsEnabled: false, solAvailable: config.solAvailable,
    extraHighAvailable: config.extraHighAvailable, proAvailable: config.proAvailable };
  const prompt = compileChatCompletion(input);
  const tokens = estimateTokens(prompt, route.backendModel);
  try { assertChatGptWebInputWithinLimits(tokens + CHATGPT_WEB_PLATFORM_RESERVE_TOKENS, tokens,
    route.backendModel, route.adapterEffort, capabilities, prompt.length); }
  catch { throw new ChatCompletionError("Conversation exceeds this Web model's supported input limit", 400, "context_length_exceeded", "messages"); }
  if (input.tools.length && input.toolChoice !== "none" && config.mode !== "full") {
    throw new ChatCompletionError("Client functions require the configured local tools connector", 409, "tools_connector_required");
  }
  return { route, capabilities, prompt };
}

export function requireChatCompletionAvailability(config: AppConfig): void {
  if (config.browserInteractionMode === "manual") throw new ChatCompletionError("Local API access requires automatic browser interaction", 409, "automatic_mode_required");
  // Authoritative per-account pacing, cooldown, concurrency and affinity checks
  // happen when the existing browser worker acquires its launcher-owned turn.
}

export function createChatCompletionExecutor(dependencies: {
  worker?: (provider: CodexProviderConfig) => Pick<ChatGptBrowserWorker, "run">;
} = {}): ChatCompletionExecutor {
  return async (input, config, signal, onText) => {
    const { route, capabilities, prompt } = prepareChatCompletion(input, config);
    if (input.tools.length && input.toolChoice !== "none") {
      throw new ChatCompletionError("Client tool transport is unavailable", 503, "tools_connector_required");
    }
    signal.throwIfAborted();
    const traceId = `api_${randomUUID().replaceAll("-", "")}`;
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const limitReached = new Error("Local API visible output limit reached");
    let limited = false, delivered = "", observed = "", nextTokenProbeLength = 1;
    const provider = providerConfig(config);
    provider.chatgptWeb = { ...provider.chatgptWeb, localToolsEnabled: false,
      useSavedChats: false, experimentalFreshConversationPerTurn: false,
      experimentalBiggerContext: false, experimentalSkillAttachments: false,
      experimentalAsyncToolOperations: false, autoApproveToolCalls: false };
    const deadline = setTimeout(() => controller.abort(new ChatCompletionError("Web request exceeded its deadline", 504, "request_timeout")), 600_000);
    deadline.unref?.(); active.add(traceId);
    const turn: BrowserTurn = {
      traceId, requestedModel: route.slug, modelId: route.backendModel, modelFamily: route.modelFamily,
      reasoning: route.adapterEffort, capabilities, abortSignal: combined,
      prepare: async () => { combined.throwIfAborted(); return { text: prompt, images: [], transport: "inline", inlineChars: prompt.length, release() {} }; },
      onTextDelta(delta) {
        if (combined.aborted) return;
        observed += delta;
        if (observed.length > 2 * 1024 * 1024) { controller.abort(new ChatCompletionError("Output exceeds the response limit", 502, "model_output_limit")); return; }
        const last = observed.charCodeAt(observed.length - 1);
        const publishable = last >= 0xD800 && last <= 0xDBFF ? observed.slice(0, -1) : observed;
        if (!wellFormedText(publishable)) { controller.abort(new ChatCompletionError("Output contains invalid Unicode", 502, "model_protocol_error")); return; }
        if (publishable.length < nextTokenProbeLength) return;
        const allowed = boundedChatText(publishable, input.maxTokens, delivered);
        if (allowed.length > delivered.length) { const next = allowed.slice(delivered.length); delivered = allowed; onText(next); }
        if (allowed.length < publishable.length) { limited = true; controller.abort(limitReached); }
        nextTokenProbeLength = Math.max(publishable.length + 1, publishable.length * 2);
      },
    };
    try {
      let answer: string;
      try { answer = await (dependencies.worker?.(provider) ?? ChatGptBrowserWorker.forProvider(provider)).run(turn); }
      catch (error) {
        // A consumer limit cannot turn failed physical cleanup into successful truncation.
        if (limited && !signal.aborted && !(error instanceof ChatGptPersistentBrowserStateError)
          && (error === limitReached || error instanceof Error && error.name === "AbortError")) return { answer: delivered, limited: true };
        if (combined.aborted && error instanceof Error && error.name === "AbortError") throw combined.reason;
        throw error;
      }
      signal.throwIfAborted();
      if (combined.aborted && !limited) combined.throwIfAborted();
      if (!answer.startsWith(delivered)) throw new ChatCompletionError("Output changed after streaming began", 502, "model_output_changed");
      const allowed = boundedChatText(answer, input.maxTokens, delivered);
      if (allowed.length > delivered.length) onText(allowed.slice(delivered.length));
      return { answer: allowed, limited: limited || allowed.length < answer.length };
    } finally { clearTimeout(deadline); active.delete(traceId); }
  };
}
