import { createCompanionDispatcher } from "./dispatch.js";
import { PAIRING_RETIRED_TEXT, extensionApi as api, companionPairingState, companionRequest, runCompanionSession } from "./transport.js";

const say = text => { document.querySelector("#status").textContent = text; };
const nonce = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
const controller = new AbortController();
const stopButton = document.querySelector("#stop");
let credentials, selectedScope, stopping = false;
async function stop() {
  // Only the exact claimed session can stop here; duplicate clicks never repeat its revoke.
  if (stopping || stopButton.disabled || !credentials) return;
  stopping = true;
  stopButton.disabled = true;
  say("Stopping sharing…");
  controller.abort();
  try {
    try { await companionRequest(credentials, "revoke"); } catch { /* No operation is replayed. */ }
    const current = await api.storage.session.get(["pairing", "companionOwner"]);
    if (current.pairing?.sessionId === credentials.sessionId) await api.storage.session.remove("pairing");
    if (current.companionOwner?.scopeId === selectedScope) await api.storage.session.remove("companionOwner");
    say("Sharing stopped. Pair and explicitly select the page again to start a new session.");
  } catch {
    say("Sharing stopped, but local pairing cleanup could not be confirmed. Close this session and forget pairing in the popup before reconnecting.");
  }
}
stopButton.addEventListener("click", () => void stop());
addEventListener("pagehide", () => { controller.abort(); });
if (!/^[a-f0-9-]{36}$/.test(nonce)) say("No one-time selection handoff. Pair and select a tab again.");
else await navigator.locks.request("nekodex-companion-session", { ifAvailable: true }, async lock => {
  if (!lock) { say("Another selected session owns this connection. Stop it before selecting another page."); return; }
  const key = `companionHandoff:${nonce}`;
  const handoff = (await api.storage.session.get(key))[key];
  await api.storage.session.remove(key);
  if (!handoff || handoff.binding?.sessionId !== handoff.pairing?.sessionId) { say("Selection handoff was consumed or unavailable. Explicitly select the page again."); return; }
  credentials = handoff.pairing; selectedScope = handoff.binding.scopeId;
  const dispatcher = createCompanionDispatcher(api, { capture: true });
  dispatcher.restore(handoff.binding);
  await api.storage.session.set({ companionOwner: { tabId: (await api.tabs.getCurrent()).id, scopeId: handoff.binding.scopeId } });
  stopButton.disabled = false;
  document.querySelector("#host").textContent = `Paired host: ${credentials.hostId} · selected tab ${handoff.binding.tabId}`;
  say("Sharing selected tab. Keep this session tab open.");
  let ended;
  try { await runCompanionSession({ credentials, dispatcher, signal: controller.signal, say }); }
  catch (error) {
    if (!controller.signal.aborted) {
      // When NEKODEX revoked or replaced this pairing, forget it so the popup cannot offer it again.
      const retired = error?.status && (await companionPairingState(credentials)).state === "retired";
      if (retired && (await api.storage.session.get("pairing")).pairing?.sessionId === credentials.sessionId) await api.storage.session.remove("pairing");
      ended = retired ? `${PAIRING_RETIRED_TEXT} Sharing stopped; nothing is retried.` : `${error.message}. Sharing stopped; uncertain input is never retried.`;
    }
  }
  finally {
    stopButton.disabled = true;
    // Release only this session marker. A still-valid pairing stays available for explicit selection.
    const current = (await api.storage.session.get("companionOwner")).companionOwner;
    if (current?.scopeId === handoff.binding.scopeId) await api.storage.session.remove("companionOwner");
    // Announce the end only once the marker is released: a popup opened then never sees a live session.
    if (ended) say(ended);
  }
});
