const test = require('node:test');
const assert = require('node:assert/strict');
const { captureOwnedSession, disposeOwnedSessionSnapshot, restoreOwnedSession } = require('../electron/owned-session-rollback.cjs');

test('rollback snapshot retains only bounded ChatGPT/OpenAI first-party state in memory', async () => {
  const cookie = (domain, name, value) => ({ domain, name, value, path: '/', secure: true, httpOnly: true,
    session: true, sameSite: 'lax' });
  const session = { cookies: { get: async ({ url }) => url.includes('chatgpt.com')
    ? [cookie('.chatgpt.com', 'chat', 'PRIVATE-A'), cookie('.evil.example', 'evil', 'PRIVATE-EVIL')]
    : [cookie('auth.openai.com', 'auth', 'PRIVATE-B')] } };
  const contents = { isDestroyed: () => false, session, getURL: () => 'https://chatgpt.com/?temporary-chat=true',
    executeJavaScript: async () => [{ name: 'theme', value: 'dark' }] };
  const snapshot = await captureOwnedSession(contents);
  assert.deepEqual(snapshot.cookies.map(value => value.name).sort(), ['auth', 'chat']);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE-EVIL/);
  assert.deepEqual(snapshot.localStorage, [{ name: 'theme', value: 'dark' }]);
  disposeOwnedSessionSnapshot(snapshot);
  assert.deepEqual(snapshot, { cookies: [], localStorage: [] });
});

test('rollback restoration writes the owned cookie jar before loading and restoring local storage', async () => {
  const events = [];
  const session = { cookies: {
    set: async cookie => events.push(['cookie', cookie.name]),
    flushStore: async () => events.push('flush-cookies'),
  }, flushStorageData: () => events.push('flush-storage') };
  const contents = { isDestroyed: () => false, session,
    loadURL: async () => events.push('load'),
    executeJavaScript: async script => { assert.match(script, /localStorage\.setItem/); events.push('local-storage'); } };
  await restoreOwnedSession(contents, { cookies: [{ url: 'https://chatgpt.com/', name: 'session', value: 'PRIVATE',
    path: '/', secure: true, httpOnly: true, sameSite: 'lax' }], localStorage: [{ name: 'theme', value: 'dark' }] },
  'https://chatgpt.com/?temporary-chat=true');
  assert.deepEqual(events, [['cookie', 'session'], 'flush-storage', 'flush-cookies', 'load', 'local-storage', 'load']);
});

test('restored historical identity remains unavailable when provider verification is unavailable', async () => {
  const { BrowserHost } = require('../electron/browser-host.cjs');
  const previous = {
    storage: { cookies: [{ url: 'https://chatgpt.com/', name: 'session', value: 'PRIVATE', path: '/', secure: true,
      httpOnly: true, sameSite: 'lax' }], localStorage: [] },
    evidence: { principalFingerprint: 'a'.repeat(64), sessionFingerprint: 'b'.repeat(64), identityEpoch: 7 },
    state: { authenticated: true, authenticationStatus: 'verified', accountLabel: 'old@example.com',
      lastVerifiedAt: '2026-09-21T10:00:00.000Z', status: 'ready', loading: false },
  };
  const session = { cookies: { set: async () => {}, flushStore: async () => {} }, flushStorageData() {} };
  const fixture = {
    accountId: 'default', authPrincipalFingerprint: null, authSessionFingerprint: null, authIdentityEpoch: 8,
    state: { authenticated: false, authenticationStatus: 'unknown' }, turnTabs: new Map(),
    view: { webContents: { isDestroyed: () => false, session, loadURL: async () => {}, getURL: () => 'https://chatgpt.com/' } },
    clearOwnedSessionForPasskey: async () => {}, probeAuthentication: async () => ({ authenticated: false, authenticationStatus: 'unavailable' }),
    snapshot() { return { ...this.state }; }, setState(patch) { this.state = { ...this.state, ...patch }; },
    onAuthIdentityChanged() {},
  };
  const restored = await BrowserHost.prototype.restoreLoginRollbackSnapshot.call(fixture, previous);
  assert.equal(restored.authenticated, false);
  assert.equal(restored.authenticationStatus, 'unavailable');
  assert.equal(restored.accountLabel, 'old@example.com');
  assert.equal(restored.lastVerifiedAt, '2026-09-21T10:00:00.000Z');
  assert.equal(fixture.authPrincipalFingerprint, 'a'.repeat(64));
  assert.equal(fixture.authIdentityEpoch, 9);
});

test('restored account A is accepted only after a fresh matching authenticated probe', async () => {
  const { BrowserHost } = require('../electron/browser-host.cjs');
  const previous = {
    storage: { cookies: [{ url: 'https://chatgpt.com/', name: 'session', value: 'PRIVATE', path: '/', secure: true,
      httpOnly: true, sameSite: 'lax' }], localStorage: [] },
    evidence: { principalFingerprint: 'a'.repeat(64), sessionFingerprint: 'b'.repeat(64), identityEpoch: 2 },
    state: { authenticated: true, authenticationStatus: 'verified', accountLabel: 'old@example.com' },
  };
  const session = { cookies: { set: async () => {}, flushStore: async () => {} }, flushStorageData() {} };
  const fixture = {
    accountId: 'default', authPrincipalFingerprint: null, authSessionFingerprint: null, authIdentityEpoch: 3,
    state: { authenticated: false }, turnTabs: new Map(),
    view: { webContents: { isDestroyed: () => false, session, loadURL: async () => {} } },
    clearOwnedSessionForPasskey: async () => {},
    probeAuthentication: async () => {
      fixture.authPrincipalFingerprint = 'a'.repeat(64);
      fixture.state = { authenticated: true, authenticationStatus: 'verified', accountLabel: 'old@example.com' };
      return fixture.snapshot();
    },
    snapshot() { return { ...this.state }; }, setState(patch) { this.state = { ...this.state, ...patch }; },
    onAuthIdentityChanged() {},
  };
  const restored = await BrowserHost.prototype.restoreLoginRollbackSnapshot.call(fixture, previous);
  assert.equal(restored.authenticated, true);
  assert.equal(restored.authenticationStatus, 'verified');
  assert.equal(fixture.authPrincipalFingerprint, 'a'.repeat(64));
});
