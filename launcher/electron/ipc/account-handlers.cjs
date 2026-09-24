// Policy stays in main: never register these handlers against raw ipcMain.
function registerAccountHandlers({
  handle, getBrowserHost, getAccountToolsService, isRuntimeBusy, invalidateAccountProof,
}) {
  handle("launcher:accounts", () => getBrowserHost().accountSnapshot());
  // A retry performs fresh account-owned browser observation. Keep it behind lifecycle admission:
  // it is not a passive read and must not race replacement, update, or shutdown transitions.
  handle("launcher:account-authentication-refresh", (_event, id) => (
    getBrowserHost().refreshAccountAuthentication(id)
  ));
  handle("launcher:account-codex-quota-snapshot", (_event, id) => getAccountToolsService().quotaSnapshot(id));
  handle("launcher:account-codex-quota-refresh", (_event, id) => getAccountToolsService().refreshQuota(id));
  // Portfolio refresh owns its concurrency and per-account leases in the backend. The renderer can
  // request one batch, but cannot supply workers or bypass lifecycle admission.
  handle("launcher:account-codex-quotas-refresh", () => getAccountToolsService().refreshQuotaPortfolio());
  handle("launcher:codex-login-snapshot", () => getAccountToolsService().snapshot());
  handle("launcher:codex-login-start", (_event, id) => {
    if (isRuntimeBusy()) throw new Error("Finish the current runtime operation before Codex sign-in");
    return getAccountToolsService().start(id);
  });
  handle("launcher:codex-login-status", (_event, flowId, id) => getAccountToolsService().status(flowId, id));
  handle("launcher:codex-login-open", (_event, flowId, id) => getAccountToolsService().open(flowId, id));
  handle("launcher:codex-login-cancel", (_event, flowId, id) => getAccountToolsService().cancel(flowId, id));
  handle("launcher:codex-login-copy-code", (_event, flowId, id) => getAccountToolsService().copyCode(flowId, id));
  handle("launcher:account-add", (_event, label) => getBrowserHost().addAccount(label));
  handle("launcher:account-select", async (_event, id) => {
    invalidateAccountProof();
    return getBrowserHost().selectAccount(id);
  });
  handle("launcher:account-enabled", (_event, id, enabled) => {
    return getBrowserHost().setAccountEnabled(id, enabled);
  });
  handle("launcher:account-proxy", (_event, id, value) => {
    getAccountToolsService().assertAccountMutable(id);
    return getBrowserHost().setAccountProxy(id, value);
  });
  handle("launcher:account-safety", (_event, id, policy) => getBrowserHost().setAccountSafety(id, policy));
  handle("launcher:account-resume", (_event, id) => getBrowserHost().resumeAccount(id));
  handle("launcher:account-mode", (_event, mode) => getBrowserHost().setAccountMode(mode));
  handle("launcher:account-login", (_event, id) => {
    getAccountToolsService().assertAccountMutable(id);
    return getBrowserHost().openAccountLogin(id);
  });
  handle("launcher:account-check", async (_event, id, connector) => {
    const selectedAccountId = getBrowserHost().snapshot().accountId;
    try {
      return await getBrowserHost().checkAccount(id, connector === true);
    } catch (error) {
      // A failed check for the account currently shown by the launcher makes
      // the global proof unusable. A check for an account that is no longer
      // selected must not erase proof established for the newer selection.
      if (selectedAccountId === id && getBrowserHost().snapshot().accountId === id) {
        invalidateAccountProof();
      }
      throw error;
    }
  });
}

module.exports = { registerAccountHandlers };
