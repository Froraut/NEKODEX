const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');

// Same isolated hook/event harness used by account-settings-ui.test.cjs.
// Exercises component callbacks, without an app, provider or browser process.
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/TaskCenter.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function harness(tasks, overrides = {}) {
  const state = [], refs = [], calls = [], errors = [];
  let stateIndex = 0, refIndex = 0;
  const react = { ...React,
    useState(initial) {
      const i = stateIndex++;
      if (!(i in state)) state[i] = initial;
      return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }];
    },
    useRef(initial) { const i = refIndex++; return refs[i] ??= { current: initial }; },
  };
  const loaded = { exports: {} };
  Function('module', 'exports', 'require', compiled)(loaded, loaded.exports,
    name => name === 'react' ? react : name.endsWith('.css') ? {} : require(name));
  const props = { tasks, language: 'en', disabled: false,
    open: async (...args) => calls.push(['open', ...args]),
    cancel: async (...args) => calls.push(['cancel', ...args]),
    dismiss: async (...args) => calls.push(['dismiss', ...args]),
    onError: error => errors.push(error), ...overrides };
  return { calls, errors, props, render() { stateIndex = refIndex = 0; return loaded.exports.TaskCenter(props); } };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  return tree && typeof tree === 'object' ? text(tree.props?.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}
const find = (tree, type, label) => {
  const found = nodes(tree).find(node => node.type === type && (label === undefined || text(node) === label));
  assert.ok(found, `Missing ${type}: ${label}`); return found;
};
const button = (tree, label) => find(tree, 'button', label);
const articles = tree => nodes(tree).filter(node => node.type === 'article');
const traces = tree => articles(tree).map(row => text(find(row, 'code')));
const settle = () => new Promise(resolve => setImmediate(resolve));
const task = (id, changes = {}) => ({ id, accountId: 'a', accountName: 'Alpha', traceId: `trace-${id}`, tabId: `tab-${id}`,
  model: 'High', createdAt: 1, updatedAt: 2, sequence: 1, phase: 'failed-after-send', submission: 'accepted',
  terminal: true, canOpen: true, canCancel: false, canDismiss: true, retrySafe: false, ...changes });
function change(h, type, index, value) {
  nodes(h.render()).filter(node => node.type === type)[index].props.onChange({ target: { value } });
}

test('retained failure requires confirmation, Keep preserves it, Open still works, exact account is dismissed once', async () => {
  const h = harness([task('same'), task('same', { accountId: 'b', accountName: 'Beta', tabId: 'b-tab' })]);
  button(articles(h.render())[1], 'Dismiss').props.onClick();
  assert.deepEqual(h.calls, []);
  assert.equal(nodes(articles(h.render())[0]).filter(node => node.props.role === 'alert').length, 0);
  button(h.render(), 'Keep record').props.onClick();
  assert.deepEqual(h.calls, []);
  assert.equal(nodes(h.render()).filter(node => node.props.role === 'alert').length, 0);
  button(articles(h.render())[1], 'Dismiss').props.onClick();
  button(articles(h.render())[1], 'Open conversation').props.onClick();
  await settle();
  assert.deepEqual(h.calls, [['open', 'b-tab']]);
  const confirm = button(h.render(), 'Close page and remove record');
  confirm.props.onClick(); confirm.props.onClick();
  await settle();
  assert.deepEqual(h.calls, [['open', 'b-tab'], ['dismiss', 'b', 'same']]);
});

test('completed continuation and unavailable document keep direct dismissal', async () => {
  for (const changes of [{ phase: 'completed' }, { canOpen: false }]) {
    const h = harness([task('done', changes)]);
    button(h.render(), 'Dismiss').props.onClick(); await settle();
    assert.deepEqual(h.calls, [['dismiss', 'a', 'done']]);
  }
});

test('combined filters preserve order and records, clear restores all, hidden confirmations are discarded', () => {
  const tasks = [task('done', { phase: 'completed' }), task('active', { terminal: false, phase: 'responding', canDismiss: false }),
    task('uncertain', { phase: 'send-uncertain', accountId: 'b', accountName: 'Beta', model: null }),
    task('interrupted', { phase: 'interrupted', accountId: 'b', accountName: 'Beta' }), task('cancelled', { phase: 'cancelled' })];
  const before = JSON.stringify(tasks), h = harness(tasks);
  button(articles(h.render())[2], 'Dismiss').props.onClick();
  change(h, 'select', 0, 'attention');
  assert.deepEqual(traces(h.render()), ['trace-uncertain', 'trace-interrupted', 'trace-cancelled']);
  change(h, 'select', 1, 'b');
  change(h, 'input', 0, ' TRACE-UNCERTAIN ');
  assert.deepEqual(traces(h.render()), ['trace-uncertain']);
  assert.ok(text(h.render()).includes('1 of 5 available records'));
  assert.equal(nodes(h.render()).filter(node => node.props.role === 'alert').length, 0);
  change(h, 'input', 0, 'missing');
  assert.equal(articles(h.render()).length, 0);
  assert.ok(text(h.render()).includes('No matching tasks'));
  button(h.render(), 'Clear filters').props.onClick();
  assert.deepEqual(traces(h.render()), tasks.map(row => row.traceId));
  assert.deepEqual(h.calls, []); assert.equal(JSON.stringify(tasks), before);
  change(h, 'select', 0, 'active'); assert.deepEqual(traces(h.render()), ['trace-active']);
  change(h, 'select', 0, 'completed'); assert.deepEqual(traces(h.render()), ['trace-done']);
});

test('search matches account and model and filtered actions retain their owner', async () => {
  const h = harness([task('one'), task('two', { accountId: 'b', accountName: 'Beta', model: 'Pro', canOpen: false })]);
  change(h, 'input', 0, 'beta'); assert.deepEqual(traces(h.render()), ['trace-two']);
  change(h, 'input', 0, 'pRo'); assert.deepEqual(traces(h.render()), ['trace-two']);
  button(h.render(), 'Dismiss').props.onClick(); await settle();
  assert.deepEqual(h.calls, [['dismiss', 'b', 'two']]);
});

test('history failure stays visible across filtering and supplies accounts without records in all six languages', () => {
  for (const language of ['en', 'ru', 'zh-CN', 'zh-TW', 'ja', 'ko']) {
    const h = harness([task('one')], { language, historyHealth: [{ accountId: 'b', accountName: 'Unavailable account', issue: 'task-history-unavailable' }] });
    change(h, 'select', 1, 'b');
    assert.equal(articles(h.render()).length, 0);
    const warning = nodes(h.render()).find(node => node.props.role === 'status' && text(node).includes('Unavailable account'));
    assert.ok(warning); assert.ok(text(warning).length > 'Unavailable account: '.length);
    assert.ok(find(h.render(), 'option', 'Unavailable account'));
    assert.deepEqual(h.calls, []);
  }
  const h = harness([], { historyHealth: [{ accountId: 'a', accountName: 'Alpha', issue: 'task-history-unavailable' }] });
  assert.ok(!text(h.render()).includes('No recorded tasks'));
});

test('disabled or revoked capabilities cannot confirm; dismissal failure reports error and preserves confirmation', async () => {
  const failure = new Error('Failed');
  const h = harness([task('one')], { dismiss: async () => { throw failure; } });
  button(h.render(), 'Dismiss').props.onClick();
  h.props.disabled = true;
  const confirm = button(h.render(), 'Close page and remove record');
  assert.equal(confirm.props.disabled, true); confirm.props.onClick(); await settle();
  assert.deepEqual(h.errors, []);
  h.props.disabled = false;
  button(h.render(), 'Close page and remove record').props.onClick(); await settle();
  assert.deepEqual(h.errors, [failure]); assert.ok(button(h.render(), 'Keep record'));
  h.props.tasks = [task('one', { canDismiss: false })];
  assert.equal(nodes(h.render()).filter(node => node.props.role === 'alert').length, 0);
});
