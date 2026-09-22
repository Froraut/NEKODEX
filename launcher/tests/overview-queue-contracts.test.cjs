const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');
const React = require('react');

// Same small element/handler harness used by account-settings-ui.test.cjs.
// Only decorative components and React hook storage are replaced; readiness is real.
function harness(file, component, props) {
  const state = [];
  let cursor = 0;
  const react = { ...React, useId: () => 'overview-test', useState(initial) {
    const index = cursor++;
    if (!(index in state)) state[index] = initial;
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
  } };
  const overrides = { react, './icons': { Icon: () => null }, './CatTail': { CatTail: () => null },
    './BrandMark': { BrandMark: () => null, CatHead: () => null, useCatReaction: () => ({}) } };
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const filename = path.join(__dirname, '../src', name);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX },
    }).outputText.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href));
    const loaded = { exports: {} };
    Function('module', 'exports', 'require', compiled)(loaded, loaded.exports, dependency =>
      Object.hasOwn(overrides, dependency) ? overrides[dependency]
        : dependency.startsWith('./') ? load(`${dependency.slice(2)}.ts`) : require(dependency));
    cache.set(name, loaded.exports);
    return loaded.exports;
  }
  const Component = load(file)[component];
  return { render() { cursor = 0; return Component(props); } };
}
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return [node?.props?.children].flat(Infinity).map(child => child && typeof child === 'object' ? text(child) : typeof child === 'string' || typeof child === 'number' ? String(child) : '').join('');
}
const flush = () => new Promise(resolve => setImmediate(resolve));

function modelRow(state, profile = 'default', catalogFailure = null) {
  const props = { copy: new Proxy({}, { get: (_, key) => key }), browser: null, catalogFailure,
    snapshot: { state: { language: 'en', browserInteractionMode: 'automatic', coreSetupComplete: true, ...state },
      profile, browserCapacity: { active: 1 } }, toolsReady: false, logs: [], navigate() {}, openTab() {} };
  return nodes(harness('Overview.tsx', 'Overview', props).render()).find(node =>
    node.type === 'button' && node.props['aria-label']?.startsWith('modelsConnectionTab:'));
}

test('installed Manual models do not require automatic catalog or picker proof', () => {
  const row = modelRow({ browserInteractionMode: 'manual', codexCatalogVerified: false, codexPickerConfirmed: false }, 'default', 'irrelevant automatic failure');
  assert.equal(row.props['aria-label'], 'modelsConnectionTab: setupInstalledTitle. manageShort');
});
test('Automatic DEV still needs catalog proof, but not picker confirmation', () => {
  assert.equal(modelRow({ codexCatalogVerified: false, codexPickerConfirmed: false }, 'development').props['aria-label'],
    'modelsConnectionTab: modelsWaitingShort. openRoutingChecks');
  assert.equal(modelRow({ codexCatalogVerified: true, codexPickerConfirmed: false }, 'development').props['aria-label'],
    'modelsConnectionTab: connectionVerified. manageShort');
});
test('missing installation, production picker proof, and catalog failures remain actionable', () => {
  assert.equal(modelRow({ coreSetupComplete: false, codexCatalogVerified: true, codexPickerConfirmed: true }).props['aria-label'],
    'modelsConnectionTab: connectionPending. openRoutingChecks');
  assert.equal(modelRow({ codexCatalogVerified: true, codexPickerConfirmed: false }).props['aria-label'],
    'modelsConnectionTab: modelsConfirmShort. openRoutingChecks');
  assert.equal(modelRow({ codexCatalogVerified: true, codexPickerConfirmed: true }, 'development', 'catalog failed').props['aria-label'],
    'modelsConnectionTab: catalogUnavailable. openRoutingChecks');
});

function queueHarness(queue, overrides = {}) {
  const calls = [];
  const props = { queue, language: 'en', disabled: false, action: async (...args) => calls.push(['action', ...args]),
    pause: async (...args) => calls.push(['pause', ...args]), onError: error => { throw error; }, ...overrides };
  return { ...harness('QueueControls.tsx', 'QueueControls', props), calls };
}
function queueState() {
  return { paused: true, pausedAccounts: ['a', 'b'], accounts: [{ id: 'a', label: 'Account A' }, { id: 'b', label: 'Account B' }], entries: [], storageIssue: null };
}
function button(view, prefix) {
  const found = nodes(view.render()).find(node => node.type === 'button' && text(node).startsWith(prefix));
  assert.ok(found, `missing button: ${prefix}`);
  return found;
}
test('account resume remains scoped and global notice survives an empty queue and account resume', async () => {
  const queue = queueState();
  const view = queueHarness(queue);
  nodes(view.render()).find(node => node.type === 'select').props.onChange({ target: { value: 'a' } });
  button(view, 'Resume new tasks · Account A').props.onClick();
  await flush();
  assert.deepEqual(view.calls, [['pause', 'a', false]]);
  queue.pausedAccounts = ['b']; // Updated snapshot after the account-only mutation.
  assert.match(text(view.render()), /New tasks are paused for all accounts/);
  assert.match(text(view.render()), /No tasks waiting/);
  button(view, 'Pause new tasks · Account A');
  button(view, 'Show all-account controls').props.onClick();
  assert.deepEqual(view.calls, [['pause', 'a', false]], 'scope navigation must never mutate pause state');
  assert.equal(nodes(view.render()).find(node => node.type === 'select').props.value, 'all');
  button(view, 'Resume new tasks · All accounts').props.onClick();
  await flush();
  assert.deepEqual(view.calls, [['pause', 'a', false], ['pause', null, false]]);
  assert.deepEqual(queue.pausedAccounts, ['b'], 'global control must not clear individual account pauses');
});
test('queue rows distinguish global and account blockers and notice follows global state', () => {
  const queue = queueState();
  queue.entries = ['paused-global', 'paused-account'].map((reason, index) => ({
    id: String(index), traceId: `trace-${index}`, accountId: 'a', status: 'waiting', reason, createdAt: index, position: index + 1,
  }));
  const view = queueHarness(queue);
  const reasons = nodes(view.render()).filter(node => node.type === 'article').map(article =>
    text(nodes(article).find(node => node.props?.role === 'status')));
  assert.deepEqual(reasons, ['Paused for all accounts', 'Paused for this account']);
  queue.paused = false;
  assert.doesNotMatch(text(view.render()), /New tasks are paused for all accounts/);
});
test('global pause notice is localized for every supported language', () => {
  for (const language of ['en', 'ru', 'zh-CN', 'zh-TW', 'ja', 'ko']) {
    const view = queueHarness(queueState(), { language });
    const status = nodes(view.render()).find(node => node.props?.role === 'status');
    assert.ok(text(status).length > 0, language);
    if (language !== 'en') assert.doesNotMatch(text(status), /New tasks are paused/);
  }
});
