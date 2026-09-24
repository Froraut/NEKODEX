import type { AdapterEvent, CodexUsage } from "../types";
import { adapterFailureFromMessage, classifyError, type CodexErrorPayload } from "../lib/errors";
import { usageDisplayTotalTokens } from "../usage/totals";

export function uuid(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function responsesUsage(usage: CodexUsage | undefined): Record<string, unknown> | null {
  // Responses permits null usage while a stream is in progress. Keep that same compatible shape
  // when this provider never reports usage; zero is a measured value and must not mean unknown.
  if (!usage) return null;
  // inputTokens is already inclusive of cache read/write (types.ts convention).
  const inputTokens = usage.inputTokens;
  const out: Record<string, unknown> = {
    input_tokens: inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usageDisplayTotalTokens(usage) ?? inputTokens + usage.outputTokens,
  };
  const inputDetails: Record<string, number> = {};
  if (usage.cachedInputTokens !== undefined) {
    // cached_tokens carries cache READS only, matching OpenAI semantics.
    inputDetails.cached_tokens = usage.cachedInputTokens;
  }
  if (usage.cacheCreationInputTokens !== undefined) {
    inputDetails.cache_write_tokens = usage.cacheCreationInputTokens;
  }
  if (Object.keys(inputDetails).length > 0) {
    out.input_tokens_details = inputDetails;
  }
  if (usage.reasoningOutputTokens !== undefined) {
    out.output_tokens_details = { reasoning_tokens: usage.reasoningOutputTokens };
  }
  return out;
}

export function responseError(status: number, type: string, message: string): CodexErrorPayload {
  return classifyError(status, type, message);
}

export function adapterFailureFromEvent(event: Extract<AdapterEvent, { type: "error" }>): { httpStatus: number; error: CodexErrorPayload } {
  if (event.status === undefined && event.errorType === undefined && event.code === undefined) {
    return adapterFailureFromMessage(event.message);
  }
  const fallback = adapterFailureFromMessage(event.message);
  const httpStatus = event.status ?? fallback.httpStatus;
  const error = classifyError(httpStatus, event.errorType ?? fallback.error.type, event.message);
  if (event.errorType !== undefined) error.type = event.errorType;
  if (event.code !== undefined) error.code = event.code;
  return { httpStatus, error };
}

export interface OutputItem {
  type: string;
  id: string;
  [key: string]: unknown;
}

const PLAINTEXT_COLLABORATION_CALLS = new Set([
  "spawn_agent",
  "send_message",
  "followup_task",
]);

/**
 * Codex MultiAgent V2 normally treats collaboration message arguments as backend ciphertext.
 * An empty encrypted_function_args list is the protocol's explicit plaintext-delivery marker.
 */
export function plaintextCollaborationFields(namespace: string | undefined, name: string): Record<string, unknown> {
  return namespace === "collaboration" && PLAINTEXT_COLLABORATION_CALLS.has(name)
    ? { encrypted_function_args: [] }
    : {};
}

export type ResponsesTerminalStatus = "completed" | "failed" | "incomplete";
