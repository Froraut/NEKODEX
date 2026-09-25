import type { CodexParsedRequest } from "../../types";
import { brokerToolResult, currentToolResults } from "./broker-tool-result";
import type { BrokerToolResult, TurnBrokerOwner } from "./turn-broker";
import type { ChatGptTurnSession } from "./turn-execution";
import { activeCompactionToolResultInstruction, zeroRiskActiveCompactionToolResultInstruction } from "./native-compaction-control";
import { abortReason, withCompactionAbort } from "./compaction-lifecycle";

function interruptedByActiveCompaction(): BrokerToolResult {
  return {
    content: [{ type: "text", text: activeCompactionToolResultInstruction() }],
    isError: true,
  };
}

function withZeroRiskCompactionInstruction(result: BrokerToolResult): BrokerToolResult {
  return {
    ...result,
    content: [
      ...result.content,
      {
        type: "text",
        text: zeroRiskActiveCompactionToolResultInstruction(true),
      },
    ],
  };
}

function interruptedByZeroRiskCompaction(): BrokerToolResult {
  return {
    content: [{
      type: "text",
      text: zeroRiskActiveCompactionToolResultInstruction(false),
    }],
    isError: true,
  };
}

type ActiveSourceBroker = Pick<TurnBrokerOwner, "requestCompaction" | "compactionDeliveryCount" | "completeTool" | "revoke">;

interface ActiveSourceDeliveryPolicy<T> {
  label: string;
  boundaryError: string;
  eligible(source: ChatGptTurnSession): boolean;
  queuedResult(): BrokerToolResult;
  result(canonical: BrokerToolResult, interruptedQueued: number, last: boolean): BrokerToolResult;
  deliveryObservation: "before-settlement" | "after-settlement";
  delivered(outstanding: number, count: () => Promise<number>): Promise<boolean>;
  interpret(answer: string, outstanding: number, intercepted: boolean): T;
}

async function settleActiveSource<T>(
  parsed: CodexParsedRequest,
  source: ChatGptTurnSession,
  broker: ActiveSourceBroker,
  policy: ActiveSourceDeliveryPolicy<T>,
  signal?: AbortSignal,
): Promise<T> {
  return source.runExclusive(async () => {
    if (signal?.aborted) {
      source.cancel(abortReason(signal));
      throw abortReason(signal);
    }
    if (!source.isActive() || source.runtime.mode !== "tools" || !policy.eligible(source)) {
      throw new Error(policy.boundaryError);
    }
    const outstanding = source.outstanding();
    const results = currentToolResults(parsed, source);
    if (results.size !== outstanding.length) {
      throw new Error(
        `Codex supplied ${results.size} of ${outstanding.length} required tool results for ${policy.label}`,
      );
    }
    let token: string | undefined;
    try {
      token = await withCompactionAbort(source.runtime.token, signal);
      const interruptedQueued = await broker.requestCompaction(token, policy.queuedResult());
      for (const [index, request] of outstanding.entries()) {
        const result = results.get(request.callId)!;
        await broker.completeTool(
          token,
          request.callId,
          policy.result(brokerToolResult(result), interruptedQueued, index === outstanding.length - 1),
        );
        source.runtime.externalProgress.recordToolResult();
        source.markResultDelivered(request.callId);
      }
      const browserOutcome = await withCompactionAbort(source.browserOutcome, signal);
      if (browserOutcome.type === "error") throw browserOutcome.error;
      const activeToken = token;
      const observeDelivery = () => policy.delivered(
        outstanding.length, async () => broker.compactionDeliveryCount(activeToken),
      );
      const beforeSettlement = policy.deliveryObservation === "before-settlement"
        ? await observeDelivery() : undefined;
      // The one structured checkpoint message reuses this exact retained tab. It must not race the
      // helper's /turn/end handshake for the response that consumed the canonical tool results.
      await withCompactionAbort(source.physicalSettlement, signal);
      return policy.interpret(browserOutcome.answer, outstanding.length, beforeSettlement ?? await observeDelivery());
    } catch (error) {
      if (signal?.aborted) source.cancel(abortReason(signal));
      throw error;
    } finally {
      if (token) await broker.revoke(token);
    }
  });
}

export function settleActiveCompactionSource(
  parsed: CodexParsedRequest, source: ChatGptTurnSession, broker: ActiveSourceBroker, signal?: AbortSignal,
): Promise<{ answer: string; compactionInstructionDelivered: boolean }> {
  return settleActiveSource(parsed, source, broker, {
    label: "compaction",
    boundaryError: "The active ChatGPT compaction source has no MCP tool boundary",
    eligible: () => true,
    queuedResult: interruptedByActiveCompaction,
    result: canonical => canonical,
    deliveryObservation: "before-settlement",
    delivered: async (_outstanding, count) => await count() > 0,
    interpret: (answer, _outstanding, intercepted) => ({ answer, compactionInstructionDelivered: intercepted }),
  }, signal);
}

export function settleActiveZeroRiskCompactionSource(
  parsed: CodexParsedRequest, source: ChatGptTurnSession, broker: ActiveSourceBroker, signal?: AbortSignal,
): Promise<string | undefined> {
  return settleActiveSource(parsed, source, broker, {
    label: "Manual mode compaction",
    boundaryError: "The active Manual mode compaction source has no manual MCP tool boundary",
    eligible: session => session.runtime.mode === "tools" && !!session.runtime.manualControl,
    queuedResult: interruptedByZeroRiskCompaction,
    // Manual mode explicitly delivers its instruction on the last canonical result only
    // when no queued call received it. Automatic mode never augments canonical results.
    result: (canonical, interruptedQueued, last) => interruptedQueued === 0 && last
      ? withZeroRiskCompactionInstruction(canonical) : canonical,
    deliveryObservation: "after-settlement",
    delivered: async (outstanding, count) => outstanding > 0 || await count() > 0,
    interpret: (answer, outstanding, intercepted) => {
      if (outstanding === 0 && !intercepted) return undefined;
      const summary = answer.trim();
      if (!summary) throw new Error("The active Manual mode response returned an empty compaction summary");
      return summary;
    },
  }, signal);
}
