import { pageOperation } from "./page.js";

const ORIGIN = "http://127.0.0.1:17843";
const PATH = "/v1/companion";
const status = document.querySelector("#status");
const selectButton = document.querySelector("#select");
const stopButton = document.querySelector("#stop");
const revokeButton = document.querySelector("#revoke");
let pairing, binding, pollingController;
const say = text => { status.textContent = text; };
function render() {
  selectButton.disabled = !pairing || !!pollingController;
  revokeButton.disabled = !pairing;
  stopButton.disabled = !pollingController;
  document.querySelector("#host").textContent = pairing ? `Paired host: ${pairing.hostId}` : "";
}
async function api(route, payload = {}, signal, credentials = pairing) {
  const response = await fetch(`${ORIGIN}${PATH}/${route}`, { method: "POST", redirect: "error", cache: "no-store",
    headers: { "content-type": "application/json", ...(credentials?.token ? { authorization: `Bearer ${credentials.token}` } : {}) },
    body: JSON.stringify({ version: 1, hostId: credentials.hostId, sessionId: credentials.sessionId, ...payload }), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Local companion request failed");
  return result;
}
async function inject(request, initial = false) {
  const target = initial ? { tabId: request.tabId, frameIds: [0] } : { tabId: binding.tabId, documentIds: [binding.documentId] };
  const rows = await chrome.scripting.executeScript({ target, world: "ISOLATED", func: pageOperation, args: [request] });
  if (rows.length !== 1 || rows[0].frameId !== 0 || !rows[0].documentId) throw new Error("No exact main-frame document receipt");
  return rows[0];
}
function fullObservation(snapshot) { return { kind: "browser", ...binding, ...snapshot }; }
async function poll(controller) {
  try {
    while (!controller.signal.aborted) {
      const { commands } = await api("poll", {}, controller.signal);
      for (const command of commands) {
        if (controller.signal.aborted) return;
        let result;
        if (!binding || Object.keys(binding).some(key => binding[key] !== command.binding?.[key])) result = { outcome: "rejected", executed: false, reason: "Selected tab, document or observation changed" };
        else {
          // Once executeScript starts, errors can be uncertain: never retry this operation.
          try {
            const row = await inject({ kind: command.kind, ...binding, action: command.action });
            result = row.result;
            if (result.snapshot) {
              result.observation = fullObservation(result.snapshot); delete result.snapshot;
              binding.observationId = result.observation.observationId;
            }
          } catch { result = { outcome: "unknown", executed: true, reason: "No terminal document receipt; inspect the page before any further input" }; }
        }
        await api("result", { result: { operationId: command.operationId, ...result } }, controller.signal);
        say(result.outcome === "completed" ? `${command.kind === "observe" ? "Fresh page observed" : "Input executed"}. Waiting for the next scoped operation.` : result.reason);
        if (result.outcome !== "completed") { controller.abort(); break; }
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) say(`${error.message}. Sharing stopped; uncertain input is never retried.`);
  } finally {
    if (pollingController === controller) { pollingController = undefined; binding = undefined; render(); }
  }
}
document.querySelector("#pair-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (pollingController) { say("Stop sharing before pairing another host."); return; }
  try {
    const offer = JSON.parse(document.querySelector("#pairing").value);
    if (offer.origin !== ORIGIN || offer.version !== 1 || offer.extensionId !== chrome.runtime.id || typeof offer.hostId !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(offer.pairingCode)) throw new Error("Pairing details do not match this extension and fixed local host");
    const result = await api("pair", { pairingCode: offer.pairingCode }, undefined, offer);
    if (result.hostId !== offer.hostId || result.version !== 1 || typeof result.sessionId !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(result.token)) throw new Error("Local host identity mismatch");
    pairing = { hostId: result.hostId, sessionId: result.sessionId, token: result.token };
    await chrome.storage.session.set({ pairing });
    document.querySelector("#pairing").value = "";
    say("Paired. Select this tab to begin sharing."); render();
  } catch (error) { say(error.message); }
});
selectButton.addEventListener("click", async () => {
  selectButton.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!Number.isSafeInteger(tab?.id) || !/^https?:\/\//.test(tab.url || "")) throw new Error("Open an ordinary web page and invoke this extension on that tab");
    const scopeId = crypto.randomUUID();
    const row = await inject({ kind: "select", scopeId, tabId: tab.id }, true);
    if (row.result.outcome !== "completed" || !row.result.snapshot) throw new Error(row.result.reason || "Unable to observe selected tab");
    binding = { sessionId: pairing.sessionId, scopeId, tabId: tab.id, windowId: tab.windowId, frameId: 0,
      documentId: row.documentId, documentEpoch: row.result.snapshot.documentEpoch, observationId: row.result.snapshot.observationId };
    await api("select", { observation: fullObservation(row.result.snapshot) });
    pollingController = new AbortController(); render(); say("Sharing selected tab while this popup is open.");
    void poll(pollingController);
  } catch (error) { binding = undefined; say(error.message); render(); }
});
stopButton.addEventListener("click", async () => {
  pollingController?.abort(); pollingController = undefined; binding = undefined;
  // Revoke rather than leave an invisible selected tab authorized after stopping.
  try { await api("revoke"); } catch { /* The local session is still forgotten. */ }
  pairing = undefined; await chrome.storage.session.remove("pairing");
  say("Sharing stopped. Pair again to share another scope."); render();
});
revokeButton.addEventListener("click", () => stopButton.click());
// Popup closure kills this polling owner. There is no background listener or automatic reconnect.
({ pairing } = await chrome.storage.session.get("pairing"));
render();
if (pairing) say("Pairing retained for this browser session. Select current tab to share it again.");
