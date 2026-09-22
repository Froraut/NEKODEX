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

test('dirty invalid window survives changed policy, restore uses latest evidence without IPC, identity resets', () => {
  const { DEFAULT_POLICY } = require('../electron/account-safety.cjs');
  let saves = 0, resumes = 0;
  const safety = { policy: { ...DEFAULT_POLICY, newSessionWindow: { limit: 2, minutes: 10 } }, stopped: false, cooldownUntil: 0, newSessionWindow: null };
  const view = harness('AccountSafetySettings.tsx', 'AccountSafetySettings', {
    id: 'a', safety, copy, disabled: false, save: async () => { saves++; return true; }, resume: () => { resumes++; },
  });
  const limit = tree => find(tree, n => n.type === 'input' && n.props.max === 10000);
  let tree = view.render();
  limit(tree).props.onChange({ target: { value: '' } });
  const latest = { ...safety, policy: { ...safety.policy, newSessionWindow: { limit: 7, minutes: 20 } } };
  tree = view.render({ safety: latest });
  assert.equal(limit(tree).props.value, ''); assert.equal(limit(tree).props['aria-invalid'], true);
  button(tree, 'accountSafetyRestore').props.onClick(); tree = view.render();
  assert.equal(limit(tree).props.value, '7'); assert.equal(saves, 0); assert.equal(resumes, 0);
  limit(tree).props.onChange({ target: { value: 'invalid' } });
  tree = view.render({ id: 'b', safety }); assert.equal(limit(tree).props.value, '2');
});

test('matching submitted policy acknowledges the draft and the next clean update follows host', async () => {
  const { DEFAULT_POLICY } = require('../electron/account-safety.cjs');
  let submitted;
  const safety = { policy: DEFAULT_POLICY, stopped: false, cooldownUntil: 0, newSessionWindow: null };
  const view = harness('AccountSafetySettings.tsx', 'AccountSafetySettings', {
    id: 'a', safety, copy, disabled: false, save: async policy => { submitted = policy; return true; }, resume() {},
  });
  let tree = view.render();
  const enabled = tree => find(tree, n => n.type === 'input' && n.props.type === 'checkbox');
  enabled(tree).props.onChange({ target: { checked: !DEFAULT_POLICY.enabled } });
  tree = view.render(); field(tree, 'form').props.onSubmit({ preventDefault() {} }); await flush();
  assert.ok(submitted); tree = view.render({ safety: { ...safety, policy: submitted } });
  assert.equal(button(tree, 'accountSafetyRestore').props.disabled, true);
  tree = view.render({ safety }); assert.equal(enabled(tree).props.checked, DEFAULT_POLICY.enabled);
});
