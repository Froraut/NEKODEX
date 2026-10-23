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

async function fixture(capacity = 3, terminalTimeoutMs = 50) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'neko-persistent-conversations-')));
  const paths = { home: join(root, 'home'), codexHome: join(root, 'codex'), cwd: join(root, 'home', 'work') };
  for (const value of Object.values(paths)) mkdirSync(value, { recursive: true, mode: 0o700 });
  const methods: any[] = [], histories = new Map<string, string[]>(), receipts: any[] = [];
  let launches = 0, holdNext = false, rejectNextCreate = false, aliasNextCreate = false, processClosed = false;
  const held = new Map<string, () => void>(), turnWaiters = new Map<string, () => void>();
  let admissionId = 'a'.repeat(64); const model = 'synthetic-model';
  const profileId = randomUUID(), epoch = randomUUID();
  const historySource = { profileId, authEpoch: epoch, backendAccountId: 'synthetic-account', sourceId: 'c'.repeat(64) };
  const interrupted = new Map<string, () => void>();
  let holdInterrupt = false;
  const forkParents = new Map<string, string | null>();
  let holdClose = false, closeSeen: (() => void) | undefined;
  let emitThreadClose: ((id: string) => void) | undefined, holdResume = false, resumeSeen: (() => void) | undefined;
  const admission: any = { paths, historySource, provider: 'openai', serverGeneration: randomUUID(), compileOutputSchema: compileAgentNativeOutputSchema,
    prestart: () => ({ executable: '/inert-owned-wrapper', args: ['--stdio'], paths, environment: {} }),
    checkEffective() {}, checkAccount() {},
    forBinding(binding: any) { return { ...admission, admissionId, modelId: model, imageInput: false,
      paths: { ...paths, journal: join(root, 'journals', binding.workerBindingId) }, availability: () => ({ available: true, reasonCode: null }) }; },
  };
  const serverOptions = { admission, maxConcurrentThreads: capacity, requestTimeoutMs: 50, terminalTimeoutMs, stopGraceMs: 20,
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
            const params = request.params, resumed = request.method === 'thread/resume', id = resumed ? params.threadId : aliasNextCreate ? histories.keys().next().value! : randomUUID();
            const aliased = aliasNextCreate; aliasNextCreate = false;
            if (resumed && holdResume) { holdResume = false; resumeSeen?.(); return; }
            if (!resumed && !aliased) { histories.set(id, params.threadId ? [...histories.get(params.threadId)!] : []); forkParents.set(id, params.threadId ?? null); }
            response(request, { thread: { id, ephemeral: resumed ? false : params.ephemeral, forkedFromId: forkParents.get(id) ?? null, parentThreadId: null, status: { type: 'idle' } },
              model, modelProvider: 'openai', approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: { type: 'readOnly' }, cwd: paths.cwd, instructionSources: [] });
          }
          if (request.method === 'turn/start') {
            const params = request.params, turnId = randomUUID(), threadId = params.threadId;
            histories.get(threadId)!.push(params.input[0].text);
            response(request, { turn: { id: turnId } });
            interrupted.set(threadId, () => event('turn/completed', { threadId, turn: { id: turnId, status: 'interrupted' } }));
            const finish = () => {
              event('item/completed', { threadId, turnId, completedAtMs: Date.now(), item: { type: 'userMessage', id: randomUUID(), clientId: params.clientUserMessageId, content: params.input } });
              event('item/completed', { threadId, turnId, completedAtMs: Date.now(), item: { type: 'agentMessage', id: randomUUID(), phase: 'final_answer', text: JSON.stringify({ protocol: 'neko-agent-v1', kind: 'final', requestId: null, toolId: null, argumentsJson: null, summary: `Observed ${params.input[0].text}` }) } });
              event('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
            };
            if (holdNext) { holdNext = false; held.set(threadId, finish); } else finish();
            turnWaiters.get(params.input[0].text)?.(); turnWaiters.delete(params.input[0].text);
          }
          if (request.method === 'turn/interrupt' && !holdInterrupt) response(request, {});
          if (request.method === 'thread/unsubscribe') { response(request, {}); if (holdClose) { closeSeen?.(); } else event('thread/closed', { threadId: request.params.threadId }); }
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
    async rewriteRegistry(edit: (state: any) => void) {
      await service.destroy();
      const file = join(storageRoot, 'registry.json'), value = JSON.parse(readFileSync(file, 'utf8')); edit(value);
      writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
      service = createPersistentNativeConversations({ getExecution: () => context, storageRoot });
    },
    interruptTerminal: (threadId: string) => { interrupted.get(threadId)!(); held.delete(threadId); },
    holdInterrupt: () => { holdInterrupt = true; },
    holdClose: () => { holdClose = true; return new Promise<void>(resolve => { closeSeen = resolve; }); },
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
    rejectCreate: () => { rejectNextCreate = true; }, aliasCreate: () => { aliasNextCreate = true; },
    waitForTurn: (text: string) => new Promise<void>(resolve => { turnWaiters.set(text, resolve); }),
    release: (threadId = held.keys().next().value) => { const finish = held.get(threadId!); held.delete(threadId!); finish!(); }, switchContext: () => { context = { ...context, epoch: randomUUID() }; }, restoreContext: () => { context = { ...context, epoch }; },
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

test('independent retained conversations run simultaneously within one account quota and keep exact continuation ownership', async () => {
  const f = await fixture(2, 1000);
  try {
    const first = f.create('parallel alpha'), second = f.create('parallel beta');
    const alphaSeen = f.waitForTurn(first.text); f.hold(); const alphaPending = f.service.create(first); await alphaSeen;
    const alpha = f.service.list().conversations.find((row: any) => row.id === f.service.inspectAction(first.actionId).conversationId);
    const betaSeen = f.waitForTurn(second.text); f.hold(); const betaPending = f.service.create(second); await betaSeen;
    const beta = f.service.list().conversations.find((row: any) => row.id === f.service.inspectAction(second.actionId).conversationId);
    expect(alpha.threadId).not.toBe(beta.threadId);
    expect(f.server.inspect().activeCount).toBe(2); expect(f.launches()).toBe(1);
    expect(f.service.list().conversations.map((row: any) => row.status)).toEqual(['running', 'running']);
    await f.service.create(first); // Exact duplicate is a passive receipt lookup.
    await expect(f.service.send({ actionId: randomUUID(), conversationId: alpha.id, revision: alpha.revision,
      text: 'overlapping alpha', expectedContext: f.expectedContext })).rejects.toMatchObject({ actionRecorded: false });
    const overCapacity = f.create('no third subscription');
    await expect(f.service.create(overCapacity)).rejects.toMatchObject({ actionRecorded: true, code: 'worker_busy' });
    expect(f.service.inspectAction(overCapacity.actionId)).toMatchObject({ state: 'failed', ownerHeld: false });
    expect(f.methods.filter(row => row.method === 'thread/start')).toHaveLength(2);
    expect(f.methods.filter(row => row.method === 'turn/start')).toHaveLength(2);
    f.release(beta.threadId); await betaPending;
    expect(f.service.inspectAction(first.actionId).state).toBe('prepared');
    expect(f.service.inspectAction(second.actionId).state).toBe('completed');
    expect(f.service.list().conversations.find((row: any) => row.id === beta.id).lastSummary).toBe('Observed parallel beta');
    f.release(alpha.threadId); await alphaPending;
    const followup = { actionId: randomUUID(), conversationId: alpha.id, revision: 1, text: 'alpha continuation', expectedContext: f.expectedContext };
    await f.service.send(followup);
    expect(f.histories.get(alpha.threadId)).toEqual(['parallel alpha', 'alpha continuation']);
    expect(f.histories.get(beta.threadId)).toEqual(['parallel beta']);
    expect(f.service.list().busy).toBe(false);
    expect(f.methods.filter(row => row.method === 'thread/start')).toHaveLength(2);
  } finally { await f.close(); }
}, 2000);

test('aliased creation receipt cannot take or close an existing retained thread and keeps the uncertain owner blocked', async () => {
  const f = await fixture();
  try {
    await f.service.create(f.create('owned original'));
    const original = f.service.list().conversations[0];
    f.aliasCreate(); const alias = f.create('must not use original');
    await expect(f.service.create(alias)).rejects.toMatchObject({ actionRecorded: true });
    expect(f.service.inspectAction(alias.actionId)).toMatchObject({ state: 'unknown', ownerHeld: true });
    expect(f.server.inspect().accepting).toBe(false);
    expect(f.methods.filter(row => row.method === 'thread/unsubscribe')).toHaveLength(0);
    expect(f.methods.filter(row => row.method === 'turn/start')).toHaveLength(1);
    expect(f.histories.get(original.threadId)).toEqual(['owned original']);
    await expect(f.service.create(f.create('blocked while outcome unknown'))).rejects.toMatchObject({ actionRecorded: false });
    await f.service.create(alias);
    expect(f.methods.filter(row => row.method === 'thread/start')).toHaveLength(2);
  } finally { await f.server.destroy(); await f.close(); }
}, 2000);

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

test('Archive releases both full active quotas, preserves receipts/context and retries never send after restart', async () => {
  const f = await fixture();
  try {
    const first = f.create('retained first'); await f.service.create(first);
    const original = f.service.list().conversations[0];
    await f.rewriteRegistry(value => {
      const row = value.conversations[0];
      for (let i = 1; i < 128; i++) value.conversations.push({ ...row, id: randomUUID(), threadId: randomUUID(), status: 'unloaded' });
      for (let i = 1; i < 512; i++) value.actions.push({ ...value.actions[0], actionId: randomUUID(), fingerprint: 'fixture-only' });
    });
    expect(f.service.list().quota).toMatchObject({ conversations: 128, actions: 512 });
    await expect(f.service.create(f.create('refused'))).rejects.toMatchObject({ code: 'registry_quota', actionRecorded: false });
    const action = { actionId: randomUUID(), conversationId: original.id, revision: original.revision, expectedContext: f.expectedContext };
    const before = f.methods.length;
    const archived = await f.service.archive(action);
    expect(f.methods).toHaveLength(before); // Unloaded registry metadata never opens a subscription.
    expect(archived.quota).toMatchObject({ conversations: 127, actions: 0 });
    expect(archived.archivedConversations[0]).toMatchObject({ id: original.id, status: 'archived', threadId: original.threadId,
      lastSummary: 'Observed retained first', resumeAvailable: false, archiveAvailable: false });
    expect(archived.archivedConversationIds).toEqual([original.id]);
    expect(f.service.inspectAction(first.actionId)).toMatchObject({ state: 'completed', ownerHeld: false });
    const disk = JSON.parse(readFileSync(join(f.storageRoot, 'registry.json'), 'utf8'));
    expect(disk.actions).toHaveLength(513); expect(disk.conversations).toHaveLength(128);
    await f.service.create(f.create('after archive'));
    const sent = f.methods.filter(row => row.method === 'turn/start').length;
    await f.restart();
    await f.service.create(first); await f.service.archive(action);
    expect(f.methods.filter(row => row.method === 'turn/start')).toHaveLength(sent);
    expect(f.service.list().archivedCount).toBe(1);
    await expect(f.service.resume({ ...action, actionId: randomUUID(), revision: original.revision + 1, expectedContext: f.expectedContext })).rejects.toMatchObject({ code: 'stale_conversation', actionRecorded: false });
  } finally { await f.close(); }
});

test('Archive retires only the exact idle subscription and keeps other loaded conversations usable', async () => {
  const f = await fixture();
  try {
    await f.service.create(f.create('one')); await f.service.create(f.create('two'));
    const [one, two] = f.service.list().conversations;
    const before = f.methods.filter(row => row.method === 'turn/start').length;
    await f.service.archive({ actionId: randomUUID(), conversationId: one.id, revision: one.revision, expectedContext: f.expectedContext });
    expect(f.methods.filter(row => row.method === 'thread/unsubscribe').map(row => row.params.threadId)).toEqual([one.threadId]);
    expect(f.methods.filter(row => row.method === 'turn/start')).toHaveLength(before);
    expect(f.service.list().conversations[0]).toMatchObject({ id: two.id, ownerAvailable: true });
    await f.service.send({ actionId: randomUUID(), conversationId: two.id, revision: two.revision, text: 'continued', expectedContext: f.expectedContext });
    expect(f.histories.get(two.threadId)).toEqual(['two', 'continued']);
  } finally { await f.close(); }
});

test('Archive retains uncertain intent across account change and passive retry; prepared/unknown/owner-held cannot archive', async () => {
  const f = await fixture();
  try {
    await f.service.create(f.create()); const row = f.service.list().conversations[0];
    const seen = f.holdClose();
    const input = { actionId: randomUUID(), conversationId: row.id, revision: row.revision, expectedContext: f.expectedContext };
    const work = f.service.archive(input); await seen;
    expect(f.service.inspectAction(input.actionId)).toMatchObject({ state: 'prepared', ownerHeld: true });
    f.switchContext(); f.emitOldClose(row.threadId);
    await expect(work).rejects.toMatchObject({ code: 'stale_account', actionRecorded: true });
    expect(f.service.inspectAction(input.actionId)).toMatchObject({ state: 'unknown', ownerHeld: false });
    const calls = f.methods.length; await f.service.archive(input); expect(f.methods).toHaveLength(calls);
    const disk = JSON.parse(readFileSync(join(f.storageRoot, 'registry.json'), 'utf8'));
    expect(disk.conversations[0].archivedAt).toBeUndefined();
    f.restoreContext(); await f.restart();
    expect(f.service.list().conversations[0].archiveAvailable).toBe(false);
    await expect(f.service.archive({ ...input, actionId: randomUUID(), revision: row.revision + 1, expectedContext: f.expectedContext })).rejects.toMatchObject({ code: 'archive_unavailable', actionRecorded: false });
  } finally { await f.close(); }
});

test('Archive listing is account scoped and paginated; settled failed receipts do not permanently spend active slots', async () => {
  const f = await fixture();
  try {
    await f.service.create(f.create());
    await f.rewriteRegistry(value => {
      const row = value.conversations[0];
      for (let i = 0; i < 51; i++) value.conversations.push({ ...row, id: randomUUID(), archivedAt: Date.now() - i, status: 'unloaded' });
      value.conversations.push({ ...row, id: randomUUID(), epoch: randomUUID(), archivedAt: Date.now(), status: 'unloaded' });
      for (let i = 0; i < 512; i++) value.actions.push({ actionId: randomUUID(), conversationId: randomUUID(), kind: 'create', state: 'failed', ownerHeld: false, fingerprint: 'failed-fixture' });
    });
    const first = f.service.list(); expect(first.archivedCount).toBe(51); expect(first.archivedConversations).toHaveLength(50);
    expect(first.quota.actions).toBe(1);
    expect(f.service.list({ archiveCursor: first.archiveNextCursor }).archivedConversations).toHaveLength(1);
    await f.service.create(f.create('not blocked by failed history'));
  } finally { await f.close(); }
});

test('Stop works at the action quota while Send is pending; ACK waits terminal and exact cleanup then Resume', async () => {
  const f = await fixture(3, 5000);
  try {
    await f.service.create(f.create('old'));
    await f.rewriteRegistry(value => { for (let i = 1; i < 511; i++) value.actions.push({ ...value.actions[0], actionId: randomUUID(), fingerprint: 'old-completed-fixture' }); });
    f.hold(); const turnSeen = f.waitForTurn('held'), input = f.create('held'), sending = f.service.create(input);
    await turnSeen; await Promise.resolve();
    const active = f.service.list().conversations.find((row: any) => row.status === 'running');
    expect(f.service.list().quota.actions).toBe(512); expect(active.stopAvailable).toBe(true);
    const stop = { actionId: randomUUID(), conversationId: active.id, revision: active.revision, expectedContext: f.expectedContext };
    const response = await f.service.stop(stop);
    expect(response.conversations.find((row: any) => row.id === active.id)).toMatchObject({ revision: active.revision, stopAvailable: false, status: 'running' });
    expect(f.service.inspectAction(stop.actionId)).toMatchObject({ state: 'stopping', ownerHeld: true });
    await f.service.stop(stop);
    expect(f.methods.filter(row => row.method === 'turn/interrupt')).toHaveLength(1);
    const closed = f.holdClose(); f.interruptTerminal(active.threadId); await sending; await closed;
    expect(f.service.inspectAction(stop.actionId).state).toBe('stopping');
    f.emitOldClose(active.threadId);
    // Await a concrete service completion observation without arbitrary sleeps.
    await f.service.destroy();
    expect(f.service.inspectAction(stop.actionId)).toMatchObject({ state: 'completed', ownerHeld: false, nativeStatus: 'interrupted' });
    const disk = JSON.parse(readFileSync(join(f.storageRoot, 'registry.json'), 'utf8'));
    expect(disk.conversations.find((row: any) => row.id === active.id)).toMatchObject({ status: 'unloaded', revision: active.revision, activeActionId: input.actionId });
    expect(disk.actions.find((row: any) => row.actionId === input.actionId)).toMatchObject({ state: 'failed', nativeStatus: 'interrupted' });
    await f.restart();
    const resumed = await f.service.resume({ actionId: randomUUID(), conversationId: active.id, revision: active.revision, expectedContext: f.expectedContext });
    expect(resumed.conversations.find((row: any) => row.id === active.id).status).toBe('idle');
    expect(f.methods.filter(row => row.method === 'turn/start')).toHaveLength(2);
  } finally { await f.close(); }
});

test('lost Stop ACK remains nonreplayable and late exact terminal settles the retained Stop', async () => {
  const f = await fixture(3, 5000);
  try {
    f.hold(); const turnSeen = f.waitForTurn('held-stop'), sending = f.service.create(f.create('held-stop'));
    await turnSeen; await Promise.resolve(); const row = f.service.list().conversations[0];
    f.holdInterrupt(); const input = { actionId: randomUUID(), conversationId: row.id, revision: row.revision, expectedContext: f.expectedContext };
    await f.service.stop(input);
    expect(f.service.inspectAction(input.actionId)).toMatchObject({ state: 'unknown', ownerHeld: true });
    await f.service.stop(input);
    await expect(f.service.stop({ ...input, actionId: randomUUID() })).rejects.toMatchObject({ actionRecorded: false, code: 'stop_unavailable' });
    expect(f.methods.filter(row => row.method === 'turn/interrupt')).toHaveLength(1);
    f.interruptTerminal(row.threadId); await sending; await f.service.destroy();
    expect(f.service.inspectAction(input.actionId)).toMatchObject({ state: 'completed', nativeStatus: 'interrupted' });
  } finally { await f.close(); }
});

test('Archive accepts a known failed settled subscription without manufacturing an unknown retirement', async () => {
  const f = await fixture(3, 5000);
  try {
    f.hold(); const turnSeen = f.waitForTurn('failed-turn'), sending = f.service.create(f.create('failed-turn'));
    await turnSeen; await Promise.resolve(); const row = f.service.list().conversations[0];
    f.interruptTerminal(row.threadId); await sending;
    // The matching closed event is delivered by the same in-memory fixture queue.
    await Promise.resolve();
    const current = f.service.list().conversations[0]; expect(current.archiveAvailable).toBe(true);
    const input = { actionId: randomUUID(), conversationId: row.id, revision: current.revision, expectedContext: f.expectedContext };
    await f.service.archive(input);
    expect(f.service.inspectAction(input.actionId)).toMatchObject({ state: 'completed', ownerHeld: false });
    expect(f.service.list().archivedCount).toBe(1);
  } finally { await f.close(); }
});

test('Archive byte-cap refusal preserves exact revision/status/actions before any retirement or Native RPC', async () => {
  const f = await fixture();
  try {
    await f.service.create(f.create('retained near byte cap'));
    await f.rewriteRegistry(value => {
      value.padding = '';
      value.padding = 'x'.repeat(4 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(value)) - 64);
    });
    const before = f.service.list(), row = before.conversations[0], calls = f.methods.length;
    const bytes = readFileSync(join(f.storageRoot, 'registry.json'));
    const input = { actionId: randomUUID(), conversationId: row.id, revision: row.revision, expectedContext: f.expectedContext };
    await expect(f.service.archive(input)).rejects.toMatchObject({ code: 'registry_quota', actionRecorded: false, registryWriteDisposition: 'not-written' });
    expect(f.service.list()).toEqual(before);
    expect(f.service.inspectAction(input.actionId)).toBeUndefined();
    expect(readFileSync(join(f.storageRoot, 'registry.json')).equals(bytes)).toBe(true);
    expect(f.methods).toHaveLength(calls);
  } finally { await f.close(); }
});
