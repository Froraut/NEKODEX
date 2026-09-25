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

export type OutputToolCallKind = "tool_search" | "freeform" | "function";

/** Resolve an adapter wire name to the client tool it calls and the output item kind it relays as. */
export function resolveOutputToolCall(
  wireName: string,
  toolNsMap?: Map<string, { namespace: string; name: string }>,
  freeformToolNames?: Set<string>,
  toolSearchToolNames?: Set<string>,
): { name: string; namespace: string | undefined; kind: OutputToolCallKind } {
  const mapped = toolNsMap?.get(wireName);
  const name = mapped?.name ?? wireName;
  const toolSearch = toolSearchToolNames?.has(name) ?? false;
  const freeform = !toolSearch && (freeformToolNames?.has(name) ?? false);
  return { name, namespace: mapped?.namespace, kind: toolSearch ? "tool_search" : freeform ? "freeform" : "function" };
}

export function outputToolCallItemId(kind: OutputToolCallKind): string {
  return `${kind === "tool_search" ? "tsc" : kind === "freeform" ? "ctc" : "fc"}_${uuid()}`;
}

// Freeform/custom tools (apply_patch) carry their body in `input`; the model is given a
// function with `{input:string}`, so unwrap it when relaying back as a custom_tool_call.
export function freeformToolInput(args: string): string {
  try { const o = JSON.parse(args); if (o && typeof o.input === "string") return o.input; } catch { /* raw */ }
  return args;
}

// tool_search_call carries arguments as a JSON object ({query, limit}); parse the model's arg string.
function toolSearchArguments(args: string): Record<string, unknown> {
  try { const o = JSON.parse(args); return o && typeof o === "object" ? o : {}; } catch { return {}; }
}

/** The completed output item for a finished tool call, shared by the SSE and JSON forms. */
export function completedToolCallItem(
  kind: OutputToolCallKind,
  id: string,
  callId: string,
  name: string,
  args: string,
  namespace: string | undefined,
): OutputItem {
  if (kind === "tool_search") {
    return {
      type: "tool_search_call", id,
      call_id: callId, execution: "client",
      arguments: toolSearchArguments(args), status: "completed",
    };
  }
  if (kind === "freeform") {
    return {
      type: "custom_tool_call", id,
      call_id: callId, name,
      input: freeformToolInput(args), status: "completed",
    };
  }
  // Empty input (no-arg tools like computer_use get_app_state / list_apps) must serialize as
  // "{}", never "" — Codex echoes the call back as a function_call next turn, and JSON.parse("")
  // would 400 the whole session ("invalid JSON arguments"), poisoning all later turns.
  return {
    type: "function_call", id,
    call_id: callId, name,
    arguments: args || "{}", status: "completed",
    ...(namespace ? { namespace } : {}),
    ...plaintextCollaborationFields(namespace, name),
  };
}
