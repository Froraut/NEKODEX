import type { AdapterEvent, CodexMessagePhase, CodexUsage } from "../types";
import { encodeCompactionSummary } from "./compaction";
import {
  uuid, responsesUsage, adapterFailureFromEvent, resolveOutputToolCall, outputToolCallItemId, completedToolCallItem,
  type OutputItem,
} from "./output-policy";

export function buildResponseJSON(
  events: AdapterEvent[],
  modelId: string,
  options?: {
    hideThinkingSummary?: boolean;
    toolNsMap?: Map<string, { namespace: string; name: string }>;
    freeformToolNames?: Set<string>;
    toolSearchToolNames?: Set<string>;
    /** Remote compaction v2 turn — append one synthetic compaction output item (see bridgeToResponsesSSE). */
    compaction?: boolean;
  },
): Record<string, unknown> {
  const responseId = `resp_${uuid()}`;
  const output: OutputItem[] = [];
  let usage: CodexUsage | undefined;
  let errorEvent: Extract<AdapterEvent, { type: "error" }> | undefined;
  let endTurn: boolean | undefined;
  let stopReason: string | undefined;
  let receivedDone = false;
  let compactionText = "";

  let currentText = "";
  let currentTextPhase: CodexMessagePhase | undefined;
  let currentSummaryReasoning = "";
  let currentToolCallId = "";
  let currentToolCallName = "";
  let currentToolCallArgs = "";

  const flushText = () => {
    if (!currentText) return;
    output.push({
      type: "message", id: `msg_${uuid()}`, role: "assistant", status: "completed",
      content: [{ type: "output_text", text: currentText, annotations: [] }],
      ...(currentTextPhase ? { phase: currentTextPhase } : {}),
    });
    currentText = "";
    currentTextPhase = undefined;
  };
  const flushSummaryReasoning = () => {
    if (!currentSummaryReasoning) return;
    if (options?.hideThinkingSummary === true) { currentSummaryReasoning = ""; return; }
    output.push({
      type: "reasoning", id: `rs_${uuid()}`,
      summary: [{ type: "summary_text", text: currentSummaryReasoning }],
    });
    currentSummaryReasoning = "";
  };
  const flushToolCall = () => {
    if (!currentToolCallId) return;
    const { name, namespace, kind } = resolveOutputToolCall(
      currentToolCallName, options?.toolNsMap, options?.freeformToolNames, options?.toolSearchToolNames,
    );
    output.push(completedToolCallItem(
      kind, outputToolCallItemId(kind), currentToolCallId, name, currentToolCallArgs, namespace,
    ));
    currentToolCallId = "";
    currentToolCallName = "";
    currentToolCallArgs = "";
  };

  for (const e of events) {
    switch (e.type) {
      case "assistant_boundary":
        flushText();
        flushSummaryReasoning();
        flushToolCall();
        break;
      case "text_delta":
        if (currentText && currentTextPhase !== e.phase) flushText();
        if (currentSummaryReasoning) flushSummaryReasoning();
        if (currentToolCallId) flushToolCall();
        // Compaction turns keep the summary out of normal message output (replay dedup — see
        // bridgeToResponsesSSE); it ships only inside the synthetic compaction item below.
        if (options?.compaction) compactionText += e.text;
        else {
          currentTextPhase = e.phase;
          currentText += e.text;
        }
        break;
      case "thinking_delta":
        if (currentText) flushText();
        if (currentToolCallId) flushToolCall();
        currentSummaryReasoning += e.thinking;
        break;
      case "tool_call_start":
        if (currentText) flushText();
        if (currentSummaryReasoning) flushSummaryReasoning();
        flushToolCall();
        currentToolCallId = e.id;
        currentToolCallName = e.name;
        currentToolCallArgs = "";
        break;
      case "tool_call_delta":
        currentToolCallArgs += e.arguments;
        break;
      case "tool_call_end":
        flushToolCall();
        break;
      case "error":
        errorEvent = e;
        usage = e.usage ?? usage;
        break;
      case "done":
        receivedDone = true;
        usage = e.usage;
        endTurn = e.endTurn;
        if (e.stopReason === "max_tokens" || e.stopReason === "content_filter") stopReason = e.stopReason;
        break;
    }
  }
  flushText();
  flushSummaryReasoning();
  flushToolCall();
  const failure = errorEvent ? adapterFailureFromEvent(errorEvent) : undefined;
  const implicitIncompleteReason = errorEvent ? undefined
    : stopReason === "max_tokens" ? "max_output_tokens"
      : stopReason === "content_filter" ? "content_filter"
        : receivedDone ? undefined : "adapter_eof";
  const status = errorEvent
    ? "failed"
    : implicitIncompleteReason
      ? "incomplete"
      : "completed";
  // Match the SSE contract: only an explicit, successful terminal can replace history.
  if (options?.compaction && status === "completed") {
    output.push({ type: "compaction", id: `cmp_${uuid()}`, encrypted_content: encodeCompactionSummary(compactionText) });
  }
  return {
    id: responseId, object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    model: modelId, output,
    ...(endTurn !== undefined ? { end_turn: endTurn } : {}),
    ...(failure ? { error: failure.error, last_error: failure.error } : {}),
    ...(errorEvent?.retryable !== undefined ? { retryable: errorEvent.retryable } : {}),
    ...(implicitIncompleteReason ? {
      incomplete_details: { reason: implicitIncompleteReason },
    } : {}),
    usage: responsesUsage(usage),
  };
}
