const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Exercise the actual Settings component without booting Electron or its IPC.
const source = ts.createSourceFile('App.tsx', fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'SettingsSurface');
const compiled = ts.transpileModule(component.getText(source), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
} }).outputText;
const copy = new Proxy({ browserCapacityStatus: 'Active {active}; saved {saved}', capacityInvalid: 'Maximum {max}' },
  { get: (target, key) => target[key] ?? key });
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(api = {}) {
  const slots = [];
  let cursor = 0, effects = [], changed = false, tree, error = null;
  const useState = initial => {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
    return [slots[i], next => {
      const value = typeof next === 'function' ? next(slots[i]) : next;
      if (!Object.is(value, slots[i])) { slots[i] = value; changed = true; }
    }];
  };
  const useRef = initial => { const i = cursor++; return slots[i] ??= { current: initial }; };
  const useEffect = (callback, deps) => {
    const i = cursor++;
    if (!slots[i] || deps.some((value, j) => !Object.is(value, slots[i][j]))) {
      slots[i] = deps; effects.push(callback);
    }
  };
  const children = ['ContentSurface', 'SectionHeading', 'InteractionModePicker', 'SettingRow', 'Switch',
    'ProModelVersionMenu', 'ContextBudgetTable', 'LanguageMenu', 'SecondaryButton', 'RouteDiagnostics',
    'Icon', 'DoctorSummary', 'BrandMark'];
  const scope = { React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    useState, useRef, useEffect, api, taskControlCopy: { en: {} }, codexSettingsStatus: () => null,
    messageOf: cause => cause.message, platformLabel: () => 'Test', ...Object.fromEntries(children.map(name => [name, name])) };
  const Settings = Function(...Object.keys(scope), `${compiled}\nreturn SettingsSurface;`)(...Object.values(scope));
  const props = { copy, language: 'en', browser: null, operation: null, devProfile: false,
    snapshot: { state: { browserInteractionMode: 'automatic' }, browserCapacity: { configured: 4, active: 4, maximum: 16, restartRequired: false } },
    updateState: state => { props.snapshot = { ...props.snapshot, state }; },
    setError: value => { error = value; }, updateBrowserCapacity: value => { props.snapshot = { ...props.snapshot, browserCapacity: value }; } };
  function render() {
    do { changed = false; cursor = 0; effects = []; tree = Settings(props); effects.forEach(effect => effect()); } while (changed);
    return tree;
  }
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children ?? null)];
  }
  const find = predicate => nodes(tree).find(predicate);
  const input = () => find(node => node.type === 'input' && node.props['aria-label'] === copy.browserCapacity);
  const refresh = capacity => { props.snapshot = { ...props.snapshot, browserCapacity: { ...props.snapshot.browserCapacity, ...capacity } }; render(); };
  render();
  return { render, refresh, input, find, nodes: () => nodes(tree), error: () => error };
}

test('capacity snapshot refresh updates pristine input and saved/runtime status', () => {
  const h = harness();
  h.refresh({ configured: 6, active: 4, restartRequired: true });
  assert.equal(h.input().props.value, '6');
  assert.ok(h.nodes().some(node => node.props?.children?.includes('Active 4; saved 6')));
  assert.ok(h.nodes().some(node => node.props?.children?.includes(copy.browserCapacityRestart)));
  assert.equal(h.find(node => node.type === 'button' && node.props.type === 'submit').props.disabled, true);
});

test('snapshot refresh preserves a draft, uses current limits, and accepts the save receipt', async () => {
  const calls = [];
  const h = harness({ setBrowserCapacity: async value => {
    calls.push(value); return { configured: value, active: 4, maximum: 8, restartRequired: true };
  } });
  h.input().props.onChange({ target: { value: '9' } }); h.render();
  h.refresh({ configured: 6, maximum: 8 });
  assert.equal(h.input().props.value, '9');
  assert.equal(h.input().props['aria-invalid'], true);
  h.input().props.onChange({ target: { value: '7' } }); h.render();
  h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await tick(); h.render();
  assert.deepEqual(calls, [7]);
  assert.equal(h.input().props.value, '7');
  assert.equal(h.find(node => node.type === 'button' && node.props.type === 'submit').props.disabled, true);
  h.input().props.onChange({ target: { value: '' } }); h.render();
  h.refresh({ configured: 8 });
  assert.equal(h.input().props.value, '');
});

test('doctor refresh clears a previous healthy result even when the replacement fails', async () => {
  let reject, calls = 0;
  const h = harness({ doctor: () => ++calls === 1 ? Promise.resolve({ ok: true, checks: [] })
    : new Promise((_resolve, fail) => { reject = fail; }) });
  const doctorButton = () => h.find(node => node.type === 'button'
    && JSON.stringify(node.props.children).includes('runDoctor'));
  doctorButton().props.onClick(); await tick(); h.render();
  assert.ok(h.find(node => node.type === 'DoctorSummary'));
  doctorButton().props.onClick(); h.render();
  assert.equal(h.find(node => node.type === 'DoctorSummary'), undefined);
  assert.equal(doctorButton().props.disabled, true);
  reject(new Error('Diagnostic unavailable')); await tick(); h.render();
  assert.equal(h.error(), 'Diagnostic unavailable');
  assert.equal(h.find(node => node.type === 'DoctorSummary'), undefined);
  assert.equal(doctorButton().props.disabled, false);
});

test('mode transition retires diagnostics before IPC settles and preserves same-mode evidence', async () => {
  let resolve, reject;
  const calls = [];
  const h = harness({ setBrowserInteractionMode: mode => {
    calls.push(mode);
    return new Promise((done, fail) => { resolve = done; reject = fail; });
  } });
  const picker = () => h.find(node => node.type === 'InteractionModePicker');
  const diagnostics = () => h.find(node => node.type === 'RouteDiagnostics');
  const initial = diagnostics().props.key;
  picker().props.onChange('automatic'); h.render();
  assert.deepEqual(calls, ['automatic']);
  assert.equal(diagnostics().props.key, initial);
  resolve({ state: { browserInteractionMode: 'automatic' }, credentialsRequired: false });
  await tick(); h.render();
  picker().props.onChange('manual'); h.render();
  assert.deepEqual(calls, ['automatic', 'manual']); // Prove the transition IPC was reached.
  assert.notEqual(diagnostics().props.key, initial);
  assert.equal(diagnostics().props.disabled, true);
  const pendingKey = diagnostics().props.key;
  resolve({ state: { browserInteractionMode: 'manual' }, credentialsRequired: false });
  await tick(); h.render();
  assert.equal(picker().props.mode, 'manual');
  assert.equal(diagnostics().props.key, pendingKey);
  assert.equal(diagnostics().props.disabled, false);
  picker().props.onChange('automatic'); h.render();
  assert.deepEqual(calls, ['automatic', 'manual', 'automatic']);
  assert.notEqual(diagnostics().props.key, pendingKey);
  const failedKey = diagnostics().props.key;
  reject(new Error('Mode transition failed')); await tick(); h.render();
  assert.equal(h.error(), 'Mode transition failed');
  assert.equal(diagnostics().props.key, failedKey);
  assert.equal(diagnostics().props.disabled, false);
});
