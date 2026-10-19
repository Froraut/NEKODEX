import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { chmodSync, mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VM_PROTOCOL, VmGuestCapture, VmJsonLines, sha256, uniqueVmPaths, validateVmInput } from '../src/execution-environments/protocol';
import { VmJobStore, type VmJobRecord, type VmStoppedReceipt } from '../src/execution-environments/storage';

const actionId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const scope = { protocol: VM_PROTOCOL, actionId, nonce: 'a'.repeat(64) };
const frame = (type: string, fields: Record<string, unknown> = {}) => ({ ...scope, type, ...fields });
const ready = () => frame('ready', { agentVersion: 1, architecture: 'arm64', capability: 'linux-shell' });
const result = (outputs: string[]) => frame('result', { exitCode: 0, signal: null, outputs, stdoutTruncated: false, stderrTruncated: false, errorCode: null });
const begin = (path: string, bytes: Buffer, hash = sha256(bytes)) => frame('output-begin', { path, mode: 0o600, size: bytes.length, sha256: hash });
const chunk = (path: string, bytes: Buffer, offset = 0) => frame('output-chunk', { path, offset, dataBase64: bytes.toString('base64') });
function capture() { const c = new VmGuestCapture(scope, ['result.csv']); c.accept(ready()); return c; }
function complete(c: VmGuestCapture, bytes = Buffer.from('total\n42\n')) {
  c.accept(begin('result.csv', bytes)); c.accept(chunk('result.csv', bytes)); c.accept(frame('output-end', { path: 'result.csv' })); return bytes;
}
function row(id = actionId): VmJobRecord {
  return { version: 1, actionId: id, nonce: scope.nonce, fingerprint: 'b'.repeat(64), configSha256: 'c'.repeat(64), phase: 'prepared', helper: null, launchAttempted: false, updatedAt: Date.now() };
}
function privateStore(run: (store: VmJobStore, home: string) => void) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-vm-contract-'))); chmodSync(home, 0o700);
  const store = new VmJobStore(home);
  try { store.acquire(); run(store, home); } finally { store.releaseLock(); rmSync(home, { recursive: true, force: true }); }
}
function receipt(row: VmJobRecord): VmStoppedReceipt {
  return { protocol: VM_PROTOCOL, actionId: row.actionId, nonce: row.nonce, configSha256: row.configSha256, helperPid: row.helper!.pid,
    vmState: 'stopped', channelsClosed: true, stopEvidence: 'host-stop-completion', reason: 'guest-result', timestampMs: Date.now() };
}
function writeReceipt(store: VmJobStore, row: VmJobRecord, body: VmStoppedReceipt, key = store.receiptKey(row.actionId, row.nonce)) {
  const bytes = Buffer.from(JSON.stringify(body));
  writeFileSync(join(store.jobRoot(row.actionId), 'stopped.json'), JSON.stringify({ bodyBase64: bytes.toString('base64'), macHex: createHmac('sha256', key).update(bytes).digest('hex') }), { mode: 0o600 });
}

describe('isolated VM framing and output contract', () => {
  test('captures the allowed ordered bytes and requires exactly those outputs at result', () => {
    const c = capture(), bytes = complete(c);
    expect(() => c.accept(result([]))).toThrow('vm-output-set-mismatch');
    expect(c.accept(result(['result.csv']))).toBe('result');
    expect(Buffer.from(c.snapshot().outputs[0]!.bytes)).toEqual(bytes);
    const snapshot = c.snapshot(); snapshot.outputs[0]!.bytes[0] = 0;
    expect(Buffer.from(c.snapshot().outputs[0]!.bytes)).toEqual(bytes);
    expect(() => c.accept(frame('stdout', { dataBase64: 'eA==' }))).toThrow('vm-frame-after-result');
  });

  test('rejects foreign scope, paths outside the allowlist, reordered chunks and mismatched content', () => {
    expect(() => capture().accept({ ...begin('result.csv', Buffer.from('x')), nonce: 'd'.repeat(64) })).toThrow('vm-scope-mismatch');
    expect(() => capture().accept(begin('secret.txt', Buffer.from('x')))).toThrow();
    const ordered = capture(); ordered.accept(begin('result.csv', Buffer.from('xy')));
    expect(() => ordered.accept(chunk('result.csv', Buffer.from('y'), 1))).toThrow();
    const hashed = capture(); hashed.accept(begin('result.csv', Buffer.from('x'), sha256('y'))); hashed.accept(chunk('result.csv', Buffer.from('x')));
    expect(() => hashed.accept(frame('output-end', { path: 'result.csv' }))).toThrow('vm-output-hash-mismatch');
    const unfinished = capture(); unfinished.accept(begin('result.csv', Buffer.from('x')));
    expect(() => unfinished.accept(result([]))).toThrow();
  });

  test('bounds incomplete frames and rejects invalid UTF-8 rather than replacing it', () => {
    const messages: unknown[] = [], parser = new VmJsonLines(v => messages.push(v), 16);
    parser.push(Buffer.from('{"ok":')); parser.push(Buffer.from('true}\n'));
    expect(messages).toEqual([{ ok: true }]);
    const missingLf = new VmJsonLines(() => {}, 8); missingLf.push(Buffer.from('12345678'));
    expect(() => missingLf.push(Buffer.from('9'))).toThrow('vm-frame-limit');
    const partial = new VmJsonLines(() => {}); partial.push(Buffer.from('{}'));
    expect(() => partial.end()).toThrow('vm-truncated-frame');
    expect(() => new VmJsonLines(() => {}).push(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d, 10]))).toThrow();
  });

  test('rejects duplicate and ancestor paths even when a sibling sorts between them', () => {
    expect(uniqueVmPaths(['a/x', 'a/y'], 4)).toEqual(['a/x', 'a/y']);
    for (const paths of [['a', 'a'], ['a', 'a/b'], ['a', 'a-b', 'a/c']]) {
      expect(() => uniqueVmPaths(paths, 4)).toThrow('vm-path-collision');
      expect(() => validateVmInput({ script: 'true', files: paths.map(path => ({ path, mode: 0o600, bytes: new Uint8Array() })), outputPaths: [], timeoutMs: 1000 })).toThrow('vm-path-collision');
    }
    for (const path of ['../x', '/x', 'a//b', 'a/./b', 'a\\b']) expect(() => uniqueVmPaths([path], 1)).toThrow('vm-path-invalid');
  });
});

// These are actual store calls with private disposable files; no helper process or VM is launched.
describe.skipIf(process.platform !== 'darwin')('macOS VM global authority and stop receipts', () => {
  test('retains the prior action across lock release, refuses another action and prevents consumed replay', () => privateStore((store, home) => {
    const first = row(); store.begin(first);
    expect(store.heldAction()).toBe(actionId);
    expect(() => store.begin(row(otherId))).toThrow('vm-prior-owner-held');
    store.releaseLock(); const resumed = new VmJobStore(home); resumed.acquire();
    try {
      expect(resumed.heldAction()).toBe(actionId);
      expect(resumed.get(actionId)).toMatchObject({ phase: 'prepared', launchAttempted: false });
      resumed.settle(resumed.get(actionId)!, 'never-started', 'cancelled');
      expect(resumed.heldAction()).toBeUndefined();
      expect(() => resumed.begin(first)).toThrow('vm-action-retained');
      resumed.begin(row(otherId)); expect(resumed.heldAction()).toBe(otherId);
    } finally { resumed.releaseLock(); }
  }));

  test('preserves a pending journal and blocks new mutation after uncertain write', () => privateStore((store, home) => {
    const first = row(); store.begin(first);
    writeFileSync(join(store.jobRoot(actionId), 'job.json.pending'), 'unfinished', { mode: 0o600 });
    expect(() => store.get(actionId)).toThrow('vm-journal-pending');
    expect(() => store.save({ ...first, phase: 'starting' })).toThrow('vm-journal-pending');
    expect(() => store.begin(row(otherId))).toThrow('vm-prior-owner-held');
    writeFileSync(join(home, 'gate.json.pending'), 'unfinished', { mode: 0o600 });
    expect(() => store.heldAction()).toThrow('vm-gate-pending');
    expect(() => store.begin(row(otherId))).toThrow('vm-gate-pending');
  }));

  test('reconciles an exact authenticated terminal gate publication without replaying its action', () => privateStore((store, home) => {
    const first = row(); store.begin(first);
    const gatePath = join(home, 'gate.json'), heldBytes = readFileSync(gatePath);
    store.settle(first, 'never-started', 'cancelled');
    const settled = store.get(actionId)!, releasedBytes = readFileSync(gatePath);
    expect(settled).toMatchObject({ phase: 'settled', outcome: 'never-started', launchAttempted: false });
    // Reconstruct the actual publication boundary using bytes produced by public store operations:
    // terminal job is durable, original gate remains held, exact release has reached .pending.
    writeFileSync(gatePath, heldBytes, { mode: 0o600 });
    writeFileSync(gatePath + '.pending', releasedBytes, { mode: 0o600 });
    expect(() => store.heldAction()).toThrow('vm-gate-pending');
    expect(() => store.begin(row(otherId))).toThrow('vm-gate-pending');
    store.releaseSettled(settled);
    expect(store.heldAction()).toBeUndefined();
    expect(store.get(actionId)).toEqual(settled);
    expect(() => store.begin(first)).toThrow('vm-action-retained');
    store.begin(row(otherId)); expect(store.heldAction()).toBe(otherId);
  }));

  test('authenticates stop bytes and exact action/configuration/helper binding before accepting them', () => privateStore(store => {
    const first = row(); store.begin(first);
    const bound: VmJobRecord = { ...first, phase: 'running', launchAttempted: true, helper: { pid: 12345, start: '10:20' } };
    store.save(bound); expect(store.stopped(bound)).toBeUndefined();
    expect(() => store.settle(bound, 'never-started', 'cancelled')).toThrow('vm-stop-proof-required');
    const body = receipt(bound);
    writeReceipt(store, bound, body, Buffer.alloc(32, 7));
    expect(() => store.stopped(bound)).toThrow('vm-stop-authentication-failed');
    writeReceipt(store, bound, { ...body, configSha256: 'd'.repeat(64) });
    expect(() => store.stopped(bound)).toThrow('vm-stop-identity-mismatch');
    writeReceipt(store, bound, { ...body, helperPid: bound.helper!.pid + 1 });
    expect(() => store.stopped(bound)).toThrow('vm-stop-identity-mismatch');
    writeReceipt(store, bound, body);
    expect(store.stopped(bound)).toEqual(body);
    // A receipt establishes this store's authenticated observation; helper exit/join is the runner's separate check.
    expect(store.heldAction()).toBe(actionId);
  }));
});
