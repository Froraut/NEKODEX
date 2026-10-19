import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { BrowserHost, TEMPORARY_CHAT_URL } = require('../launcher/electron/browser-host.cjs');

function fixture(message: string, manualOperation = 'ChatGPT passkey login', verified = true) {
  const result = { composer: verified, temporary: true, sessionAuthenticated: verified,
    sessionVerification: verified ? 'verified' : 'unavailable', verificationFailure: verified ? null : 'session HTTP 403',
    readyState: 'complete', principalFingerprint: 'a'.repeat(64), sessionFingerprint: 'b'.repeat(64),
    accountLabel: null, url: TEMPORARY_CHAT_URL };
  const contents = { isDestroyed: () => false, getURL: () => TEMPORARY_CHAT_URL, executeJavaScript: async () => result };
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    view: { webContents: contents }, authView: null, authGeneration: 0, authProbeRevision: 0,
    authPrincipalFingerprint: null, authSessionFingerprint: null, authIdentityEpoch: 0,
    turnTabs: new Map(), manualOperation, getBrowserInteractionMode: () => 'automatic',
    state: { status: 'error', message, authenticated: false, authenticationStatus: 'unavailable' },
    setState(patch: unknown) { this.state = { ...this.state, ...patch as object }; },
    snapshot() { return { ...this.state }; }, onAuthIdentityChanged() {}, logger: { info() {} },
  });
  return host;
}

test('a current verified login probe clears superseded verification errors, while current failures retain their presentation', async () => {
  const recovered = fixture('ChatGPT session verification unavailable: Temporary Chat surface unavailable');
  await expect(recovered.runAuthenticationProbe()).resolves.toMatchObject({ status: 'ready', message: 'ChatGPT is ready', authenticated: true, authenticationStatus: 'verified' });
  expect(recovered.authIdentityEpoch).toBe(1);
  const historicalImport = fixture('chrome-account-unverified');
  await expect(historicalImport.runAuthenticationProbe()).resolves.toMatchObject({ status: 'ready', authenticated: true });
  const navigation = fixture('Could not load ChatGPT: ERR_CONNECTION_RESET');
  await expect(navigation.runAuthenticationProbe()).resolves.toMatchObject({ status: 'error', message: 'Could not load ChatGPT: ERR_CONNECTION_RESET' });
  const unrelated = fixture('ChatGPT session verification unavailable: session HTTP 403', 'browser smoke test');
  await expect(unrelated.runAuthenticationProbe()).resolves.toMatchObject({ status: 'error' });
  const stillUnavailable = fixture('chrome-account-unverified', 'ChatGPT passkey login', false);
  await expect(stillUnavailable.runAuthenticationProbe()).resolves.toMatchObject({ status: 'error', authenticated: false, authenticationStatus: 'unavailable' });
});
