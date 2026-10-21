import { pageOperation } from "./page.js";
import { chatGptOperation } from "./chatgpt.js";

const bindingKeys = ["sessionId", "scopeId", "tabId", "windowId", "frameId", "documentId", "documentEpoch", "observationId"];
export function sameBinding(a, b) { return !!a && !!b && bindingKeys.every(key => a[key] === b[key]); }

/** Explicit selected-tab authority only. No tab lookup can silently replace this owner. */
export function createCompanionDispatcher(api, { capture = false } = {}) {
  let binding;
  async function inject(request, initial = false, func = pageOperation) {
    const tabId = initial ? request.tabId : binding.tabId;
    const target = initial ? { tabId, frameIds: [0] } : { tabId, documentIds: [binding.documentId] };
    const rows = await api.scripting.executeScript({ target, world: "ISOLATED", func, args: [request] });
    if (rows.length !== 1 || rows[0].frameId !== 0) throw new Error("No exact main-frame document receipt");
    const row = rows[0];
    const documentId = row.documentId;
    if (!documentId || (!initial && documentId !== binding.documentId)) throw new Error("Selected document changed during dispatch");
    return { ...row, documentId };
  }
  async function select(tab, sessionId, scopeId) {
    if (!Number.isSafeInteger(tab?.id) || !Number.isSafeInteger(tab.windowId) || !/^https?:\/\//.test(tab.url || "")) throw new Error("Open an ordinary web page and invoke this extension on that tab");
    const row = await inject({ kind: "select", scopeId, tabId: tab.id }, true);
    if (row.result?.outcome !== "completed" || !row.result.snapshot) throw new Error(row.result?.reason || "Unable to observe selected tab");
    binding = { sessionId, scopeId, tabId: tab.id, windowId: tab.windowId, frameId: 0, documentId: row.documentId,
      documentEpoch: row.result.snapshot.documentEpoch, observationId: row.result.snapshot.observationId };
    return { kind: "browser", ...binding, ...row.result.snapshot };
  }
  async function selectedActive() {
    const tabs = await api.tabs.query({ active: true, windowId: binding.windowId });
    return tabs.length === 1 && tabs[0].id === binding.tabId;
  }
  async function screenshot(snapshot, includeImage) {
    if (!includeImage || !capture || !api.tabs.captureVisibleTab) return undefined;
    if (!(await selectedActive())) throw new Error("Selected tab changed before capture");
    const dataUrl = await api.tabs.captureVisibleTab(binding.windowId, { format: "jpeg", quality: 30 });
    if (!(await selectedActive())) throw new Error("Selected tab changed during capture");
    // Prove that capture still belongs to the same document and unchanged DOM observation.
    const proof = await inject({ kind: "validate", ...binding, observationId: snapshot.observationId });
    if (proof.result?.outcome !== "completed") throw new Error("Selected document changed during capture");
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match) throw new Error("Unsupported screenshot encoding");
    const bytes = Uint8Array.from(atob(match[1]), value => value.charCodeAt(0));
    if (bytes.length > 160 * 1024) return undefined; // Text observation remains useful; never upload oversized pixels.
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    try {
      if (bitmap.width > 16384 || bitmap.height > 16384 || bitmap.width * bitmap.height > 40_000_000) return undefined;
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return { mimeType: "image/jpeg", data: match[1], width: bitmap.width, height: bitmap.height,
        sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") };
    } finally { bitmap.close(); }
  }
  /** Bundled ChatGPT operation on the exact bound document; only `send` can click. */
  async function executeChatGpt(command) {
    const operation = command.chatgpt;
    const send = operation?.op === "send";
    if (!operation || !["identify", "send", "read"].includes(operation.op)) return { outcome: "rejected", executed: false, reason: "Unsupported ChatGPT operation" };
    let injected = false;
    try {
      // Reading a response may continue while the user looks at another tab; input may not.
      if (send && !(await selectedActive())) return { outcome: "rejected", executed: false, reason: "Selected ChatGPT tab is no longer active in its window" };
      injected = true;
      const row = await inject({ ...operation, scopeId: binding.scopeId, documentEpoch: binding.documentEpoch }, false, chatGptOperation);
      const result = row.result;
      if (!result || !["completed", "rejected", "unknown"].includes(result.outcome)) throw new Error("Missing terminal document receipt");
      return { outcome: result.outcome, executed: send && result.executed === true, ...(result.reason ? { reason: String(result.reason).slice(0, 240) } : {}),
        ...(result.outcome === "completed" && result.chatgpt ? { chatgpt: result.chatgpt } : {}) };
    } catch { return { outcome: injected && send ? "unknown" : "rejected", executed: injected && send, reason: "No exact terminal ChatGPT document receipt; the send is never retried" }; }
  }
  return {
    select,
    binding: () => binding ? { ...binding } : undefined,
    restore(value) { if (binding) throw new Error("Dispatcher already owns a selection"); binding = { ...value }; },
    async execute(command) {
      if (!sameBinding(binding, command.binding) || !["observe", "act", "chatgpt"].includes(command.kind)) return { outcome: "rejected", executed: false, reason: "Selected tab, document or observation changed" };
      if (command.kind === "chatgpt") return executeChatGpt(command);
      let injected = false;
      try {
        if (!(await selectedActive())) return { outcome: "rejected", executed: false, reason: "Selected tab is no longer active in its window" };
        injected = true;
        const row = await inject({ kind: command.kind, ...binding, action: command.action, operationId: command.operationId });
        const result = row.result;
        if (!result || !["completed", "rejected", "unknown"].includes(result.outcome)) throw new Error("Missing terminal document receipt");
        if (result.snapshot) {
          const image = await screenshot(result.snapshot, command.includeImage === true);
          result.observation = { kind: "browser", ...binding, ...result.snapshot, ...(image ? { screenshot: image } : {}) };
          delete result.snapshot;
          binding.observationId = result.observation.observationId;
        }
        return result;
      } catch { return { outcome: injected && command.kind === "act" ? "unknown" : "rejected", executed: injected && command.kind === "act", reason: "No exact terminal document receipt; inspect the page before further input" }; }
    },
  };
}
