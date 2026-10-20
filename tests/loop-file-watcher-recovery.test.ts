import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, statSync, renameSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url), nativeFs = require('node:fs');
const leafPath = require.resolve('../launcher/electron/loop-file-watcher.cjs');
const { createLoopFileWatcher } = require(leafPath);
const { createLoopFileWatcherRecovery } = require('../launcher/electron/loop-file-watcher-recovery.cjs');

function crashedOwner() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'neko-loop-recovery-'))), project = join(home, 'project'), directory = join(home, 'private');
  mkdirSync(project); const file = join(project, 'selected.txt'), packetFile = join(home, 'core-packet.json'); writeFileSync(file, 'private selected bytes');
  const child = spawnSync(process.execPath, ['-e', `
    const fs = require('node:fs'), { createLoopFileWatcher } = require(process.argv[1]);
    const [directory, project, file, packetFile] = process.argv.slice(2);
    const task = { id:'task',familyId:'family',generation:1,revision:1,cycle:1,mode:'loop',status:'review_required',ownerId:'core',loopRun:{ownerId:'core',generation:1},bounds:{maxTurns:4,maxConcurrent:1,maxSpend:null} };
    const scope = {familyId:'family',generation:1,revision:1};
    const deadline = setTimeout(() => process.exit(24), 1800);
    const service = createLoopFileWatcher({directory,resolveProject:async()=>({id:'project',path:project}),getTask:async()=>({task,loopSourceAuthority:{active:true,runId:'run',ownerId:'core',...scope,cycle:1}}),
      enqueueWork:async body=>{fs.writeFileSync(packetFile,JSON.stringify({...body.work,taskId:'task'}),{mode:0o600});process.exit(23);}});
    (async()=>{const row=await service.select({taskId:'task',scope,projectId:'project',filePath:file});await service.enable({watcherId:row.id,scope,instruction:'Inspect this selected revision.',eventBound:2,explicitUserAction:true});fs.writeFileSync(file,'changed private selected bytes');})().catch(error=>{console.error(error);process.exit(25)});
  `, leafPath, directory, project, file, packetFile], { encoding: 'utf8', timeout: 2500 });
  if (child.error || child.status !== 23 || child.stderr) { rmSync(home, { recursive: true, force: true }); throw new Error(`Crash fixture failed: ${child.error || child.status}: ${child.stderr}`); }
  return { home, project, directory, file, packet: JSON.parse(readFileSync(packetFile, 'utf8')),
    lock: join(directory, 'owner.lock'), registry: join(directory, 'watchers.json'), cleanup: () => rmSync(home, { recursive: true, force: true }) };
}
const request = (review: any) => ({ reviewId: review.reviewId, reviewDigest: review.reviewDigest, explicitUserAction: true });

test('actual crashed watcher owner is explicitly recovered with preserved unknown outbox, default off and no replay', async () => {
  const f = crashedOwner(), recovery = createLoopFileWatcherRecovery({ directory: f.directory }); let service: any;
  const oldLock = statSync(f.lock), oldRegistry = statSync(f.registry), oldBytes = readFileSync(f.registry), original = JSON.parse(oldBytes.toString());
  unlinkSync(f.file);
  const open = nativeFs.openSync; let sourceReads = 0, enqueues = 0, projectResolutions = 0, proof = false;
  nativeFs.openSync = (name: any, ...args: any[]) => { if (typeof name === 'string' && name.startsWith(f.project + '/')) { sourceReads++; throw new Error('Recovery must not open a source file'); } return open(name, ...args); };
  try {
    const review = recovery.review();
    expect(review).toMatchObject({ recoverable: true, sourceCount: 1, eventCounts: { pending: 1, unknown: 0, delivered: 0 }, owner: { state: 'absent' }, contentIncluded: false, startsRun: false });
    const result = recovery.recover(request(review));
    expect(result).toMatchObject({ state: 'completed', terminal: true, ownerHeld: false, recovered: true, sourceCount: 1, unknownCount: 1, enabled: false, startsRun: false });
    const archive = join(f.directory, 'recovery', review.reviewId);
    expect(statSync(join(archive, 'owner.lock')).ino).toBe(oldLock.ino);
    expect(statSync(join(archive, 'watchers.json')).ino).toBe(oldRegistry.ino);
    expect(readFileSync(join(archive, 'watchers.json'))).toEqual(oldBytes);
    const retained = JSON.parse(readFileSync(f.registry, 'utf8'));
    expect(retained.rows[0]).toMatchObject({ enabled: false, events: [{ ...original.rows[0].events[0], state: 'unknown' }] });
    service = createLoopFileWatcher({ directory: f.directory,
      resolveProject: async () => { projectResolutions++; throw new Error('No source grant may be read automatically'); },
      getTask: async (taskId: string, workId: string) => { expect(taskId).toBe('task'); expect(workId).toBe(f.packet.workId); return { workPacket: proof ? f.packet : undefined, workPackets: [] }; },
      enqueueWork: async () => { enqueues++; throw new Error('Recovered enqueue must never replay'); } });
    const ownLock = readFileSync(f.lock), row = service.status().rows[0];
    expect(row).toMatchObject({ enabled: false, events: [{ state: 'unknown' }] });
    expect((await service.reconcile({ watcherId: row.id, eventId: row.events[0].eventId })).events[0].state).toBe('unknown');
    proof = true;
    expect((await service.reconcile({ watcherId: row.id, eventId: row.events[0].eventId })).events[0].state).toBe('delivered');
    expect(service.status().rows[0].enabled).toBe(false);
    expect(recovery.recover(request(review))).toEqual(result);
    expect(recovery.inspect(review.reviewId)).toEqual(result);
    expect(readFileSync(f.lock)).toEqual(ownLock);
    expect({ sourceReads, enqueues, projectResolutions }).toEqual({ sourceReads: 0, enqueues: 0, projectResolutions: 0 });
  } finally { nativeFs.openSync = open; if (service) await service.close(); recovery.close(); f.cleanup(); }
}, 5000);

test('live, unverified and newly live reused PID observations refuse recovery and retain terminal rejection receipts', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'neko-loop-live-recovery-'))), directory = join(home, 'private');
  const service = createLoopFileWatcher({ directory, resolveProject: async () => null, getTask: async () => null, enqueueWork: async () => null });
  const recovery = createLoopFileWatcherRecovery({ directory }), lock = join(directory, 'owner.lock'), original = readFileSync(lock), kill = process.kill;
  try {
    const live = recovery.review(); expect(live).toMatchObject({ recoverable: false, owner: { pid: process.pid, state: 'live' } });
    expect(() => recovery.recover(request(live))).toThrow('live, reused or unverified');
    expect(recovery.inspect(live.reviewId)).toMatchObject({ state: 'rejected', terminal: true, ownerHeld: false, recovered: false });
    (process as any).kill = () => { throw Object.assign(new Error('Permission denied'), { code: 'EPERM' }); };
    const unknown = recovery.review(); expect(unknown).toMatchObject({ recoverable: false, owner: { state: 'unknown' } });
    expect(() => recovery.recover(request(unknown))).toThrow('live, reused or unverified');
    expect(recovery.inspect(unknown.reviewId)).toMatchObject({ state: 'rejected', terminal: true, ownerHeld: false });
    (process as any).kill = () => { throw Object.assign(new Error('Former observation absent'), { code: 'ESRCH' }); };
    const reused = recovery.review(); expect(reused.recoverable).toBe(true);
    process.kill = kill;
    expect(() => recovery.recover(request(reused))).toThrow('live, reused or unverified');
    expect(recovery.inspect(reused.reviewId)).toMatchObject({ state: 'rejected', terminal: true, ownerHeld: false });
    expect(readFileSync(lock)).toEqual(original); expect(service.status().rows).toHaveLength(0);
  } finally { process.kill = kill; await service.close(); recovery.close(); rmSync(home, { recursive: true, force: true }); }
}, 5000);

test('changed reviewed lock or registry and a retained recovery writer cannot be silently adopted or removed', () => {
  const f = crashedOwner(), recovery = createLoopFileWatcherRecovery({ directory: f.directory });
  try {
    let review = recovery.review(); const lockBytes = readFileSync(f.lock), registryBytes = readFileSync(f.registry);
    const replacement = join(f.directory, 'replacement'); writeFileSync(replacement, lockBytes, { mode: 0o600 }); renameSync(replacement, f.lock);
    const replacementIdentity = statSync(f.lock).ino;
    expect(() => recovery.recover(request(review))).toThrow('changed since review');
    expect(recovery.inspect(review.reviewId)).toMatchObject({ state: 'rejected', terminal: true, ownerHeld: false });
    expect(statSync(f.lock).ino).toBe(replacementIdentity); expect(readFileSync(f.registry)).toEqual(registryBytes);
    review = recovery.review(); writeFileSync(replacement, registryBytes, { mode: 0o600 }); renameSync(replacement, f.registry);
    const registryIdentity = statSync(f.registry).ino;
    expect(() => recovery.recover(request(review))).toThrow('changed since review');
    expect(statSync(f.registry).ino).toBe(registryIdentity); expect(readFileSync(f.lock)).toEqual(lockBytes);
    const gate = join(f.directory, 'recovery.lock'), gateBytes = JSON.stringify({ pid: process.pid, nonce: randomUUID(), recoveryId: randomUUID() });
    writeFileSync(gate, gateBytes, { mode: 0o600 }); review = recovery.review();
    expect(review).toMatchObject({ recoverable: false, reason: 'recovery_in_progress' });
    expect(() => recovery.recover(request(review))).toThrow('Another Loop recovery writer');
    expect(() => createLoopFileWatcher({ directory: f.directory, resolveProject: async () => null, getTask: async () => null, enqueueWork: async () => null })).toThrow('owner recovery is retained');
    expect(readFileSync(gate, 'utf8')).toBe(gateBytes); expect(readFileSync(f.lock)).toEqual(lockBytes); expect(readFileSync(f.registry)).toEqual(registryBytes);
  } finally { recovery.close(); f.cleanup(); }
}, 5000);

test('fresh controller discovers the exact retained transaction after a recovery process crashes after registry archive', () => {
  const f = crashedOwner(), recoveryModule = require.resolve('../launcher/electron/loop-file-watcher-recovery.cjs'), attemptFile = join(f.home, 'recovery-attempt.json');
  try {
    const originalOwner = readFileSync(f.lock), originalRegistry = readFileSync(f.registry);
    const child = spawnSync(process.execPath, ['-e', `
      const fs = require('node:fs'), {createLoopFileWatcherRecovery} = require(process.argv[1]);
      const [directory,attemptFile] = process.argv.slice(2), recovery = createLoopFileWatcherRecovery({directory});
      const review = recovery.review(); fs.writeFileSync(attemptFile,JSON.stringify(review),{mode:0o600});
      const rename = fs.renameSync;
      fs.renameSync = (from,to) => { rename(from,to); if (from === directory + '/watchers.json') process.exit(29); };
      recovery.recover({reviewId:review.reviewId,reviewDigest:review.reviewDigest,explicitUserAction:true});
      process.exit(30);
    `, recoveryModule, f.directory, attemptFile], { encoding: 'utf8', timeout: 2000 });
    expect(child.error).toBeUndefined(); expect(child.status).toBe(29); expect(child.stderr).toBe('');
    const attempted = JSON.parse(readFileSync(attemptFile, 'utf8')), gate = join(f.directory, 'recovery.lock');
    const gateBytes = readFileSync(gate), receiptPath = join(f.directory, 'recovery', attempted.reviewId, 'receipt.json'), receiptBytes = readFileSync(receiptPath);
    rmSync(f.project, { recursive: true, force: true });
    const fresh = createLoopFileWatcherRecovery({ directory: f.directory });
    const discovered = fresh.review();
    expect(discovered).toMatchObject({ recoverable: false, reason: 'recovery_in_progress', retainedRecovery: {
      recoveryId: attempted.reviewId, receipt: { recoveryId: attempted.reviewId, state: 'unknown', terminal: false, ownerHeld: true, recovered: false, sourceCount: 1, unknownCount: 1 },
    } });
    expect(discovered.retainedRecovery.recoveryId).not.toBe(discovered.reviewId);
    expect(fresh.inspect(discovered.retainedRecovery.recoveryId)).toEqual(discovered.retainedRecovery.receipt);
    fresh.close();
    expect(readFileSync(gate)).toEqual(gateBytes); expect(readFileSync(receiptPath)).toEqual(receiptBytes); expect(readFileSync(f.lock)).toEqual(originalOwner);
    expect(readFileSync(join(f.directory, 'recovery', attempted.reviewId, 'watchers.json'))).toEqual(originalRegistry);
    expect(nativeFs.existsSync(f.registry)).toBe(false);
  } finally { f.cleanup(); }
}, 5000);
