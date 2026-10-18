import { afterEach, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { createCodexClientControl } = require('../launcher/electron/codex-client-control.cjs');
const { registerCodexClientControlIpc } = require('../launcher/electron/ipc/codex-client-control.cjs');
import { mergeNativeThreads, nativeThreadRows } from '../launcher/src/native-threads-model';

const ROOT = '0199a001-0000-7000-8000-000000000001';
const CHILD = '0199a001-0000-7000-8000-000000000002';
const directories: string[] = [];
afterEach(() => { while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true }); });
function thread(id = ROOT, extra: any = {}) {
  return { id, sessionId: ROOT, parentThreadId: null, forkedFromId: null,
    name: 'Example', status: { type: 'notLoaded' }, turns: [{ private: 'turn content' }],
    path: '/private/rollout.jsonl', preview: 'Private prompt', ...extra };
}
function fixture(options: any = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'nekodex-fork-journal-test-')); directories.push(directory);
  const received: any[] = [], launches: any[] = [], terminations: any[] = [];
  const child: any = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let input = '';
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    input += chunk.toString();
    for (;;) {
      const newline = input.indexOf('\n'); if (newline < 0) break;
      const message = JSON.parse(input.slice(0, newline)); input = input.slice(newline + 1);
      received.push(message);
      if (message.method === 'initialize') queueMicrotask(() => respond(message, {
        userAgent: 'codex-cli/0.163.0', codexHome: options.responseHome || '/fixture/codex',
      }));
    }
    callback();
  } });
  const close = () => { child.exitCode = 0; child.emit('close', 0, null); };
  if (!options.holdClose) child.stdin.on('finish', close);
  const respond = (message: any, result: any) => child.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
  const reject = (message: any, code: number) => child.stdout.write(`${JSON.stringify({ id: message.id,
    error: { code, message: 'private provider details', data: { secret: 'never show' } } })}\n`);
  const client = createCodexClientControl({ executable: '/fixture/codex-bin', codexHome: '/fixture/codex',
    journalPath: join(directory, 'native-thread-control', 'forks.json'),
    environment: { PATH: '/fixture/bin', CODEX_HOME: '/wrong', CODEX_THREAD_ID: ROOT },
    requestTimeoutMs: 1000, stopGraceMs: 5, ...options,
    spawnProcess: (...args: any[]) => { launches.push(args); return child; },
    terminateProcess: (_process: any, signal: string) => { terminations.push(signal); close(); },
  });
  const next = async (method: string, count = 1) => {
    for (let i = 0; i < 50; i++) {
      const matches = received.filter(row => row.method === method);
      if (matches.length >= count) return matches[count - 1];
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    throw new Error(`Fixture never reached ${method}`);
  };
  return { client, child, received, launches, respond, reject, next, close, terminations, directory };
}

test('metadata requests correlate out-of-order replies and preserve native tree/status without content', async () => {
  const f = fixture();
  try {
    const listing = f.client.listThreads({ limit: 2, cursor: 'page-two' });
    const reading = f.client.readThread(CHILD);
    const list = await f.next('thread/list'), read = await f.next('thread/read');
    expect(list.params).toMatchObject({ cursor: 'page-two', limit: 2 });
    expect(list.params.sourceKinds).toContain('subAgentThreadSpawn');
    expect(read.params).toEqual({ threadId: CHILD, includeTurns: false });
    f.respond(read, { thread: thread(CHILD, { parentThreadId: ROOT, agentNickname: 'Reader',
      status: { type: 'active', activeFlags: ['waitingOnApproval'] } }) });
    f.respond(list, { data: [thread()], nextCursor: 'page-three' });
    const detail = await reading, page = await listing;
    expect(detail.thread).toMatchObject({ id: CHILD, parentThreadId: ROOT, agentNickname: 'Reader',
      status: { type: 'active', activeFlags: ['waitingOnApproval'] } });
    expect(page).toMatchObject({ nextCursor: 'page-three', statusScope: 'connection' });
    expect(JSON.stringify([page, detail])).not.toMatch(/private|turn content|Private prompt/);
    expect(f.launches[0][1]).toEqual(['app-server', '--stdio']);
    expect(f.launches[0][2].env.CODEX_HOME).toBe('/fixture/codex');
    expect(f.launches[0][2].env.CODEX_THREAD_ID).toBeUndefined();
    expect(f.client.snapshot().capabilities).toMatchObject({ list: 'supported', read: 'supported', approve: false });
  } finally { await f.client.destroy(); }
});

test('fork requires user action, preserves native policies and returns the new fork receipt', async () => {
  const f = fixture({ controlSocket: '/fixture/control.sock' });
  try {
    await expect(f.client.forkThread({ threadId: ROOT })).rejects.toMatchObject({ code: 'user_action_required' });
    expect(f.launches).toHaveLength(0);
    const promise = f.client.forkThread({ threadId: ROOT, userInitiated: true });
    const request = await f.next('thread/fork');
    expect(f.client.currentOperation()).toBe('Creating native Codex fork');
    expect(request.params).toEqual({ threadId: ROOT, excludeTurns: true });
    f.respond(request, { thread: thread(CHILD, { forkedFromId: ROOT }),
      instructionSources: ['/private/AGENTS.md'], baseInstructions: 'private instructions' });
    expect(await promise).toMatchObject({ thread: { id: CHILD, forkedFromId: ROOT }, statusScope: 'configured-server' });
    expect(f.client.currentOperation()).toBeNull();
    expect(f.launches[0][1]).toEqual(['app-server', 'proxy', '--sock', '/fixture/control.sock']);
    f.child.stdout.write(`${JSON.stringify({ method: 'item/commandExecution/requestApproval', id: 900,
      params: { command: 'private' } })}\n`);
    expect(f.received.at(-1)).toEqual({ id: 900, error: { code: -32601,
      message: 'This client does not handle server requests' } });
  } finally { await f.client.destroy(); }
});

test('cancelled metadata reads settle locally and late replies cannot satisfy another read', async () => {
  const f = fixture();
  try {
    const aborter = new AbortController();
    const cancelled = f.client.readThread(ROOT, { signal: aborter.signal });
    const first = await f.next('thread/read'); aborter.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' });
    const reading = f.client.readThread(CHILD);
    const second = await f.next('thread/read', 2);
    f.respond(first, { thread: thread() });
    f.respond(second, { thread: thread(CHILD) });
    expect((await reading).thread.id).toBe(CHILD);
    expect(f.received.some(row => row.method?.includes('interrupt'))).toBe(false);
  } finally { await f.client.destroy(); }
});

test('process close rejects pending reads and uncertain fork without retrying a mutation', async () => {
  const f = fixture();
  const reading = f.client.readThread(ROOT);
  const forking = f.client.forkThread({ threadId: ROOT, userInitiated: true });
  const outcomes = Promise.allSettled([reading, forking]);
  await f.next('thread/read'); await f.next('thread/fork'); f.close();
  expect(await outcomes).toMatchObject([
    { status: 'rejected', reason: { code: 'client_closed' } },
    { status: 'rejected', reason: { code: 'fork_outcome_unknown' } },
  ]);
  expect(f.received.filter(row => row.method === 'thread/fork')).toHaveLength(1);
  await f.client.destroy();
});

test('unsupported methods and provider failures are explicit and redact private server details', async () => {
  const f = fixture();
  try {
    const forking = f.client.forkThread({ threadId: ROOT, userInitiated: true });
    f.reject(await f.next('thread/fork'), -32601);
    await expect(forking).rejects.toMatchObject({ code: 'rpc_error', rpcCode: -32601 });
    expect(f.client.snapshot().capabilities.fork).toBe('unsupported');
    const reading = f.client.readThread(ROOT);
    f.reject(await f.next('thread/read'), -32000);
    let caught: any; try { await reading; } catch (reason) { caught = reason; }
    expect(caught.message).toBe('Codex rejected the request');
    expect(JSON.stringify(caught)).not.toMatch(/private|secret/);
  } finally { await f.client.destroy(); }
});

test('timeout reports uncertain fork and destroy settles its exact owned child', async () => {
  const f = fixture({ requestTimeoutMs: 30, holdClose: true });
  const forking = f.client.forkThread({ threadId: ROOT, userInitiated: true });
  await f.next('thread/fork');
  await expect(forking).rejects.toMatchObject({ code: 'fork_outcome_unknown', cause: { code: 'rpc_timeout' } });
  expect(f.client.currentOperation()).toBeNull();
  await f.client.destroy();
  expect(f.terminations).toEqual(['SIGTERM']);
  expect(f.client.snapshot().state).toBe('closed');
});

test('wrong home fails closed; oversized split lines close the owned transport', async () => {
  const mismatch = fixture({ responseHome: '/another/home' });
  await expect(mismatch.client.connect()).rejects.toMatchObject({ code: 'home_mismatch' });
  expect(mismatch.received.some(row => row.method === 'initialized')).toBe(false);
  await mismatch.client.destroy();
  const f = fixture({ maxLineBytes: 512 });
  const reading = f.client.readThread(ROOT);
  await f.next('thread/read');
  f.child.stdout.write('x'.repeat(300)); f.child.stdout.write('y'.repeat(300));
  await expect(reading).rejects.toMatchObject({ code: 'response_too_large' });
  await f.client.destroy();
  expect(f.client.snapshot().state).toBe('closed');
});

test('IPC admits metadata parameters only, keeps trusted process configuration private, and sanitizes errors', async () => {
  const handlers = new Map<string, Function>();
  const calls: any[] = [];
  const client = { snapshot: () => ({ state: 'disconnected' }),
    listThreads: async (params: any) => { calls.push(['list', params]); return { data: [], nextCursor: null }; },
    readThread: async () => { throw Object.assign(new Error('/private/account/auth.json secret-provider-value'), { code: 'transport_error' }); },
    forkThread: async (params: any) => { calls.push(['fork', params]); return { thread: { id: CHILD } }; },
    acknowledgeFork: (params: any) => { calls.push(['acknowledge', params]); return { uncertainForks: [] }; } };
  registerCodexClientControlIpc({ handle: (channel: string, handler: Function) => handlers.set(channel, handler), getClient: () => client });
  const invoke = (channel: string, ...args: any[]) => handlers.get(`launcher:${channel}`)!({}, ...args);
  expect(await invoke('native-threads-snapshot', { executable: '/malicious' })).toMatchObject({ ok: false,
    error: { code: 'invalid_parameters' } });
  expect(await invoke('native-threads-list', { executable: '/malicious' })).toMatchObject({ ok: false });
  expect(await invoke('native-thread-fork', { threadId: ROOT, codexHome: '/another-account' })).toMatchObject({ ok: false });
  expect(await invoke('native-threads-list', { limit: 25 })).toMatchObject({ ok: true, value: { data: [] } });
  expect(await invoke('native-thread-fork', { threadId: ROOT })).toMatchObject({ ok: true, value: { thread: { id: CHILD } } });
  expect(calls).toEqual([['list', { limit: 25 }], ['fork', { threadId: ROOT, userInitiated: true }]]);
  const failed = await invoke('native-thread-read', ROOT);
  expect(failed).toEqual({ ok: false, error: { code: 'transport_error', message: 'The native Codex connection failed.' } });
  expect(JSON.stringify(failed)).not.toMatch(/private|auth.json|secret-provider/);
  expect(await invoke('native-thread-acknowledge-fork', { actionId: ROOT, threadId: CHILD, confirmedInspection: false }))
    .toMatchObject({ ok: false, error: { code: 'invalid_parameters' } });
  expect(await invoke('native-thread-acknowledge-fork', { actionId: ROOT, threadId: CHILD, confirmedInspection: true }))
    .toMatchObject({ ok: true, value: { uncertainForks: [] } });
});

test('tree display uses parent IDs, preserves missing parents and cycles, and keeps forks separate', () => {
  const forkId = '0199a001-0000-7000-8000-000000000003';
  const orphanId = '0199a001-0000-7000-8000-000000000004';
  const rows = [thread(CHILD, { parentThreadId: ROOT }), thread(forkId, { forkedFromId: ROOT }), thread(),
    thread(orphanId, { parentThreadId: '0199a001-0000-7000-8000-000000000099' })] as any;
  const tree = nativeThreadRows(rows);
  expect(tree.find(row => row.thread.id === CHILD)).toMatchObject({ depth: 1, parentMissing: false });
  expect(tree.find(row => row.thread.id === forkId)).toMatchObject({ depth: 0 });
  expect(tree.find(row => row.thread.id === orphanId)).toMatchObject({ depth: 0, parentMissing: true });
  expect(nativeThreadRows([thread(ROOT, { parentThreadId: CHILD }), thread(CHILD, { parentThreadId: ROOT })] as any))
    .toHaveLength(2);
  expect(mergeNativeThreads(rows, [thread(ROOT, { name: 'Fresh native title' })] as any)).toHaveLength(4);
  expect(mergeNativeThreads(rows, [thread(ROOT, { name: 'Fresh native title' })] as any).find(row => row.id === ROOT)?.name)
    .toBe('Fresh native title');
});

test('durable pending fork precedes dispatch and survives restart without replay until explicit source-bound inspection', async () => {
  const f = fixture({ requestTimeoutMs: 30 });
  const journalPath = join(f.directory, 'native-thread-control', 'forks.json');
  const forking = f.client.forkThread({ threadId: ROOT, userInitiated: true });
  await f.next('thread/fork');
  const pending = JSON.parse(readFileSync(journalPath, 'utf8')).records[0];
  expect(pending).toMatchObject({ threadId: ROOT, state: 'pending', source: { codexHome: '/fixture/codex' } });
  expect(statSync(journalPath).mode & 0o777).toBe(0o600);
  await expect(forking).rejects.toMatchObject({ code: 'fork_outcome_unknown' });
  await f.client.destroy();
  // Restore the exact pre-response durable bytes to model a process crash before
  // it could write any terminal outcome; there is no live fixture owner now.
  writeFileSync(journalPath, JSON.stringify({ version: 1, codexHome: '/fixture/codex', records: [pending] }), { mode: 0o600 });
  const reopened = fixture({ journalPath });
  expect(reopened.launches).toHaveLength(0);
  expect(reopened.client.snapshot().uncertainForks).toMatchObject([{ actionId: pending.actionId, threadId: ROOT,
    state: 'unknown', reasonCode: 'process_restarted' }]);
  await expect(reopened.client.forkThread({ threadId: ROOT, userInitiated: true }))
    .rejects.toMatchObject({ code: 'fork_reconciliation_required' });
  expect(reopened.received.some(row => row.method === 'thread/fork')).toBe(false);
  expect(() => reopened.client.acknowledgeFork({ actionId: pending.actionId, threadId: CHILD, confirmedInspection: true }))
    .toThrow('No matching unknown fork action');
  reopened.client.acknowledgeFork({ actionId: pending.actionId, threadId: ROOT, confirmedInspection: true });
  expect(reopened.client.snapshot().uncertainForks).toEqual([]);
  expect(JSON.parse(readFileSync(journalPath, 'utf8')).records[0].state).toBe('acknowledgedUnknown');
  const newFork = reopened.client.forkThread({ threadId: ROOT, userInitiated: true });
  const request = await reopened.next('thread/fork');
  reopened.respond(request, { thread: thread(CHILD, { forkedFromId: ROOT }) });
  const receipt = await newFork;
  expect(receipt.actionId).not.toBe(pending.actionId);
  const saved = JSON.parse(readFileSync(journalPath, 'utf8')).records;
  expect(saved[1]).toMatchObject({ actionId: receipt.actionId, threadId: ROOT, state: 'completed', forkId: CHILD });
  await reopened.client.destroy();
  const afterSuccess = fixture({ journalPath });
  expect(afterSuccess.client.snapshot().uncertainForks).toEqual([]);
  expect(afterSuccess.launches).toHaveLength(0);
  await afterSuccess.client.destroy();
});

test('receipt storage failure blocks dispatch, and post-response storage failure preserves the observed provider ID', async () => {
  const missing = fixture({ journalPath: undefined });
  await expect(missing.client.forkThread({ threadId: ROOT, userInitiated: true }))
    .rejects.toMatchObject({ code: 'fork_journal_unavailable' });
  expect(missing.launches).toHaveLength(0);
  await missing.client.destroy();
  const before = fixture();
  await before.client.connect();
  mkdirSync(join(before.directory, 'native-thread-control'), { mode: 0o755 });
  await expect(before.client.forkThread({ threadId: ROOT, userInitiated: true }))
    .rejects.toMatchObject({ code: 'fork_journal_unavailable' });
  expect(before.received.some(row => row.method === 'thread/fork')).toBe(false);
  await before.client.destroy();
  const f = fixture();
  const journalPath = join(f.directory, 'native-thread-control', 'forks.json');
  const forking = f.client.forkThread({ threadId: ROOT, userInitiated: true });
  const request = await f.next('thread/fork');
  const original = JSON.parse(readFileSync(journalPath, 'utf8'));
  expect(original.records[0].state).toBe('pending');
  writeFileSync(journalPath, 'external writer bytes', { mode: 0o600 });
  f.respond(request, { thread: thread(CHILD, { forkedFromId: ROOT }) });
  await expect(forking).rejects.toMatchObject({ code: 'fork_outcome_unknown' });
  expect(readFileSync(journalPath, 'utf8')).toBe('external writer bytes');
  expect(f.client.snapshot().uncertainForks).toMatchObject([{ actionId: original.records[0].actionId,
    threadId: ROOT, state: 'unknown', observedForkId: CHILD }]);
  await f.client.destroy();
});

test('invalid fork association retains its observed thread ID without inventing an authoritative receipt', async () => {
  const f = fixture();
  const forking = f.client.forkThread({ threadId: ROOT, userInitiated: true });
  const request = await f.next('thread/fork');
  f.respond(request, { thread: thread(CHILD, { forkedFromId: null }) });
  await expect(forking).rejects.toMatchObject({ code: 'fork_outcome_unknown' });
  expect(f.client.snapshot().uncertainForks).toMatchObject([{ threadId: ROOT, observedForkId: CHILD, state: 'unknown' }]);
  await f.client.destroy();
});
