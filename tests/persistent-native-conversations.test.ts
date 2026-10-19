import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync, realpathSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { createOwnedNativeAccountServer } = require('../launcher/electron/owned-native-worker.cjs');
const { createPersistentNativeConversations } = require('../launcher/electron/persistent-native-conversations.cjs');
const { compileAgentNativeOutputSchema } = require('../launcher/electron/agent-native-bridge.cjs');

async function fixture(capacity = 3) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'neko-persistent-conversations-')));
  const paths = { home: join(root, 'home'), codexHome: join(root, 'codex'), cwd: join(root, 'home', 'work') };
  for (const value of Object.values(paths)) mkdirSync(value, { recursive: true, mode: 0o700 });
  const methods: any[] = [], histories = new Map<string, string[]>(), receipts: any[] = [];
  let launches = 0, held: (() => void) | undefined, holdNext = false, rejectNextCreate = false, processClosed = false;
  let admissionId = 'a'.repeat(64); const model = 'synthetic-model';
  const profileId = randomUUID(), epoch = randomUUID();
  const historySource = { profileId, authEpoch: epoch, backendAccountId: 'synthetic-account', sourceId: 'c'.repeat(64) };
  const forkParents = new Map<string, string | null>();
  let emitThreadClose: ((id: string) => void) | undefined, holdResume = false, resumeSeen: (() => void) | undefined;
  const admission: any = { paths, historySource, provider: 'openai', serverGeneration: randomUUID(), compileOutputSchema: compileAgentNativeOutputSchema,
    prestart: () => ({ executable: '/inert-owned-wrapper', args: ['--stdio'], paths, environment: {} }),
    checkEffective() {}, checkAccount() {},
    forBinding(binding: any) { return { ...admission, admissionId, modelId: model, imageInput: false,
      paths: { ...paths, journal: join(root, 'journals', binding.workerBindingId) }, availability: () => ({ available: true, reasonCode: null }) }; },
  };
  const serverOptions = { admission, maxConcurrentThreads: capacity, requestTimeoutMs: 50, terminalTimeoutMs: 50, stopGraceMs: 20,
    testHooks: { spawnProcess() {
      launches++; processClosed = false;
      const child: any = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      const response = (request: any, result: any) => child.stdout.write(JSON.stringify({ id: request.id, result }) + '\n');
      const event = (method: string, params: any) => child.stdout.write(JSON.stringify({ method, params }) + '\n');
      emitThreadClose = (threadId: string) => event('thread/closed', { threadId });
      child.stdin = new Writable({ write(chunk, _encoding, done) {
        const request = JSON.parse(chunk.toString()); methods.push(request);
        queueMicrotask(() => {
          if (request.method === 'initialize') response(request, { codexHome: paths.codexHome, userAgent: 'synthetic-persistent' });
          if (request.method === 'config/read') response(request, { config: {}, layers: [] });
          if (request.method === 'configRequirements/read') response(request, { requirements: null });
          if (request.method === 'account/read') response(request, { account: {} });
          if (request.method === 'account/rateLimits/read') response(request, {});
          if (request.method === 'thread/start' || request.method === 'thread/fork' || request.method === 'thread/resume') {
            if (rejectNextCreate) { rejectNextCreate = false; child.stdout.write(JSON.stringify({ id: request.id, error: { code: -32600, message: 'Synthetic known rejection' } }) + '\n'); return; }
            const params = request.params, resumed = request.method === 'thread/resume', id = resumed ? params.threadId : randomUUID();
            if (resumed && holdResume) { holdResume = false; resumeSeen?.(); return; }
            if (!resumed) { histories.set(id, params.threadId ? [...histories.get(params.threadId)!] : []); forkParents.set(id, params.threadId ?? null); }
            response(request, { thread: { id, ephemeral: resumed ? false : params.ephemeral, forkedFromId: forkParents.get(id) ?? null, parentThreadId: null, status: { type: 'idle' } },
              model, modelProvider: 'openai', approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: { type: 'readOnly' }, cwd: paths.cwd, instructionSources: [] });
          }
          if (request.method === 'turn/start') {
            const params = request.params, turnId = randomUUID(), threadId = params.threadId;
            histories.get(threadId)!.push(params.input[0].text);
            response(request, { turn: { id: turnId } });
            const finish = () => {
              event('item/completed', { threadId, turnId, completedAtMs: Date.now(), item: { type: 'userMessage', id: randomUUID(), clientId: params.clientUserMessageId, content: params.input } });
              event('item/completed', { threadId, turnId, completedAtMs: Date.now(), item: { type: 'agentMessage', id: randomUUID(), phase: 'final_answer', text: JSON.stringify({ protocol: 'neko-agent-v1', kind: 'final', requestId: null, toolId: null, argumentsJson: null, summary: `Observed ${params.input[0].text}` }) } });
              event('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
            };
            if (holdNext) { holdNext = false; held = finish; } else finish();
          }
          if (request.method === 'thread/unsubscribe') { response(request, {}); event('thread/closed', { threadId: request.params.threadId }); }
        }); done();
      } });
      child.stdin.on('finish', () => { processClosed = true; child.emit('close', 0, null); });
      return child;
    } },
  };
  let server = createOwnedNativeAccountServer(serverOptions);
  // Production publishes an execution context only after account preparation, without a thread or turn.
  await server.prepare();
  let context: any = { server, models: [{ id: model, admissionId, historySource }], profileId, epoch, serverGeneration: admission.serverGeneration };
  let expectedContext = { profileId: context.profileId, epoch: context.epoch, serverGeneration: context.serverGeneration };
  const storageRoot = join(root, 'persistent');
  let service = createPersistentNativeConversations({ getExecution: () => context, storageRoot });
  const create = (text = 'first') => ({ actionId: randomUUID(), model, text, retainContext: true, expectedContext });
  return { root, get server() { return server; }, get service() { return service; }, methods, histories, get expectedContext() { return expectedContext; }, create, storageRoot, launches: () => launches, hold: () => { holdNext = true; },
    emitOldClose: (threadId: string) => emitThreadClose!(threadId),
    holdResume: () => { holdResume = true; return new Promise<void>(resolve => { resumeSeen = resolve; }); },
    async restart() {
      await Promise.all([service.destroy(), server.destroy()]);
      admission.serverGeneration = randomUUID(); admissionId = 'b'.repeat(64); server = createOwnedNativeAccountServer(serverOptions);
      await server.prepare();
      context = { ...context, server, serverGeneration: admission.serverGeneration, models: [{ id: model, admissionId, historySource }] };
      expectedContext = { profileId, epoch, serverGeneration: admission.serverGeneration };
      service = createPersistentNativeConversations({ getExecution: () => context, storageRoot });
    },
    rejectCreate: () => { rejectNextCreate = true; },
    release: () => { held!(); held = undefined; }, switchContext: () => { context = { ...context, epoch: randomUUID() }; },
    async close() { await Promise.all([service.destroy(), server.destroy()]); expect(processClosed || launches === 0).toBe(true); rmSync(root, { recursive: true, force: true }); } };
}

test('explicit persistent ownership keeps same-thread followup and fork context without changing ephemeral defaults', async () => {
  const f = await fixture();
  try {
    expect(f.service.list().conversations).toEqual([]); expect(f.launches()).toBe(1);
    expect(f.server.inspect()).toMatchObject({ ready: true, accepting: true });
    expect(f.methods.some(row => row.method.startsWith('thread/') || row.method.startsWith('turn/'))).toBe(false);
    const denied = { ...f.create(), retainContext: false };
    await expect(f.service.create(denied)).rejects.toMatchObject({ actionRecorded: false }); expect(f.launches()).toBe(1);
    expect(f.methods.some(row => row.method.startsWith('thread/') || row.method.startsWith('turn/'))).toBe(false);
    const first = f.create(); expect((await f.service.create(first)).busy).toBe(false);
    const original = f.service.list().conversations[0]; expect(original).toMatchObject({ status: 'idle', revision: 1, lastSummary: 'Observed first' });
    const turnCount = () => f.methods.filter(row => row.method === 'turn/start').length;
    await expect(f.server.persistentOperation(async (operation: any) => operation.createWorker({ workerBindingId: randomUUID(), admissionId: 'a'.repeat(64), model: 'synthetic-model' }, undefined, randomUUID()))).rejects.toThrow('exact idle persistent conversation');
    await f.service.create(first); expect(turnCount()).toBe(1);
    await expect(f.service.send({ actionId: randomUUID(), conversationId: original.id, revision: 0, text: 'stale', expectedContext: f.expectedContext })).rejects.toMatchObject({ actionRecorded: false });
    expect((await f.service.send({ actionId: randomUUID(), conversationId: original.id, revision: 1, text: 'second', expectedContext: f.expectedContext })).busy).toBe(false);
    expect(f.histories.get(original.threadId)).toEqual(['first', 'second']);
    expect((await f.service.fork({ actionId: randomUUID(), conversationId: original.id, revision: 2, expectedContext: f.expectedContext })).busy).toBe(false);
    const child = f.service.list().conversations.find((row: any) => row.parentId === original.id);
    expect(child).toMatchObject({ status: 'idle', revision: 1 }); expect(turnCount()).toBe(2);
    await f.service.send({ actionId: randomUUID(), conversationId: child.id, revision: 1, text: 'child', expectedContext: f.expectedContext });
    expect(f.histories.get(child.threadId)).toEqual(['first', 'second', 'child']); expect(f.histories.get(original.threadId)).toEqual(['first', 'second']);
    expect(f.launches()).toBe(1);
    const starts = f.methods.filter(row => row.method === 'thread/start' || row.method === 'thread/fork');
    expect(starts.every(row => row.params.ephemeral === false && row.params.approvalPolicy === 'never' && row.params.sandbox === 'read-only')).toBe(true);
    const bindingId = randomUUID();
    const agent = f.server.createWorker({ workerBindingId: bindingId, admissionId: 'a'.repeat(64), model: 'synthetic-model' });
    await agent.createOwnedWorker({ actionId: randomUUID() });
    expect(f.methods.filter(row => row.method === 'thread/start').at(-1).params.ephemeral).toBe(true);
    const registry = JSON.parse(readFileSync(join(f.storageRoot, 'registry.json'), 'utf8'));
    const journal = JSON.parse(readFileSync(join(f.root, 'journals', registry.conversations.find((row: any) => row.id === original.id).bindingId, 'actions.json'), 'utf8'));
    expect(journal.actions.filter((row: any) => row.kind === 'offer').every((row: any) => row.inputAuthorship === 'direct-user' && row.canonicalItems[0].authorship === 'direct-user')).toBe(true);
    f.switchContext();
    expect(f.service.list().actions).toEqual([]);
    expect(f.service.inspectAction(first.actionId)).toMatchObject({ state: 'completed', conversationId: original.id });
    await expect(f.service.send({ actionId: randomUUID(), conversationId: original.id, revision: 2, text: 'wrong account', expectedContext: f.expectedContext })).rejects.toMatchObject({ actionRecorded: false });
    expect(turnCount()).toBe(3);
  } finally { await f.close(); }
});

test('held unknown conversation blocks all senders, duplicate never reoffers, late exact receipt settles and restart never resumes', async () => {
  const f = await fixture();
  try {
    f.hold(); const input = f.create('held'); const pending = f.service.create(input);
    // Wait for the owned operation to reach its observation boundary, not a polling loop.
    await pending;
    expect(f.service.list().conversations[0].status).toBe('unknown');
    expect(f.service.list().conversations[0].resumeReason).toBe('prior_outcome_unresolved');
    await expect(f.service.resume({ actionId: randomUUID(), conversationId: f.service.list().conversations[0].id, revision: 1, expectedContext: f.expectedContext })).rejects.toMatchObject({ actionRecorded: false });
    expect(f.methods.filter(row => row.method === 'thread/resume')).toHaveLength(0);
    const count = f.methods.filter(row => row.method === 'turn/start').length;
    await f.service.create(input); expect(f.methods.filter(row => row.method === 'turn/start')).toHaveLength(count);
    await expect(f.service.create(f.create('other'))).rejects.toMatchObject({ actionRecorded: false });
    expect(() => f.server.createWorker({ workerBindingId: randomUUID(), admissionId: 'a'.repeat(64), model: 'synthetic-model' })).toThrow('unsettled owner');
    f.release();
    expect(f.service.list().conversations[0].status).toBe('idle');
    expect(f.service.inspectAction(input.actionId).state).toBe('completed');
    f.hold();
    const followup = { actionId: randomUUID(), conversationId: f.service.list().conversations[0].id, revision: 1, text: 'late followup', expectedContext: f.expectedContext };
    await f.service.send(followup);
    expect(f.service.inspectAction(followup.actionId).state).toBe('unknown');
    expect(f.service.list().conversations[0].revision).toBe(2);
    f.release();
    expect(f.service.inspectAction(followup.actionId).state).toBe('completed');
    expect(f.service.list().conversations[0]).toMatchObject({ status: 'idle', revision: 2, lastSummary: 'Observed late followup' });
    await f.service.destroy();
    const reopened = createPersistentNativeConversations({ getExecution: () => null, storageRoot: f.storageRoot });
    expect(reopened.list().conversations[0]).toMatchObject({ status: 'unavailable', ownerAvailable: false });
    await expect(reopened.send({ actionId: randomUUID(), conversationId: reopened.list().conversations[0].id, revision: 1, text: 'restart', expectedContext: f.expectedContext })).rejects.toMatchObject({ actionRecorded: false });
    await reopened.destroy();
  } finally { await f.close(); }
});

test('account context is rechecked after asynchronous account readiness before durable claim', async () => {
  const f = await fixture();
  try {
    const work = f.service.create(f.create()); f.switchContext();
    await expect(work).rejects.toMatchObject({ actionRecorded: false, code: 'stale_account' });
    expect(f.methods.filter(row => row.method === 'thread/start')).toHaveLength(0);
    expect(f.service.list().actions).toEqual([]);
  } finally { await f.close(); }
});

test('capacity refusal before a leaf intent is a failed durable action rather than an unknown send', async () => {
  const f = await fixture(2);
  try {
    await f.service.create(f.create());
    const original = f.service.list().conversations[0];
    await f.service.fork({ actionId: randomUUID(), conversationId: original.id, revision: original.revision, expectedContext: f.expectedContext });
    const refused = f.create('no third thread');
    await expect(f.service.create(refused)).rejects.toMatchObject({ actionRecorded: true, code: 'worker_busy' });
    expect(f.service.inspectAction(refused.actionId)).toMatchObject({ state: 'failed', ownerHeld: false });
    expect(f.methods.filter(row => row.method === 'thread/start')).toHaveLength(1);
    expect(f.service.list().conversations.find((row: any) => row.id === f.service.inspectAction(refused.actionId).conversationId).status).toBe('unavailable');
  } finally { await f.close(); }
});

test('known RPC creation rejection retains failed nonheld leaf authority despite wrapped error', async () => {
  const f = await fixture();
  try {
    f.rejectCreate(); const input = f.create();
    await expect(f.service.create(input)).rejects.toMatchObject({ actionRecorded: true });
    expect(f.service.inspectAction(input.actionId)).toMatchObject({ state: 'failed', ownerHeld: false });
    expect(f.methods.filter(row => row.method === 'turn/start')).toHaveLength(0);
  } finally {
    // No thread identity exists after rejected creation. The shared process close
    // reconciles physical ownership before the retained facade is released.
    await f.server.destroy(); await f.close();
  }
});

test('explicit idle close frees capacity; same-server Resume uses new binding and retained thread, then supports fork', async () => {
  const f = await fixture(2);
  try {
    await f.service.create(f.create('remembered-context'));
    const original = f.service.list().conversations[0];
    await f.service.fork({ actionId: randomUUID(), conversationId: original.id, revision: 1, expectedContext: f.expectedContext });
    const child = f.service.list().conversations.find((row: any) => row.parentId === original.id);
    const close = { actionId: randomUUID(), conversationId: original.id, revision: 1, expectedContext: f.expectedContext };
    const closed = await f.service.closeIdle(close);
    expect(closed.busy).toBe(false);
    expect(closed.conversations.find((row: any) => row.id === original.id)).toMatchObject({ status: 'unloaded', resumeAvailable: true, revision: 2 });
    const resumesBefore = f.methods.filter(row => row.method === 'thread/resume').length;
    expect(resumesBefore).toBe(0);
    await f.service.create(f.create('capacity freed'));
    const extra = f.service.list().conversations.find((row: any) => row.lastSummary === 'Observed capacity freed');
    await f.service.closeIdle({ actionId: randomUUID(), conversationId: extra.id, revision: 1, expectedContext: f.expectedContext });
    const resumed = await f.service.resume({ actionId: randomUUID(), conversationId: original.id, revision: 2, expectedContext: f.expectedContext });
    expect(resumed.busy).toBe(false);
    expect(resumed.conversations.find((row: any) => row.id === original.id)).toMatchObject({ status: 'idle', revision: 3, threadId: original.threadId, resumeAvailable: false });
    expect(f.methods.filter(row => row.method === 'turn/start')).toHaveLength(2);
    await f.service.send({ actionId: randomUUID(), conversationId: original.id, revision: 3, text: 'followup', expectedContext: f.expectedContext });
    expect(f.histories.get(original.threadId)).toEqual(['remembered-context', 'followup']);
    await f.service.closeIdle({ actionId: randomUUID(), conversationId: child.id, revision: 1, expectedContext: f.expectedContext });
    await f.service.fork({ actionId: randomUUID(), conversationId: original.id, revision: 4, expectedContext: f.expectedContext });
    expect(f.methods.filter(row => row.method === 'thread/fork')).toHaveLength(2);
    const resumeRequest = f.methods.find(row => row.method === 'thread/resume').params;
    expect(resumeRequest).toMatchObject({ threadId: original.threadId, excludeTurns: true, approvalPolicy: 'never', sandbox: 'read-only' });
    expect(resumeRequest).not.toHaveProperty('history'); expect(resumeRequest).not.toHaveProperty('path');
  } finally { await f.close(); }
});

test('restart Resume refreshes admission and binding but never sends without a new explicit followup', async () => {
  const f = await fixture();
  try {
    await f.service.create(f.create('persist-across-owner'));
    const original = f.service.list().conversations[0];
    const before = JSON.parse(readFileSync(join(f.storageRoot, 'registry.json'), 'utf8')).conversations[0];
    await f.restart();
    expect(f.service.list().conversations[0]).toMatchObject({ status: 'unavailable', resumeAvailable: true });
    expect(f.methods.filter(row => row.method === 'thread/resume')).toHaveLength(0);
    const result = await f.service.resume({ actionId: randomUUID(), conversationId: original.id, revision: 1, expectedContext: f.expectedContext });
    expect(result.conversations[0]).toMatchObject({ status: 'idle', threadId: original.threadId, revision: 2 });
    const after = JSON.parse(readFileSync(join(f.storageRoot, 'registry.json'), 'utf8')).conversations[0];
    expect(after.bindingId).not.toBe(before.bindingId); expect(after.admissionId).not.toBe(before.admissionId);
    expect(after.historySource).toEqual(before.historySource); expect(f.launches()).toBe(2);
    expect(f.methods.filter(row => row.method === 'turn/start')).toHaveLength(1);
    await f.service.send({ actionId: randomUUID(), conversationId: original.id, revision: 2, text: 'after-restart', expectedContext: f.expectedContext });
    expect(f.histories.get(original.threadId)).toEqual(['persist-across-owner', 'after-restart']);
  } finally { await f.close(); }
});

test('unexpected historical close after Resume cannot mark the new subscription closed or free its owner', async () => {
  const f = await fixture();
  try {
    await f.service.create(f.create()); const original = f.service.list().conversations[0];
    await f.service.closeIdle({ actionId: randomUUID(), conversationId: original.id, revision: 1, expectedContext: f.expectedContext });
    await f.service.resume({ actionId: randomUUID(), conversationId: original.id, revision: 2, expectedContext: f.expectedContext });
    f.emitOldClose(original.threadId);
    expect(f.server.inspect()).toMatchObject({ accepting: false, closed: false });
    expect(f.server.currentOperation()).toContain('reconciliation');
    await expect(f.service.send({ actionId: randomUUID(), conversationId: original.id, revision: 3, text: 'must not send', expectedContext: f.expectedContext })).rejects.toMatchObject({ actionRecorded: false });
    expect(f.methods.filter(row => row.method === 'turn/start')).toHaveLength(1);
  } finally { await f.close(); }
});

test('lost Resume ACK remains unknown after physical owner close and cannot be replayed', async () => {
  const f = await fixture();
  try {
    await f.service.create(f.create()); const original = f.service.list().conversations[0];
    await f.service.closeIdle({ actionId: randomUUID(), conversationId: original.id, revision: 1, expectedContext: f.expectedContext });
    const seen = f.holdResume();
    const input = { actionId: randomUUID(), conversationId: original.id, revision: 2, expectedContext: f.expectedContext };
    const work = f.service.resume(input); await seen;
    expect(f.service.inspectAction(input.actionId).state).toBe('prepared');
    await f.server.destroy(); await expect(work).rejects.toMatchObject({ actionRecorded: true });
    expect(f.service.inspectAction(input.actionId).state).toBe('unknown');
    await f.service.resume(input);
    expect(f.methods.filter(row => row.method === 'thread/resume')).toHaveLength(1);
    expect(f.service.list().conversations[0].resumeAvailable).toBe(false);
  } finally { await f.close(); }
});

test('legacy retained rows remain readable metadata but cannot Resume without proven account identity', async () => {
  const f = await fixture();
  try {
    await f.service.create(f.create());
    const original = f.service.list().conversations[0];
    await Promise.all([f.service.destroy(), f.server.destroy()]);
    const file = join(f.storageRoot, 'registry.json'), registry = JSON.parse(readFileSync(file, 'utf8'));
    registry.version = 1; delete registry.conversations[0].contextVersion; delete registry.conversations[0].historySource;
    writeFileSync(file, JSON.stringify(registry), { mode: 0o600 });
    await f.restart();
    expect(f.service.list().conversations[0]).toMatchObject({ id: original.id, resumeAvailable: false, resumeReason: 'legacy_identity_unproven' });
    await expect(f.service.resume({ actionId: randomUUID(), conversationId: original.id, revision: 1, expectedContext: f.expectedContext })).rejects.toMatchObject({ actionRecorded: false });
    expect(f.methods.filter(row => row.method === 'thread/resume')).toHaveLength(0);
  } finally { await f.close(); }
});
