const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');

// Same dependency-injected component approach as account-settings-ui.test.cjs,
// with effect dependency/cleanup tracking and explicitly drained debounce timers.
function harness(file, name, initialProps, api = {}, overrides = {}) {
  const slots = [], effects = [], timers = new Map(), modules = new Map();
  let cursor = 0, nextTimer = 0, props = initialProps, disposed = false;
  const hooks = { ...React,
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn) { return fn(); },
    useEffect(fn, deps) {
      const i = cursor++;
      const previous = slots[i];
      if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
        effects.push(() => {
          previous?.cleanup?.();
          slots[i] = { deps, cleanup: fn() };
        });
      }
    },
  };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const mod = { exports: {} };
    Function('module', 'exports', 'require', compiled)(mod, mod.exports, dependency => {
      if (Object.hasOwn(overrides, dependency)) return overrides[dependency];
      if (dependency === 'react') return hooks;
      if (dependency.endsWith('.css')) return {};
      if (dependency.startsWith('./')) return load(dependency.slice(2) + '.ts');
      return require(dependency);
    });
    modules.set(relative, mod.exports);
    return mod.exports;
  }
  const Component = load(file)[name];
  const previousWindow = global.window;
  global.window = { codexWebLauncher: api,
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  return {
    render(changes = {}) {
      props = { ...props, ...changes }; cursor = 0;
      const tree = Component(props);
      effects.splice(0).forEach(fn => fn());
      return tree;
    },
    timers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    dispose() {
      if (disposed) return;
      disposed = true;
      slots.forEach(slot => slot?.cleanup?.());
      global.window = previousWindow;
    },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function events(accounts) {
  const browser = new Set(), operation = new Set();
  return {
    accounts,
    onBrowserState(fn) { browser.add(fn); return () => browser.delete(fn); },
    onOperation(fn) { operation.add(fn); return () => operation.delete(fn); },
    browser() { browser.forEach(fn => fn({})); },
    operation(status) { operation.forEach(fn => fn({ status })); },
    listeners() { return browser.size + operation.size; },
  };
}
const browser = { accountId: 'a', authenticated: true, authenticationStatus: 'verified', loginInProgress: false };
function pool(id = 'a', ready = false) {
  return { selectedId: id, accounts: [{ id, label: id, authenticated: true,
    authenticationStatus: 'verified', checked: ready, connectorReady: ready }] };
}
function handoff(api) {
  return harness('AccountToolsOnboarding.tsx', 'AccountToolsHandoff', {
    browser, language: 'en', disabled: false, onContinue() {},
  }, api);
}
function button(tree, label) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.type === 'button' && [tree.props.children].flat().some(text => typeof text === 'string' && text.startsWith(label))) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const result = button(child, label); if (result) return result;
  }
  return null;
}

test('event overtakes initial pool read and coalesces exactly one replacement', async t => {
  const old = deferred(), fresh = deferred(); let reads = 0;
  const api = events(() => ++reads === 1 ? old.promise : fresh.promise);
  const view = harness('useAccountPoolSnapshot.ts', 'useAccountPoolSnapshot', { api, initial: 'immediate' }, api);
  t.after(() => view.dispose()); view.render(); api.browser(); api.browser(); view.timers();
  assert.equal(reads, 1); old.resolve(pool('old')); await flush();
  assert.equal(view.render().snapshot, null); view.timers(); assert.equal(reads, 2);
  fresh.resolve(pool('a')); await flush(); assert.equal(view.render().snapshot.selectedId, 'a');
});

test('failed refresh retains Accounts evidence with failed guard, receipt rejects an older read', async t => {
  const old = deferred(); let reads = 0;
  const api = events(() => { reads++; return reads === 1 ? Promise.resolve(pool()) : reads === 2 ? old.promise : Promise.reject(new Error('refresh boundary')); });
  const view = harness('useAccountPoolSnapshot.ts', 'useAccountPoolSnapshot', { api, initial: 'immediate' }, api);
  t.after(() => view.dispose()); view.render(); await flush();
  view.render().invalidate(); view.timers(); assert.equal(reads, 2);
  view.render().applyReceipt(pool('saved')); old.resolve(pool('stale')); await flush();
  assert.equal(view.render().snapshot.selectedId, 'saved'); view.timers(); await flush();
  const state = view.render(); assert.equal(reads, 3); assert.equal(state.failed, true); assert.equal(state.snapshot.selectedId, 'saved');
});

test('handoff identity switch rejects old read and unavailable evidence hides continuation', async t => {
  const old = deferred(), fresh = deferred(); let reads = 0;
  const api = events(() => ++reads === 1 ? old.promise : fresh.promise);
  const view = handoff(api); t.after(() => view.dispose()); view.render();
  view.render({ browser: { ...browser, accountId: 'b' } });
  old.resolve(pool('a')); await flush(); assert.equal(view.render(), null);
  fresh.resolve(pool('b')); await flush(); let continued;
  button(view.render({ onContinue: id => { continued = id; } }), 'Continue').props.onClick(); assert.equal(continued, 'b');
  api.accounts = () => Promise.reject(new Error('handoff refresh')); api.browser(); view.timers(); await flush();
  assert.equal(view.render(), null);
});

const progress = { flowId: 'flow-a', accountId: 'a', active: true, settling: false, deadlineAt: new Date(Date.now() + 60000).toISOString(), phase: 'waiting' };
function loginView(api, setError = () => {}) {
  return harness('useAccountCodexLogin.ts', 'useAccountCodexLogin', { api, transitionBusy: false, loadFailed: false, isQuotaBusy: () => false, setError }, api);
}
test('login cancellation remains bound to original flow/account during a transition', async t => {
  const calls = []; const api = { codexLoginSnapshot: async () => progress,
    cancelCodexLogin: async (...args) => { calls.push(args); return { ...progress, active: false }; } };
  const view = loginView(api); t.after(() => view.dispose()); view.render(); await flush();
  const state = view.render({ transitionBusy: true }); await state.cancelCodexLogin(state.login);
  assert.deepEqual(calls, [['flow-a', 'a']]); assert.equal(view.render().login.active, false);
});

test('login polling reaches status boundary and fails after three consecutive failures', async t => {
  let calls = 0;
  const api = { codexLoginSnapshot: async () => progress, codexLoginStatus: async (flow, account) => {
    assert.equal(flow, 'flow-a'); assert.equal(account, 'a'); calls++; throw new Error('status boundary');
  } };
  const view = loginView(api); t.after(() => view.dispose()); view.render(); await flush(); view.render();
  for (let i = 0; i < 3; i++) { view.timers(); await flush(); }
  assert.equal(calls, 3); assert.equal(view.render().loginSnapshotStatus, 'failed');
});

test('failed start recovers host snapshot without losing the actionable start error', async t => {
  let reads = 0, starts = 0; const errors = [];
  const api = { codexLoginSnapshot: async () => ++reads === 1 ? null : progress,
    startCodexLogin: async id => { assert.equal(id, 'a'); starts++; throw new Error('start boundary'); } };
  const view = loginView(api, error => errors.push(error)); t.after(() => view.dispose()); view.render(); await flush();
  await view.render().startCodexLogin('a');
  assert.equal(starts, 1); assert.equal(reads, 2); assert.equal(view.render().login.flowId, 'flow-a'); assert.equal(errors.at(-1), 'start boundary');
});

test('Accounts keeps stale account identity visible but blocks mutations after refresh failure', async t => {
  let reads = 0, mutations = 0;
  const api = events(async () => {
    if (++reads > 1) throw new Error('accounts refresh boundary');
    return { ...pool(), mode: 'selected', accounts: [{ ...pool().accounts[0], enabled: true, activeTurns: 0, evidenceEpoch: 1 }] };
  });
  Object.assign(api, { codexLoginSnapshot: async () => null, accountCodexQuotaSnapshot: async () => null,
    setAccountEnabled: async () => { mutations++; return pool(); } });
  const text = new Proxy({}, { get: (_, key) => String(key) });
  const components = ['Icon', 'AccountSafetySettings', 'AccountProxySettings', 'AccountCodexControls',
    'AccountReadiness', 'AccountToolsOnboarding', 'QuotaPortfolioSummary'];
  const overrides = Object.fromEntries(components.map(name => [name === 'Icon' ? './icons' : './' + name, { [name]: () => null }]));
  overrides['./i18n'] = { accountCodexCopyFor: () => text };
  overrides['./workflow-copy'] = { workflowCopy: () => ({ portfolio: text, session: text }) };
  overrides['./session-issue-copy'] = { sessionIssueCopy: () => '' };
  const view = harness('AccountSettings.tsx', 'AccountSettings', { copy: text, language: 'en', manual: false,
    transitionBusy: false, openBrowser() {}, setError() {}, toolsSetup: { runtimeConfigured: true, connectorName: 'Test', urls: {} },
    focusAccountId: null, onSetupTools() {} }, api, overrides);
  t.after(() => view.dispose()); view.render(); view.timers(); await flush(); view.render(); await flush();
  api.browser(); view.timers(); await flush(); const tree = view.render();
  function nodes(node) { return !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]; }
  const all = nodes(tree);
  assert.equal(reads, 2);
  assert.ok(all.some(node => node.type === 'article'), 'retained account card stays visible');
  const enabled = all.find(node => node.type === 'input' && node.props.type === 'checkbox');
  assert.ok(enabled); assert.equal(enabled.props.disabled, true);
  enabled.props.onChange({ target: { checked: false } }); await flush(); assert.equal(mutations, 0);
});
