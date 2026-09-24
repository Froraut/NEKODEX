const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');

// Same isolated hook/event harness used by account-settings-ui.test.cjs.
// Exercises component callbacks, without an app, provider or browser process.
const compiledModules = new Map();
function compile(filename) {
  if (!compiledModules.has(filename)) compiledModules.set(filename, ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  }).outputText);
  return compiledModules.get(filename);
}
// Expand the extracted, hook-free presentation component once per render so
// event traversal and the simulated ref commit observe the same element tree.
function presentationTree(tree) {
  if (Array.isArray(tree)) return tree.map(presentationTree);
  if (!React.isValidElement(tree)) return tree;
  if (typeof tree.type === 'function') return presentationTree(tree.type(tree.props));
  return { ...tree, props: { ...tree.props, children: presentationTree(tree.props.children) } };
}
function harness(tasks, overrides = {}) {
  const state = [], refs = [], effects = [], calls = [], errors = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  const react = { ...React,
    useMemo: create => create(),
    useId: () => 'task-confirmation',
    useLayoutEffect(setup, deps) {
      const i = effectIndex++;
      if (!effects[i] || deps.some((dep, index) => dep !== effects[i].deps[index])) {
        effects[i]?.cleanup?.();
        effects[i] = { setup, deps, changed: true };
      }
    },
    useState(initial) {
      const i = stateIndex++;
      if (!(i in state)) state[i] = initial;
      return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }];
    },
    useRef(initial) { const i = refIndex++; return refs[i] ??= { current: initial }; },
  };
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const loaded = { exports: {} };
    modules.set(filename, loaded);
    Function('module', 'exports', 'require', compile(filename))(loaded, loaded.exports, name => {
      if (name === 'react') return react;
      if (name.endsWith('.css')) return {};
      if (!name.startsWith('.')) return require(name);
      const base = path.resolve(path.dirname(filename), name);
      const resolved = [base, `${base}.ts`, `${base}.tsx`].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (!resolved) throw new Error(`Unresolved local test dependency: ${name} from ${filename}`);
      return load(resolved);
    });
    return loaded.exports;
  }
  const { TaskCenter } = load(path.join(__dirname, '../src/TaskCenter.tsx'));
  const props = { tasks, language: 'en', disabled: false,
    open: async (...args) => calls.push(['open', ...args]),
    cancel: async (...args) => calls.push(['cancel', ...args]),
    dismiss: async (...args) => calls.push(['dismiss', ...args]),
    onError: error => errors.push(error), ...overrides };
  return { calls, errors, props, render(commit = () => {}) {
    stateIndex = refIndex = effectIndex = 0;
    const tree = presentationTree(TaskCenter(props));
    commit(tree);
    for (const effect of effects) if (effect.changed) { effect.changed = false; effect.cleanup = effect.setup(); }
    return tree;
  } };
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
  button(articles(h.render())[1], 'Dismiss').props.onClick({ currentTarget: null });
  assert.deepEqual(h.calls, []);
  assert.equal(nodes(articles(h.render())[0]).filter(node => node.props.role === 'alertdialog').length, 0);
  button(h.render(), 'Keep record').props.onClick({ currentTarget: null });
  assert.deepEqual(h.calls, []);
  assert.equal(nodes(h.render()).filter(node => node.props.role === 'alertdialog').length, 0);
  button(articles(h.render())[1], 'Dismiss').props.onClick({ currentTarget: null });
  button(articles(h.render())[1], 'Open conversation').props.onClick({ currentTarget: null });
  await settle();
  assert.deepEqual(h.calls, [['open', 'b-tab']]);
  const confirm = button(h.render(), 'Close page and remove record');
  confirm.props.onClick({ currentTarget: null }); confirm.props.onClick({ currentTarget: null });
  await settle();
  assert.deepEqual(h.calls, [['open', 'b-tab'], ['dismiss', 'b', 'same']]);
});

test('completed continuation and unavailable document keep direct dismissal', async () => {
  for (const changes of [{ phase: 'completed' }, { canOpen: false }]) {
    const h = harness([task('done', changes)]);
    button(h.render(), 'Dismiss').props.onClick({ currentTarget: null }); await settle();
    assert.deepEqual(h.calls, [['dismiss', 'a', 'done']]);
  }
});

test('combined filters preserve order and records, clear restores all, hidden confirmations are discarded', () => {
  const tasks = [task('done', { phase: 'completed' }), task('active', { terminal: false, phase: 'responding', canDismiss: false }),
    task('uncertain', { phase: 'send-uncertain', accountId: 'b', accountName: 'Beta', model: null }),
    task('interrupted', { phase: 'interrupted', accountId: 'b', accountName: 'Beta' }), task('cancelled', { phase: 'cancelled' })];
  const before = JSON.stringify(tasks), h = harness(tasks);
  button(articles(h.render())[2], 'Dismiss').props.onClick({ currentTarget: null });
  change(h, 'select', 0, 'attention');
  assert.deepEqual(traces(h.render()), ['trace-uncertain', 'trace-interrupted', 'trace-cancelled']);
  change(h, 'select', 1, 'b');
  change(h, 'input', 0, ' TRACE-UNCERTAIN ');
  assert.deepEqual(traces(h.render()), ['trace-uncertain']);
  assert.ok(text(h.render()).includes('1 of 5 available records'));
  assert.equal(nodes(h.render()).filter(node => node.props.role === 'alertdialog').length, 0);
  change(h, 'input', 0, 'missing');
  assert.equal(articles(h.render()).length, 0);
  assert.ok(text(h.render()).includes('No matching tasks'));
  button(h.render(), 'Clear filters').props.onClick({ currentTarget: null });
  assert.deepEqual(traces(h.render()), tasks.map(row => row.traceId));
  assert.deepEqual(h.calls, []); assert.equal(JSON.stringify(tasks), before);
  change(h, 'select', 0, 'active'); assert.deepEqual(traces(h.render()), ['trace-active']);
  change(h, 'select', 0, 'completed'); assert.deepEqual(traces(h.render()), ['trace-done']);
});

test('search matches account and model and filtered actions retain their owner', async () => {
  const h = harness([task('one'), task('two', { accountId: 'b', accountName: 'Beta', model: 'Pro', canOpen: false })]);
  change(h, 'input', 0, 'beta'); assert.deepEqual(traces(h.render()), ['trace-two']);
  change(h, 'input', 0, 'pRo'); assert.deepEqual(traces(h.render()), ['trace-two']);
  button(h.render(), 'Dismiss').props.onClick({ currentTarget: null }); await settle();
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
  button(h.render(), 'Dismiss').props.onClick({ currentTarget: null });
  h.props.disabled = true;
  const confirm = button(h.render(), 'Close page and remove record');
  assert.equal(confirm.props.disabled, true); confirm.props.onClick({ currentTarget: null }); await settle();
  assert.deepEqual(h.errors, []);
  h.props.disabled = false;
  button(h.render(), 'Close page and remove record').props.onClick({ currentTarget: null }); await settle();
  assert.deepEqual(h.errors, [failure]); assert.ok(button(h.render(), 'Keep record'));
  h.props.tasks = [task('one', { canDismiss: false })];
  assert.equal(nodes(h.render()).filter(node => node.props.role === 'alertdialog').length, 0);
});

// Minimal DOM focus boundary: React commits refs before layout effects, and
// removes the old panel after its cleanup. No app/browser/provider is launched.
function focusHarness(h) {
  const document = { activeElement: null, body: {} };
  const control = () => ({ isConnected: true, disabled: false, focus() { document.activeElement = this; } });
  const trigger = control(), keep = control(), search = control();
  const panel = { ownerDocument: document, contains: node => node === keep };
  let hadPanel = false;
  return { document, trigger, keep, search,
    render() {
      return h.render(tree => {
        find(tree, 'input').props.ref.current = search;
        const dialog = nodes(tree).find(node => node.props.role === 'alertdialog');
        if (dialog) {
          dialog.props.ref.current = panel;
          nodes(dialog).find(node => node.type === 'button' && node.props.ref).props.ref.current = keep;
        } else if (hadPanel && document.activeElement === keep) document.activeElement = document.body;
        hadPanel = !!dialog;
      });
    },
  };
}

test('both confirmations focus the safe choice; Escape and Keep restore their trigger without acting', async () => {
  for (const cancellation of [false, true]) {
    const h = harness([task('one', cancellation ? { terminal: false, canCancel: true, canDismiss: false, phase: 'responding' } : {})]);
    const f = focusHarness(h);
    const start = cancellation ? 'Cancel this task' : 'Dismiss';
    button(f.render(), start).props.onClick({ currentTarget: f.trigger });
    let tree = f.render();
    assert.equal(f.document.activeElement, f.keep);
    const dialog = nodes(tree).find(node => node.props.role === 'alertdialog');
    assert.equal(nodes(dialog).find(node => node.type === 'p').props.id, dialog.props['aria-describedby']);
    dialog.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    f.render(); await settle();
    assert.equal(f.document.activeElement, f.trigger);
    assert.deepEqual(h.calls, []);
    button(f.render(), start).props.onClick({ currentTarget: f.trigger });
    tree = f.render();
    button(tree, cancellation ? 'Keep working' : 'Keep record').props.onClick();
    f.render(); await settle();
    assert.equal(f.document.activeElement, f.trigger);
    assert.deepEqual(h.calls, []);
  }
});

test('live row removal falls back to search, while filtering preserves the user focus', async () => {
  const h = harness([task('one')]), f = focusHarness(h);
  button(f.render(), 'Dismiss').props.onClick({ currentTarget: f.trigger }); f.render();
  h.props.tasks = [];
  // A child deletion can return focus to body before the parent's cleanup.
  f.document.activeElement = f.document.body;
  f.render(); f.trigger.isConnected = false;
  await settle(); assert.equal(f.document.activeElement, f.search);

  h.props.tasks = [task('two')]; f.trigger.isConnected = true;
  button(f.render(), 'Dismiss').props.onClick({ currentTarget: f.trigger }); f.render();
  f.search.focus();
  find(f.render(), 'input').props.onChange({ target: { value: 'missing' } });
  f.render(); await settle();
  assert.equal(f.document.activeElement, f.search);
  assert.deepEqual(h.calls, []);
});
