import { parseDataUrl } from "../image";
import type { CodexContentPart, CodexParsedRequest, CodexToolResultMessage } from "../../types";
import type { BrokerToolResult, TurnBrokerOwner } from "./turn-broker";
import type { ChatGptTurnSession } from "./turn-execution";
import { activeCompactionToolResultInstruction, zeroRiskActiveCompactionToolResultInstruction } from "./native-compaction-control";
import { abortReason, withCompactionAbort } from "./compaction-lifecycle";

function brokerContent(content: string | CodexContentPart[]): unknown[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content.map(part => {
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.type === "file") return {
      type: "resource",
      resource: {
        uri: `nekodex-file:sha256:${part.sha256}`,
        name: part.name,
        mimeType: part.mimeType,
        blob: part.base64,
      },
    };
    const parsed = parseDataUrl(part.imageUrl);
    if (parsed) return { type: "image", data: parsed.base64, mimeType: parsed.mediaType };
    return { type: "resource_link", uri: part.imageUrl, name: "Codex tool image", mimeType: "image/*" };
  });
}

function structuredContent(text: string): unknown | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function toolResult(message: CodexToolResultMessage): BrokerToolResult {
  const content = brokerContent(message.content);
  const text = typeof message.content === "string"
    ? message.content
    : message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
  const structured = structuredContent(text);
  return {
    content,
    ...(structured !== undefined ? { structuredContent: structured } : {}),
    ...(message.isError ? { isError: true } : {}),
  };
}

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

function currentToolResults(
  parsed: CodexParsedRequest,
  session: ChatGptTurnSession,
): Map<string, CodexToolResultMessage> {
  const results = new Map<string, CodexToolResultMessage>();
  for (const message of parsed.context.messages) {
    if (message.role !== "toolResult" || !session.hasOutstanding(message.toolCallId)) continue;
    if (results.has(message.toolCallId)) {
      throw new Error(`Codex returned duplicate results for tool call ${message.toolCallId}`);
    }
    results.set(message.toolCallId, message);
  }
  return results;
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
          policy.result(toolResult(result), interruptedQueued, index === outstanding.length - 1),
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
