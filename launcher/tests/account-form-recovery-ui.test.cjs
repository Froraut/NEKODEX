const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');

// Same direct component/hook approach as account-settings-ui; effects retain
// dependencies so an unchanged host snapshot cannot silently reset the draft.
function harness(file, name, initialProps) {
  const slots = [];
  let cursor = 0, effects = [], props = initialProps;
  const react = { ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useId() { return `field-${cursor++}`; },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index][i]))) effects.push(callback);
      slots[index] = deps;
    },
  };
  function load(file) {
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    Function('module', 'exports', 'require', source)(module, module.exports, name =>
      name === 'react' ? react : name.endsWith('.css') ? {} : name === './account-proxy-validation'
        ? load('account-proxy-validation.ts') : require(name));
    return module.exports;
  }
  const Component = load(file)[name];
  return { render(next = {}) {
    props = { ...props, ...next };
    cursor = 0; effects = [];
    let tree = Component(props);
    if (effects.length) {
      effects.forEach(effect => effect());
      cursor = 0; effects = []; tree = Component(props);
    }
    return tree;
  } };
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const result = find(child, predicate); if (result) return result;
  }
  return null;
}
const button = (tree, label) => find(tree, node => node.type === 'button' && node.props.children === label);
const field = (tree, type) => find(tree, node => node.type === type);
const url = tree => find(tree, node => node.type === 'input' && node.props.type === 'url');
const status = tree => find(tree, node => node.type === 'p' && node.props.id);
const copy = new Proxy({}, { get: (_target, key) => key });
const saved = { mode: 'http', url: 'http://proxy.example:8080' };
const restore = tree => button(tree, 'Restore saved proxy');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('proxy restore recovers invalid/mode-switch drafts and latest saved values without saving', () => {
  let calls = 0;
  const view = harness('AccountProxySettings.tsx', 'AccountProxySettings', {
    proxy: saved, language: 'en', copy, disabled: false, save: async () => { calls++; return true; },
  });
  let tree = view.render();
  assert.equal(restore(tree).props.disabled, true);
  field(tree, 'select').props.onChange({ target: { value: 'system' } });
  tree = view.render();
  field(tree, 'select').props.onChange({ target: { value: 'http' } });
  tree = view.render();
  url(tree).props.onBlur();
  tree = view.render({ proxy: { ...saved } }); // same snapshot must retain edits
  assert.equal(url(tree).props.value, '');
  assert.equal(url(tree).props['aria-invalid'], true);
  assert.equal(restore(tree).props.disabled, false);
  restore(tree).props.onClick(); tree = view.render();
  assert.equal(url(tree).props.value, saved.url);
  assert.equal(url(tree).props['aria-invalid'], false);
  assert.equal(status(tree).props.children, 'accountFormSaved');
  const latest = { mode: 'pac', url: 'https://proxy.example/latest.pac' };
  tree = view.render({ proxy: latest });
  url(tree).props.onChange({ target: { value: 'invalid' } });
  tree = view.render(); restore(tree).props.onClick(); tree = view.render();
  assert.equal(field(tree, 'select').props.value, 'pac');
  assert.equal(url(tree).props.value, latest.url);
  assert.equal(calls, 0);
});

test('proxy raw-only edits can be restored and pending/disabled/failure gates stay intact', async () => {
  let finish, calls = 0;
  const view = harness('AccountProxySettings.tsx', 'AccountProxySettings', {
    proxy: saved, language: 'en', copy, disabled: false,
    save: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
  });
  let tree = view.render();
  url(tree).props.onChange({ target: { value: saved.url + '/' } }); tree = view.render();
  assert.equal(button(tree, 'proxySave').props.disabled, true);
  assert.equal(restore(tree).props.disabled, false);
  restore(tree).props.onClick(); tree = view.render();
  url(tree).props.onChange({ target: { value: 'http://other.example:8080' } }); tree = view.render();
  const pendingRestore = restore(tree).props.onClick;
  field(tree, 'form').props.onSubmit({ preventDefault() {} });
  pendingRestore(); tree = view.render();
  assert.equal(field(tree, 'fieldset').props.disabled, true);
  assert.equal(restore(tree).props.disabled, true);
  assert.equal(url(tree).props.value, 'http://other.example:8080');
  finish(false); await flush(); tree = view.render();
  assert.equal(status(tree).props.children, 'accountFormFailed');
  tree = view.render({ disabled: true }); restore(tree).props.onClick(); tree = view.render();
  assert.equal(url(tree).props.value, 'http://other.example:8080');
  tree = view.render({ disabled: false }); restore(tree).props.onClick(); tree = view.render();
  assert.equal(url(tree).props.value, saved.url);
  assert.equal(status(tree).props.children, 'accountFormSaved');
  assert.equal(calls, 1);
});

test('resume is offered for an unstopped session limit and respects disabled and pending-save gates', async () => {
  const { DEFAULT_POLICY } = require('../electron/account-safety.cjs');
  let resumes = 0, finish;
  const safety = { policy: DEFAULT_POLICY, stopped: false, cooldownUntil: 0, newSessionWindow: null };
  const view = harness('AccountSafetySettings.tsx', 'AccountSafetySettings', {
    id: 'a', safety, copy, disabled: false, resumeRequired: true,
    resume: () => { resumes++; }, save: () => new Promise(resolve => { finish = resolve; }),
  });
  let tree = view.render(); button(tree, 'pacingResume').props.onClick();
  assert.equal(resumes, 1);
  tree = view.render({ disabled: true }); button(tree, 'pacingResume').props.onClick();
  assert.equal(field(tree, 'fieldset').props.disabled, true);
  assert.equal(resumes, 1);
  tree = view.render({ disabled: false });
  find(tree, node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  tree = view.render(); field(tree, 'form').props.onSubmit({ preventDefault() {} });
  button(tree, 'pacingResume').props.onClick(); tree = view.render();
  assert.equal(field(tree, 'fieldset').props.disabled, true);
  assert.equal(resumes, 1);
  finish(true); await flush();
  tree = view.render({ resumeRequired: false }); assert.equal(button(tree, 'pacingResume'), null);
  tree = view.render({ safety: { ...safety, stopped: true } }); assert.ok(button(tree, 'pacingResume'));
});

test('proxy host refresh preserves an unsaved draft and restore uses the newest saved proxy', () => {
  let calls = 0;
  const view = harness('AccountProxySettings.tsx', 'AccountProxySettings', {
    proxy: saved, language: 'en', copy, disabled: false, save: async () => { calls++; return true; },
  });
  let tree = view.render();
  url(tree).props.onChange({ target: { value: 'not-a-proxy' } });
  tree = view.render(); url(tree).props.onBlur();
  const latest = { mode: 'https', url: 'https://new.example:8443' };
  tree = view.render({ proxy: latest });
  assert.equal(field(tree, 'select').props.value, 'http');
  assert.equal(url(tree).props.value, 'not-a-proxy');
  assert.equal(url(tree).props['aria-invalid'], true);
  assert.equal(button(tree, 'proxySave').props.disabled, true);
  restore(tree).props.onClick(); tree = view.render();
  assert.equal(field(tree, 'select').props.value, 'https');
  assert.equal(url(tree).props.value, latest.url);
  assert.equal(status(tree).props.children, 'accountFormSaved');
  assert.equal(calls, 0);
});

test('proxy save acknowledges canonical host values while a clean form follows host changes', async () => {
  let finish, submitted;
  const view = harness('AccountProxySettings.tsx', 'AccountProxySettings', {
    proxy: saved, language: 'en', copy, disabled: false,
    save: value => { submitted = value; return new Promise(resolve => { finish = resolve; }); },
  });
  let tree = view.render();
  const latest = { mode: 'https', url: 'https://new.example:8443' };
  tree = view.render({ proxy: latest });
  assert.equal(url(tree).props.value, latest.url);
  url(tree).props.onChange({ target: { value: 'https://draft.example:443/' } });
  tree = view.render(); field(tree, 'form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(submitted, { mode: 'https', url: 'https://draft.example' });
  tree = view.render({ proxy: submitted });
  assert.equal(url(tree).props.value, submitted.url);
  assert.equal(field(tree, 'fieldset').props.disabled, true);
  finish(true); await flush(); tree = view.render();
  assert.equal(status(tree).props.children, 'accountFormSaved');
  assert.equal(restore(tree).props.disabled, true);
});
