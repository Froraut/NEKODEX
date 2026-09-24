const test = require('node:test');
const assert = require('node:assert/strict');
const { BrowserHost } = require('../electron/browser-host.cjs');
const { verifiedCaptureTransfer } = require('../electron/chrome-session-identity.cjs');

const fingerprint = character => character.repeat(64);
const storageState = { cookies: [{ name: 'session', value: 'fixture', domain: '.chatgpt.com', path: '/',
  expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] };

function transfer(identity, events, options = {}) {
  return verifiedCaptureTransfer({ storageState, cleanup: async () => {
    events.push('cleanup');
    if (options.cleanupError) throw new Error('fixture cleanup failed');
  } }, identity, {
    identityIntent: options.identityIntent ?? null,
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
  });
}

function installFixture(capturedFingerprint, installedFingerprint = capturedFingerprint) {
  const events = [];
  const captured = transfer({ principalFingerprint: capturedFingerprint, label: 'captured@example.com' }, events);
  const fixture = {
    accountId: 'default',
    authPrincipalFingerprint: fingerprint('a'),
    authSessionFingerprint: fingerprint('s'), authIdentityEpoch: 4,
    state: { authenticated: true, authenticationStatus: 'verified', accountLabel: 'old@example.com' },
    turnTabs: new Map(),
    getBrowserInteractionMode: () => 'automatic',
    verifyCapturedLoginTransfer: async value => { events.push('preflight'); return value; },
    captureLoginRollbackSnapshot: async () => { events.push('snapshot-old'); return { storage: { cookies: [], localStorage: [] },
      evidence: { principalFingerprint: fingerprint('a'), sessionFingerprint: fingerprint('s'), identityEpoch: 4 },
      state: { authenticated: true, authenticationStatus: 'verified', accountLabel: 'old@example.com' } }; },
    restoreLoginRollbackSnapshot: async () => { events.push('restore-old'); fixture.authPrincipalFingerprint = fingerprint('a');
      fixture.state = { authenticated: true, authenticationStatus: 'verified', accountLabel: 'old@example.com' }; },
    clearOwnedSessionForPasskey: async () => events.push('clear-old'),
    resetFailedPasskeyLogin: async () => { events.push('reset-import'); fixture.authPrincipalFingerprint = null; },
    view: { webContents: { isDestroyed: () => false, session: {
      cookies: { set: async () => events.push('cookie'), flushStore: async () => events.push('flush-cookies') },
      flushStorageData: () => events.push('flush-storage'),
    }, loadURL: async () => events.push('load') } },
    waitForAuthenticated: async () => {
      events.push('authenticated');
      fixture.authPrincipalFingerprint = installedFingerprint;
      fixture.state = { authenticated: true, authenticationStatus: 'verified', accountLabel: 'captured@example.com' };
      return { authenticated: true };
    },
    runSessionInspection: async () => events.push('inspect'),
    activateHomeSurface: () => events.push('activate'),
    show: () => events.push('show'),
    logger: { info: () => events.push('logged') },
    snapshot: () => ({ ...fixture.state }),
  };
  return { fixture, captured, events };
}

test('known principal replacement requires a visible pre-mutation confirmation', async () => {
  const events = [];
  const captured = transfer({ principalFingerprint: fingerprint('b'), label: 'new@example.com' }, events);
  let shown;
  const fixture = {
    authPrincipalFingerprint: fingerprint('a'), state: { accountLabel: 'old@example.com' }, window: {},
    dialog: { showMessageBox: async (_window, options) => { shown = options; return { response: 0 }; } },
  };
  await assert.rejects(BrowserHost.prototype.verifyCapturedLoginTransfer.call(fixture, captured),
    error => error.code === 'profile-login-cancelled');
  assert.match(shown.message, /old@example\.com/);
  assert.match(shown.message, /new@example\.com/);
  assert.deepEqual(events, []);
  fixture.dialog.showMessageBox = async () => ({ response: 1 });
  assert.equal(await BrowserHost.prototype.verifyCapturedLoginTransfer.call(fixture, captured), captured);
});

test('a matching durable intent avoids a duplicate prompt but cannot authorize another known principal', async () => {
  const events = [];
  const captured = transfer({ principalFingerprint: fingerprint('b'), label: 'new@example.com' }, events, {
    identityIntent: { knownPrincipalFingerprint: fingerprint('a'), actualIdentityConfirmed: true },
  });
  const accepted = { authPrincipalFingerprint: fingerprint('a'), state: {},
    dialog: { showMessageBox: async () => assert.fail('duplicate confirmation') } };
  assert.equal(await BrowserHost.prototype.verifyCapturedLoginTransfer.call(accepted, captured), captured);
  const conflict = { authPrincipalFingerprint: fingerprint('c'), state: { accountLabel: 'third@example.com' },
    window: {}, dialog: { showMessageBox: async () => ({ response: 0 }) } };
  await assert.rejects(BrowserHost.prototype.verifyCapturedLoginTransfer.call(conflict, captured),
    error => error.code === 'profile-login-cancelled');
});

test('successful installation verifies the final principal, cleans capture, then commits binding', async () => {
  const { fixture, captured, events } = installFixture(fingerprint('b'));
  const result = await BrowserHost.prototype.installPasskeyLogin.call(fixture, captured);
  assert.equal(result.authenticated, true);
  assert.ok(events.indexOf('preflight') < events.indexOf('clear-old'));
  assert.ok(events.indexOf('snapshot-old') < events.indexOf('clear-old'));
  assert.ok(events.indexOf('inspect') < events.indexOf('cleanup'));
  assert.ok(events.indexOf('cleanup') < events.indexOf('commit'));
  assert.equal(events.includes('rollback'), false);
  assert.equal(events.includes('restore-old'), false);
});

test('installed-principal mismatch restores account A and rejects account B without commit', async () => {
  const { fixture, captured, events } = installFixture(fingerprint('b'), fingerprint('c'));
  await assert.rejects(BrowserHost.prototype.installPasskeyLogin.call(fixture, captured),
    error => error.code === 'chrome-account-mismatch');
  assert.equal(events.includes('commit'), false);
  assert.equal(events.filter(event => event === 'restore-old').length, 1);
  assert.equal(fixture.authPrincipalFingerprint, fingerprint('a'));
  assert.equal(fixture.state.accountLabel, 'old@example.com');
  assert.ok(events.indexOf('cleanup') < events.indexOf('rollback'));
});

test('temporary capture cleanup failure prevents commit and rolls back the imported session', async () => {
  const { fixture, events } = installFixture(fingerprint('b'));
  const captured = transfer({ principalFingerprint: fingerprint('b'), label: 'captured@example.com' }, events,
    { cleanupError: true });
  fixture.verifyCapturedLoginTransfer = async value => value;
  await assert.rejects(BrowserHost.prototype.installPasskeyLogin.call(fixture, captured), /temporary passkey state/);
  assert.equal(events.includes('commit'), false);
  assert.equal(events.includes('rollback'), true);
  assert.equal(events.filter(event => event === 'restore-old').length, 1);
  assert.equal(fixture.authPrincipalFingerprint, fingerprint('a'));
});

test('cancellation after mutation restores authenticated account A and never commits account B', async () => {
  const { fixture, captured, events } = installFixture(fingerprint('b'));
  const controller = new AbortController();
  fixture.view.webContents.session.cookies.set = async () => { events.push('cookie'); controller.abort(); };
  await assert.rejects(BrowserHost.prototype.installPasskeyLogin.call(fixture, captured, controller.signal),
    error => error.name === 'AbortError');
  assert.equal(events.includes('commit'), false);
  assert.equal(events.includes('rollback'), true);
  assert.equal(events.filter(event => event === 'restore-old').length, 1);
  assert.equal(fixture.authPrincipalFingerprint, fingerprint('a'));
  assert.equal(fixture.state.authenticated, true);
  assert.equal(fixture.state.accountLabel, 'old@example.com');
});

test('passkey error projection does not overwrite an authenticated session restored by rollback', async () => {
  const fixture = Object.assign(Object.create(BrowserHost.prototype), {
    state: { authenticated: false, authenticationStatus: 'unknown', status: 'idle' },
    passkeyLoginOperation: null, loginOperation: null, embeddedLoginController: null,
    sessionRefreshOperation: null, manualOperation: null, authView: null, turnTabs: new Map(),
    getBrowserInteractionMode: () => 'automatic', withManualOperation: async (_label, action) => action(),
    loginWithPasskey: async () => ({ cleanup: async () => {} }),
    installPasskeyLogin: async () => {
      fixture.state = { authenticated: true, authenticationStatus: 'verified', status: 'ready', accountLabel: 'old@example.com' };
      const error = new Error('Installed ChatGPT identity does not match the verified capture');
      error.code = 'chrome-account-mismatch'; error.previousSessionRestored = true; throw error;
    },
    snapshot() { return { ...this.state }; }, setState(patch) { this.state = { ...this.state, ...patch }; },
    publishState() {}, activateHomeSurface() {}, show() {}, closeAuthView() {},
    logger: { info() {} }, configureAccountSession: async () => {},
  });
  await assert.rejects(fixture.openPasskeyLogin(), error => error.code === 'chrome-account-mismatch');
  assert.equal(fixture.state.authenticated, true);
  assert.equal(fixture.state.authenticationStatus, 'verified');
  assert.equal(fixture.state.accountLabel, 'old@example.com');
});
