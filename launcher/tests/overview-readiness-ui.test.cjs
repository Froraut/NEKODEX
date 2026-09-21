const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function loadOverview(deriveWorkspaceReadiness) {
  const filename = path.join(__dirname, '../src/Overview.tsx');
  const source = fs.readFileSync(filename, 'utf8')
    .replace(/const workspaceBase = .*?;\n/, 'const workspaceBase = "base";\n')
    .replace(/const workspaceArt = .*?;\n/, 'const workspaceArt = "art";\n');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = { exports: {} };
  Function('module', 'exports', 'require', compiled)(loaded, loaded.exports, name => ({
    react: React,
    './CatTail': { CatTail: () => null },
    './BrandMark': { BrandMark: () => null, CatHead: () => null,
      useCatReaction: () => ({ reaction: null, play() {}, follow() {}, reset() {} }) },
    './icons': { Icon: () => null },
    './workspace-readiness': { deriveWorkspaceReadiness },
    './workflow-copy': { workflowCopy: () => ({
      session: { verificationUnavailable: 'Verification unavailable',
        verificationUnavailableBody: 'This does not mean the account is signed out.',
        retryVerification: 'Retry verification' },
      recovery: { webTransportTitle: 'Web transport needs attention',
        webTransportBody: 'Native models remain available.', repairAction: 'Repair Web transport',
        repairing: 'Repairing Web transport…' },
    }) },
  })[name] ?? require(name));
  return loaded.exports.Overview;
}

const copy = new Proxy({
  retry: 'Retry account status', accountConnection: 'ChatGPT account', accountsRefreshFailed: 'Account status unavailable',
  localToolsUnavailable: 'Web tools unavailable', localToolsUnavailableNativeBody: 'Native Codex remains available.',
  manageToolsConnection: 'Repair Web connection', overviewRunRunning: 'Running', automaticShort: 'Automatic',
  overviewOpenRun: 'Open run', overviewActiveRunsBody: 'Active run details',
}, { get: (target, key) => target[key] ?? String(key) });

function props(browser, runtimeCapabilities = null) {
  return {
    copy,
    browser,
    catalogFailure: null,
    snapshot: {
      profile: 'production', runtimeCapabilities, lifecycle: null,
      state: { browserInteractionMode: 'automatic', language: 'en', coreSetupComplete: true,
        codexCatalogVerified: true, codexPickerConfirmed: true, mcpRuntimeInstalled: true },
      browserCapacity: { active: 5 },
    },
    toolsReady: true,
    logs: [],
    navigate() {},
    openTab() {},
  };
}

test('Overview routes unavailable authentication to Accounts without hiding an active run', () => {
  let received;
  const Overview = loadOverview(input => {
    received = input;
    return { action: 'retry-session', reason: 'session-unavailable', native: 'ready', web: 'unknown', tools: 'ready' };
  });
  const browser = { authenticated: false, authenticationStatus: 'unavailable', loading: false, status: 'error',
    tabs: [{ id: 'active', title: 'Build',
    status: 'running', interactionMode: 'automatic' }] };
  const html = renderToStaticMarkup(React.createElement(Overview, props(browser)));
  assert.equal(received.authenticationStatus, 'unavailable');
  assert.match(html, />Retry verification</);
  assert.match(html, /This does not mean the account is signed out\./);
  assert.match(html, />Build</);
  assert.match(html, />Open run</);
  assert.doesNotMatch(html, />finishSetup</);
});

test('Overview keeps missing legacy authentication proof unknown after a generic browser error', () => {
  let received;
  const Overview = loadOverview(input => {
    received = input;
    return { action: 'wait', reason: 'session-checking', native: 'ready', web: 'checking', tools: 'ready' };
  });
  renderToStaticMarkup(React.createElement(Overview, props({ authenticated: false, loading: false,
    status: 'error', tabs: [] })));
  assert.equal(received.authenticationStatus, 'unknown');
});

test('Overview keeps optional Automatic tools neutral and reports catalog before picker', () => {
  const Overview = loadOverview(() => ({ action: 'open-browser', reason: 'workspace-ready',
    native: 'ready', web: 'ready', tools: 'unavailable' }));
  const snapshot = props({ authenticated: true, loading: false, status: 'ready', tabs: [] });
  snapshot.snapshot.state.codexCatalogVerified = false;
  snapshot.snapshot.state.codexPickerConfirmed = false;
  snapshot.snapshot.state.mcpRuntimeInstalled = false;
  snapshot.toolsReady = false;
  const html = renderToStaticMarkup(React.createElement(Overview, snapshot));
  assert.match(html, /modelsConnectionTab: modelsWaitingShort/);
  assert.doesNotMatch(html, /modelsConnectionTab: modelsConfirmShort/);
  assert.match(html, /toolsConnectionTab: connectorNotVerified/);
  assert.doesNotMatch(html, /toolsConnectionTab: Web tools unavailable/);
});

test('Overview preserves the native-ready message while offering explicit Web repair', () => {
  const Overview = loadOverview(() => ({ action: 'repair-web', reason: 'web-repair-available',
    native: 'ready', web: 'degraded', tools: 'degraded' }));
  const html = renderToStaticMarkup(React.createElement(Overview, props({ authenticated: true, loading: false,
    status: 'ready', tabs: [] }, { nativeAvailability: 'ready', webAvailability: 'degraded', tunnelStatus: 'degraded' })));
  assert.match(html, />Native models remain available\.</);
  assert.match(html, />Repair Web transport</);
  assert.doesNotMatch(html, />openWorkspace</);
});

test('Overview never calls the workspace ready when Web is explicitly unavailable', () => {
  const Overview = loadOverview(() => ({ action: 'open-setup', reason: 'web-unavailable',
    native: 'ready', web: 'unavailable', tools: 'unavailable' }));
  const html = renderToStaticMarkup(React.createElement(Overview, props({ authenticated: true,
    authenticationStatus: 'verified', loading: false, status: 'ready', tabs: [] },
  { nativeAvailability: 'ready', webAvailability: 'unavailable', tunnelStatus: 'degraded' })));
  assert.doesNotMatch(html, />openWorkspace</);
  assert.doesNotMatch(html, />setupChecksPassed</);
  assert.match(html, />finishSetup</);
});
