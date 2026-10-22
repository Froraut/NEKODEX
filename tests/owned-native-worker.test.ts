import { afterEach, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { createOwnedNativeWorkerService } = require('../launcher/electron/owned-native-worker.cjs');
const { makeAdmission, digest } = require('../launcher/electron/owned-native-admission.cjs');
const { createOwnedNativeJournal } = require('../launcher/electron/owned-native-journal.cjs');
const catalog = require('./fixtures/owned-native-model.cjs');
const Ajv = require('ajv');
const macTest = process.platform === 'darwin' ? test : test.skip;
const THREAD = '0199a001-0000-7000-8000-000000000001';
const TURN = '0199a001-0000-7000-8000-000000000002';
const TURN2 = '0199a001-0000-7000-8000-000000000003';
const CREATE = '0199a001-0000-7000-8000-000000000004';
const OFFER = '0199a001-0000-7000-8000-000000000005';
const OFFER2 = '0199a001-0000-7000-8000-000000000006';
const RETIRE = '0199a001-0000-7000-8000-000000000007';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function configuration() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-owned-native-test-'))); roots.push(root);
  mkdirSync(join(root, 'package', 'bin'), { recursive: true });
  const executable = join(root, 'package', 'bin', 'codex');
  writeFileSync(executable, 'inert native executable fixture', { mode: 0o700 });
  writeFileSync(join(root, 'package', 'codex-package.json'), JSON.stringify({ version: '0.163.0', layoutVersion: 1,
    entrypoint: 'bin/codex', variant: 'codex', target: 'aarch64-apple-darwin' }), { mode: 0o600 });
  return { executable, executableSha256: digest(readFileSync(executable)), authorityHome: join(root, 'authority'),
    catalog: { json: catalog.json, modelId: catalog.modelId, sha256: digest(catalog.json) },
    route: { kind: 'local-fixture', baseUrl: 'http://127.0.0.1:12345/v1' },
    testHooks: { probeManagedPreferences: () => {} },
    compileOutputSchema: (schema: any) => new Ajv({ strict: true, allErrors: false }).compile(schema),
    requestTimeoutMs: 50, terminalTimeoutMs: 100,
    stopGraceMs: 5 };
}
function fixture(changes: any = {}) {
  const config = { ...configuration(), ...changes }, admission = makeAdmission(config);
  const child: any = new EventEmitter(), received: any[] = [], launches: any[] = [], callbacks: any[] = [];
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const respond = (message: any, result: any) => child.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
  const event = (method: string, params: any) => child.stdout.write(`${JSON.stringify({ method, params })}\n`);
  const close = () => { if (child.exitCode !== undefined) return; child.exitCode = 0; child.emit('close', 0, null); };
  let data = '', onTurn: any;
  child.stdin = new Writable({ write(chunk, _encoding, done) {
    data += chunk.toString();
    for (;;) {
      const newline = data.indexOf('\n'); if (newline < 0) break;
      const message = JSON.parse(data.slice(0, newline)); data = data.slice(newline + 1); received.push(message);
      queueMicrotask(() => {
        if (message.method === 'initialize') respond(message, { codexHome: admission.paths.codexHome, userAgent: 'owned-client test' });
        if (message.method === 'config/read') respond(message, { config: admission.config, origins: {}, layers: [
          { name: { type: 'packagedDefaults', file: config.executable }, config: {}, version: '1', disabledReason: null },
          { name: { type: 'user', file: admission.paths.config, profile: null }, config: admission.config, version: '1', disabledReason: null },
          ...(changes.extraLayers || []),
        ] });
        if (message.method === 'configRequirements/read') respond(message, { requirements: changes.requirements ?? null });
        if (message.method === 'thread/start') respond(message, { thread: { id: THREAD, ephemeral: true,
          forkedFromId: null, parentThreadId: null, status: { type: 'idle' } }, model: catalog.modelId,
          modelProvider: 'nekodex_fixture', cwd: admission.paths.cwd, instructionSources: [], approvalPolicy: 'never',
          approvalsReviewer: 'user', sandbox: { type: 'readOnly' } });
        if (message.method === 'turn/start') onTurn?.(message);
      });
    }
    done();
  } });
  if (!changes.holdClose) child.stdin.on('finish', close);
  const service = createOwnedNativeWorkerService({ ...config,
    onReceipt: (receipt: any) => { callbacks.push(receipt); changes.onReceipt?.(receipt); },
    testHooks: { ...config.testHooks, spawnProcess: (...args: any[]) => { launches.push(args); return child; },
      terminateProcess: changes.terminateProcess ?? close } });
  const complete = (message: any, turnId = TURN, text = 'canonical answer', beforeAck = false) => {
    const params = { threadId: THREAD, turnId, completedAtMs: 1000 };
    const emit = () => {
      event('item/completed', { ...params, item: { type: 'userMessage', id: `user-${turnId}`,
        clientId: message.params.clientUserMessageId, content: message.params.input } });
      event('item/completed', { ...params, item: { type: 'agentMessage', id: `assistant-${turnId}`, text, phase: 'final_answer' } });
      event('thread/tokenUsage/updated', { threadId: THREAD, turnId, tokenUsage: { last: { totalTokens: 9,
        inputTokens: 4, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 5, reasoningOutputTokens: 0 } } });
      event('turn/completed', { threadId: THREAD, turn: { id: turnId, status: 'completed' } });
    };
    if (beforeAck) emit();
    respond(message, { turn: { id: turnId, status: 'inProgress' } });
    if (!beforeAck) queueMicrotask(emit);
  };
  return { service, config, admission, child, received, launches, callbacks, event, respond, close, complete,
    set onTurn(value: any) { onTurn = value; } };
}

macTest('native admission is passive and refuses real route, capability drift, managed inputs before spawn', async () => {
  const config = configuration();
  const mutableRoute = { kind: 'official-openai' };
  const unavailable = createOwnedNativeWorkerService({ ...config, route: mutableRoute });
  mutableRoute.kind = 'local-fixture';
  expect(unavailable.inspectOwnedWorker().availability).toEqual({ available: false, reasonCode: 'official_policy_preflight_unverified' });
  expect(existsSync(config.authorityHome)).toBe(false);
  await expect(unavailable.createOwnedWorker({ actionId: CREATE })).rejects.toMatchObject({ code: 'official_policy_preflight_unverified' });
  expect(existsSync(config.authorityHome)).toBe(false); await unavailable.destroy();
  const bad = JSON.parse(catalog.json); bad.models[0].experimental_supported_tools = ['clock'];
  const json = JSON.stringify(bad);
  expect(() => makeAdmission({ ...config, catalog: { ...config.catalog, json, sha256: digest(json) } })).toThrow('capability');
  const pinned = makeAdmission(config);
  const admittedHash = pinned.admissionId;
  config.catalog.json = json; config.catalog.sha256 = digest(json);
  const admitted = pinned.prestart();
  expect(admitted.admissionId).toBe(admittedHash);
  expect(JSON.parse(readFileSync(admitted.paths.catalog, 'utf8')).models[0].experimental_supported_tools).toEqual([]);
  mkdirSync(admitted.paths.journal, { mode: 0o700 });
  const stoppedLock = JSON.stringify({ pid: 2147483647, nonce: 'preserve-stopped-owner' });
  writeFileSync(join(admitted.paths.journal, 'owner.lock'), stoppedLock, { mode: 0o600 });
  const stoppedJournal = createOwnedNativeJournal({ directory: admitted.paths.journal, admissionId: admitted.admissionId });
  expect(stoppedJournal.ownerStatus()).toBe('stale');
  expect(() => stoppedJournal.acquire()).toThrow('controlled recovery');
  expect(readFileSync(join(admitted.paths.journal, 'owner.lock'), 'utf8')).toBe(stoppedLock);
  const f = fixture({ testHooks: { probeManagedPreferences() { throw Object.assign(new Error('fixture forced policy'), { code: 'unsupported_startup_policy' }); } } });
  await expect(f.service.createOwnedWorker({ actionId: CREATE })).rejects.toMatchObject({ code: 'unsupported_startup_policy' });
  expect(f.launches).toHaveLength(0); await f.service.destroy();
});

macTest('owned wrapper checks binary, fixed metadata and source pins before any static execution', () => {
  const config = configuration();
  const sourceRoot = join(config.authorityHome, '..', 'owned-worker');
  const target = `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`;
  const output = join(sourceRoot, 'build', target);
  mkdirSync(output, { recursive: true, mode: 0o700 }); mkdirSync(join(sourceRoot, 'src'), { mode: 0o700 });
  const sentinel = join(sourceRoot, 'unexpected-probe');
  const executable = join(output, 'nekodex-owned-native-worker');
  writeFileSync(executable, `#!/bin/sh\ntouch '${sentinel}'\nexit 99\n`, { mode: 0o700 });
  const info = require('../launcher/native/owned-worker/source-pin.json');
  writeFileSync(join(sourceRoot, 'source-pin.json'), JSON.stringify(info), { mode: 0o600 });
  writeFileSync(join(sourceRoot, 'Cargo.toml'), 'inert manifest', { mode: 0o600 });
  writeFileSync(join(sourceRoot, 'Cargo.lock'), 'inert lock', { mode: 0o600 });
  writeFileSync(join(sourceRoot, 'src', 'main.rs'), 'inert source', { mode: 0o600 });
  const metadataPath = join(output, 'build-info.json');
  const metadata = { ...info, executable, target, bytes: readFileSync(executable).length,
    sha256: digest(readFileSync(executable)), manifestSha256: digest('inert manifest'),
    cargoLockSha256: digest('inert lock'), mainSha256: digest('inert source') };
  const pin = () => {
    const bytes = JSON.stringify(metadata); writeFileSync(metadataPath, bytes, { mode: 0o600 });
    return { metadataPath, metadataSha256: digest(bytes), sourceRoot,
      sourcePinSha256: digest(readFileSync(join(sourceRoot, 'source-pin.json'))) };
  };
  const base = { ...config, executable, executableVariant: 'owned-wrapper' };
  expect(() => makeAdmission({ ...base, executableSha256: '0'.repeat(64), wrapperBuildPin: pin() }).prestart()).toThrow('executable pin');
  expect(existsSync(sentinel)).toBe(false);
  metadata.pluginStartupTasks = 'start';
  expect(() => makeAdmission({ ...base, executableSha256: metadata.sha256, wrapperBuildPin: pin() }).prestart()).toThrow('runtime options');
  expect(existsSync(sentinel)).toBe(false);
  metadata.pluginStartupTasks = 'skip'; metadata.mainSha256 = '0'.repeat(64);
  expect(() => makeAdmission({ ...base, executableSha256: metadata.sha256, wrapperBuildPin: pin() }).prestart()).toThrow('source input');
  expect(existsSync(sentinel)).toBe(false);
  expect(existsSync(config.authorityHome)).toBe(false);
});

macTest('connected managed/cloud layers are rejected before any ephemeral thread is created', async () => {
  const f = fixture({ extraLayers: [{ name: { type: 'enterpriseManaged', id: 'required', name: 'policy' },
    config: { features: { hooks: true } }, version: '2', disabledReason: null }] });
  try {
    await expect(f.service.createOwnedWorker({ actionId: CREATE })).rejects.toMatchObject({ code: 'unsupported_effective_policy' });
    expect(f.received.some(row => row.method === 'thread/start')).toBe(false);
    expect(f.child.exitCode).toBe(0);
  } finally { await f.service.destroy(); }
});

macTest('one owner continues exact thread with durable ACK, early canonical events, fixed schema and unknown usage semantics', async () => {
  const f = fixture();
  try {
    expect(f.admission.config.thread_unload_delay_secs).toBe(0);
    expect(() => f.admission.checkEffective({ config: { ...f.admission.config,
      features: { ...f.admission.config.features, respect_system_proxy: false } }, layers: [] }, { requirements: null }))
      .toThrow('Native effective configuration differs from admission');
    expect(() => f.admission.checkEffective({ config: { ...f.admission.config, thread_unload_delay_secs: 1800 }, layers: [] }, { requirements: null }))
      .toThrow('Native effective configuration differs from admission');
    expect(f.service.inspectOwnedWorker().state).toBe('disconnected'); expect(f.launches).toHaveLength(0);
    const created = await f.service.createOwnedWorker({ actionId: CREATE });
    expect(created.threadId).toBe(THREAD); expect(f.launches).toHaveLength(1);
    const start = f.received.find(row => row.method === 'thread/start').params;
    expect(start).toMatchObject({ approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'read-only' });
    expect(start).not.toHaveProperty('tools'); expect(start).not.toHaveProperty('config');
    expect(typeof start.developerInstructions === 'string' && start.developerInstructions.trim().length > 0).toBe(true);
    expect(f.launches[0][1]).toEqual(['app-server', '--stdio', '--strict-config']);
    expect(f.launches[0][2].env).not.toHaveProperty('OPENAI_API_KEY');
    expect(f.launches[0][2].env.HOME).toBe(f.admission.paths.home);
    f.onTurn = (message: any) => f.complete(message, TURN, '{"answer":"first"}', true);
    const first = await f.service.offerOwnedTurn({ workerHandle: created.workerHandle, actionId: OFFER, text: 'automatic request',
      outputSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } });
    expect(first).toMatchObject({ state: 'completed', threadId: THREAD, turnId: TURN,
      inputAuthorship: 'automatic-host', structuredOutput: { answer: 'first' }, usage: { totalTokens: 9 } });
    expect(first.canonicalItems.map((row: any) => [row.role, row.authorship])).toEqual([['user', 'automatic-host'], ['assistant', 'native-assistant']]);
    expect(f.callbacks.filter(row => row.actionId === OFFER).map(row => row.state)).toEqual(['offered', 'acknowledged', 'completed']);
    expect(JSON.parse(readFileSync(join(f.admission.paths.journal, 'actions.json'), 'utf8')).actions.at(-1)).toEqual(first);
    f.onTurn = (message: any) => f.complete(message, TURN2, '');
    const second = await f.service.offerOwnedTurn({ workerHandle: created.workerHandle, actionId: OFFER2, text: '' });
    expect(second.state).toBe('completed'); expect(second.canonicalItems.at(-1).text).toBe('');
    expect(f.launches).toHaveLength(1);
    expect(f.received.filter(row => row.method === 'turn/start').every(row => row.params.threadId === THREAD)).toBe(true);
    await expect(f.service.offerOwnedTurn({ workerHandle: created.workerHandle, actionId: OFFER, text: 'replay' })).rejects.toMatchObject({ code: 'intent_already_recorded' });
    expect(f.received.filter(row => row.method === 'turn/start')).toHaveLength(2);
  } finally { await f.service.destroy(); }
});

macTest('lost native ACK is durable unknown across owner recreation and explicit retirement never replays it', async () => {
  const f = fixture();
  const created = await f.service.createOwnedWorker({ actionId: CREATE });
  f.onTurn = () => f.close();
  const outcome = await f.service.offerOwnedTurn({ workerHandle: created.workerHandle, actionId: OFFER, text: 'one attempt' });
  expect(outcome.state).toBe('unknown'); expect(outcome.turnId).toBeNull(); expect(outcome.usage).toBeNull();
  expect(f.service.currentOperation()).toBeNull();
  await f.service.destroy();
  const recovered = createOwnedNativeWorkerService(f.config);
  try {
    expect(recovered.inspectOwnedWorker(created.workerHandle).receipts.at(-1).state).toBe('unknown');
    await expect(recovered.createOwnedWorker({ actionId: OFFER2 })).rejects.toMatchObject({ code: 'reconciliation_required' });
    await recovered.retireOwnedWorker({ workerHandle: created.workerHandle, actionId: RETIRE });
    expect(recovered.inspectOwnedWorker().receipts.at(-1)).toMatchObject({ state: 'unknown', retired: true });
    expect(f.received.filter(row => row.method === 'turn/start')).toHaveLength(1);
  } finally { await recovered.destroy(); }
});

macTest('unsupported server authority is denied, poisons owned offer and cannot report tool success', async () => {
  const f = fixture();
  try {
    const created = await f.service.createOwnedWorker({ actionId: CREATE });
    f.onTurn = () => f.child.stdout.write(`${JSON.stringify({ id: 999, method: 'item/commandExecution/requestApproval', params: { command: 'private command' } })}\n`);
    const receipt = await f.service.offerOwnedTurn({ workerHandle: created.workerHandle, actionId: OFFER, text: 'fixture' });
    expect(receipt.state).toBe('unknown'); expect(receipt.reasonCode).toBe('unsupported_server_request');
    expect(f.received.at(-1)).toEqual({ id: 999, error: { code: -32601, message: 'Unsupported by inference-only owner' } });
    expect(JSON.stringify(receipt)).not.toContain('private command');
    expect(f.service.inspectOwnedWorker().capabilities).toMatchObject({ nativeTools: false, foreignThreadAdoption: false, realProviderVerified: false });
  } finally { await f.service.destroy(); }
});

macTest('receipt waits retain physical owner and reconcile exact late ACK and late terminal without replay', async () => {
  let completeReceipt: (receipt: any) => void = () => {};
  let offered: any;
  const f = fixture({ requestTimeoutMs: 20, terminalTimeoutMs: 30,
    onReceipt: (receipt: any) => { if (receipt.kind === 'offer' && receipt.state === 'completed') completeReceipt(receipt); } });
  try {
    const created = await f.service.createOwnedWorker({ actionId: CREATE });
    f.onTurn = (message: any) => { offered = message; };
    let terminal = new Promise(resolve => { completeReceipt = resolve; });
    const wait = await f.service.offerOwnedTurn({ workerHandle: created.workerHandle, actionId: OFFER, text: 'late ACK' });
    expect(wait).toMatchObject({ state: 'unknown', ownerHeld: true, turnId: null, reasonCode: 'ack_receipt_wait' });
    const observer = createOwnedNativeWorkerService(f.config);
    expect(observer.inspectOwnedWorker(created.workerHandle).receipts.at(-1)).toMatchObject({
      state: 'unknown', ownerHeld: true, reasonCode: 'ack_receipt_wait', ownerState: 'elsewhere-or-unverified' });
    await observer.destroy();
    expect(f.child.exitCode).toBeUndefined(); expect(f.service.currentOperation()).toBeTruthy();
    await expect(f.service.retireOwnedWorker({ workerHandle: created.workerHandle, actionId: CREATE })).rejects.toMatchObject({ code: 'intent_already_recorded' });
    expect(f.service.currentOperation()).toBeTruthy();
    await expect(f.service.createOwnedWorker({ actionId: OFFER2 })).rejects.toMatchObject({ code: 'worker_busy' });
    await expect(f.service.offerOwnedTurn({ workerHandle: created.workerHandle, actionId: OFFER2, text: 'duplicate' })).rejects.toMatchObject({ code: 'worker_not_ready' });
    // Real pending request correlation remains live after its observation wait.
    f.complete(offered, TURN, 'late ACK then canonical terminal', true);
    const lateAck: any = await terminal;
    expect(lateAck).toMatchObject({ actionId: OFFER, state: 'completed', ownerHeld: false, turnId: TURN });
    expect(lateAck.observations.map((fact: any) => fact.state)).toEqual(['prepared', 'offered', 'unknown', 'acknowledged', 'completed']);
    expect(lateAck.observations.find((fact: any) => fact.state === 'unknown')).toMatchObject({
      ownerHeld: true, turnId: null, reasonCode: 'ack_receipt_wait' });
    expect(lateAck.observations.every((fact: any) => Number.isSafeInteger(fact.timestampMs) && !('text' in fact))).toBe(true);
    expect(f.service.inspectOwnedWorker().state).toBe('ready');
    expect(f.service.currentOperation()).toBeNull();
    terminal = new Promise(resolve => { completeReceipt = resolve; });
    f.onTurn = (message: any) => { offered = message; f.respond(message, { turn: { id: TURN2, status: 'inProgress' } }); };
    const held = await f.service.offerOwnedTurn({ workerHandle: created.workerHandle, actionId: OFFER2, text: 'late terminal' });
    expect(held).toMatchObject({ state: 'unknown', ownerHeld: true, turnId: TURN2, reasonCode: 'terminal_receipt_wait' });
    expect(f.child.exitCode).toBeUndefined(); expect(f.service.currentOperation()).toBeTruthy();
    f.complete(offered, TURN2, 'later valid terminal');
    const settled: any = await terminal;
    expect(settled).toMatchObject({ state: 'completed', ownerHeld: false, turnId: TURN2 });
    expect(settled.observations.find((fact: any) => fact.state === 'unknown')).toMatchObject({
      ownerHeld: true, turnId: TURN2, reasonCode: 'terminal_receipt_wait' });
    expect(settled.canonicalItems.at(-1).text).toBe('later valid terminal');
    expect(f.received.filter(row => row.method === 'turn/start')).toHaveLength(2);
    expect(f.launches).toHaveLength(1);
    expect(f.service.currentOperation()).toBeNull();
  } finally { await f.service.destroy(); }
});

test.skipIf(process.platform === 'darwin')('native worker is explicitly unavailable without profile or CLI on phase-2 platforms', async () => {
  const config = configuration();
  const service = createOwnedNativeWorkerService(config);
  try {
    expect(service.inspectOwnedWorker().availability).toEqual({ available: false, reasonCode: 'mac_only' });
    await expect(service.createOwnedWorker({ actionId: CREATE })).rejects.toMatchObject({ code: 'mac_only' });
    expect(existsSync(config.authorityHome)).toBe(false);
  } finally { await service.destroy(); }
});

macTest('failed physical Native cleanup retains the exact journal owner until explicit close and cleanup retry', async () => {
  let terminations = 0;
  const f = fixture({ holdClose: true, terminateProcess() { terminations++; } });
  const observer = createOwnedNativeJournal({ directory: f.admission.paths.journal, admissionId: f.admission.admissionId });
  try {
    const created = await f.service.createOwnedWorker({ actionId: CREATE });
    expect(created.workerHandle).toBeTruthy(); expect(f.launches).toHaveLength(1);
    const lock = join(f.admission.paths.journal, 'owner.lock');
    const retainedOwner = readFileSync(lock, 'utf8');
    const attempts = await Promise.allSettled([f.service.destroy(), f.service.destroy()]);
    expect(attempts.map(row => row.status)).toEqual(['rejected', 'rejected']);
    for (const row of attempts) if (row.status === 'rejected') expect(row.reason.code).toBe('process_not_settled');
    expect(terminations).toBe(2); expect(f.child.exitCode).toBeUndefined();
    expect(f.service.inspectOwnedWorker()).toMatchObject({ state: 'unknown', storageOwner: 'current', workerHandle: created.workerHandle });
    expect(f.service.currentOperation()).toBe('Awaiting exact native process cleanup');
    expect(readFileSync(lock, 'utf8')).toBe(retainedOwner);
    expect(observer.ownerStatus()).toBe('elsewhere-or-unverified');
    expect(() => observer.acquire()).toThrow();
    expect(readFileSync(lock, 'utf8')).toBe(retainedOwner);
    await expect(f.service.createOwnedWorker({ actionId: OFFER2 })).rejects.toMatchObject({ code: 'worker_busy' });
    await expect(f.service.offerOwnedTurn({ workerHandle: created.workerHandle, actionId: OFFER, text: 'Forbidden after cleanup began.' })).rejects.toMatchObject({ code: 'worker_not_ready' });
    expect(f.launches).toHaveLength(1); expect(f.received.filter(row => row.method === 'turn/start')).toHaveLength(0);
    f.close();
    // Physical close alone leaves the durable owner retained until its exact service reconciles.
    expect(readFileSync(lock, 'utf8')).toBe(retainedOwner);
    await Promise.all([f.service.destroy(), f.service.destroy()]);
    expect(terminations).toBe(2); expect(existsSync(lock)).toBe(false);
    expect(f.service.inspectOwnedWorker()).toMatchObject({ state: 'retired', storageOwner: 'unclaimed', workerHandle: created.workerHandle });
    expect(f.service.currentOperation()).toBeNull();
    observer.acquire(); expect(observer.ownerStatus()).toBe('current'); observer.release();
    await f.service.destroy();
    expect(f.launches).toHaveLength(1); expect(f.received.filter(row => row.method === 'turn/start')).toHaveLength(0);
  } finally { f.close(); await f.service.destroy(); observer.release(); }
});
