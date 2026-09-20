const { AccountQuotaReader } = require('./account-quotas.cjs');
const { createCodexLoginController, OFFICIAL_DEVICE_VERIFICATION_URL } = require('./codex-login.cjs');
const { allowedAuthUrl } = require('./browser-host.cjs');
const { validateAccountId } = require('./account-registry.cjs');

function sameIdentity(a, b) {
  return Boolean(a && b && a.accountId === b.accountId
    && a.identityEpoch === b.identityEpoch && a.principalFingerprint === b.principalFingerprint);
}

function safeAuthNavigation(value) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && (!url.port || url.port === '443') && allowedAuthUrl(value);
  } catch { return false; }
}

/** Account-scoped quota reads and the official shared Codex device-login flow. */
function createCodexAccountTools({ getPool, getInteractionMode = () => 'automatic', BrowserWindow, clipboard, codexHome, logger,
  quotaReader = new AccountQuotaReader(), createController = createCodexLoginController }) {
  let binding = null;
  let lastFlow = null;
  let starting = false;
  let releaseAccountOperation = null;
  let settling = null;
  let destroyed = false;
  let monitor = null;
  let authWindow = null;
  const ownedClosures = new WeakSet();
  const authChildren = new Set();
  const quotaAccounts = new Set();

  function pool() {
    if (destroyed) throw new Error('Codex account tools are closed');
    const value = getPool();
    if (!value) throw new Error('ChatGPT accounts are still loading');
    return value;
  }
  function account(id) {
    validateAccountId(id);
    const value = pool().accountSnapshot().accounts.find(item => item.id === id);
    if (!value) throw new Error('Unknown ChatGPT account');
    return value;
  }
  function currentIdentity(id) {
    try { return !destroyed && binding?.accountId === id
      && sameIdentity(binding, pool().accountIdentityLease(id)); }
    catch { return false; }
  }
  const controller = createController({ codexHome, logger, isAccountCurrent: currentIdentity });

  function closeWindows() {
    for (const child of authChildren) if (!child.isDestroyed()) { ownedClosures.add(child); child.close(); }
    authChildren.clear();
    const window = authWindow;
    authWindow = null;
    if (window && !window.isDestroyed()) { ownedClosures.add(window); window.close(); }
  }
  function snapshot() {
    const owner = controller.selectionLock() || lastFlow;
    if (!owner) return null;
    const value = controller.status(owner);
    lastFlow = { flowId: value.flowId, accountId: value.accountId };
    if (!value.active) { closeWindows(); settleAccount(); }
    return progress(value);
  }
  function progress(value) {
    return { ...value, settling: !value.active && Boolean(releaseAccountOperation
      && binding?.accountId === value.accountId) };
  }
  function settleAccount() {
    if (!releaseAccountOperation || settling) return;
    const release = releaseAccountOperation;
    const id = binding.accountId;
    // A user may change the browser identity on the official authorization page.
    // Reconcile that exact session before accepting another turn for the account.
    settling = Promise.resolve().then(() => {
      const currentPool = getPool();
      if (!currentPool) return;
      const host = currentPool.getHost(id);
      // Reuse the host's bounded read-only inspection lease. Its abort path advances the
      // authentication generation, so a timed-out read cannot commit a stale signed-in result.
      return host.withReadOnlyInspection('Codex sign-in reconciliation', signal =>
        host.probeAuthentication({ signal }));
    })
      .catch(error => logger.warn('codex.account_login_reconciliation_failed', { accountId: id, message: error.message }))
      .finally(() => {
        release();
        if (releaseAccountOperation === release) releaseAccountOperation = null;
        settling = null;
      });
  }
  function watch() {
    clearTimeout(monitor);
    if (destroyed) return;
    const value = snapshot();
    if (value?.active) monitor = setTimeout(watch, 750);
  }
  function requireOwner(flowId, id) {
    account(id);
    const value = controller.status({ flowId, accountId: id });
    lastFlow = { flowId, accountId: id };
    if (!value.active) { closeWindows(); settleAccount(); }
    return progress(value);
  }
  function assertAccountMutable(id) {
    validateAccountId(id);
    const owner = controller.selectionLock();
    if ((releaseAccountOperation && binding?.accountId === id) || owner?.accountId === id) {
      throw new Error('Finish or cancel this account’s Codex sign-in before changing its session or proxy');
    }
  }

  function quotaSnapshot(id) {
    account(id);
    const host = pool().hosts.get(id);
    if (!host || host.view.webContents.isDestroyed()) return null;
    return quotaReader.snapshot(host.view.webContents.session, id, pool().evidenceEpoch(id));
  }
  async function refreshQuota(id) {
    account(id);
    const currentPool = pool();
    if (getInteractionMode() === 'manual') {
      throw new Error('Account limit refresh is unavailable in Manual mode');
    }
    const host = currentPool.getHost(id);
    await host.ready();
    const epoch = currentPool.evidenceEpoch(id);
    const identity = currentPool.accountIdentityLease(id);
    quotaAccounts.add(id);
    const result = await quotaReader.read(host.view.webContents.session, id, epoch, { refresh: true });
    if (destroyed || getPool() !== currentPool || currentPool.evidenceEpoch(id) !== epoch
      || !sameIdentity(identity, currentPool.accountIdentityLease(id))) {
      quotaReader.clear(id);
      throw new Error('The account changed while its limits were being read; refresh again');
    }
    return result;
  }

  async function start(id) {
    const value = account(id);
    if (starting || releaseAccountOperation || controller.selectionLock()) throw new Error('Another Codex sign-in is already active');
    if (!value.authenticated) throw new Error('Sign in to this ChatGPT account first');
    if (pool().currentOperation()) throw new Error('Finish the current account operation before Codex sign-in');
    starting = true;
    closeWindows();
    binding = pool().accountIdentityLease(id);
    try {
      releaseAccountOperation = pool().acquireAccountOperation(id, 'Codex account sign-in');
      const result = await controller.start({ accountId: id, confirmed: true });
      lastFlow = { flowId: result.flowId, accountId: id };
      watch();
      return progress(result);
    } catch (error) {
      if (!controller.selectionLock()) settleAccount();
      throw error;
    } finally { starting = false; }
  }

  function secureWindow(window, accountSession) {
    const webContents = window.webContents;
    webContents.on('will-navigate', (event, url) => { if (!safeAuthNavigation(url)) event.preventDefault(); });
    webContents.on('will-redirect', (event, url) => { if (!safeAuthNavigation(url)) event.preventDefault(); });
    webContents.setWindowOpenHandler(({ url }) => {
      if (!safeAuthNavigation(url) || authChildren.size >= 3) return { action: 'deny' };
      return { action: 'allow', overrideBrowserWindowOptions: {
        width: 620, height: 760, autoHideMenuBar: true,
        webPreferences: { session: accountSession, sandbox: true, contextIsolation: true,
          nodeIntegration: false, webSecurity: true, preload: undefined },
      } };
    });
    webContents.on('did-create-window', child => {
      authChildren.add(child);
      secureWindow(child, accountSession);
      child.on('closed', () => authChildren.delete(child));
    });
    webContents.on('will-attach-webview', event => event.preventDefault());
  }
  async function open(flowId, id) {
    const value = requireOwner(flowId, id);
    if (!value.canOpen || value.verificationUrl !== OFFICIAL_DEVICE_VERIFICATION_URL) return false;
    if (authWindow && !authWindow.isDestroyed()) { authWindow.show(); authWindow.focus(); return true; }
    const host = pool().getHost(id);
    await host.ready();
    if (!requireOwner(flowId, id).canOpen) return false;
    if (authWindow && !authWindow.isDestroyed()) { authWindow.show(); authWindow.focus(); return true; }
    const accountSession = host.view.webContents.session;
    const window = new BrowserWindow({ width: 660, height: 800, minWidth: 460, minHeight: 560,
      title: 'Codex sign-in', autoHideMenuBar: true, show: true,
      webPreferences: { session: accountSession, sandbox: true, contextIsolation: true,
        nodeIntegration: false, webSecurity: true },
    });
    authWindow = window;
    secureWindow(window, accountSession);
    window.on('closed', () => {
      if (authWindow === window) authWindow = null;
      if (!ownedClosures.has(window) && controller.selectionLock()?.flowId === flowId) {
        void controller.cancel({ flowId, accountId: id }).then(watch).catch(() => {});
      }
    });
    try { await window.loadURL(OFFICIAL_DEVICE_VERIFICATION_URL); return true; }
    catch { if (!window.isDestroyed()) window.close(); throw new Error('The official Codex sign-in page could not open'); }
  }
  async function cancel(flowId, id) {
    requireOwner(flowId, id);
    closeWindows();
    const result = await controller.cancel({ flowId, accountId: id });
    watch();
    return progress(result);
  }
  function copyCode(flowId, id) {
    const value = requireOwner(flowId, id);
    if (!value.canOpen || !value.userCode) return false;
    clipboard.writeText(value.userCode);
    return true;
  }
  async function destroy() {
    clearTimeout(monitor);
    closeWindows();
    for (const id of quotaAccounts) quotaReader.clear(id);
    await controller.destroy();
    settleAccount();
    if (settling) await settling;
    destroyed = true;
  }
  return Object.freeze({ quotaSnapshot, refreshQuota, start, snapshot,
    status: requireOwner, open, cancel, copyCode, assertAccountMutable,
    currentOperation: () => starting || releaseAccountOperation || controller.selectionLock() ? 'Codex account sign-in' : null,
    destroy });
}

module.exports = { createCodexAccountTools, sameIdentity, safeAuthNavigation };
