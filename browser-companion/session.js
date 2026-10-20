import { createCompanionDispatcher } from "./dispatch.js";
import { extensionApi as api, companionRequest, runCompanionSession } from "./transport.js";

const say = text => { document.querySelector("#status").textContent = text; };
const nonce = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
const controller = new AbortController();
let credentials, selectedScope;
async function stop() {
  controller.abort();
  if (credentials) {
    try { await companionRequest(credentials, "revoke"); } catch { /* No operation is replayed. */ }
    const current = await api.storage.session.get(["pairing", "companionOwner"]);
    if (current.pairing?.sessionId === credentials.sessionId) await api.storage.session.remove("pairing");
    if (current.companionOwner?.scopeId === selectedScope) await api.storage.session.remove("companionOwner");
  }
  say("Sharing stopped. Pair and explicitly select the page again to start a new session.");
}
document.querySelector("#stop").addEventListener("click", () => void stop());
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
  document.querySelector("#host").textContent = `Paired host: ${credentials.hostId} · selected tab ${handoff.binding.tabId}`;
  say("Sharing selected tab. Keep this session tab open.");
  try { await runCompanionSession({ credentials, dispatcher, signal: controller.signal, say }); }
  catch (error) { if (!controller.signal.aborted) say(`${error.message}. Sharing stopped; uncertain input is never retried.`); }
  finally {
    // Release only this session marker. Pairing stays available for explicit selection after failure.
    const current = (await api.storage.session.get("companionOwner")).companionOwner;
    if (current?.scopeId === handoff.binding.scopeId) await api.storage.session.remove("companionOwner");
  }
});
