const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Deterministic hook host: effects run after render, cleanup precedes replacement.
// DOM/focus integration remains in the parent's renderer fixture.
function host() {
  let cursor = 0; const slots = [], effects = [], cache = new Map();
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn) { return fn(); },
    useEffect(fn, deps) { const i = cursor++; const old = slots[i]; if (!old || deps.some((x,j) => x !== old.deps[j])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  react.useId = () => 'confirmation';
  react.useLayoutEffect = react.useEffect;
  const document = Object.assign(new EventTarget(), { hidden: false });
  const timers = new Map(); let nextTimer = 0;
  const window = Object.assign(new EventTarget(), { setInterval(fn, ms) { assert.equal(ms, 30000); timers.set(++nextTimer, fn); return nextTimer; }, clearInterval(id) { timers.delete(id); } });
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const base = path.resolve(__dirname, '../src', name);
    const filename = fs.existsSync(base + '.ts') ? base + '.ts' : base + '.tsx';
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} }; cache.set(name, module.exports);
    new Function('require','module','exports','window','document', output)(dep => dep === 'react' ? react : dep.endsWith('.css') ? {} : dep.startsWith('./') ? load(dep.slice(2)) : require(dep), module, module.exports, window, document);
    return module.exports;
  }
  return { load, document, window, tick: () => [...timers.values()].forEach(fn => fn()), render(fn) { cursor = 0; const result = fn(); effects.splice(0).forEach(fn => fn()); return result; } };
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
function report(source, selectedAccountId = null) { return { available: true, source, selectedAccountId, accounts: [], rows: [], calendar: [], failures: [], period: { startDay:'2026-09-22', endDay:'2026-09-22', days:1 }, metrics: { total:0, completed:0, failed:0, cancelled:0, unrecorded:0, knownOutcomeTotal:0, knownOutcomeCompletionRate:null }, durations: { observedSamples:0, medianMs:null,p95Ms:null } }; }

test('usage query disposal omits native account and ignores late Web response', async () => {
  const h=host(), {useUsageReport}=h.load('useUsageReport'); const calls=[];
  const load=query => { const d=deferred(); calls.push({query,...d}); return d.promise; };
  const render=()=>h.render(()=>useUsageReport(load,'unavailable'));
  let view=render(); view.changeFilters({days:7,source:'web',accountId:'A'}); view=render();
  view.changeFilters({days:7,source:'native',accountId:'A'}); render();
  assert.deepEqual(calls[2].query,{days:7,source:'native'});
  calls[2].resolve(report('native')); await settle();
  calls[1].resolve(report('web','A')); calls[0].resolve(report('web')); await settle();
  view=render(); assert.equal(view.visible.source,'native'); assert.equal(view.visibleError,null);
});
test('usage refresh coalesces focus/timer, retains data on rejection and recovers on retry', async () => {
  const h=host(), {useUsageReport}=h.load('useUsageReport'); const calls=[];
  const load=()=>{ const d=deferred(); calls.push(d); return d.promise; };
  const render=()=>h.render(()=>useUsageReport(load,'unavailable'));
  render(); h.tick(); h.window.dispatchEvent(new Event('focus')); assert.equal(calls.length,1);
  calls[0].resolve(report('web')); await settle();
  h.document.hidden=true; h.tick(); assert.equal(calls.length,1);
  h.document.hidden=false; h.window.dispatchEvent(new Event('focus')); assert.equal(calls.length,2);
  calls[1].reject(new Error('injected loader failure')); await settle();
  let view=render(); assert.equal(view.visible.source,'web'); assert.equal(view.visibleError,'unavailable'); assert.equal(view.refreshing,false);
  view.retry(); render(); assert.equal(calls.length,3); calls[2].resolve(report('web')); await settle();
  view=render(); assert.equal(view.visibleError,null);
});
test('action gate enters once synchronously, reports captured account and recovers after rejection', async () => {
  const h=host(), {useFeatureAction}=h.load('useFeatureAction'); const errors=[]; const fail=(e,id)=>errors.push([e.message,id]);
  const render=()=>h.render(()=>useFeatureAction(false,fail)); const d=deferred(); let entered=0;
  const a=render(); const first=a.run({accountId:'A',action:'close'},()=>{entered++;return d.promise;});
  await a.run({accountId:'B',action:'close'},async()=>{entered++;}); assert.equal(entered,1);
  assert.equal(render().pending.accountId,'A'); d.reject(new Error('close failed')); await first;
  assert.deepEqual(errors,[['close failed',{accountId:'A',action:'close'}]]); assert.equal(render().pending,null);
  await render().run({accountId:'B',action:'restore'},async()=>{entered++;}); assert.equal(entered,2);
});
test('task confirmation follows latest capabilities and visible account identity', () => {
  const {taskKey,eligibleTaskConfirmation,filterTasks}=host().load('task-center-model');
  const a={id:'same',accountId:'A',accountName:'Alpha',traceId:'trace',model:null,phase:'send-uncertain',terminal:true,canCancel:true,canOpen:true,canDismiss:true};
  const b={...a,accountId:'B'};
  for(const kind of ['cancel','dismiss']) {
    const target={kind,taskKey:taskKey(a)}; assert.deepEqual(eligibleTaskConfirmation([a,b],target),target);
    assert.equal(eligibleTaskConfirmation([b],target),null);
    assert.equal(eligibleTaskConfirmation([{...a,canCancel:false,canDismiss:false}],target),null);
    assert.equal(eligibleTaskConfirmation(filterTasks([a,b],{account:'B',status:'all',query:'',language:'en'}),target),null);
  }
});

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
test('workspace hides settled A failure on B and late A failure after removal', async () => {
  const h=host(), {BrowserWorkspaceManager}=h.load('BrowserWorkspaceManager');
  const account=id=>({accountId:id,label:id,items:[],manifestStatus:'uninitialized',restoreAttempted:false});
  const snapshot={accounts:[account('A'),account('B')],total:0,maximum:5,nativeTabs:false};
  const calls=[]; let response=deferred();
  const props={language:'en',snapshot,selectedAccountId:'A',onOpen:(id)=>{calls.push(id);return response.promise;},onRestore:async()=>{},onClose:async()=>{},onFocus:async()=>{}};
  const render=()=>h.render(()=>BrowserWorkspaceManager(props));
  const open=tree=>nodes(tree).find(n=>n.type==='button').props.onClick();
  const alert=tree=>nodes(tree).find(n=>n.props?.role==='alert');
  open(render()); assert.deepEqual(calls,['A']); response.reject(new Error('A failed')); await settle();
  assert.equal(alert(render()).props.children,'A failed');
  nodes(render()).find(n=>n.type==='select').props.onChange({target:{value:'B'}});
  assert.equal(alert(render()),undefined);
  nodes(render()).find(n=>n.type==='select').props.onChange({target:{value:'A'}});
  response=deferred(); open(render()); assert.deepEqual(calls,['A','A']);
  snapshot.accounts=[account('B')]; render(); response.reject(new Error('late A failure')); await settle();
  assert.equal(alert(render()),undefined);
  assert.equal(nodes(render()).find(n=>n.type==='button').props.disabled,false);
});

test('both Task Center confirmations forward exact task identity and keep distinct safe actions', async () => {
  for (const kind of ['cancel','dismiss']) {
    const h=host(), {TaskCenter}=h.load('TaskCenter'); const calls=[];
    const task={id:'record',accountId:'account',accountName:'Alpha',traceId:'trace',tabId:'tab',model:null,updatedAt:1,phase:'send-uncertain',terminal:true,canOpen:true,canCancel:true,canDismiss:true};
    const props={tasks:[task],language:'en',disabled:false,open:async()=>{},cancel:async(...args)=>calls.push(args),dismiss:async(...args)=>calls.push(args),onError:e=>{throw e;}};
    const render=()=>h.render(()=>TaskCenter(props));
    const label=kind==='cancel'?'Cancel this task':'Dismiss';
    nodes(render()).find(n=>n.type==='button' && n.props.children===label).props.onClick({currentTarget:{}});
    const confirmation=nodes(render()).find(n=>typeof n.type==='function' && n.props.kind===kind);
    assert.ok(confirmation); const panel=confirmation.type(confirmation.props);
    assert.equal(panel.props.role,'alertdialog');
    const buttons=nodes(panel).filter(n=>n.type==='button');
    assert.equal(buttons[1].props.children,kind==='cancel'?'Keep working':'Keep record');
    buttons[0].props.onClick(); await settle();
    assert.deepEqual(calls,[kind==='cancel'?['tab','trace']:['account','record']]);
    assert.equal(nodes(render()).some(n=>n.props.kind===kind),false);
  }
});
