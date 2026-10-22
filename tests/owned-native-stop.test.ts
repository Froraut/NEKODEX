import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync, realpathSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { createOwnedNativeAccountServer } = createRequire(import.meta.url)('../launcher/electron/owned-native-worker.cjs');

// Real worker/account/receipt code; only the private child stdio is synthetic.
async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-stop-')));
  const paths = { home: join(root, 'home'), codexHome: join(root, 'codex'), cwd: join(root, 'home', 'work') };
  for (const value of Object.values(paths)) mkdirSync(value, { recursive: true, mode: 0o700 });
  const methods: any[] = [], workers: any[] = [], callbacks = new Map<string, (receipt: any) => void>();
  const turns = new Map<string, any>(); let child: any, respond: any, event: any;
  let holdInterrupt = false, holdClose = false, launches = 0;
  const admission: any = { paths, provider: 'openai', serverGeneration: randomUUID(),
    prestart: () => ({ executable: '/inert-owned-wrapper', args: ['--stdio'], paths, environment: {} }),
    checkEffective() {}, checkAccount() {},
    forBinding(binding: any) { return { ...admission, admissionId: 'a'.repeat(64), modelId: 'synthetic-model', imageInput: false,
      paths: { ...paths, journal: join(root, 'journals', binding.workerBindingId) }, availability: () => ({ available: true, reasonCode: null }) }; },
  };
  const server = createOwnedNativeAccountServer({ admission, requestTimeoutMs: 25, terminalTimeoutMs: 5000,
    testHooks: { spawnProcess() {
      launches++; child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      respond = (request: any, result: any) => child.stdout.write(JSON.stringify({ id: request.id, result }) + '\n');
      event = (method: string, params: any) => child.stdout.write(JSON.stringify({ method, params }) + '\n');
      child.stdin = new Writable({ write(chunk, _encoding, done) {
        const request = JSON.parse(chunk.toString()); methods.push(request);
        queueMicrotask(() => {
          const p = request.params;
          if (request.method === 'initialize') respond(request, { codexHome: paths.codexHome, userAgent: 'synthetic-stop' });
          if (request.method === 'config/read') respond(request, { config: {}, layers: [] });
          if (request.method === 'configRequirements/read') respond(request, { requirements: null });
          if (request.method === 'account/read') respond(request, { account: {} });
          if (request.method === 'account/rateLimits/read') respond(request, {});
          if (request.method === 'thread/start') respond(request, { thread: { id: randomUUID(), ephemeral: false, forkedFromId: null,
            parentThreadId: null, status: { type: 'idle' } }, model: 'synthetic-model', modelProvider: 'openai',
            approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: { type: 'readOnly' }, cwd: paths.cwd, instructionSources: [] });
          if (request.method === 'turn/start') { const turnId = randomUUID(); turns.set(p.threadId, { request, turnId }); respond(request, { turn: { id: turnId } }); }
          if (request.method === 'turn/interrupt' && !holdInterrupt) respond(request, {});
          if (request.method === 'thread/unsubscribe') { respond(request, {}); if (!holdClose) event('thread/closed', { threadId: p.threadId }); }
        }); done();
      } });
      child.stdin.on('finish', () => { child.exitCode = 0; child.emit('close', 0, null); }); return child;
    } },
  });
  await server.prepare();
  async function start() {
    let worker: any, created: any;
    const targetActionId = randomUUID();
    let acknowledged: any; const ack = new Promise<any>(resolve => { acknowledged = resolve; });
    const operation = server.persistentOperation(async (owner: any) => {
      const binding = { workerBindingId: randomUUID(), workerGeneration: 1, taskId: randomUUID(), familyId: randomUUID(), generation: 1,
        agentWorkerId: randomUUID(), admissionId: 'a'.repeat(64), model: 'synthetic-model' };
      worker = owner.createWorker(binding, (receipt: any) => {
        callbacks.get(targetActionId)?.(receipt);
        if (receipt.actionId === targetActionId && receipt.state === 'acknowledged') acknowledged(receipt);
      }, undefined, { mode: 'canonical-text-v1' }); workers.push(worker);
      created = await worker.createOwnedWorker({ actionId: randomUUID() });
      return worker.offerOwnedTurn({ workerHandle: created.workerHandle, actionId: targetActionId, text: 'synthetic request' });
    });
    const receipt = await ack;
    const stopInput = { workerHandle: created.workerHandle, actionId: randomUUID(), targetActionId, turnId: receipt.turnId };
    return { worker, stopInput, operation, threadId: created.threadId };
  }
  const finish = (threadId: string, status = 'interrupted') => {
    const { request, turnId } = turns.get(threadId);
    if (status === 'completed') {
      event('item/completed', { threadId, turnId, completedAtMs: 1, item: { type: 'userMessage', id: randomUUID(), clientId: request.params.clientUserMessageId, content: request.params.input } });
      event('item/completed', { threadId, turnId, completedAtMs: 1, item: { type: 'agentMessage', id: randomUUID(), text: 'finished', phase: 'final_answer' } });
    }
    event('turn/completed', { threadId, turn: { id: turnId, status } });
  };
  return { start, methods, callbacks, finish, launches: () => launches,
    holdInterrupt: () => { holdInterrupt = true; }, holdClose: () => { holdClose = true; },
    releaseClose: (threadId: string) => event('thread/closed', { threadId }),
    allowClose: () => { holdClose = false; },
    async close() { await server.destroy(); await Promise.all(workers.map(worker => worker.destroy())); rmSync(root, { recursive: true, force: true }); } };
}

test('owned Stop targets one live turn, persists intent, ACK does not settle, cleanup waits exact close', async () => {
  const f = await fixture();
  try {
    const a = await f.start(), b = await f.start();
    await expect(a.worker.interruptOwnedTurn({ ...a.stopInput, turnId: b.stopInput.turnId })).rejects.toMatchObject({ code: 'invalid_intent' });
    expect(f.methods.filter(row => row.method === 'turn/interrupt')).toHaveLength(0);
    f.callbacks.set(a.stopInput.targetActionId, receipt => {
      if (receipt.interruptState === 'requested') expect(f.methods.filter(row => row.method === 'turn/interrupt')).toHaveLength(0);
    });
    const result = await a.worker.interruptOwnedTurn(a.stopInput);
    expect(result).toMatchObject({ state: 'stopping', receipt: { ownerHeld: true, interruptActionId: a.stopInput.actionId } });
    f.callbacks.delete(a.stopInput.targetActionId);
    expect(a.worker.inspectOwnedWorker().state).toBe('offering');
    await a.worker.interruptOwnedTurn(a.stopInput);
    await expect(a.worker.interruptOwnedTurn({ ...a.stopInput, actionId: randomUUID() })).rejects.toMatchObject({ code: 'intent_already_recorded' });
    expect(f.methods.filter(row => row.method === 'turn/interrupt').map(row => row.params)).toEqual([{ threadId: a.threadId, turnId: a.stopInput.turnId }]);
    expect(b.worker.inspectOwnedWorker().state).toBe('offering'); expect(f.launches()).toBe(1);
    f.holdClose(); f.finish(a.threadId);
    expect(await a.operation).toMatchObject({ nativeStatus: 'interrupted', ownerHeld: false, state: 'failed' });
    let cleaned = false; const closing = a.worker.destroy().then(() => { cleaned = true; });
    await Promise.resolve(); expect(cleaned).toBe(false);
    f.releaseClose(a.threadId); await closing; expect(cleaned).toBe(true);
    f.finish(b.threadId, 'completed'); expect(await b.operation).toMatchObject({ nativeStatus: 'completed' });
    f.allowClose();
  } finally { await f.close(); }
}, 2000);

test('lost interrupt ACK keeps exact offer owned and cannot resend; a late terminal still settles', async () => {
  const f = await fixture();
  try {
    const a = await f.start(); f.holdInterrupt();
    expect(await a.worker.interruptOwnedTurn(a.stopInput)).toMatchObject({ state: 'unknown', receipt: { ownerHeld: true, interruptState: 'unknown' } });
    await a.worker.interruptOwnedTurn(a.stopInput);
    expect(f.methods.filter(row => row.method === 'turn/interrupt')).toHaveLength(1);
    expect(a.worker.inspectOwnedWorker().state).toBe('offering');
    f.finish(a.threadId); expect(await a.operation).toMatchObject({ nativeStatus: 'interrupted', ownerHeld: false });
  } finally { await f.close(); }
}, 2000);

test('natural completion winning Stop race is preserved and sends no interrupt', async () => {
  const f = await fixture();
  try {
    const a = await f.start(); f.finish(a.threadId, 'completed'); await a.operation;
    expect(await a.worker.interruptOwnedTurn(a.stopInput)).toMatchObject({ state: 'settled', receipt: { nativeStatus: 'completed', ownerHeld: false } });
    expect(f.methods.filter(row => row.method === 'turn/interrupt')).toHaveLength(0);
  } finally { await f.close(); }
}, 2000);
