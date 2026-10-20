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

test('a loaded verified home presents idle readiness after a retired preflight failure without rewriting retained task failures', async () => {
  const host = fixture('old operation', '');
  let observations = 0;
  const contents = host.view.webContents;
  const inspect = contents.executeJavaScript;
  Object.assign(contents, { getTitle: () => 'ChatGPT', isLoading: () => false, isLoadingMainFrame: () => false, isCrashed: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false }, setBackgroundThrottling() {},
    executeJavaScript: async () => { observations++; return inspect(); } });
  Object.assign(host, { primaryDocumentRevision: 1, primaryRendererReady: true, primaryNavigationFailed: false,
    selectedTabId: 'home', visible: true, surfaceActive: true, ready: async () => {}, activateHomeSurface() {},
    publishState() {}, sessionRecheckEnabled: () => false,
    setState: BrowserHost.prototype.setState, snapshot: BrowserHost.prototype.snapshot });
  const failedTask = { id: 'task-receipt', terminal: true, status: 'failed', submission: 'not-sent', failure: 'personalization preflight deadline' };
  host.taskLedger = { get: () => failedTask };
  host.turnTabs.set('retained-task', { id: 'retained-task', traceId: 'saved-failed-turn', status: 'error', message: 'Task failed', loading: false,
    label: 'Retained failed task', pageTitle: 'ChatGPT', taskRecordId: failedTask.id, view: { webContents: contents } });
  const failOperation = () => host.withManualOperation('connector verification', async () => { throw new Error('ChatGPT personalization preflight exceeded its readiness deadline'); });
  await expect(host.withManualOperation('connector verification', async () => {
    host.setState({ status: 'error', message: 'ChatGPT session verification unavailable: Temporary Chat surface unavailable',
      authenticated: false, authenticationStatus: 'unavailable' });
    await host.runAuthenticationProbe();
    throw new Error('ChatGPT personalization preflight exceeded its readiness deadline');
  })).rejects.toThrow('personalization preflight');
  const home = host.snapshot();
  expect(home).toMatchObject({ status: 'ready', authenticated: true, authenticationStatus: 'verified' });
  expect(home.tabs.find((row: any) => row.id === 'home').status).toBe('ready');
  expect(home.tabs.find((row: any) => row.id === 'retained-task').status).toBe('error');
  expect(failedTask).toMatchObject({ terminal: true, status: 'failed', submission: 'not-sent' });
  expect(observations).toBe(1); // Snapshot readiness does not start another probe/login.
  host.selectedTabId = 'retained-task';
  expect(host.snapshot().status).toBe('error');
  host.turnTabs.get('retained-task').status = 'running';
  expect(host.snapshot().status).toBe('running');
  host.turnTabs.get('retained-task').status = 'error'; host.selectedTabId = 'home';
  host.primaryNavigationFailed = true;
  expect(host.snapshot().status).toBe('error');
  host.primaryNavigationFailed = false; host.primaryRendererReady = false;
  expect(host.snapshot().status).toBe('error');
  host.primaryRendererReady = true; host.primaryDocumentRevision++;
  expect(host.snapshot().status).toBe('error'); // Same URL in another document cannot reuse old proof.
  await host.runAuthenticationProbe();
  await expect(failOperation()).rejects.toThrow('personalization preflight');
  host.setState({ status: 'error', message: 'ERR_CONNECTION_RESET' });
  expect(host.snapshot()).toMatchObject({ status: 'error', message: 'ERR_CONNECTION_RESET' });
  await expect(failOperation()).rejects.toThrow('personalization preflight');
  expect(host.snapshot().status).toBe('error'); // An operation wrapper cannot relabel a current surface failure.
  host.setState({ authenticated: false, authenticationStatus: 'unavailable', message: 'ChatGPT session verification unavailable: session HTTP 403' });
  expect(host.snapshot()).toMatchObject({ status: 'error', authenticated: false, authenticationStatus: 'unavailable' });
});

test('a check waiting through its own reload never publishes a mid-load page as a lost sign-in', async () => {
  const host = fixture('', '', false);
  host.state = { status: 'ready', message: 'ChatGPT is ready', authenticated: true, authenticationStatus: 'verified' };
  const quiet = await host.runAuthenticationProbe({ preserveVerified: true });
  expect(quiet).toMatchObject({ authenticated: false, authenticationStatus: 'unknown' });
  expect(host.state).toMatchObject({ authenticated: true, authenticationStatus: 'verified' });
  // Without the owner's flag the same observation is published as before.
  await expect(host.runAuthenticationProbe()).resolves.toMatchObject({ authenticated: false, authenticationStatus: 'unavailable' });
});

test('page-load probes wait while a check owns the page and run once after it releases it', async () => {
  const host = fixture('', '');
  host.state = { status: 'ready', message: 'ChatGPT is ready', authenticated: true, authenticationStatus: 'verified' };
  let probes = 0;
  host.runAuthenticationProbe = async () => { probes += 1; return host.snapshot(); };
  host.ready = async () => {};
  host.manualOperation = null;
  host.view.webContents.setBackgroundThrottling = () => {};
  let release!: () => void;
  const check = host.withReadOnlyInspection('connector verification', () => new Promise<void>(resolve => { release = resolve; }),
    { preserveSelection: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  await host.probeAuthentication();
  await host.probeAuthentication();
  expect(probes).toBe(0);
  release();
  await check;
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(probes).toBe(1);
});
