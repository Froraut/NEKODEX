import { afterEach, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { createCodexThreadHandoff } = require('../launcher/electron/codex-thread-handoff.cjs');
const { registerCodexClientControlIpc } = require('../launcher/electron/ipc/codex-client-control.cjs');

const ROOT = '0199a001-0000-7000-8000-000000000001';
const CHILD = '0199a001-0000-7000-8000-000000000002';
const TURN = '0199a001-0000-7000-8000-0000000000aa';
const directories: string[] = [];
afterEach(() => { while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true }); });

type Handler = (message: any, child: any) => void;
/** Each explicit action spawns its own fake official app-server child. */
function fixture(handlers: Record<string, Handler>, options: any = {}) {
  const directory = options.directory || mkdtempSync(join(tmpdir(), 'nekodex-handoff-test-'));
  if (!options.directory) directories.push(directory);
  const received: any[] = [], launches: any[] = [], children: any[] = [];
  const spawn = (...args: any[]) => {
    launches.push(args);
    const child: any = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.respond = (message: any, result: any) => child.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
    child.reject = (message: any, code: number, text = 'private provider details') =>
      child.stdout.write(`${JSON.stringify({ id: message.id, error: { code, message: text, data: { secret: 'never show' } } })}\n`);
    child.notify = (method: string, params: any) => child.stdout.write(`${JSON.stringify({ method, params })}\n`);
    child.close = () => { if (!child.closed) { child.closed = true; child.emit('close', 0, null); } };
    let input = '';
    child.stdin = new Writable({ write(chunk, _encoding, callback) {
      input += chunk.toString();
      for (;;) {
        const newline = input.indexOf('\n'); if (newline < 0) break;
        const message = JSON.parse(input.slice(0, newline)); input = input.slice(newline + 1);
        received.push(message);
        if (message.method === 'initialize') queueMicrotask(() => child.respond(message, {
          userAgent: 'codex-cli/0.163.0', codexHome: '/fixture/codex' }));
        else if (message.method && handlers[message.method]) queueMicrotask(() => handlers[message.method]!(message, child));
      }
      callback();
    } });
    child.stdin.on('finish', () => child.close());
    children.push(child);
    return child;
  };
  const handoff = createCodexThreadHandoff({ executable: '/fixture/codex-bin', codexHome: '/fixture/codex',
    journalPath: join(directory, 'native-thread-control', 'handoffs.json'),
    environment: { PATH: '/fixture/bin', CODEX_THREAD_ID: CHILD }, requestTimeoutMs: 500, stopGraceMs: 5,
    turnTimeoutMs: 2000, interruptGraceMs: 200, ...options.config,
    spawnProcess: spawn, terminateProcess: (child: any) => child.close() });
  const journal = () => JSON.parse(readFileSync(join(directory, 'native-thread-control', 'handoffs.json'), 'utf8'));
  return { handoff, received, launches, children, directory, journal };
}
const root = (extra: any = {}) => ({ id: ROOT, parentThreadId: null, ephemeral: false, status: { type: 'notLoaded' }, ...extra });
const readRoot: Handler = (message, child) => child.respond(message, { thread: root() });
const resumeIdle: Handler = (message, child) => child.respond(message, { thread: root({ status: { type: 'idle' } }),
  model: 'gpt-test', instructionSources: ['/private/AGENTS.md'] });
const methods = (received: any[]) => received.map(row => row.method).filter(Boolean);

test('exclusive handoff resumes without overrides, sends one turn, refuses approvals and releases the writer', async () => {
  const f = fixture({ 'thread/read': readRoot, 'thread/resume': resumeIdle,
    'turn/start': (message, child) => {
      child.respond(message, { turn: { id: TURN, status: 'inProgress', items: [] } });
      setTimeout(() => {
        child.stdout.write(`${JSON.stringify({ method: 'item/commandExecution/requestApproval', id: 77, params: { threadId: ROOT, command: 'private' } })}\n`);
        child.notify('item/completed', { threadId: ROOT, turnId: TURN, completedAtMs: 1, item: { type: 'agentMessage', id: 'm1', text: 'commentary' } });
        child.notify('item/completed', { threadId: CHILD, turnId: TURN, completedAtMs: 1, item: { type: 'agentMessage', id: 'x', text: 'other thread' } });
        child.notify('item/completed', { threadId: ROOT, turnId: TURN, completedAtMs: 2, item: { type: 'agentMessage', id: 'm2', text: 'Final reply' } });
        child.notify('turn/completed', { threadId: ROOT, turn: { id: TURN, status: 'completed', items: [] } });
      }, 5);
    } });
  await expect(f.handoff.continueThread({ threadId: ROOT, text: 'hi' })).rejects.toMatchObject({ code: 'user_action_required' });
  await expect(f.handoff.continueThread({ threadId: ROOT, text: '  ', userInitiated: true })).rejects.toMatchObject({ code: 'invalid_parameters' });
  expect(f.launches).toHaveLength(0);
  const running = f.handoff.continueThread({ threadId: ROOT, text: 'Continue the plan', userInitiated: true });
  await new Promise(resolve => setTimeout(resolve, 1));
  expect(f.handoff.currentOperation()).toBe('Continuing a native Codex thread');
  const receipt = await running;
  expect(receipt).toEqual({ actionId: expect.any(String), threadId: ROOT, turnId: TURN, turnStatus: 'completed',
    approvalsRefused: 1, released: true, executionOwner: 'released', assistantText: 'Final reply', assistantTextTruncated: false });
  expect(methods(f.received)).toEqual(['initialize', 'initialized', 'thread/read', 'thread/resume', 'turn/start']);
  const resume = f.received.find(row => row.method === 'thread/resume');
  expect(resume.params).toEqual({ threadId: ROOT, excludeTurns: true });
  const start = f.received.find(row => row.method === 'turn/start');
  expect(start.params).toEqual({ threadId: ROOT, input: [{ type: 'text', text: 'Continue the plan', text_elements: [] }] });
  expect(f.received.find(row => row.id === 77)).toEqual({ id: 77, error: { code: -32601, message: 'This client does not handle server requests' } });
  // A dedicated owned stdio child per action, never a proxy to a shared daemon; closed afterwards.
  expect(f.launches).toHaveLength(1);
  expect(f.launches[0][1]).toEqual(['app-server', '--stdio']);
  expect(f.launches[0][2].env.CODEX_THREAD_ID).toBeUndefined();
  expect(f.children[0].closed).toBe(true);
  expect(f.handoff.currentOperation()).toBeNull();
  expect(f.handoff.snapshot()).toMatchObject({ available: true, exclusivity: 'codex-thread-writer-lock', approvals: 'refused',
    active: null, uncertainHandoffs: [] });
  const saved = f.journal();
  expect(saved.records[0]).toMatchObject({ threadId: ROOT, state: 'completed', phase: 'released', turnId: TURN,
    turnStatus: 'completed', approvalsRefused: 1 });
  expect(JSON.stringify(saved)).not.toMatch(/Continue the plan|Final reply|private/);
});

test('an external owner holding the writer lock is a known refusal: nothing is sent and nothing blocks', async () => {
  const f = fixture({ 'thread/read': readRoot,
    'thread/resume': (message, child) => child.reject(message, -32600, `thread ${ROOT} already has an active writer`) });
  await expect(f.handoff.continueThread({ threadId: ROOT, text: 'hello', userInitiated: true }))
    .rejects.toMatchObject({ code: 'handoff_owner_active', rpcCode: -32600 });
  expect(methods(f.received)).not.toContain('turn/start');
  expect(f.children[0].closed).toBe(true);
  expect(f.journal().records[0]).toMatchObject({ state: 'refused', reasonCode: 'owner_active', phase: 'acquiring' });
  expect(f.handoff.snapshot().uncertainHandoffs).toEqual([]);
  // Other rejections stay generic and never forward provider text.
  const g = fixture({ 'thread/read': readRoot, 'thread/resume': (message, child) => child.reject(message, -32600) });
  const failure = await g.handoff.continueThread({ threadId: ROOT, text: 'hello', userInitiated: true }).catch((reason: any) => reason);
  expect(failure).toMatchObject({ code: 'handoff_resume_rejected', rpcCode: -32600 });
  expect(JSON.stringify(failure)).not.toMatch(/private provider|never show/);
});

test('a thread that is not idle after acquisition, or a subagent thread, is refused before any send', async () => {
  const busy = fixture({ 'thread/read': readRoot, 'thread/resume': (message, child) => child.respond(message,
    { thread: root({ status: { type: 'active', activeFlags: [] } }) }) });
  await expect(busy.handoff.continueThread({ threadId: ROOT, text: 'hello', userInitiated: true }))
    .rejects.toMatchObject({ code: 'handoff_thread_not_idle' });
  expect(methods(busy.received)).not.toContain('turn/start');
  expect(busy.journal().records[0]).toMatchObject({ state: 'refused', reasonCode: 'thread_not_idle' });
  const child = fixture({ 'thread/read': (message, process) => process.respond(message, { thread: root({ parentThreadId: CHILD }) }) });
  await expect(child.handoff.continueThread({ threadId: ROOT, text: 'hello', userInitiated: true }))
    .rejects.toMatchObject({ code: 'handoff_subagent_thread' });
  expect(methods(child.received)).not.toContain('thread/resume');
});

test('a lost turn receipt is unknown, never replayed, and blocks that thread until explicit inspection', async () => {
  const f = fixture({ 'thread/read': readRoot, 'thread/resume': resumeIdle, 'turn/start': (_message, child) => child.close() });
  await expect(f.handoff.continueThread({ threadId: ROOT, text: 'hello', userInitiated: true }))
    .rejects.toMatchObject({ code: 'handoff_outcome_unknown' });
  expect(f.received.filter(row => row.method === 'turn/start')).toHaveLength(1);
  const [uncertain] = f.handoff.snapshot().uncertainHandoffs;
  expect(uncertain).toMatchObject({ threadId: ROOT, state: 'unknown', phase: 'dispatching', reasonCode: 'turn_outcome_unknown' });
  await expect(f.handoff.continueThread({ threadId: ROOT, text: 'again', userInitiated: true }))
    .rejects.toMatchObject({ code: 'handoff_reconciliation_required' });
  await expect(f.handoff.continueThread({ threadId: CHILD, text: 'other', userInitiated: true }))
    .rejects.toMatchObject({ code: 'handoff_busy' });
  expect(f.launches).toHaveLength(1);
  expect(() => f.handoff.acknowledge({ actionId: uncertain.actionId, threadId: CHILD, confirmedInspection: true })).toThrow();
  expect(f.handoff.acknowledge({ actionId: uncertain.actionId, threadId: ROOT, confirmedInspection: true }).uncertainHandoffs).toEqual([]);
  expect(f.journal().records[0]).toMatchObject({ state: 'acknowledgedUnknown' });
});

test('a turn that never settles is interrupted by its own owner; an unsettled turn stays unknown', async () => {
  const f = fixture({ 'thread/read': readRoot, 'thread/resume': resumeIdle,
    'turn/start': (message, child) => child.respond(message, { turn: { id: TURN, status: 'inProgress', items: [] } }),
    'turn/interrupt': (message, child) => { child.respond(message, {});
      child.notify('turn/completed', { threadId: ROOT, turn: { id: TURN, status: 'interrupted', items: [] } }); } },
  { config: { turnTimeoutMs: 1000 } });
  const receipt = await f.handoff.continueThread({ threadId: ROOT, text: 'long', userInitiated: true });
  expect(receipt).toMatchObject({ turnStatus: 'interrupted', assistantText: null, released: true });
  expect(f.received.find(row => row.method === 'turn/interrupt').params).toEqual({ threadId: ROOT, turnId: TURN });
  const g = fixture({ 'thread/read': readRoot, 'thread/resume': resumeIdle,
    'turn/start': (message, child) => child.respond(message, { turn: { id: TURN, status: 'inProgress', items: [] } }) },
  { config: { turnTimeoutMs: 1000 } });
  await expect(g.handoff.continueThread({ threadId: ROOT, text: 'long', userInitiated: true }))
    .rejects.toMatchObject({ code: 'handoff_outcome_unknown' });
  expect(g.handoff.snapshot().uncertainHandoffs[0]).toMatchObject({ phase: 'running', turnId: TURN, reasonCode: 'turn_unsettled' });
});

test('restart keeps pre-send records failed and post-dispatch records unknown without replay', async () => {
  const f = fixture({ 'thread/read': readRoot, 'thread/resume': resumeIdle,
    'turn/start': () => { /* Never answers: the owner disappears mid-dispatch. */ } }, { config: { requestTimeoutMs: 5000 } });
  const running = f.handoff.continueThread({ threadId: ROOT, text: 'hello', userInitiated: true }).catch(() => {});
  for (let i = 0; i < 100 && !f.received.some(row => row.method === 'turn/start'); i++) await new Promise(resolve => setTimeout(resolve, 2));
  expect(f.journal().records[0]).toMatchObject({ state: 'pending', phase: 'dispatching' });
  const reopened = fixture({}, { directory: f.directory });
  expect(reopened.handoff.snapshot().uncertainHandoffs[0]).toMatchObject({ state: 'unknown', reasonCode: 'process_restarted' });
  expect(reopened.launches).toHaveLength(0);
  await f.handoff.destroy(); await running;
});

test('IPC exposes only an explicit thread/text intent and sanitized handoff failures', async () => {
  const handlers = new Map<string, Function>();
  const calls: any[] = [];
  registerCodexClientControlIpc({ handle: (name: string, fn: Function) => handlers.set(name, fn), getClient: () => ({}),
    getHandoff: () => ({ snapshot: () => ({ available: true }),
      continueThread: async (params: any) => { calls.push(params);
        throw Object.assign(new Error('/private/path leaked'), { code: 'handoff_owner_active', rpcCode: -32600 }); },
      acknowledge: (params: any) => ({ acknowledged: params }) }) });
  const invoke = (channel: string, ...args: any[]) => handlers.get(`launcher:${channel}`)!({}, ...args);
  expect(await invoke('native-thread-continue', { threadId: ROOT, text: 'hi', executable: '/bin/sh' }))
    .toMatchObject({ ok: false, error: { code: 'invalid_parameters' } });
  expect(await invoke('native-thread-continue', { threadId: ROOT, text: '' })).toMatchObject({ ok: false, error: { code: 'invalid_text' } });
  const refused = await invoke('native-thread-continue', { threadId: ROOT, text: 'hi' });
  expect(refused).toMatchObject({ ok: false, error: { code: 'handoff_owner_active', rpcCode: -32600 } });
  expect(JSON.stringify(refused)).not.toMatch(/private\/path/);
  expect(calls).toEqual([{ threadId: ROOT, text: 'hi', userInitiated: true }]);
  expect(await invoke('native-thread-acknowledge-handoff', { actionId: ROOT, threadId: ROOT, confirmedInspection: false }))
    .toMatchObject({ ok: false });
  expect(await invoke('native-thread-handoff-snapshot')).toEqual({ ok: true, value: { available: true } });
  const bare = new Map<string, Function>();
  registerCodexClientControlIpc({ handle: (name: string, fn: Function) => bare.set(name, fn), getClient: () => ({}) });
  expect(await bare.get('launcher:native-thread-handoff-snapshot')!({})).toMatchObject({ ok: false, error: { code: 'handoff_unavailable' } });
});
