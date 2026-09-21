// One owner for launcher startup, replacement and exit. This gate protects the
// service graph; per-account leases and the daemon's atomic drain remain separate.
const OBSERVATION_CHANNELS = new Set([
  "launcher:snapshot", "launcher:accounts", "launcher:account-codex-quota-snapshot",
  "launcher:codex-login-snapshot", "launcher:codex-login-status", "launcher:logs",
  "launcher:usage", "launcher:window-state", "launcher:update-request-revision",
  "launcher:browser-bounds", "launcher:browser-surface-active", "launcher:browser-hide",
  "launcher:browser-zoom", "launcher:sidebar-state",
  // Existing operations must remain cancellable while exit is checking idleness.
  "launcher:codex-login-cancel", "launcher:browser-passkey-login-cancel",
  "launcher:browser-existing-chrome-login-cancel", "launcher:cancel-context-change",
  "launcher:update-cancel",
]);

function createLifecycleAdmission(onChange = () => {}) {
  let owner = null;
  function unavailable() {
    return Object.assign(new Error(`Wait for ${owner.label} to finish before starting another action`), {
      code: "LAUNCHER_TRANSITION_BUSY",
    });
  }
  return {
    busy: () => owner !== null,
    currentLabel: () => owner?.label ?? null,
    acquire(label) {
      if (owner) throw unavailable();
      const lease = Object.freeze({ label });
      owner = lease;
      onChange(label);
      return lease;
    },
    assertOwner(lease) {
      if (!lease || owner !== lease) throw new Error("Launcher transition ownership changed");
    },
    release(lease) {
      if (owner === lease) {
        owner = null;
        onChange(null);
      }
    },
    guard(channel, action) {
      return (...args) => {
        if (owner && !OBSERVATION_CHANNELS.has(channel)) throw unavailable();
        return action(...args);
      };
    },
  };
}

module.exports = { createLifecycleAdmission };
