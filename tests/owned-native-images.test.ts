import { afterEach, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
const require = createRequire(import.meta.url);
const { createOwnedNativeWorkerService } = require('../launcher/electron/owned-native-worker.cjs');
const { makeAdmission, digest } = require('../launcher/electron/owned-native-admission.cjs');
const { validateOwnedNativeImages, ownedNativeImageMetadata, ownedNativeInputHash } = require('../launcher/electron/owned-native-images.cjs');
const baseCatalog = require('./fixtures/owned-native-model.cjs');
const macTest = process.platform === 'darwin' ? test : test.skip;
const roots: string[] = [];
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNg+A8AAQIBAEK+vGgAAAAASUVORK5CYII=';
function image(overrides: any = {}) {
  return { data: PNG, mimeType: 'image/png', width: 1, height: 1, byteLength: Buffer.from(PNG, 'base64').length,
    sha256: digest(Buffer.from(PNG, 'base64')), source: { toolCallId: 'capture-1', receipt: 'approved-local-fixture', attachmentIndex: 0 }, ...overrides };
}
function paddedImage(byteLength: number) {
  const bytes = Buffer.from(PNG, 'base64'), chunk = Buffer.alloc(byteLength - bytes.length);
  chunk.writeUInt32BE(chunk.length - 12); chunk.write('tEXt', 4);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  const padded = Buffer.concat([bytes.subarray(0, -12), chunk, bytes.subarray(-12)]);
  return image({ data: padded.toString('base64'), byteLength: padded.length, sha256: digest(padded) });
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function configuration(imageInput = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-native-images-'))); roots.push(root);
  mkdirSync(join(root, 'package', 'bin'), { recursive: true });
  const executable = join(root, 'package', 'bin', 'codex');
  writeFileSync(executable, 'inert native image fixture', { mode: 0o700 });
  writeFileSync(join(root, 'package', 'codex-package.json'), JSON.stringify({ version: '0.163.0', layoutVersion: 1,
    entrypoint: 'bin/codex', variant: 'codex', target: 'aarch64-apple-darwin' }), { mode: 0o600 });
  const catalog = JSON.parse(baseCatalog.json); catalog.models[0].input_modalities = imageInput ? ['text', 'image'] : ['text'];
  const json = JSON.stringify(catalog);
  return { executable, executableSha256: digest(readFileSync(executable)), authorityHome: join(root, 'authority'),
    catalog: { json, modelId: baseCatalog.modelId, sha256: digest(json) },
    route: { kind: 'local-fixture', baseUrl: 'http://127.0.0.1:12345/v1' },
    testHooks: { probeManagedPreferences: () => {} }, requestTimeoutMs: 50, terminalTimeoutMs: 80, stopGraceMs: 5 };
}
function fixture(config = configuration()) {
  const admission = makeAdmission(config), child: any = new EventEmitter(), received: any[] = [];
  const threadId = randomUUID(); let onTurn: any, closed = false;
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const respond = (message: any, result: any) => child.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
  const event = (method: string, params: any) => child.stdout.write(`${JSON.stringify({ method, params })}\n`);
  const close = () => { if (!closed) { closed = true; child.emit('close', 0, null); } };
  child.stdin = new Writable({ write(chunk, _encoding, done) {
    const message = JSON.parse(String(chunk)); received.push(message);
    queueMicrotask(() => {
      if (message.method === 'initialize') respond(message, { codexHome: admission.paths.codexHome, userAgent: 'inert image fixture' });
      if (message.method === 'config/read') respond(message, { config: admission.config, origins: {}, layers: [
        { name: { type: 'user', file: admission.paths.config, profile: null }, config: admission.config, version: '1', disabledReason: null }] });
      if (message.method === 'configRequirements/read') respond(message, { requirements: null });
      if (message.method === 'thread/start') respond(message, { thread: { id: threadId, ephemeral: true,
        forkedFromId: null, parentThreadId: null, status: { type: 'idle' } }, model: baseCatalog.modelId,
        modelProvider: 'nekodex_fixture', cwd: admission.paths.cwd, instructionSources: [], approvalPolicy: 'never',
        approvalsReviewer: 'user', sandbox: { type: 'readOnly' } });
      if (message.method === 'turn/start') onTurn?.(message);
    }); done();
  } });
  child.stdin.on('finish', close);
  const service = createOwnedNativeWorkerService({ ...config, testHooks: { ...config.testHooks,
    spawnProcess: () => child, terminateProcess: close } });
  const complete = (message: any, content = message.params.input) => {
    const turnId = randomUUID(), params = { threadId, turnId, completedAtMs: 1000 };
    respond(message, { turn: { id: turnId, status: 'inProgress' } });
    queueMicrotask(() => {
      event('item/completed', { ...params, item: { type: 'userMessage', id: `u-${turnId}`,
        clientId: message.params.clientUserMessageId, content } });
      event('item/completed', { ...params, item: { type: 'agentMessage', id: `a-${turnId}`, text: 'fixture final', phase: 'final_answer' } });
      event('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
    });
  };
  return { service, config, admission, received, complete, close, get closed() { return closed; }, set onTurn(value: any) { onTurn = value; } };
}

test('typed image helper binds canonical bytes, dimensions and provenance without embedding bytes in metadata', () => {
  const images = [image()];
  expect(validateOwnedNativeImages(images)).toEqual(images);
  expect(ownedNativeInputHash('text')).toBe(digest('text'));
  expect(ownedNativeInputHash('text', images)).not.toBe(digest('text'));
  expect(ownedNativeImageMetadata(images)[0]).not.toHaveProperty('data');
  for (const bad of [image({ data: `${PNG}\n` }), image({ width: 2 }), image({ sha256: '0'.repeat(64) }),
    image({ mimeType: 'image/jpeg' }), image({ path: '/not-authorized' }), image({ data: 'http://example.invalid/a.png' })]) {
    expect(() => validateOwnedNativeImages([bad])).toThrow();
  }
  const bytes = Buffer.alloc(160 * 1024 + 1);
  expect(() => validateOwnedNativeImages([image({ data: bytes.toString('base64'), byteLength: bytes.length, sha256: digest(bytes) })])).toThrow();
  expect(() => validateOwnedNativeImages([paddedImage(90 * 1024), paddedImage(90 * 1024)])).toThrow();
});

macTest('one inert physical owner echoes typed images and durable binding budget survives facade replacement', async () => {
  const f = fixture(); const created = await f.service.createOwnedWorker({ actionId: randomUUID() });
  f.onTurn = (message: any) => f.complete(message);
  try {
    for (let index = 0; index < 2; index++) {
      const images = [{ ...paddedImage(80 * 1024), source: { toolCallId: `capture-${index}`, receipt: 'approved-local-fixture', attachmentIndex: 0 } }];
      const receipt = await f.service.offerOwnedTurn({ workerHandle: created.workerHandle, actionId: randomUUID(), text: 'Inspect screenshot.', images });
      expect(receipt.state).toBe('completed'); expect(receipt.inputAuthorship).toBe('automatic-host');
      expect(receipt.inputHash).toBe(ownedNativeInputHash('Inspect screenshot.', images));
      expect(receipt.imageAttachments).toEqual(ownedNativeImageMetadata(images));
      expect(receipt.canonicalItems[0].imageAttachments).toEqual(receipt.imageAttachments);
      expect(JSON.stringify(receipt)).not.toContain(PNG);
    }
    expect(f.received.filter(row => row.method === 'turn/start')[0].params.input[1]).toEqual({ type: 'image', url: `data:image/png;base64,${paddedImage(80 * 1024).data}`, detail: 'high' });
    await expect(f.service.offerOwnedTurn({ workerHandle: created.workerHandle, actionId: randomUUID(), text: 'over budget', images: [image()] })).rejects.toMatchObject({ code: 'image_budget_exceeded' });
    expect(f.received.filter(row => row.method === 'turn/start')).toHaveLength(2);
    await f.service.retireOwnedWorker({ workerHandle: created.workerHandle, actionId: randomUUID() });
  } finally { await f.service.destroy(); }
  expect(f.closed).toBe(true);
  const replacement = fixture(f.config);
  try {
    const next = await replacement.service.createOwnedWorker({ actionId: randomUUID() });
    await expect(replacement.service.offerOwnedTurn({ workerHandle: next.workerHandle, actionId: randomUUID(), text: 'restart cannot reset', images: [image()] })).rejects.toMatchObject({ code: 'image_budget_exceeded' });
    expect(replacement.received.filter(row => row.method === 'turn/start')).toHaveLength(0);
  } finally { await replacement.service.destroy(); }
});

macTest('image capability absence rejects before a turn; fileId rewrite holds uncertain image offer and physical ownership', async () => {
  const unsupported = fixture(configuration(false));
  try {
    const created = await unsupported.service.createOwnedWorker({ actionId: randomUUID() });
    await expect(unsupported.service.offerOwnedTurn({ workerHandle: created.workerHandle, actionId: randomUUID(), text: 'image', images: [image()] })).rejects.toMatchObject({ code: 'image_input_unsupported' });
    expect(unsupported.received.filter(row => row.method === 'turn/start')).toHaveLength(0);
  } finally { await unsupported.service.destroy(); }
  const drift = fixture();
  try {
    const created = await drift.service.createOwnedWorker({ actionId: randomUUID() });
    drift.onTurn = (message: any) => drift.complete(message, [message.params.input[0], { type: 'image', fileId: 'untrusted-upload-id', detail: 'high' }]);
    const receipt = await drift.service.offerOwnedTurn({ workerHandle: created.workerHandle, actionId: randomUUID(), text: 'same text', images: [image()] });
    expect(receipt).toMatchObject({ state: 'unknown', ownerHeld: true, reasonCode: 'canonical_image_mismatch' });
    expect(drift.closed).toBe(false); expect(drift.service.currentOperation()).not.toBeNull();
    await expect(drift.service.offerOwnedTurn({ workerHandle: created.workerHandle, actionId: randomUUID(), text: 'no replay', images: [image()] })).rejects.toMatchObject({ code: 'worker_not_ready' });
    expect(drift.service.inspectOwnedWorker().receipts.at(-1).imageAttachments).toHaveLength(1);
  } finally { await drift.service.destroy(); }
  expect(drift.closed).toBe(true);
});
