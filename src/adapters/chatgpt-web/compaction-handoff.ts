import { withCompactionAbort } from "./compaction-lifecycle";
import { CompactionCheckpointStore, type CompactionCheckpoint } from "./compaction-checkpoint-store";
import type { CodexParsedRequest } from "../../types";
import { extractChatGptCompactionSourceRevision } from "./environment";
import type { ChatGptBrowserWorker } from "./browser-worker";
import type { ChatGptWebCompactionExecution } from "../../chatgpt-web-compaction-policy";
import { ChatGptCompactionHandoffAccepted, ChatGptWebAdapterError } from "./adapter-error";
import type { CompactionTransactionHandle } from "./compaction-transaction";
import type { ChatGptWebCapabilities } from "./model";
import { structuredCompactionHandoffInstruction } from "./native-compaction-control";
import type { TurnBroker } from "./turn-broker";
import type { ChatGptTurnSession } from "./turn-execution";

export const LATEST_USER_PROMPT_MARKER = "CODEX_LATEST_USER_PROMPT_JSON";

function userPromptText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const text = content.flatMap(part => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return [];
    const value = part as { type?: unknown; text?: unknown };
    return (value.type === "input_text" || value.type === "text") && typeof value.text === "string"
      ? [value.text]
      : [];
  }).join("\n");
  return text || undefined;
}

export function canonicalizeCompactionHandoff(
  parsed: CodexParsedRequest,
  summary: string,
): string {
  const normalized = summary.trim();
  if (!normalized) throw new Error("ChatGPT returned an empty structured compaction handoff");
  const latestUserPrompt = userPromptText(extractChatGptCompactionSourceRevision(parsed).content);
  if (latestUserPrompt === undefined) {
    throw new Error("ChatGPT compaction source has no canonical latest user prompt");
  }
  const appendix = `${LATEST_USER_PROMPT_MARKER}\n${JSON.stringify(latestUserPrompt)}`;
  const markerOffset = normalized.lastIndexOf(`\n${LATEST_USER_PROMPT_MARKER}\n`);
  if (markerOffset < 0) return `${normalized}\n\n${appendix}`;
  if (normalized.slice(markerOffset + 1).trimEnd() !== appendix) {
    throw new Error("ChatGPT compaction handoff contains a conflicting latest-user marker");
  }
  return normalized;
}

export const MAX_COMPACTION_HANDOFF_TIMEOUT_MS = 5 * 60_000;

function boundedCompactionTimeout(timeoutMs: number): number {
  return Math.min(timeoutMs, MAX_COMPACTION_HANDOFF_TIMEOUT_MS);
}

export async function requestRetainedCompactionHandoff(
  worker: ChatGptBrowserWorker,
  parsed: CodexParsedRequest,
  source: ChatGptTurnSession,
  broker: TurnBroker,
  capabilities: ChatGptWebCapabilities,
  traceId: string,
  signal?: AbortSignal,
  timeoutMs = MAX_COMPACTION_HANDOFF_TIMEOUT_MS,
  compactionExecution?: ChatGptWebCompactionExecution,
): Promise<string> {
  const conversationKey = source.conversationKey();
  if (!conversationKey) throw new Error("The completed ChatGPT source has no retained conversation identity");
  const operationTimeoutMs = boundedCompactionTimeout(timeoutMs);
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(
    () => deadline.abort(new Error(`ChatGPT compaction handoff timed out after ${operationTimeoutMs}ms`)),
    operationTimeoutMs,
  );
  deadlineTimer.unref?.();
  const operationSignal = signal
    ? AbortSignal.any([signal, deadline.signal])
    : deadline.signal;
  const browserAbort = new AbortController();
  const abortBrowser = () => browserAbort.abort(operationSignal.reason);
  let transaction: CompactionTransactionHandle | undefined;
  let browser: Promise<string> | undefined;
  let sendActivated = false;
  const checkpoints = new CompactionCheckpointStore();
  let checkpoint: CompactionCheckpoint | undefined;
  if (operationSignal.aborted) abortBrowser();
  else operationSignal.addEventListener("abort", abortBrowser, { once: true });
  try {
    const transactionPromise = broker.beginCompactionTransaction(traceId, operationTimeoutMs);
    void transactionPromise.then(lateTransaction => {
      if (operationSignal.aborted && transaction !== lateTransaction) {
        broker.abortCompactionTransaction(lateTransaction.token);
      }
    }, () => {});
    transaction = await withCompactionAbort(transactionPromise, operationSignal);
    const instruction = structuredCompactionHandoffInstruction(transaction);
    const prepare = async () => ({ text: instruction, images: [], release: () => {} });
    checkpoint = checkpoints.begin({
      owner: source.ownerKey, thread: source.nativeThreadId, turn: source.nativeTurnId,
      conversationKey, sourceRequest: parsed._rawBody,
      // Hash the complete source context as well: latest-user identity alone misses tool revisions.
      context: parsed.context, model: parsed.modelId, options: parsed.options,
    });
    browser = worker.run({
      traceId,
      modelId: parsed.modelId,
      reasoning: parsed.options.reasoning,
      // The retained connector exposes only the one-shot control token embedded above. It does
      // not receive an ordinary Codex tool environment for this checkpoint message.
      capabilities: { ...capabilities, localToolsEnabled: false },
      nativeConnector: true,
      compaction: true,
      ...(compactionExecution ? { compactionExecution } : {}),
      prepare,
      prepareResume: prepare,
      conversationKey,
      requireRetainedConversation: true,
      abortSignal: browserAbort.signal,
      onTextDelta: () => {},
      onSendActivated: () => { sendActivated = true; },
    });
    const browserFailure = browser.then<never>(
      () => new Promise<never>(() => {}),
      error => { throw error; },
    );
    // A synchronous worker cancellation can precede the abort race attaching its handler.
    void browserFailure.catch(() => {});
    const summary = await withCompactionAbort(
      Promise.race([
        broker.waitForCompactionHandoff(transaction.token, operationSignal),
        browserFailure,
      ]),
      operationSignal,
    );
    // The one-shot control submission is the terminal event for this purpose-built response.
    // ChatGPT may render no assistant text after a tool-only response, and therefore no Copy
    // action. End our owned turn explicitly and wait for the launcher/helper cleanup handshake.
    browserAbort.abort(new ChatGptCompactionHandoffAccepted());
    await withCompactionAbort(
      browser.then(() => undefined, () => undefined),
      operationSignal,
    );
    try { checkpoints.finish(checkpoint, "accepted", summary); }
    catch {
      // Persistence is diagnostic, not part of live success. Rejecting here would replace
      // an accepted handoff with a failed exact-run result for reconnecting observers.
      console.warn("Compaction checkpoint acceptance not persisted", { id: checkpoint.id, binding: checkpoint.binding });
    }
    return summary;
  } catch (error) {
    if (checkpoint) {
      // If this write fails, the fsynced intent remains deliberately uncertain. Preserve the
      // original failure/cancellation, and never reinterpret a journal failure as safe to retry.
      try { checkpoints.finish(checkpoint, operationSignal.aborted ? "interrupted" : "ambiguous"); }
      catch { /* diagnostic update unavailable; durable intent remains */ }
    }
    // Only page acquisition failure before Send is safe to replace. A model
    // refusal, timeout after submission or cancellation must never be resent.
    if (!sendActivated && !operationSignal.aborted && error instanceof Error
      && error.message.startsWith("ChatGPT browser surface did not expose an operational viewport:")) {
      throw new ChatGptWebAdapterError("Retained page unavailable before compaction submission", {
        status: 409, errorType: "invalid_request_error", code: "compaction_source_unavailable",
        retryable: false, cause: error,
      });
    }
    throw error;
  } finally {
    browserAbort.abort();
    if (transaction) broker.abortCompactionTransaction(transaction.token);
    if (browser) {
      // Logical cancellation is not physical retirement. The retained-session owner tracks
      // physical settlement separately, so this helper must not turn its own deadline into an
      // unbounded wait when the worker does not acknowledge abort immediately.
      await withCompactionAbort(
        browser.then(() => undefined, () => undefined),
        operationSignal,
      ).catch(() => {});
    }
    operationSignal.removeEventListener("abort", abortBrowser);
    clearTimeout(deadlineTimer);
  }
}


export * from "./compaction-run-registry";
export { settleActiveCompactionSource, settleActiveZeroRiskCompactionSource } from "./active-compaction-source";
