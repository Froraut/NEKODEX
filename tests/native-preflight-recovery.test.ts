import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync, realpathSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOwnedNativeAccountServer } from '../launcher/electron/owned-native-worker.cjs';
import { createAgentNativeBridge, compileAgentNativeOutputSchema } from '../launcher/electron/agent-native-bridge.cjs';
import { AGENT_NATIVE_PROTOCOL, AGENT_NATIVE_OUTPUT_SCHEMA_ID, AGENT_NATIVE_OUTPUT_SCHEMA_HASH } from '../launcher/electron/agent-native-protocol.cjs';
import { createOwnedNativeExecutionPort } from '../src/agent-mode/native-provider';
import type { AgentNativeOfferEnvelope } from '../src/agent-mode/native-protocol';

async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'neko-preflight-')));
  const child: any = new EventEmitter(); child.pid = 43180; child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const received: any[] = [], checked: any[] = [];
  let input = '', closed = false, failedReads = 0, failedMethod = 'account/rateLimits/read', changedAccount = false, holdThread = false, heldThread: any;
  let readReached: () => void = () => {}, threadReached!: () => void;
  const nextThread = new Promise<void>(resolve => { threadReached = resolve; });
  const respond = (message: any, result: any) => child.stdout.write(JSON.stringify({ id: message.id, result }) + '\n');
  const event = (method: string, params: any) => child.stdout.write(JSON.stringify({ method, params }) + '\n');
  const close = () => { if (!closed) { closed = true; child.emit('close', 0, null); } };
  const finishThread = (message: any) => respond(message, { thread: { id: randomUUID(), ephemeral: true, forkedFromId: null, parentThreadId: null, status: { type: 'idle' } },
    model: 'fixture', modelProvider: 'openai', cwd: root, instructionSources: [], approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: { type: 'readOnly' } });
  child.stdin = new Writable({ write(chunk, _encoding, done) {
    input += chunk.toString();
    for (;;) {
      const at = input.indexOf('\n'); if (at < 0) break;
      const m = JSON.parse(input.slice(0, at)); input = input.slice(at + 1); received.push(m);
      queueMicrotask(() => {
        if (m.method === 'initialize') respond(m, { codexHome: root, userAgent: 'inert-preflight-fixture' });
        if (m.method === 'config/read') respond(m, {});
        if (m.method === 'configRequirements/read') respond(m, {});
        if (m.method === 'account/read') {
          if (failedMethod === m.method && failedReads > 0) failedReads--;
          else respond(m, { account: changedAccount ? 'other' : 'expected' });
        }
        if (m.method === 'account/rateLimits/read') {
          readReached();
          if (failedMethod === m.method && failedReads > 0) failedReads--; else respond(m, { allowed: !changedAccount });
        }
        if (m.method === 'thread/start') {
          if (holdThread) { heldThread = m; threadReached(); } else finishThread(m);
        }
        if (m.method === 'turn/start') {
          const turnId = randomUUID(), threadId = m.params.threadId;
          respond(m, { turn: { id: turnId, status: 'inProgress' } });
          event('item/completed', { threadId, turnId, completedAtMs: Date.now(), item: { type: 'userMessage', id: randomUUID(), clientId: m.params.clientUserMessageId, content: m.params.input } });
          event('item/completed', { threadId, turnId, completedAtMs: Date.now(), item: { type: 'agentMessage', id: randomUUID(), phase: 'final_answer', text: JSON.stringify({ protocol: AGENT_NATIVE_PROTOCOL, kind: 'final', requestId: null, toolId: null, argumentsJson: null, summary: 'fixture complete' }) } });
          event('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
        }
        if (m.method === 'thread/unsubscribe') { respond(m, { status: 'unsubscribed' }); event('thread/closed', { threadId: m.params.threadId }); }
      });
    }
    done();
  } });
  child.stdin.on('finish', close);
  const admission: any = { serverGeneration: randomUUID(), modelId: 'fixture', admissionId: 'fixture-admission', provider: 'openai', paths: { cwd: root, codexHome: root },
    availability: () => ({ available: true, reasonCode: null }), compileOutputSchema: compileAgentNativeOutputSchema,
    prestart: () => ({ executable: '/inert', args: [], paths: { cwd: root, codexHome: root }, environment: {} }),
    checkEffective() {}, checkAccount(account: any, usage: any) {
      checked.push({ account, usage });
      if (account.account !== 'expected' || usage.allowed !== true) throw Object.assign(new Error('Account changed'), { code: 'account_changed' });
    }, forBinding(binding: any) { return { ...admission, paths: { ...admission.paths, journal: join(root, binding.workerBindingId.replace(':', '-')) } }; } };
  const server = createOwnedNativeAccountServer({ admission, requestTimeoutMs: 15, terminalTimeoutMs: 100, stopGraceMs: 5,
    ...{ testHooks: { spawnProcess: () => child, terminateProcess: close } } });
  await server.prepare(); received.length = 0; checked.length = 0;
  const nextRead = new Promise<void>(resolve => { readReached = resolve; });
  const bridge = createAgentNativeBridge({ canStart: () => true, validateOffer: () => true,
    resolveAdmission: () => ({ createWorker: (binding, notify) => server.createWorker(binding, notify) }) });
  const envelope = (): AgentNativeOfferEnvelope => {
    const actionId = randomUUID(); return { version: 1, protocol: AGENT_NATIVE_PROTOCOL, actionId,
      scope: { taskId: 'test-task', familyId: 'test-task', generation: 1, revision: 1, dispatchId: actionId, ownerId: 'test-owner', agentWorkerId: randomUUID() },
      model: 'fixture', admissionId: 'fixture-admission', outputSchemaId: AGENT_NATIVE_OUTPUT_SCHEMA_ID, outputSchemaHash: AGENT_NATIVE_OUTPUT_SCHEMA_HASH,
      authorship: 'automatic-host', text: 'inert preflight request', continuation: null };
  };
  return { server, bridge, received, checked, envelope, nextRead, nextThread,
    receipts: () => readdirSync(root).flatMap(dir => JSON.parse(readFileSync(join(root, dir, 'actions.json'), 'utf8')).actions),
    failReads: (count: number, method = 'account/rateLimits/read') => { failedReads = count; failedMethod = method; }, changeAccount: () => { changedAccount = true; },
    delayThread: () => { holdThread = true; }, finishThread: () => finishThread(heldThread),
    cleanup: async () => { close(); await server.destroy(); await bridge.destroy(); rmSync(root, { recursive: true, force: true }); } };
}

async function terminal(f: Awaited<ReturnType<typeof fixture>>, e: AgentNativeOfferEnvelope) {
  let receipt = await f.bridge.offer(e);
  while (!['completed', 'failed', 'not_sent', 'unknown'].includes(receipt.state)) {
    receipt = await f.bridge.waitReceipt({ actionId: e.actionId, scope: e.scope, payloadDigest: receipt.payloadDigest, afterRevision: receipt.revision }) ?? receipt;
  }
  return receipt;
}

test('one metadata timeout retries fresh account checks before a single thread and turn', async () => {
  const f = await fixture();
  try {
    f.failReads(1);
    expect(await terminal(f, f.envelope())).toMatchObject({ state: 'completed', ownerHeld: false });
    expect(f.received.filter(m => m.method === 'account/read')).toHaveLength(3); // two create reads, one turn read
    expect(f.received.filter(m => m.method === 'account/rateLimits/read')).toHaveLength(3);
    expect(f.checked).toHaveLength(2);
    expect(f.received.filter(m => m.method === 'thread/start')).toHaveLength(1);
    expect(f.received.filter(m => m.method === 'turn/start')).toHaveLength(1);
  } finally { await f.cleanup(); }
}, 1000);

test('repeated metadata timeout is known not-written, releases its owner and permits a fresh explicit binding', async () => {
  const f = await fixture();
  try {
    f.failReads(2);
    const e = f.envelope();
    expect(await terminal(f, e)).toMatchObject({ state: 'not_sent', ownerHeld: false, writeDisposition: 'not-written',
      preflightFailure: { phase: 'account-rate-limits', reasonCode: 'rpc_timeout' } });
    expect(f.received.filter(m => m.method === 'thread/start' || m.method === 'turn/start')).toHaveLength(0);
    expect(f.received.filter(m => m.method === 'account/read')).toHaveLength(2);
    expect(f.server.inspect()).toMatchObject({ accepting: true, activeCount: 0 });
    expect(f.receipts()).toHaveLength(1);
    expect(f.receipts()[0]).toMatchObject({ kind: 'create', state: 'failed', retired: true, ownerHeld: false, writeDisposition: 'not-written',
      preflightFailure: { phase: 'account-rate-limits', reasonCode: 'rpc_timeout' } });
    expect(f.receipts()[0].observations.some((row: any) => row.state === 'unknown' || row.state === 'offered')).toBe(false);
    const rows = f.bridge.status().bindings;
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ retired: true, closed: true });
    expect(await terminal(f, f.envelope())).toMatchObject({ state: 'completed', ownerHeld: false });
    expect(f.received.filter(m => m.method === 'thread/start')).toHaveLength(1);
  } finally { await f.cleanup(); }
}, 1000);

test('metadata retry never bypasses changed account or usage', async () => {
  const f = await fixture();
  try {
    f.failReads(1); f.changeAccount();
    expect(await terminal(f, f.envelope())).toMatchObject({ state: 'not_sent', ownerHeld: false,
      preflightFailure: { phase: 'account-check', reasonCode: 'account_changed' } });
    expect(f.checked).toHaveLength(1);
    expect(f.received.filter(m => m.method === 'thread/start' || m.method === 'turn/start')).toHaveLength(0);
  } finally { await f.cleanup(); }
}, 1000);

test('closing the owner during metadata wait prevents retry and creation', async () => {
  const f = await fixture();
  try {
    f.failReads(2); const pending = terminal(f, f.envelope());
    await f.nextRead; await f.server.destroy();
    expect(await pending).toMatchObject({ state: 'not_sent', ownerHeld: false, writeDisposition: 'not-written' });
    expect(f.received.filter(m => m.method === 'account/rateLimits/read')).toHaveLength(1);
    expect(f.received.filter(m => m.method === 'thread/start' || m.method === 'turn/start')).toHaveLength(0);
  } finally { await f.cleanup(); }
}, 1000);

test('late thread acknowledgement retains the original creation and never retries its write', async () => {
  const f = await fixture();
  try {
    f.delayThread(); const pending = terminal(f, f.envelope());
    await f.nextThread; await Bun.sleep(40); // exceed only this synthetic 15ms RPC observation bound
    expect(f.received.filter(m => m.method === 'thread/start')).toHaveLength(1);
    expect(f.received.filter(m => m.method === 'turn/start')).toHaveLength(0);
    expect(f.server.inspect()).toMatchObject({ accepting: false, activeCount: 1 });
    f.finishThread();
    expect(await pending).toMatchObject({ state: 'completed', ownerHeld: false });
    expect(f.received.filter(m => m.method === 'thread/start')).toHaveLength(1);
    expect(f.received.filter(m => m.method === 'turn/start')).toHaveLength(1);
  } finally { await f.cleanup(); }
}, 1000);


test('account identity read timeout also gets only one metadata retry', async () => {
  const f = await fixture();
  try {
    f.failReads(1, 'account/read');
    expect(await terminal(f, f.envelope())).toMatchObject({ state: 'completed', ownerHeld: false });
    expect(f.received.filter(m => m.method === 'account/read')).toHaveLength(3);
    expect(f.received.filter(m => m.method === 'account/rateLimits/read')).toHaveLength(2);
    expect(f.received.filter(m => m.method === 'thread/start')).toHaveLength(1);
  } finally { await f.cleanup(); }
}, 1000);

test('Agent result retains bounded preflight reason and zero spend without acknowledgement', async () => {
  const f = await fixture();
  try {
    f.failReads(2);
    const e = f.envelope(); let acknowledgements = 0, claims = 0;
    const port = createOwnedNativeExecutionPort({
      models: () => [{ id: 'fixture', admissionId: 'fixture-admission', provider: 'owned-native', available: true, accepting: true }],
      bridge: f.bridge, claimTransport() { claims++; },
    });
    const result = await port.execute({ task: { id: e.scope.taskId, familyId: e.scope.familyId, generation: 1, revision: 1,
      execution: { provider: 'owned-native', model: 'fixture', admissionId: 'fixture-admission' }, bounds: { maxConcurrent: 1, maxSpend: null },
      originalRequest: 'inert', corrections: [], requirements: [] }, dispatch: { id: e.actionId, ownerId: e.scope.ownerId },
      worker: { id: e.scope.agentWorkerId }, stage: { id: 'fixture' }, messages: [], history: { reports: [], total: 0, truncated: false },
      signal: new AbortController().signal } as any, () => { acknowledgements++; });
    expect(result).toMatchObject({ outcome: 'not_sent', actualSpend: 0,
      summary: 'Native account preflight failed at account-rate-limits (rpc_timeout); no Native offer was made.' });
    expect(claims).toBe(1); expect(acknowledgements).toBe(0);
    expect(f.received.filter(m => m.method === 'thread/start' || m.method === 'turn/start')).toHaveLength(0);
  } finally { await f.cleanup(); }
}, 1000);
