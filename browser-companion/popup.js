import { createCompanionDispatcher } from "./dispatch.js";
import { ORIGIN, COMPANION_FEATURES, PAIRING_RETIRED_TEXT, extensionApi as api, companionPairingState, companionRequest } from "./transport.js";

const say = text => { document.querySelector("#status").textContent = text; };
const selectButton = document.querySelector("#select"), stopButton = document.querySelector("#stop"), revokeButton = document.querySelector("#revoke");
let pairing, owner, stopping = false;
function render() {
  selectButton.disabled = stopping || !pairing || !!owner;
  revokeButton.disabled = stopping || !pairing;
  stopButton.disabled = stopping || !pairing;
  document.querySelector("#host").textContent = pairing ? `Paired host: ${pairing.hostId}` : `Extension: ${api.runtime.id} · ${api.runtime.getURL("").replace(/\/$/, "")}`;
}
/** Drop only the exact pairing the host refused (and its dead session marker); a newer pasted pairing is never touched. */
async function forgetRetired(probed) {
  if (pairing?.sessionId !== probed.sessionId) return false;
  pairing = undefined; owner = undefined;
  if ((await api.storage.session.get("pairing")).pairing?.sessionId === probed.sessionId) await api.storage.session.remove(["pairing", "companionOwner"]);
  return true;
}
document.querySelector("#pair-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (owner || stopping) { say("Stop sharing before pairing another host."); return; }
  try {
    const offer = JSON.parse(document.querySelector("#pairing").value);
    if (offer.origin !== ORIGIN || offer.version !== 1 || offer.extensionId !== api.runtime.id || (offer.extensionOrigin && offer.extensionOrigin !== api.runtime.getURL("").replace(/\/$/, "")) || typeof offer.hostId !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(offer.pairingCode)) throw new Error("Pairing details do not match this extension and fixed local host");
    const result = await companionRequest(offer, "pair", { pairingCode: offer.pairingCode });
    if (result.hostId !== offer.hostId || result.version !== 1 || typeof result.sessionId !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(result.token)) throw new Error("Local host identity mismatch");
    pairing = { hostId: result.hostId, sessionId: result.sessionId, token: result.token };
    await api.storage.session.set({ pairing });
    document.querySelector("#pairing").value = "";
    say("Paired. Select this tab to begin sharing."); render();
  } catch (error) { say(error.message); }
});
selectButton.addEventListener("click", async () => {
  selectButton.disabled = true;
  let handoffKey;
  try {
    if (!pairing || owner) throw new Error("Pair and stop any previous sharing session first");
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const dispatcher = createCompanionDispatcher(api);
    const observation = await dispatcher.select(tab, pairing.sessionId, crypto.randomUUID());
    await companionRequest(pairing, "select", { observation, features: COMPANION_FEATURES });
    const nonce = crypto.randomUUID(); handoffKey = `companionHandoff:${nonce}`;
    await api.storage.session.set({ [handoffKey]: { pairing, binding: dispatcher.binding() } });
    const session = await api.tabs.create({ url: api.runtime.getURL(`session.html#${nonce}`), active: false });
    owner = { tabId: session.id, scopeId: observation.scopeId }; render();
    say("Sharing selected tab. Keep the NEKODEX selected tab session open; this popup can close.");
  } catch (error) {
    if (handoffKey) await api.storage.session.remove(handoffKey);
    // A host refusal may mean NEKODEX revoked this pairing: show that state instead of a stale one.
    const probed = pairing;
    if (error?.status && probed && (await companionPairingState(probed)).state === "retired" && await forgetRetired(probed)) say(PAIRING_RETIRED_TEXT);
    else say(error.message);
    render();
  }
});
stopButton.addEventListener("click", async () => {
  if (stopping) return;
  stopping = true; render();
  try { if (pairing) await companionRequest(pairing, "revoke"); } catch { /* Forget only our local authority. */ }
  // Closing the exact extension session cannot close the user's selected web page.
  if (owner?.tabId) { try { await api.tabs.remove(owner.tabId); } catch { /* Already closed. */ } }
  pairing = undefined; owner = undefined; stopping = false;
  await api.storage.session.remove(["pairing", "companionOwner"]);
  say("Sharing stopped. Pair again to share another scope."); render();
});
revokeButton.addEventListener("click", () => stopButton.click());
({ pairing, companionOwner: owner } = await api.storage.session.get(["pairing", "companionOwner"]));
if (owner) {
  try {
    const tab = await api.tabs.get(owner.tabId);
    if (!tab.url?.startsWith(api.runtime.getURL("session.html"))) owner = undefined;
  } catch { owner = undefined; }
}
render();
if (pairing) {
  // Session storage keeps the token after NEKODEX revokes or restarts; ask the host for the real state.
  const probed = pairing;
  say("Checking this pairing with NEKODEX…");
  const current = await companionPairingState(probed);
  if (pairing?.sessionId === probed.sessionId) {
    if (current.state === "retired") { if (await forgetRetired(probed)) say(PAIRING_RETIRED_TEXT); }
    else if (current.state === "unreachable") say("NEKODEX is not reachable at its local address, so this pairing cannot be used now. If NEKODEX turned the connection off or restarted, pair again.");
    else if (owner) say("Selected sharing session is open. Stop sharing before selecting another tab.");
    else say("Paired with NEKODEX. Select current tab to share it.");
    render();
  }
} else if (owner) say("Selected sharing session is open. Stop sharing before selecting another tab.");
