import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ChatGptWebAdapterError } from "../adapters/chatgpt-web/adapter-error";
import type { BrowserTurn } from "../adapters/chatgpt-web/browser-worker";
import type { ChatGptCompanionTransportPort } from "../adapters/chatgpt-web/companion-transport-port";
import { chatGptHtmlToMarkdown } from "../adapters/chatgpt-web/markdown";
import { CHATGPT_WEB_LUNA_MODEL_ID, CHATGPT_WEB_MODEL_ID } from "../adapters/chatgpt-web/model";
import type { BrowserCompanionHost } from "./host";
import {
  CHATGPT_COMPANION_MAX_PROMPT_CHARS, COMPANION_CHATGPT_FEATURE, browserBindingOf,
  type BrowserBinding, type ChatGptCompanionResult, type CompanionReceipt,
} from "./protocol";

/** Explicit user attestation of the visible ChatGPT selection in the bound tab. */
export const chatGptCompanionBindSchema = z.object({
  modelId: z.enum([CHATGPT_WEB_MODEL_ID, CHATGPT_WEB_LUNA_MODEL_ID]),
  reasoning: z.enum(["low", "medium", "high", "xhigh", "max"]),
  modelFamily: z.string().regex(/^\d{1,2}(?:\.\d{1,2})?$/).optional(),
  /** Optional trusted-owner account pin (same one-way digest the page reports). */
  account: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type ChatGptCompanionBindRequest = z.infer<typeof chatGptCompanionBindSchema>;

type DocumentAnchor = Omit<BrowserBinding, "observationId">;
interface Bound extends ChatGptCompanionBindRequest {
  document: DocumentAnchor; account: string; identityEpoch: string; modelLabel: string; boundAt: number;
}
export interface ChatGptCompanionHeld {
  operationId: string; stage: "send" | "response"; reason: string; heldAt: number; userMessageId?: string;
}
export interface ChatGptCompanionTurnReceipt {
  operationId: string; traceId: string; userMessageId: string; assistantMessageId?: string; path: string;
  identityEpoch: string; answerSha256: string; completedAt: number;
}
export interface ChatGptCompanionTransportOptions {
  /** Current live host owner, or undefined while the listener is disabled. */
  host(): BrowserCompanionHost | undefined;
  timing?: Partial<{ sendReceiptMs: number; readMs: number; pollMs: number; responseMs: number; stableReads: number }>;
  now?: () => number;
}

const anchorKeys = ["sessionId", "scopeId", "tabId", "windowId", "frameId", "documentId", "documentEpoch"] as const;
const sameAnchor = (a: DocumentAnchor, b: DocumentAnchor) => anchorKeys.every(key => a[key] === b[key]);
const anchorOf = (binding: BrowserBinding): DocumentAnchor => {
  const { observationId: _ignored, ...anchor } = browserBindingOf(binding);
  return anchor;
};
function refused(message: string, code: string): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(message, { status: 409, errorType: "invalid_request_error", code, retryable: false });
}
function heldError(message: string, code = "companion_outcome_unknown"): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(message, { status: 502, errorType: "api_error", code, retryable: false });
}
const aborted = () => new DOMException("ChatGPT web turn aborted", "AbortError");

/**
 * Companion ChatGPT transport leaf. `ChatGptBrowserWorker.run` admits each turn and keeps its
 * registry slot; this leaf owns only the bound document, its one send and the response read.
 * A dispatched send without a terminal receipt is held: no later turn is admitted until the
 * user explicitly releases it, and the same prompt is never offered to the page again.
 */
export function createCompanionChatGptTransport(options: ChatGptCompanionTransportOptions) {
  const timing = { sendReceiptMs: 60_000, readMs: 15_000, pollMs: 1_000, responseMs: 30 * 60_000, stableReads: 2, ...options.timing };
  if (timing.stableReads < 2) throw new Error("A settled ChatGPT answer needs at least two equal reads");
  const now = options.now ?? Date.now;
  let bound: Bound | undefined;
  let held: ChatGptCompanionHeld | undefined;
  let active: string | undefined;
  let binding = false;
  let lastReceipt: ChatGptCompanionTurnReceipt | undefined;

  function liveHost(): BrowserCompanionHost {
    const host = options.host();
    if (!host) throw refused("The browser companion listener is not enabled", "companion_unavailable");
    return host;
  }
  /** Exact current selection; any re-selection, other tab or other document refuses. */
  function currentAnchor(host: BrowserCompanionHost, expected?: DocumentAnchor): BrowserBinding {
    const status = host.status();
    if (!status.paired || !status.selected) throw refused("Pair the companion and select the ChatGPT tab first", "companion_not_selected");
    if (expected && !sameAnchor(anchorOf(status.selected), expected)) throw refused("The selected companion tab or document changed since binding; bind the ChatGPT tab again", "companion_tab_mismatch");
    if (!status.features.includes(COMPANION_CHATGPT_FEATURE)) throw refused("The selected companion extension does not support ChatGPT send; update it and select the tab again", "companion_extension_outdated");
    return status.selected;
  }
  async function operate(host: BrowserCompanionHost, anchor: BrowserBinding, request: unknown, signal: AbortSignal, operationId?: string): Promise<CompanionReceipt> {
    return await host.chatgpt(anchor, request, signal, operationId);
  }
  function result<T extends ChatGptCompanionResult["op"]>(receipt: CompanionReceipt, op: T): Extract<ChatGptCompanionResult, { op: T }> | undefined {
    return receipt.outcome === "completed" && receipt.chatgpt?.op === op ? receipt.chatgpt as Extract<ChatGptCompanionResult, { op: T }> : undefined;
  }

  async function bind(input: unknown, signal?: AbortSignal) {
    const request = chatGptCompanionBindSchema.parse(input);
    if (binding || active) throw new Error("A ChatGPT companion binding or turn is already in progress");
    if (held) throw new Error("Release the held ChatGPT companion outcome before binding again");
    binding = true;
    try {
      const host = liveHost();
      const anchor = currentAnchor(host);
      const url = host.selectedUrl();
      if (!url || new URL(url).origin !== "https://chatgpt.com") throw new Error("Select a https://chatgpt.com tab in the companion first");
      const receipt = await operate(host, anchor, { op: "identify" }, signal ?? AbortSignal.timeout(timing.readMs));
      const identity = result(receipt, "identify");
      if (!identity) throw new Error(receipt.reason ?? "The selected ChatGPT tab could not be identified");
      if (request.account && request.account !== identity.account) throw new Error("The selected ChatGPT tab is signed in to a different account");
      if (identity.modelLabel === "ambiguous") throw new Error("The ChatGPT tab shows more than one model control; leave one composer visible");
      bound = { ...request, document: anchorOf(anchor), account: identity.account, identityEpoch: randomUUID(), modelLabel: identity.modelLabel, boundAt: now() };
      return status();
    } finally { binding = false; }
  }
  function unbind() { bound = undefined; return status(); }
  function release(operationId: unknown) {
    if (!held || operationId !== held.operationId) throw new Error("No held ChatGPT companion outcome has that operation ID");
    held = undefined;
    return status();
  }

  function admit(turn: BrowserTurn): Bound {
    if (held) throw heldError(`A previous companion ChatGPT send (${held.operationId}) has an unknown outcome. Inspect the ChatGPT tab, then release it in NEKODEX; it is never resent.`, "companion_outcome_held");
    if (active) throw refused("Another ChatGPT turn is using the browser companion", "companion_busy");
    const current = bound;
    if (!current) throw refused("No ChatGPT tab is bound to the browser companion", "companion_unbound");
    const unsupported = [
      turn.nativeConnector && "Codex Native connector", turn.externalProgress && "local tools", turn.completionFence && "local tools",
      turn.asyncToolOperations && "async tool operations", turn.onTunnelSelected && "account tunnel", turn.retainConversation && "retained conversations",
      turn.requireRetainedConversation && "retained conversations", turn.prepareResume && "conversation resume", turn.compaction && "compaction",
      turn.compactionExecution && "compaction", turn.captureLunaCheckpoint && "Luna checkpoints",
    ].filter(Boolean);
    if (unsupported.length) throw refused(`The browser companion sends Browser-only text turns; this turn needs ${[...new Set(unsupported)].join(", ")}. Unbind the companion tab to use the embedded browser.`, "companion_turn_unsupported");
    const reasoning = turn.reasoning ?? (turn.modelId === CHATGPT_WEB_LUNA_MODEL_ID ? "low" : "high");
    if (turn.modelId !== current.modelId || reasoning !== current.reasoning || (turn.modelFamily ?? undefined) !== current.modelFamily) {
      throw refused(`This turn requests ${turn.modelId} ${reasoning}${turn.modelFamily ? ` (${turn.modelFamily})` : ""}; the companion tab is bound to ${current.modelId} ${current.reasoning}${current.modelFamily ? ` (${current.modelFamily})` : ""}. Nothing was sent.`, "companion_model_mismatch");
    }
    return current;
  }

  async function run(turn: BrowserTurn): Promise<string> {
    const current = admit(turn);
    const host = liveHost();
    currentAnchor(host, current.document);
    const traceId = turn.traceId;
    active = traceId;
    try {
      if (turn.abortSignal?.aborted) throw aborted();
      const prepared = await turn.prepare();
      let text: string;
      try {
        if (prepared.multipart || prepared.images.length || prepared.files?.length || prepared.skillFiles?.length) {
          throw refused("The browser companion sends one plain-text message; attachments, images and multipart context are not supported. Nothing was sent.", "companion_turn_unsupported");
        }
        if (prepared.text.length > CHATGPT_COMPANION_MAX_PROMPT_CHARS) throw refused("The prompt is too large for the browser companion. Nothing was sent.", "companion_prompt_too_large");
        text = prepared.text;
      } finally { prepared.release(); }
      // Every refusal that can be known before dispatch happens before the send fence.
      const preflight = () => {
        if (turn.abortSignal?.aborted) throw aborted();
        if (options.host() !== host) throw refused("The browser companion listener changed; bind the ChatGPT tab again", "companion_unavailable");
        if (host.status().operation) throw refused("Another companion operation owns the selected tab; nothing was sent", "companion_busy");
        // A concurrent approved observation may have advanced the anchor's observation ID.
        return currentAnchor(host, current.document);
      };
      preflight();
      // Dispatching the command is the ambiguity boundary: from here the prompt is never replayed.
      await turn.onSendActivated?.();
      const operationId = `chatgpt_send:${randomUUID()}`;
      const signal = AbortSignal.any([AbortSignal.timeout(timing.sendReceiptMs), ...(turn.abortSignal ? [turn.abortSignal] : [])]);
      let pendingReceipt: Promise<CompanionReceipt>;
      try {
        // Re-checked synchronously with the queueing call; nothing can be delivered in between.
        pendingReceipt = host.chatgpt(preflight(), { op: "send", text, expectedAccount: current.account, expectedModelLabel: current.modelLabel }, signal, operationId);
      } catch (error) {
        if (error instanceof ChatGptWebAdapterError || (error instanceof DOMException && error.name === "AbortError")) throw error;
        // Refused before queueing (pairing gone, outdated extension): nothing was offered.
        throw refused(`Companion send was refused before dispatch: ${error instanceof Error ? error.message : String(error)}`, "companion_send_refused");
      }
      const receipt = await pendingReceipt;
      if (receipt.outcome === "not_sent") {
        if (turn.abortSignal?.aborted) throw aborted();
        throw refused(`Companion send was not delivered: ${receipt.reason ?? "no extension owner"}. Nothing was sent.`, "companion_send_refused");
      }
      if (receipt.outcome === "rejected") throw refused(`${receipt.reason ?? "The ChatGPT tab refused the send"}. Nothing was sent.`, "companion_send_refused");
      const sent = result(receipt, "send");
      if (!sent) {
        held = { operationId, stage: "send", reason: receipt.reason ?? "No terminal send receipt", heldAt: now() };
        throw heldError(`The companion send has no confirmed outcome (${held.reason}). It is held and will not be retried; inspect the ChatGPT tab.`);
      }
      await turn.onSubmitted?.();
      const answer = await awaitAnswer(host, current, sent.userMessageId, operationId, turn);
      turn.onTextDelta(answer.markdown);
      lastReceipt = { operationId, traceId, userMessageId: sent.userMessageId, ...(answer.assistantMessageId ? { assistantMessageId: answer.assistantMessageId } : {}),
        path: answer.path, identityEpoch: current.identityEpoch, answerSha256: createHash("sha256").update(answer.markdown).digest("hex"), completedAt: now() };
      return answer.markdown;
    } finally { if (active === traceId) active = undefined; }
  }

  async function awaitAnswer(host: BrowserCompanionHost, current: Bound, userMessageId: string, operationId: string, turn: BrowserTurn) {
    const deadline = now() + timing.responseMs;
    let previous: string | undefined, stable = 0;
    const hold = (reason: string): never => {
      held = { operationId, stage: "response", reason, heldAt: now(), userMessageId };
      throw heldError(`ChatGPT accepted the companion message, but its answer could not be observed: ${reason}. The message is not resent.`, "companion_response_unobserved");
    };
    while (true) {
      if (turn.abortSignal?.aborted) throw aborted();
      if (now() > deadline) hold("response deadline elapsed");
      // Another approved companion operation (for example an Agent browser read) may briefly own
      // the host's single slot. Wait for it; only an unknown slot makes the answer unobservable.
      const busy = host.status().operation;
      if (busy?.phase === "unknown") return hold("another companion operation has an unknown outcome");
      if (busy) { await new Promise(resolve => setTimeout(resolve, timing.pollMs)); continue; }
      // Reads never click. Once an answer looks settled, the next read also re-checks the account.
      const verifyAccount = previous !== undefined;
      let receipt: CompanionReceipt;
      try {
        receipt = await operate(host, currentAnchor(host, current.document), { op: "read", userMessageId, ...(verifyAccount ? { verifyAccount: true } : {}) },
          AbortSignal.any([AbortSignal.timeout(timing.readMs), ...(turn.abortSignal ? [turn.abortSignal] : [])]));
      } catch (error) {
        if (turn.abortSignal?.aborted) throw aborted();
        // Lost the single slot to another approved operation between the check and dispatch: retry the read.
        const owner = host.status().operation;
        if (owner && owner.phase !== "unknown" && options.host() === host) { await new Promise(resolve => setTimeout(resolve, timing.pollMs)); continue; }
        return hold(error instanceof Error ? error.message : "companion read unavailable");
      }
      if (turn.abortSignal?.aborted) throw aborted();
      const read = result(receipt, "read");
      if (!read) return hold(receipt.reason ?? `read ${receipt.outcome}`);
      if (!read.userTurnFound) return hold("the sent message is no longer in the bound conversation");
      turn.onHeartbeat?.();
      const assistant = read.assistant;
      if (assistant?.truncated) return hold("the answer exceeds the companion transport size limit");
      if (verifyAccount && read.account !== current.account) return hold(read.account ? "the signed-in ChatGPT account changed before the answer settled" : "the signed-in ChatGPT account could not be verified");
      const signature = assistant && !read.generating && assistant.html.trim() ? `${assistant.messageId ?? ""}\0${assistant.html}` : undefined;
      stable = signature !== undefined && signature === previous ? stable + 1 : signature !== undefined ? 1 : 0;
      previous = signature;
      if (signature !== undefined && stable >= timing.stableReads) {
        const markdown = chatGptHtmlToMarkdown(assistant!.html);
        if (!markdown) return hold("ChatGPT finished without a visible answer");
        return { markdown, path: read.path, ...(assistant!.messageId ? { assistantMessageId: assistant!.messageId } : {}) };
      }
      await new Promise(resolve => setTimeout(resolve, timing.pollMs));
    }
  }

  function status() {
    return {
      sendSupported: true as const,
      state: held ? "held" as const : active ? "sending" as const : bound ? "bound" as const : "unbound" as const,
      bound: bound ? { modelId: bound.modelId, reasoning: bound.reasoning, ...(bound.modelFamily ? { modelFamily: bound.modelFamily } : {}),
        modelLabel: bound.modelLabel, accountFingerprint: bound.account.slice(0, 12), identityEpoch: bound.identityEpoch,
        tabId: bound.document.tabId, documentId: bound.document.documentId, boundAt: bound.boundAt } : null,
      held: held ? structuredClone(held) : null,
      lastTurn: lastReceipt ? structuredClone(lastReceipt) : null,
    };
  }

  // An in-flight companion turn keeps the port engaged even if Unbind/Disable runs meanwhile,
  // so no later admission can start the embedded sender beside it.
  const port: ChatGptCompanionTransportPort = { engaged: () => !!bound || !!held || !!active, run };
  return { port, bind, unbind, release, status };
}
export type CompanionChatGptTransport = ReturnType<typeof createCompanionChatGptTransport>;
