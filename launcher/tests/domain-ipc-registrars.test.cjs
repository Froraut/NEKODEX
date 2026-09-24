const test = require('node:test');
const assert = require('node:assert/strict');
const { registerBrowserHandlers } = require('../electron/ipc/browser-handlers.cjs');
const { registerAccountHandlers } = require('../electron/ipc/account-handlers.cjs');
const { createRendererIpcGuard, registerLoggedIpc } = require('../electron/logging.cjs');
const { createLifecycleAdmission } = require('../electron/lifecycle-admission.cjs');

function fixture(browser) {
  const handlers = new Map();
  const frame = { processId: 1, routingId: 2, parent: null, detached: false,
    url: 'app://launcher', isDestroyed: () => false };
  const sender = { mainFrame: frame, isDestroyed: () => false, getZoomFactor: () => 1.5 };
  const window = { webContents: sender, isDestroyed: () => false };
  const event = { sender, senderFrame: frame };
  const admission = createLifecycleAdmission();
  const authorize = createRendererIpcGuard({ getMainWindow: () => window,
    isRendererUrlAllowed: url => url === 'app://launcher' });
  const handle = (channel, action) => registerLoggedIpc({ handle: (key, fn) => handlers.set(key, fn) },
    { error() {} }, channel, admission.guard(channel, action), authorize);
  let current = browser;
  let invalidations = 0;
  const dependencies = { handle, getBrowserHost: () => current,
    getAccountToolsService: () => ({}), isRuntimeBusy: () => false,
    invalidateAccountProof: () => invalidations++, validateBounds: bounds => bounds };
  registerBrowserHandlers(dependencies);
  registerAccountHandlers(dependencies);
  return { event, admission, invoke: (name, ...args) => handlers.get(`launcher:${name}`)(event, ...args),
    untrusted: name => handlers.get(`launcher:${name}`)({ sender: {}, senderFrame: frame }),
    replace: browser => { current = browser; }, invalidations: () => invalidations };
}

test('domain IPC rejects foreign renderer and lifecycle-closed refresh before services', async () => {
  let reached = 0;
  const f = fixture({ refreshAccountAuthentication() { reached++; } });
  await assert.rejects(f.untrusted('account-authentication-refresh'), /Unauthorized/);
  const lease = f.admission.acquire('shutdown');
  await assert.rejects(f.invoke('account-authentication-refresh', 'account-a'), /Wait for shutdown/);
  assert.equal(reached, 0);
  f.admission.release(lease);
  await f.invoke('account-authentication-refresh', 'account-a');
  assert.equal(reached, 1);
});

test('browser IPC uses current host and forwards exact close owner and sender zoom', async () => {
  const calls = [];
  const f = fixture({ closeTab() { throw new Error('obsolete host'); } });
  f.replace({ closeTab: (...args) => { calls.push(args); return 'closed'; },
    setBounds: (...args) => calls.push(args) });
  assert.equal(await f.invoke('browser-tab-close', 'tab-a', 'exact-trace'), 'closed');
  await f.invoke('browser-bounds', { width: 120 });
  assert.deepEqual(calls, [['tab-a', 'exact-trace'], [{ width: 120 }, 1.5]]);
});

test('account check failure invalidates proof only while the checked selection remains current', async () => {
  for (const changed of [false, true]) {
    let rejectCheck;
    let reached = false;
    let selected = 'account-a';
    const failure = new Error('check reached and failed');
    const f = fixture({ snapshot: () => ({ accountId: selected }), checkAccount: () => {
      reached = true;
      return new Promise((_, reject) => { rejectCheck = reject; });
    } });
    const pending = f.invoke('account-check', 'account-a', true);
    assert.equal(reached, true);
    if (changed) selected = 'account-b';
    rejectCheck(failure);
    await assert.rejects(pending, error => error === failure);
    assert.equal(f.invalidations(), changed ? 0 : 1);
  }
});
