import { ChatGptWebAdapterError } from "./adapter-error";
import type { BrokerToolResult } from "./turn-broker-protocol";
import { recordTurnBrokerEvent } from "./turn-broker-diagnostics";
import { chatGptTurnSessions, type ChatGptTurnSessions } from "./turn-execution";

const TOOL_RESULT_ITEM_TYPES = new Set(["function_call_output", "custom_tool_call_output"]);
const MAX_CALL_ID_CHARS = 256;
const MAX_REJECTION_DETAIL_CHARS = 600;

/**
 * Call ids of tool results in a raw Responses body, read without schema validation. Only the
 * item type and call_id are inspected; outputs are never read.
 */
export function extractToolResultCallIds(raw: unknown): Set<string> {
  const callIds = new Set<string>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return callIds;
  const input = (raw as { input?: unknown }).input;
  if (!Array.isArray(input)) return callIds;
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const { type, call_id: callId } = item as { type?: unknown; call_id?: unknown };
    if (typeof type !== "string" || !TOOL_RESULT_ITEM_TYPES.has(type)) continue;
    if (typeof callId === "string" && callId.length > 0 && callId.length <= MAX_CALL_ID_CHARS) callIds.add(callId);
  }
  return callIds;
}

export function rejectedToolResult(detail: string): BrokerToolResult {
  const value = {
    code: "codex_tool_result_rejected",
    executed: "unknown",
    retryable: false,
    message: "NEKODEX rejected the tool result Codex returned for this call; the tool may have executed."
      + " Its result is unavailable and this Codex turn is ending. Do not assume the action did not happen.",
    detail: detail.length > MAX_REJECTION_DETAIL_CHARS ? `${detail.slice(0, MAX_REJECTION_DETAIL_CHARS - 1)}…` : detail,
  };
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, isError: true };
}

/**
 * A Codex follow-up whose Responses body fails validation never reaches the adapter, so the
 * dispatched calls it answers would keep their MCP requests waiting until the transport deadline
 * and the model would poll them until the turn ends. Answer each matched outstanding call with an
 * explicit error, then fail its browser turn: the native turn already ended with this rejection.
 * Returns the number of calls answered.
 */
export async function rejectUnparseableChatGptToolResults(
  raw: unknown,
  detail: string,
  sessions: Pick<ChatGptTurnSessions, "findOutstandingToolCalls" | "retire"> = chatGptTurnSessions,
): Promise<number> {
  const callIds = extractToolResultCallIds(raw);
  if (callIds.size === 0) return 0;
  let answered = 0;
  for (const match of sessions.findOutstandingToolCalls(callIds)) {
    const { key, session } = match;
    if (session.runtime.mode !== "tools") continue;
    const runtime = session.runtime;
    let sessionAnswered = 0;
    for (const callId of match.callIds) {
      if (!session.hasOutstanding(callId)) continue;
      try {
        if (!runtime.completeTool) throw new Error("this turn cannot deliver tool results directly");
        await runtime.completeTool(callId, rejectedToolResult(detail));
        sessionAnswered += 1;
      } catch (error) {
        console.error(`[chatgpt-web] could not answer a rejected tool result call=${callId.slice(0, 17)}: ${
          error instanceof Error ? error.message : String(error)}`);
      }
      try {
        runtime.externalProgress.recordToolResult(callId, Date.now());
      } catch {
        // Progress accounting is advisory; the session is retired below either way.
      }
      session.markResultDelivered(callId);
    }
    answered += sessionAnswered;
    console.error(
      `[chatgpt-web] Codex tool results were rejected by request validation; answered ${sessionAnswered}`
      + ` of ${match.callIds.length} outstanding call(s) with an error and failed trace=${session.traceId ?? "unknown"}`,
    );
    recordTurnBrokerEvent("broker_tool_results_rejected", {
      traceId: session.traceId ?? "unknown", matched: match.callIds.length, answered: sessionAnswered,
    });
    sessions.retire(key, session, new ChatGptWebAdapterError(
      "Codex returned a tool result that NEKODEX could not parse, so this ChatGPT turn was stopped.",
      { status: 400, errorType: "invalid_request_error", code: "tool_result_rejected", retryable: false },
    ));
  }
  return answered;
}
