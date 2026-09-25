import type { AdapterEvent, CodexUsage } from "../../types";
import type { BrokerToolRequest } from "./turn-broker";
import type { ChatGptTurnSession } from "./turn-session";
import type { ChatGptBrowserOutcome } from "./turn-feeds";

/** Terminal framing shared by journalled rounds and standalone structured compaction. */
export function emitBrowserCompletion(
  outcome: ChatGptBrowserOutcome,
  usage: CodexUsage,
  emit: (event: AdapterEvent) => void,
): void {
  if (outcome.type === "error") throw outcome.error;
  emit({ type: "done", stopReason: "stop", endTurn: true, usage });
}

function emitToolBatch(requests: BrokerToolRequest[], usage: CodexUsage, emit: (event: AdapterEvent) => void): void {
  for (const request of requests) {
    emit({ type: "tool_call_start", id: request.callId, name: request.wireName });
    emit({
      type: "tool_call_delta",
      arguments: request.freeform
        ? JSON.stringify({ input: request.input ?? "" })
        : JSON.stringify(request.arguments ?? {}),
    });
    emit({ type: "tool_call_end" });
  }
  emit({ type: "done", stopReason: "tool_use", endTurn: false, usage });
}

export function emitTextDeltas(deltas: string[], emit: (event: AdapterEvent) => void): void {
  for (const text of deltas) emit({ type: "text_delta", text, phase: "final_answer" });
}

type UsageInput = { answer?: string; reasoning: string[]; toolRequests?: BrokerToolRequest[] };

/** Per-native-round delivery: reserve and journal the whole batch before calling the observer. */
export function createChatGptTurnRoundDelivery(options: {
  session: ChatGptTurnSession;
  roundKey: string;
  emit: (event: AdapterEvent) => void;
  estimateUsage: (input: UsageInput) => CodexUsage;
  validateStructuredOutput?: (answer: string) => void;
  bufferStructuredOutput: boolean;
}) {
  const { session, roundKey, emit, estimateUsage, validateStructuredOutput, bufferStructuredOutput } = options;
  const events = (batch: readonly AdapterEvent[]): void => {
    session.appendRoundEvents(roundKey, batch);
    for (const event of batch) emit(event);
  };
  const batch = (produce: (buffer: (event: AdapterEvent) => void) => void): void => {
    const buffered: AdapterEvent[] = [];
    produce(event => buffered.push(event));
    events(buffered);
  };
  return {
    events,
    batch,
    event: (event: AdapterEvent): void => events([event]),
    successfulAnswer(answer: string, rememberFinalReplay = false): void {
      if (session.runtime.text.value() !== answer) {
        throw new Error("ChatGPT browser Markdown stream did not reproduce the completed answer");
      }
      validateStructuredOutput?.(answer);
      if (bufferStructuredOutput) batch(buffer => emitTextDeltas([answer], buffer));
      const reasoning = session.roundReasoning(roundKey);
      // Settled replay records its prelude after validated buffered output. Live completion has
      // already captured its prelude before broker revocation, including on a failing outcome.
      if (rememberFinalReplay) {
        session.setFinalReasoning(reasoning);
        session.setFinalEvents(session.roundEvents(roundKey));
      }
      batch(buffer => emitBrowserCompletion(
        { type: "final", answer }, estimateUsage({ answer, reasoning }), buffer,
      ));
      session.completeRound(roundKey);
    },
    tools(requests: BrokerToolRequest[], reasoning: string[]): void {
      batch(buffer => emitToolBatch(requests, estimateUsage({ reasoning, toolRequests: requests }), buffer));
      session.completeRound(roundKey);
    },
  };
}
