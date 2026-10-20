import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, existsSync, unlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { createNativeAccountAuthority } = require('../launcher/electron/native-account-authority.cjs');
const { observeNativeRecoveryProcesses, NATIVE_RECOVERY_OBSERVER_SOURCE } = require('../launcher/electron/native-recovery-processes.cjs');
const { SOURCE, VERSION } = require('../launcher/electron/owned-native-admission.cjs');
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function fixture(hooks: any = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-owner-recovery-'))), authorityHome = join(root, 'accounts'), executionRoot = join(root, 'execution'), inventoryRoot = join(root, 'inventory');
  const profileId = randomUUID(), epoch = randomUUID(), serverGeneration = randomUUID(), actionId = randomUUID(), admissionId = sha('model-admission');
  const profile = join(authorityHome, 'profiles', profileId, 'epochs', epoch), generation = join(executionRoot, serverGeneration), binding = join(generation, 'bindings', sha('binding'));
  const dir = (file: string) => mkdirSync(file, { recursive: true, mode: 0o700 });
  for (const file of [profile, binding, inventoryRoot]) dir(file);
  const write = (file: string, value: any) => writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
  const executable = join(root, 'official-codex'), wrapper = join(root, 'reviewed-wrapper'); write(executable, 'inert CLI fixture'); write(wrapper, 'inert wrapper fixture');
  const pid = 99999999, lock = join(authorityHome, 'owner.lock'), executionLock = join(profile, '.execution-owner');
  write(lock, { pid, nonce: randomUUID() }); write(executionLock, { pid, actionId, serverGeneration });
  write(join(authorityHome, 'registry.json'), { version: 1, source: SOURCE, cliVersion: VERSION, profiles: [{ id: profileId, epoch, state: 'signed-in-checking', label: 'Recovery fixture' }], receipts: [{ actionId: randomUUID(), profileId, epoch, kind: 'cancel-login', state: 'settled' }] });
  write(join(generation, 'generation.json'), { version: 1, profileId, epoch, serverGeneration, inventoryActionId: randomUUID(), modelAdmissions: [{ admissionId }] });
  const actionsFile = join(binding, 'actions.json'), journalLock = join(binding, 'owner.lock');
  write(actionsFile, { version: 1, admissionId, actions: ['completed', 'unknown', 'prepared'].map(state => ({ actionId: randomUUID(), workerHandle: randomUUID(), inputHash: sha(state), retired: state === 'completed', ownerHeld: state === 'unknown', state, observations: [{ state, ownerHeld: state === 'unknown', turnId: null, timestampMs: 1 }] })) });
  write(journalLock, { pid, nonce: randomUUID() });
  // These files are deliberate unreadable-route sentinels, never auth fixtures.
  dir(join(profile, 'codex')); write(join(profile, 'codex', 'auth.json'), 'DO NOT OPEN'); write(join(profile, 'codex', 'config.toml'), 'DO NOT OPEN');
  let calls = 0, defer: (() => Promise<void>) | undefined;
  const create = () => createNativeAccountAuthority({ authorityHome, executable, executableSha256: sha(readFileSync(executable)),
    recovery: { executionRoot, inventoryRoot, getWorkerPin: async () => ({ executable: wrapper, executableSha256: sha(readFileSync(wrapper)) }), getMetadataRuntimePin: async () => ({ bunPath: wrapper, bunSha256: sha(readFileSync(wrapper)) }) },
    testHooks: { platform: 'darwin', recovery: { ...hooks, observeProcesses: async (input: any) => { calls++; await defer?.(); return hooks.observeProcesses ? hooks.observeProcesses(input, calls) : { complete: true, matches: [], former: input.formerPids.map((pid: number) => ({ pid, absent: true })) }; } } } });
  const authority = create();
  return { root, authorityHome, profile, lock, executionLock, actionsFile, journalLock, authority, create, write, calls: () => calls, defer: (value: typeof defer) => { defer = value; }, async close() { await authority.destroy(); rmSync(root, { recursive: true, force: true }); } };
}

test('explicit review archives only exact known markers, root last, and preserves uncertain original actions without replay', async () => {
  const order: number[] = [], f = fixture({ afterRename: (index: number) => order.push(index) });
  const actions = readFileSync(f.actionsFile), journal = readFileSync(f.journalLock), original = [f.executionLock, f.lock].map(file => ({ bytes: readFileSync(file), ino: lstatSync(file).ino }));
  const nodeFs = require('node:fs'), open = nodeFs.openSync;
  nodeFs.openSync = (file: any, ...args: any[]) => { if (typeof file === 'string' && /(?:auth\.json|config\.toml)$/.test(file)) throw new Error('Forbidden profile input opened'); return open(file, ...args); };
  try {
    expect(f.authority.inspect()).toMatchObject({ storageOwner: 'stale', activeCount: 0, recoverySupported: true }); expect(f.calls()).toBe(0);
    const preview = await f.authority.previewRecovery(), duplicatePreview = await f.authority.previewRecovery();
    expect(preview).toMatchObject({ state: 'reviewable', unsettledActionCount: 2 }); expect(duplicatePreview.reviewDigest).toBe(preview.reviewDigest);
    expect(preview.markers.map((row: any) => row.kind)).toEqual(['execution', 'authority']);
    const actionId = randomUUID(), result = await f.authority.recoverOwner({ actionId, reviewDigest: preview.reviewDigest });
    expect(result).toMatchObject({ actionId, state: 'completed', archivedCount: 2, unsettledActionCount: 2, ownerHeld: false, terminal: true });
    expect(order).toEqual([0, 1]); expect(existsSync(f.lock)).toBe(false); expect(existsSync(f.executionLock)).toBe(false);
    for (let i = 0; i < 2; i++) { const file = join(f.authorityHome, 'owner-recovery', actionId, `marker-${i}.json`); expect(readFileSync(file)).toEqual(original[i].bytes); expect(lstatSync(file).ino).toBe(original[i].ino); }
    expect(readFileSync(f.actionsFile)).toEqual(actions); expect(readFileSync(f.journalLock)).toEqual(journal);
    const calls = f.calls(); expect(await f.authority.recoverOwner({ actionId, reviewDigest: preview.reviewDigest })).toEqual(result); expect(f.calls()).toBe(calls);
    expect(f.authority.inspect()).toMatchObject({ storageOwner: 'unclaimed', activeCount: 0 });
  } finally { nodeFs.openSync = open; await f.close(); }
});

test('live/orphan/carrier proof and changed review refuse retirement before any durable recovery action', async () => {
  const f = fixture({ observeProcesses: (input: any, count: number) => ({ complete: true, matches: count > 1 ? [{ pid: 123, executable: '/usr/bin/sandbox-exec' }] : [], former: input.formerPids.map((pid: number) => ({ pid, absent: true })) }) });
  try {
    const preview = await f.authority.previewRecovery(), actionId = randomUUID();
    await expect(f.authority.recoverOwner({ actionId, reviewDigest: preview.reviewDigest })).rejects.toMatchObject({ actionRecorded: false, code: 'recovery_physical_owner_unverified' });
    expect(f.authority.inspectRecovery(actionId)).toBeUndefined(); expect(existsSync(f.lock)).toBe(true); expect(existsSync(f.executionLock)).toBe(true);
  } finally { await f.close(); }
  const changed = fixture();
  try {
    const preview = await changed.authority.previewRecovery(); const bytes = readFileSync(changed.executionLock); unlinkSync(changed.executionLock); writeFileSync(changed.executionLock, bytes, { mode: 0o600 });
    await expect(changed.authority.recoverOwner({ actionId: randomUUID(), reviewDigest: preview.reviewDigest })).rejects.toMatchObject({ actionRecorded: false, code: 'recovery_review_changed' });
    expect(existsSync(changed.lock)).toBe(true);
  } finally { await changed.close(); }
});

test('partial archive remains unknown and held; exact complete archive reconciliation never renames or replays again', async () => {
  for (const failureIndex of [0, 1]) {
    const f = fixture({ afterRename(index: number) { if (index === failureIndex) throw new Error('Simulated interruption after rename'); } });
    const actions = readFileSync(f.actionsFile), preview = await f.authority.previewRecovery(), actionId = randomUUID();
    try {
      await expect(f.authority.recoverOwner({ actionId, reviewDigest: preview.reviewDigest })).rejects.toMatchObject({ actionRecorded: true });
      const calls = f.calls(), fresh = f.create(), receipt = fresh.inspectRecovery(actionId); expect(f.calls()).toBe(calls);
      if (failureIndex === 0) {
        expect(receipt).toMatchObject({ state: 'unknown', ownerHeld: true, terminal: false, archivedCount: 1 });
        expect(fresh.inspect().activeCount).toBe(1); expect(await fresh.previewRecovery()).toMatchObject({ state: 'blocked' });
        await expect(fresh.destroy()).rejects.toMatchObject({ code: 'recovery_owner_held' });
        // Test-only disposal after validating held ownership; no product auto cleanup.
        rmSync(join(f.authorityHome, 'owner-recovery', 'owner.lock'));
        rmSync(join(f.authorityHome, 'owner-recovery', actionId), { recursive: true });
        await fresh.destroy();
      } else { expect(receipt).toMatchObject({ state: 'completed', ownerHeld: false, terminal: true, archivedCount: 2 }); await fresh.destroy(); }
      expect(readFileSync(f.actionsFile)).toEqual(actions);
    } finally { await f.close(); }
  }
});

test('malformed/missing canonical ownership is blocked and preview lifecycle gates mutation and joins close', async () => {
  const f = fixture();
  try {
    f.write(f.executionLock, { pid: 99999999, actionId: randomUUID(), serverGeneration: 'malformed' });
    expect(await f.authority.previewRecovery()).toMatchObject({ state: 'blocked' }); expect(existsSync(f.lock)).toBe(true);
  } finally { await f.close(); }
  const pending = fixture(); let release!: () => void, entered!: () => void; const observed = new Promise<void>(resolve => { entered = resolve; });
  pending.defer(() => { entered(); return new Promise<void>(resolve => { release = resolve; }); });
  const diagnostic = pending.authority.previewRecovery();
  try {
    await observed;
    expect(pending.authority.inspect().activeCount).toBe(1); expect(pending.authority.currentOperation()).toBe('Native owner recovery');
    expect(() => pending.authority.prepareProfile({ actionId: randomUUID(), label: 'Must not overlap' })).toThrow();
    let closed = false; const close = pending.authority.destroy().then(() => { closed = true; });
    expect(closed).toBe(false); release(); await diagnostic; await close; expect(closed).toBe(true);
  } finally { release?.(); await pending.close(); }
});

test('terminal receipt written before gate unlink is reconciled exactly after interrupted cleanup', async () => {
  const f = fixture(), preview = await f.authority.previewRecovery(), actionId = randomUUID();
  const gate = join(f.authorityHome, 'owner-recovery', 'owner.lock'), receipt = join(f.authorityHome, 'owner-recovery', actionId, 'receipt.json');
  const nodeFs = require('node:fs'), unlink = nodeFs.unlinkSync, rename = nodeFs.renameSync;
  const failure = () => Object.assign(new Error('Simulated storage interruption'), { code: 'EIO' });
  nodeFs.unlinkSync = (file: string) => { if (file === gate) throw failure(); return unlink(file); };
  nodeFs.renameSync = (from: string, to: string) => { if (to === receipt && JSON.parse(readFileSync(from, 'utf8')).state === 'unknown') throw failure(); return rename(from, to); };
  try {
    await expect(f.authority.recoverOwner({ actionId, reviewDigest: preview.reviewDigest })).rejects.toMatchObject({ actionRecorded: true });
    expect(JSON.parse(readFileSync(receipt, 'utf8'))).toMatchObject({ state: 'completed', ownerHeld: false }); expect(existsSync(gate)).toBe(true);
  } finally { nodeFs.unlinkSync = unlink; nodeFs.renameSync = rename; }
  try {
    const calls = f.calls(), fresh = f.create();
    expect(fresh.inspect().activeCount).toBe(1);
    expect(fresh.inspectRecovery(actionId)).toMatchObject({ state: 'completed', terminal: true, ownerHeld: false, archivedCount: 2 });
    expect(existsSync(gate)).toBe(false); expect(f.calls()).toBe(calls);
    expect(await fresh.recoverOwner({ actionId, reviewDigest: preview.reviewDigest })).toMatchObject({ state: 'completed', archivedCount: 2 });
    expect(f.calls()).toBe(calls);
    expect(fresh.prepareProfile({ actionId: randomUUID(), label: 'Explicit new profile, no login' })).toMatchObject({ state: 'fresh' });
    await fresh.destroy();
  } finally { await f.close(); }
});

test('fixed observer rejects a still-live former parent before enumeration can miss its later orphan', () => {
  let listed = false, output = '';
  const process = { argv: ['', '', 'fixture'], pid: 700, getuid: () => 501, kill: () => {}, stdout: { write: (text: string) => { output += text; } }, exitCode: 0 };
  const source = NATIVE_RECOVERY_OBSERVER_SOURCE.replace(/^import[^\n]*\n/gm, '');
  new Function('process', 'Buffer', 'dlopen', 'ptr', 'readFileSync', source)(process, Buffer,
    () => ({ symbols: { proc_listpids: () => { listed = true; throw new Error('Parent could spawn then exit here'); } }, close() {} }), (value: any) => value,
    () => JSON.stringify({ uid: 501, paths: ['/trusted/codex'], formerPids: [123] }));
  expect(JSON.parse(output)).toMatchObject({ complete: false, reasonCode: 'former_owner_live' }); expect(listed).toBe(false);
});

test('fixed observer rejects owned workers from another checkout or renamed after launch without exposing their paths', () => {
  for (const executable of ['/other-checkout/nekodex-owned-native-worker', '/renamed/worker-artifact']) {
    let output = '';
    const process = { argv: ['', '', 'fixture'], pid: 700, getuid: () => 501, kill: () => {}, stdout: { write: (text: string) => { output += text; } }, exitCode: 0 };
    const source = NATIVE_RECOVERY_OBSERVER_SOURCE.replace(/^import[^\n]*\n/gm, '');
    new Function('process', 'Buffer', 'dlopen', 'ptr', 'readFileSync', source)(process, Buffer, () => ({ close() {}, symbols: {
      proc_listpids(_type: number, _uid: number, bytes: Buffer) { bytes.writeInt32LE(123, 0); bytes.writeInt32LE(700, 4); return 8; },
      proc_pidinfo(pid: number, _kind: number, _arg: number, bytes: Buffer) { bytes.writeUInt32LE(pid, 12); bytes.writeUInt32LE(501, 20); bytes.write('nekodex-owned-native-worker', 64); bytes.writeBigUInt64LE(1n, 120); bytes.writeBigUInt64LE(2n, 128); return 136; },
      proc_pidpath(_pid: number, bytes: Buffer) { bytes.write(executable); return Buffer.byteLength(executable); },
    } }), (value: any) => value, () => JSON.stringify({ uid: 501, paths: ['/current/worker'], formerPids: [] }));
    expect(JSON.parse(output)).toMatchObject({ complete: true, matches: [{ pid: 123, role: 'owned-worker', start: '1:2' }] });
    expect(output).not.toContain(executable); expect(output).not.toContain('nativeName');
  }
});

test('path-unavailable exclusion requires stable noncandidate kernel accounting image and never trusts mutable long name alone', () => {
  const ordinary = { short: 'unrelated-daem', long: 'Unrelated vendor image', status: 2, flags: 0x4000, start: 1n };
  for (const [before, after, excluded] of [
    [ordinary, ordinary, true],
    [{ ...ordinary, short: 'codex', long: 'apparently-unrelated' }, { ...ordinary, short: 'codex', long: 'apparently-unrelated' }, false],
    [{ ...ordinary, short: 'nekodex-owned-n' }, { ...ordinary, short: 'nekodex-owned-n' }, false],
    [{ ...ordinary, short: 'sandbox-exec' }, { ...ordinary, short: 'sandbox-exec' }, false],
    [{ ...ordinary, long: 'nekodex-owned-native-worker' }, { ...ordinary, long: 'nekodex-owned-native-worker' }, false],
    [ordinary, { ...ordinary, status: 4 }, false], [ordinary, { ...ordinary, flags: 0 }, false],
    [ordinary, { ...ordinary, start: 2n }, false], [ordinary, { ...ordinary, short: 'changed-image' }, false],
    [{ ...ordinary, short: '' }, { ...ordinary, short: '' }, false],
  ] as const) {
    let output = '', observations = 0;
    const process = { argv: ['', '', 'fixture'], pid: 700, getuid: () => 501, kill: () => {}, stdout: { write: (text: string) => { output += text; } }, exitCode: 0 };
    const source = NATIVE_RECOVERY_OBSERVER_SOURCE.replace(/^import[^\n]*\n/gm, '');
    new Function('process', 'Buffer', 'dlopen', 'ptr', 'readFileSync', source)(process, Buffer, () => ({ close() {}, symbols: {
      proc_listpids(_type: number, _uid: number, bytes: Buffer) { bytes.writeInt32LE(123, 0); bytes.writeInt32LE(700, 4); return 8; },
      proc_pidinfo(pid: number, _kind: number, _arg: number, bytes: Buffer) { const row = observations++ ? after : before; bytes.writeUInt32LE(row.flags, 0); bytes.writeUInt32LE(row.status, 4); bytes.writeUInt32LE(pid, 12); bytes.writeUInt32LE(501, 20); bytes.write(row.short, 48); bytes.write(row.long, 64); bytes.writeBigUInt64LE(row.start, 120); bytes.writeBigUInt64LE(0n, 128); return 136; },
      proc_pidpath() { return 0; },
    } }), (value: any) => value, () => JSON.stringify({ uid: 501, paths: ['/qualified/codex', '/reviewed/nekodex-owned-native-worker', '/usr/bin/sandbox-exec'], formerPids: [] }));
    expect(JSON.parse(output)).toMatchObject(excluded ? { complete: true, matches: [] } : { complete: false, reasonCode: 'uninspectable_process_path' });
    expect(output).not.toContain(ordinary.short); expect(output).not.toContain(ordinary.long);
  }
  for (const mode of ['removed-absent', 'removed-live-or-reused', 'added-worker', 'added-unrelated']) {
    let output = '', lists = 0;
    const removed = mode.startsWith('removed'), worker = mode === 'added-worker';
    const process = { argv: ['', '', 'fixture'], pid: 700, getuid: () => 501,
      kill: () => { if (mode === 'removed-absent') throw Object.assign(new Error('Kernel confirms absence'), { code: 'ESRCH' }); },
      stdout: { write: (text: string) => { output += text; } }, exitCode: 0 };
    const source = NATIVE_RECOVERY_OBSERVER_SOURCE.replace(/^import[^\n]*\n/gm, '');
    new Function('process', 'Buffer', 'dlopen', 'ptr', 'readFileSync', source)(process, Buffer, () => ({ close() {}, symbols: {
      proc_listpids(_type: number, _uid: number, bytes: Buffer) { const ids = lists++ === 0 ? (removed ? [123, 700] : [700]) : (removed ? [700] : [123, 700]); ids.forEach((pid, i) => bytes.writeInt32LE(pid, i * 4)); return ids.length * 4; },
      proc_pidinfo(pid: number, _kind: number, _arg: number, bytes: Buffer) { bytes.writeUInt32LE(0x4000, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(pid, 12); bytes.writeUInt32LE(501, 20); bytes.write(worker ? 'nekodex-owned-n' : ordinary.short, 48); bytes.write(worker ? 'nekodex-owned-native-worker' : ordinary.long, 64); bytes.writeBigUInt64LE(1n, 120); bytes.writeBigUInt64LE(0n, 128); return 136; },
      proc_pidpath(_pid: number, bytes: Buffer) { const file = worker ? '/other-checkout/nekodex-owned-native-worker' : '/unrelated/application'; bytes.write(file); return Buffer.byteLength(file); },
    } }), (value: any) => value, () => JSON.stringify({ uid: 501, paths: ['/qualified/codex'], formerPids: [] }));
    expect(JSON.parse(output)).toMatchObject(mode === 'removed-live-or-reused' ? { complete: false, reasonCode: 'process_inventory_changed' }
      : { complete: true, matches: worker ? [{ pid: 123, role: 'owned-worker' }] : [] });
    expect(lists).toBe(2);
  }
});

test.skipIf(process.platform !== 'darwin')('actual bounded macOS libproc observer sees exact trusted executable/start without exposing argv', async () => {
  const bunPath = realpathSync(process.execPath), bunSha256 = sha(readFileSync(bunPath));
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-observer-fixture-'))), bunfig = join(root, 'bunfig.toml');
  writeFileSync(bunfig, '[install]\nauto = "disable"\n', { mode: 0o400 });
  const child = Bun.spawn([bunPath, '--no-install', '--no-env-file', `--config=${bunfig}`, '--eval', 'setInterval(()=>{},1000)', 'SYNTHETIC-ARGV-MUST-NOT-LEAK'],
    { cwd: root, env: { HOME: root, TMPDIR: root, PATH: '/usr/bin:/bin' }, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  try {
    const proof = await observeNativeRecoveryProcesses({ getMetadataRuntimePin: async () => ({ bunPath, bunSha256 }), paths: [bunPath], formerPids: [] });
    expect(proof).toMatchObject({ complete: true, uid: process.getuid() });
    expect(proof.matches.find((row: any) => row.pid === child.pid)).toMatchObject({ executable: bunPath, uid: process.getuid() });
    expect(proof.matches.find((row: any) => row.pid === child.pid).start).toMatch(/^\d+:\d+$/);
    expect(JSON.stringify(proof)).not.toContain('SYNTHETIC-ARGV'); expect(JSON.stringify(proof)).not.toContain('--eval');
  } finally { child.kill('SIGKILL'); await child.exited; rmSync(root, { recursive: true, force: true }); }
}, 12000);
