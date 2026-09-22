const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');

// Same dependency-injected component approach as account-settings-ui.test.cjs,
// with effect dependency/cleanup tracking and explicitly drained debounce timers.
function harness(file, name, initialProps, api = {}) {
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

test('same-identity readiness events hide and restore the handoff, with explicit account continuation', async t => {
  let value = pool(), reads = 0;
  const api = events(async () => { reads++; return value; });
  const view = handoff(api); t.after(() => view.dispose());
  view.render(); await flush();
  let continued;
  button(view.render({ onContinue: id => { continued = id; } }), 'Continue').props.onClick();
  assert.equal(continued, 'a');
  value = pool('a', true);
  api.browser(); api.browser(); api.operation('running');
  view.timers(); await flush();
  assert.equal(reads, 2);
  assert.equal(view.render(), null);
  value = pool(); api.operation('succeeded'); view.timers(); await flush();
  assert.ok(button(view.render(), 'Continue'));
});

test('in-flight events supersede stale readiness and failed reads recover on the next event', async t => {
  const first = deferred(), second = deferred(); let reads = 0;
  const api = events(() => { reads++; return reads === 1 ? first.promise : reads === 2 ? second.promise : Promise.resolve(pool()); });
  const view = handoff(api); t.after(() => view.dispose());
  view.render(); api.browser(); api.browser(); view.timers();
  assert.equal(reads, 1, 'event bursts do not start overlapping requests');
  first.resolve(pool()); await flush();
  assert.equal(view.render(), null, 'outdated pending read must not publish its banner');
  view.timers(); assert.equal(reads, 2);
  second.reject(new Error('transient IPC failure')); await flush();
  assert.equal(view.render(), null);
  api.browser(); view.timers(); await flush();
  assert.ok(button(view.render(), 'Continue'));
  assert.equal(reads, 3);
});

test('identity changes and unmount discard old reads and remove subscriptions/timers', async t => {
  const old = deferred(), current = deferred(); let reads = 0;
  const api = events(() => ++reads === 1 ? old.promise : current.promise);
  const view = handoff(api); t.after(() => view.dispose());
  view.render(); assert.equal(api.listeners(), 2);
  view.render({ browser: { ...browser, accountId: 'b' } });
  assert.equal(api.listeners(), 2);
  current.resolve(pool('b')); await flush();
  let continued;
  button(view.render({ onContinue: id => { continued = id; } }), 'Continue').props.onClick();
  assert.equal(continued, 'b');
  old.resolve(pool()); await flush();
  assert.ok(button(view.render(), 'Continue'), 'late old identity cannot replace the current pool');
  api.browser(); view.dispose(); view.timers();
  assert.equal(reads, 2); assert.equal(api.listeners(), 0);
});

function directory(overrides = {}, total = 15) {
  return { total, maximum: 16, nativeTabs: true, accounts: [{ accountId: 'a', label: 'A',
    manifestStatus: 'loaded', restoreAttempted: true,
    items: [{ id: 'saved', state: 'saved', restorable: true, location: 'https://chatgpt.com/c/test' }],
    ...overrides }] };
}
test('remaining workspaces can be explicitly retried after capacity frees, once per pending action', async t => {
  const restored = [], pending = deferred();
  const view = harness('BrowserWorkspaceManager.tsx', 'BrowserWorkspaceManager', {
    language: 'en', snapshot: directory({}, 16),
    onRestore(id) { restored.push(id); return pending.promise; },
    onOpen: async () => {}, onFocus: async () => {}, onClose: async () => {},
  }); t.after(() => view.dispose());
  assert.equal(button(view.render(), 'Restore').props.disabled, true);
  const available = button(view.render({ snapshot: directory() }), 'Restore');
  assert.equal(available.props.disabled, false);
  assert.deepEqual(restored, [], 'freeing capacity must not automatically open windows');
  available.props.onClick();
  assert.deepEqual(restored, ['a']);
  assert.equal(button(view.render(), 'Restore').props.disabled, true);
  pending.resolve(); await flush();
  assert.equal(button(view.render(), 'Restore').props.disabled, false);
  assert.equal(button(view.render({ snapshot: directory({ items: [{ id: 'saved', state: 'open', restorable: true }] }) }), 'Restore'), null);
});

test('restore keeps identity, temporary, transition and unavailable-manifest guards', t => {
  const view = harness('BrowserWorkspaceManager.tsx', 'BrowserWorkspaceManager', {
    language: 'en', snapshot: directory(), onRestore: async () => {},
    onOpen: async () => {}, onFocus: async () => {}, onClose: async () => {},
  }); t.after(() => view.dispose());
  for (const item of [
    { id: 'wrong', state: 'saved', restorable: false, needsOriginalAccount: true },
    { id: 'temp', state: 'saved', restorable: false, temporary: true },
  ]) assert.equal(button(view.render({ snapshot: directory({ items: [item] }) }), 'Restore').props.disabled, true);
  assert.equal(button(view.render({ snapshot: directory({ sessionMutation: { generation: 1 } }) }), 'Restore').props.disabled, true);
  assert.equal(button(view.render({ snapshot: directory(), disabled: true }), 'Restore').props.disabled, true);
  assert.equal(button(view.render({ disabled: false, snapshot: directory({ items: [], manifestStatus: 'uninitialized', restoreAttempted: false }) }), 'Restore').props.disabled, false);
  assert.equal(button(view.render({ snapshot: directory({ items: [], manifestStatus: 'uninitialized' }) }), 'Restore'), null);
});
