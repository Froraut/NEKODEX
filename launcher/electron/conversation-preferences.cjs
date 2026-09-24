// Configuration is authoritative; launcher preferences project its committed state.
// Ready documents with an old retention policy must not be reused for a new turn.
function syncConversationPreferences({ stateStore, config, browserHost, busy = false, publish }) {
  const current = stateStore.read();
  if (!config || busy) return current;
  const useSavedChats = config.useSavedChats === true;
  const experimentalFreshConversationPerTurn = config.experimentalFreshConversationPerTurn === true;
  const persistenceChanged = current.useSavedChats !== useSavedChats;
  if (!persistenceChanged && current.experimentalFreshConversationPerTurn === experimentalFreshConversationPerTurn) {
    return current;
  }
  const keys = new Set([...browserHost.turnTabs.values()]
    .filter(tab => tab.status === "ready" && tab.conversationKey
      && (persistenceChanged || tab.interactionMode === "automatic"))
    .map(tab => tab.conversationKey));
  for (const key of keys) browserHost.releaseRetainedConversation(key);
  const state = stateStore.update({ useSavedChats, experimentalFreshConversationPerTurn });
  publish?.(state);
  return state;
}

async function changeConversationPreference({ lifecycleAdmission, browserHost, runtimeHost, label, change, sync, shouldReopen }) {
  const lease = lifecycleAdmission.acquire(label);
  let closed = false;
  let changed = false;
  let recoveryRequired = false;
  try {
    browserHost.closeTurnAdmission(label);
    closed = true;
    if (browserHost.hasActiveTurns() || browserHost.currentOperation() || runtimeHost.currentOperation()) {
      throw new Error("Finish active tasks and setup operations before changing browser conversations");
    }
    await change();
    changed = true;
    const state = sync(lease);
    browserHost.setTurnAdmissionBlocker("conversation-policy", null);
    return state;
  } catch (error) {
    if (changed) {
      recoveryRequired = true;
      browserHost.setTurnAdmissionBlocker("conversation-policy", "browser conversation policy recovery");
      throw new Error("The runtime conversation policy was saved, but the launcher could not synchronize it. New browser turns are paused. Retry this setting to finish synchronization.", { cause: error });
    }
    throw error;
  } finally {
    try { if (closed && !recoveryRequired && shouldReopen()) browserHost.openTurnAdmission(); }
    finally { lifecycleAdmission.release(lease); }
  }
}

module.exports = { syncConversationPreferences, changeConversationPreference };
