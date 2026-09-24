const test = require('node:test');
const assert = require('node:assert/strict');
const { BrowserHost } = require('../electron/browser-host.cjs');
const { AccountBrowserPool } = require('../electron/account-pool.cjs');

function fixture() {
  const calls = [];
  const configured = { passkeyBrowser: 'firefox' };
  const transfer = { verifiedIdentity: { principalFingerprint: 'a'.repeat(64) } };
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    accountId: 'selected-account', state: { authenticated: false, authenticationStatus: 'unknown', accountLabel: 'known@example.com' },
    passkeyLoginOperation: null, loginOperation: null, embeddedLoginController: null,
    sessionRefreshOperation: null, manualOperation: null, authView: null, turnTabs: new Map(),
    getBrowserInteractionMode: () => 'automatic', withManualOperation: async (_label, action) => action(),
    loginWithPasskey: async () => { calls.push(configured.passkeyBrowser); return transfer; },
    loginWithChromeProfile: async (_progress, context) => { calls.push('chrome-profile');
      assert.equal(context.accountId, 'selected-account');
      assert.equal(context.accountLabel, 'known@example.com');
      assert.ok(context.signal instanceof AbortSignal);
      assert.equal(typeof context.configureVerificationSession, 'function');
      return transfer;
    },
    installPasskeyLogin: async (capture, signal) => { assert.equal(capture, transfer); assert.equal(signal.aborted, false);
      calls.push('install-verified-transfer'); return { authenticated: true }; },
    snapshot() { return { ...this.state }; }, setState(patch) { this.state = { ...this.state, ...patch }; },
    publishState() {}, activateHomeSurface() {}, show() {}, closeAuthView() {},
    logger: { info() {} }, configureAccountSession: async () => {},
  });
  return { host, calls, configured };
}

test('explicit Chrome entry uses the selected account transaction while keeping Firefox configured', async () => {
  const { host, calls, configured } = fixture();
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
    destroyed: false, registry: { snapshot: () => ({ selectedId: 'selected-account' }) },
    getHost: id => { assert.equal(id, 'selected-account'); return host; },
    acquireAccountOperation: id => { assert.equal(id, 'selected-account'); calls.push('lease'); return () => calls.push('release'); },
  });
  assert.equal((await pool.openPasskeyLogin('chrome-profile')).authenticated, true);
  assert.deepEqual(calls, ['lease', 'chrome-profile', 'install-verified-transfer', 'release']);
  assert.equal(configured.passkeyBrowser, 'firefox');
  assert.equal(pool.passkeyImportLease, null);
});

test('ordinary passkey entry still uses the configured provider', async () => {
  const { host, calls } = fixture();
  await host.openPasskeyLogin();
  assert.deepEqual(calls, ['firefox', 'install-verified-transfer']);
});

test('explicit Chrome entry cannot silently fall back when its profile transaction is unavailable', () => {
  const { host, calls } = fixture();
  host.loginWithChromeProfile = undefined;
  assert.throws(() => host.openPasskeyLogin('chrome-profile'), /operation is unavailable/);
  assert.equal(host.passkeyLoginOperation, null);
  assert.deepEqual(calls, []);
});
