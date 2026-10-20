import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, linkSync, renameSync, watch, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { createLoopFileWatcher } = createRequire(import.meta.url)('../launcher/electron/loop-file-watcher.cjs');
const { registerLoopFileWatcher } = createRequire(import.meta.url)('../launcher/electron/ipc/loop-file-watcher.cjs');
const nativeFs = createRequire(import.meta.url)('node:fs');
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function deferred<T = unknown>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function deadline<T>(promise: Promise<T>): Promise<T> { let timer: ReturnType<typeof setTimeout>; return Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('file event boundary not reached')), 2500); })]).finally(() => clearTimeout(timer)); }
function setup() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-loop-file-'))), projectPath = join(directory, 'project'); mkdirSync(projectPath, { mode: 0o700 });
  const file = join(projectPath, 'selected.txt'); writeFileSync(file, 'selected private bytes v1');
  const task: any = { id: 'task', familyId: 'family', generation: 1, revision: 1, cycle: 0, mode: 'loop', status: 'review_required', ownerId: 'runtime', loopRun: { ownerId: 'runtime', generation: 1 }, bounds: { maxTurns: 4, maxConcurrent: 1, maxSpend: null } };
  let active = true, runId = 'explicit-run-1', granted = true, advance = false, loseResponse = false; let held: ReturnType<typeof deferred> | null = null;
  let heldTaskRead: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null = null;
  let accepted = deferred<any>(); const packets: any[] = [], attempts: any[] = [];
  const getTask = async (taskId = task.id) => {
    const snapshot = { task: { ...structuredClone(task), id: taskId }, workPackets: structuredClone(packets), loopSourceAuthority: active ? { active: true, runId, ownerId: task.ownerId, familyId: task.familyId, generation: task.generation, revision: task.revision, cycle: task.cycle } : null };
    const hold = heldTaskRead; heldTaskRead = null;
    if (hold) { hold.entered.resolve(undefined); await hold.release.promise; }
    return snapshot;
  };
  const enqueueWork = async (body: any) => {
    attempts.push(structuredClone(body));
    if (!active || body.loopSourceRunId !== runId || JSON.stringify(body.scope) !== JSON.stringify(scope())) throw new Error('stale source');
    const packet = { ...body.work, taskId: body.taskId, state: 'pending', enqueuedGeneration: task.generation };
    packets.push(packet); if (advance) { task.generation++; task.revision++; task.cycle++; task.loopRun.generation = task.generation; }
    accepted.resolve(body); if (held) await held.promise; if (loseResponse) throw new Error('reply lost after durable acceptance'); return { packet, task: structuredClone(task) };
  };
  const resolveProject = async (id: string) => granted && id === 'project' ? { id, path: projectPath } : null;
  const serviceOptions = { directory: join(directory, 'private'), getTask, enqueueWork, resolveProject };
  let service = createLoopFileWatcher(serviceOptions);
  const scope = () => ({ familyId: task.familyId, generation: task.generation, revision: task.revision });
  cleanups.push(async () => { await service.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, projectPath, file, task, packets, attempts, scope, resolveProject, get service() { return service; },
    select: (taskId = task.id) => service.select({ taskId, scope: { revision: task.revision, generation: task.generation, familyId: task.familyId }, projectId: 'project', filePath: file }),
    enable: (id: string, bound = 3) => service.enable({ watcherId: id, scope: scope(), instruction: 'Inspect the new selected source revision and report any changed risks.', eventBound: bound, explicitUserAction: true }),
    setActive: (value: boolean) => { active = value; }, setRun: (value: string) => { runId = value; }, setGranted: (value: boolean) => { granted = value; },
    holdEnqueue: () => { held = deferred(); return () => held!.resolve(undefined); },
    holdNextTaskRead: () => { const hold = { entered: deferred(), release: deferred() }; heldTaskRead = hold; return { entered: hold.entered.promise, release: () => hold.release.resolve(undefined) }; },
    startChange: async (text: string) => { accepted = deferred(); writeFileSync(file, text); return deadline(accepted.promise); },
    setAdvance: () => { advance = true; }, loseResponse: () => { loseResponse = true; },
    async change(text: string) { accepted = deferred(); writeFileSync(file, text); const body = await deadline(accepted.promise).catch(error => { throw new Error(error.message + ': ' + JSON.stringify(service.status())); }); await service.waitForIdle(); return body; },
    async mutateWithoutPacket(mutate: () => void) { const signalled = deferred(); const observer = watch(file, () => signalled.resolve(undefined)); try { await new Promise(r => setImmediate(r)); mutate(); await deadline(signalled.promise).catch(error => { throw new Error('raw fixture watcher: ' + error.message + ': ' + JSON.stringify(service.status())); }); await new Promise(r => setImmediate(r)); await service.waitForIdle(); } finally { observer.close(); } },
    async restart() { await service.close(); service = createLoopFileWatcher(serviceOptions); },
  };
}

test('explicit selected real file emits durable metadata only once per change and follows the same live Run across natural cycles', async () => {
  const f = setup(), selected = await f.select();
  expect(selected.enabled).toBe(false); expect(selected.baseline).toBeNull();
  await f.mutateWithoutPacket(() => writeFileSync(f.file, 'before explicit enable'));
  expect(f.attempts).toHaveLength(0);
  f.setAdvance(); await f.enable(selected.id, 2);
  const first = await f.change('first selected secret payload');
  expect(first.loopSourceRunId).toBe('explicit-run-1'); expect(first.scope).toEqual({ familyId: 'family', generation: 1, revision: 1 });
  expect(first.work.text).toContain('metadata only'); expect(first.work.text).not.toContain('secret payload');
  expect(first.work.text).toContain('selected.txt'); expect(first.work.text).not.toContain(f.projectPath);
  expect(f.service.status().rows[0]).toMatchObject({ enabled: true, scope: { generation: 2, revision: 2 }, emitted: 1 });
  await f.mutateWithoutPacket(() => writeFileSync(f.file, 'first selected secret payload'));
  expect(f.attempts).toHaveLength(1);
  await f.change('second selected secret payload');
  const state = f.service.status().rows[0];
  expect(state).toMatchObject({ enabled: false, reason: 'event_bound', emitted: 2, contentIncluded: false });
  expect(new Set(state.events.map((row: any) => row.workKey)).size).toBe(2);
  expect(state.events.every((row: any) => row.state === 'delivered')).toBe(true);
  const persisted = readFileSync(join(f.directory, 'private/watchers.json'), 'utf8');
  expect(persisted).not.toContain('secret payload'); expect(JSON.parse(persisted).rows[0].events).toHaveLength(2);
  await f.restart(); expect(f.service.status().rows[0]).toMatchObject({ enabled: false, reason: 'restart_requires_explicit_enable', emitted: 2 });
  await f.mutateWithoutPacket(() => writeFileSync(f.file, 'after restart'));
  expect(f.attempts).toHaveLength(2);
}, 5000);

test('lost enqueue response is retained unknown across restart and exact read-only reconciliation never resends', async () => {
  const f = setup(), selected = await f.select(); await f.enable(selected.id); f.loseResponse(); await f.change('changed once');
  expect(f.service.status().rows[0]).toMatchObject({ enabled: false, reason: 'delivery_unknown' });
  expect(f.service.status().rows[0].events[0].state).toBe('unknown'); expect(f.packets).toHaveLength(1);
  await f.restart(); const retained = f.service.status().rows[0];
  await expect(f.enable(selected.id)).rejects.toThrow('settled receipts');
  const result = await f.service.reconcile({ watcherId: selected.id, eventId: retained.events[0].eventId });
  expect(result.events[0].state).toBe('delivered'); expect(f.attempts).toHaveLength(1); expect(f.packets).toHaveLength(1);
  expect(result.enabled).toBe(false);
}, 5000);

test('Pause, correction, owner loss and changed Run authority stop the actual source before further events', async () => {
  const f = setup(), selected = await f.select(); await f.enable(selected.id);
  f.task.status = 'paused'; f.task.generation++; delete f.task.loopRun; f.setActive(false);
  await f.mutateWithoutPacket(() => writeFileSync(f.file, 'paused bytes'));
  expect(f.service.status().rows[0].enabled).toBe(false); expect(f.attempts).toHaveLength(0);
  f.task.status = 'review_required'; f.task.loopRun = { ownerId: 'runtime', generation: f.task.generation }; f.setActive(true);
  await f.enable(selected.id); f.setRun('different-explicit-run');
  await f.mutateWithoutPacket(() => writeFileSync(f.file, 'different Run bytes'));
  expect(f.attempts).toHaveLength(0); expect(f.service.status().rows[0].reason).toBe('source_or_authority_changed');
  await f.enable(selected.id); f.task.revision++;
  await f.mutateWithoutPacket(() => writeFileSync(f.file, 'corrected bytes'));
  expect(f.attempts).toHaveLength(0);
  await f.enable(selected.id); f.task.ownerId = 'another-owner';
  await f.mutateWithoutPacket(() => writeFileSync(f.file, 'owner changed bytes'));
  expect(f.attempts).toHaveLength(0);
}, 5000);

test('selected project and pinned regular file refuse symlinks, hardlinks and replacement; explicit picker reselection restores the source', async () => {
  const f = setup();
  const outside = join(f.directory, 'outside.txt'); writeFileSync(outside, 'outside');
  await expect(f.service.select({ taskId: 'task', scope: f.scope(), projectId: 'project', filePath: outside })).rejects.toThrow('inside');
  const symbolic = join(f.projectPath, 'symlink.txt'); symlinkSync(outside, symbolic);
  await expect(f.service.select({ taskId: 'task', scope: f.scope(), projectId: 'project', filePath: symbolic })).rejects.toThrow('symbolic');
  const hard = join(f.projectPath, 'hard.txt'); linkSync(outside, hard);
  await expect(f.service.select({ taskId: 'task', scope: f.scope(), projectId: 'project', filePath: hard })).rejects.toThrow('regular file');
  const selected = await f.select(); await f.enable(selected.id);
  await f.mutateWithoutPacket(() => { const replacement = join(f.projectPath, 'replacement.txt'); writeFileSync(replacement, 'new inode'); renameSync(replacement, f.file); });
  expect(f.service.status().rows[0].enabled).toBe(false); expect(f.attempts).toHaveLength(0);
  await expect(f.enable(selected.id)).rejects.toThrow('identity');
  expect(f.service.status().rows[0].baseline.byteLength).toBe('selected private bytes v1'.length);
  const reselected = await f.select(); expect(reselected.id).toBe(selected.id); expect(reselected.enabled).toBe(false);
  await f.enable(reselected.id); await f.change('explicitly reselected new inode'); expect(f.attempts).toHaveLength(1);
  f.service.disable(reselected.id); writeFileSync(f.file, 'x'.repeat(32769));
  await expect(f.enable(reselected.id)).rejects.toThrow('bound');
}, 5000);

test('synchronous task/project invalidation stops further source events', async () => {
  const f = setup(), selected = await f.select(); await f.enable(selected.id);
  f.service.invalidateProject('project'); f.setGranted(false);
  await f.mutateWithoutPacket(() => writeFileSync(f.file, 'revoked bytes'));
  expect(f.attempts).toHaveLength(0); expect(f.service.status().rows[0].reason).toBe('project_grant_revoked');
  f.setGranted(true); await f.enable(selected.id); f.service.invalidateTask('task');
  await f.mutateWithoutPacket(() => writeFileSync(f.file, 'invalidated bytes'));
  expect(f.attempts).toHaveLength(0);
}, 5000);


test('close waits for the already committed enqueue owner without replay or automatic reactivation', async () => {
  const f = setup(), selected = await f.select(); await f.enable(selected.id);
  const release = f.holdEnqueue(); await f.startChange('accepted bytes awaiting reply');
  expect(f.service.status().rows[0].events[0].state).toBe('pending');
  let closed = false; const closing = f.service.close().then(() => { closed = true; });
  await new Promise(r => setImmediate(r)); expect(closed).toBe(false);
  expect(f.service.status().rows[0].enabled).toBe(false); expect(f.attempts).toHaveLength(1);
  release(); await closing; expect(closed).toBe(true);
  await f.restart(); expect(f.service.status().rows[0].events[0].state).toBe('delivered');
  expect(f.service.status().rows[0].enabled).toBe(false); expect(f.attempts).toHaveLength(1);
}, 5000);


test('concurrent Enable keeps one owner and project invalidation fences a pending Enable', async () => {
  const f = setup(), selected = await f.select();
  const outcomes = await Promise.allSettled([f.enable(selected.id), f.enable(selected.id)]);
  expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter(row => row.status === 'rejected')).toHaveLength(1);
  f.service.disable(selected.id);
  const enabling = f.enable(selected.id); f.service.invalidateProject('project');
  await expect(enabling).rejects.toThrow('grant');
  expect(f.service.status().rows[0].enabled).toBe(false); expect(f.attempts).toHaveLength(0);
});

test('invalidation during the awaited task reply cancels pending Enable before reading the file', async () => {
  for (const action of ['task', 'project', 'disable']) {
    const f = setup(), selected = await f.select(), held = f.holdNextTaskRead();
    const enabling = f.enable(selected.id); await held.entered;
    if (action === 'task') f.service.invalidateTask('task');
    else if (action === 'project') f.service.invalidateProject('project');
    else f.service.disable(selected.id);
    held.release();
    await expect(enabling).rejects.toThrow('grant');
    expect(f.service.status().rows[0]).toMatchObject({ enabled: false, baseline: null });
    expect(f.attempts).toHaveLength(0);
  }
}, 5000);

test('close fences pending Enable while preserving an already committed enqueue receipt', async () => {
  const f = setup(), first = await f.select(), second = await f.select('second-task');
  await f.enable(first.id);
  const releaseEnqueue = f.holdEnqueue(); await f.startChange('committed before close');
  const held = f.holdNextTaskRead(), enabling = f.enable(second.id); await held.entered;
  const closing = f.service.close(); held.release();
  try {
    await expect(enabling).rejects.toThrow();
    await expect(f.enable(second.id)).rejects.toThrow();
    expect(f.service.status().rows.find((row: any) => row.id === second.id)).toMatchObject({ enabled: false, baseline: null });
  } finally { releaseEnqueue(); await closing; }
  expect(f.attempts).toHaveLength(1);
  expect(f.service.status().rows.find((row: any) => row.id === first.id).events[0].state).toBe('delivered');
}, 5000);

test('close fences a pending selection before it opens or retains a source', async () => {
  const f = setup(), held = f.holdNextTaskRead(), selecting = f.select();
  await held.entered; await f.service.close(); held.release();
  await expect(selecting).rejects.toThrow();
  expect(f.service.status().rows).toHaveLength(0);
}, 5000);

test('a parent swapped after lstat cannot make Enable read through a symlink outside the granted project', async () => {
  const f = setup(), parent = join(f.projectPath, 'nested'), moved = join(f.directory, 'moved-parent');
  mkdirSync(parent); const nestedFile = join(parent, 'selected.txt'); renameSync(f.file, nestedFile);
  const selected = await f.service.select({ taskId: 'task', scope: f.scope(), projectId: 'project', filePath: nestedFile });
  const lstat = nativeFs.lstatSync, read = nativeFs.readSync; let swapped = false, reads = 0;
  nativeFs.lstatSync = (name: string, ...args: any[]) => {
    const result = lstat(name, ...args);
    if (name === parent && !swapped) { swapped = true; renameSync(parent, moved); symlinkSync(moved, parent); }
    return result;
  };
  nativeFs.readSync = (...args: any[]) => { reads++; return read(...args); };
  try {
    await expect(f.enable(selected.id)).rejects.toThrow();
    expect(swapped).toBe(true); expect(reads).toBe(0);
    expect(f.service.status().rows[0]).toMatchObject({ enabled: false, baseline: null });
    expect(f.attempts).toHaveLength(0);
  } finally { nativeFs.lstatSync = lstat; nativeFs.readSync = read; }
}, 5000);

test('IPC uses one native picker inside an existing project and rejects renderer paths and implicit enables', async () => {
  const f = setup(); let handler: any, pickerCount = 0;
  registerLoopFileWatcher({ handle: (channel: string, fn: any) => { expect(channel).toBe('launcher:loop-file-watcher'); handler = fn; }, service: f.service,
    resolveProject: f.resolveProject, getWindow: () => undefined, dialog: { showOpenDialog: async (options: any) => { pickerCount++; expect(options.defaultPath).toBe(f.projectPath); return { canceled: false, filePaths: [f.file] }; } } });
  await expect(handler(null, { action: 'select', taskId: 'task', scope: f.scope(), projectId: 'project', explicitUserAction: true, filePath: f.file })).rejects.toThrow('Invalid');
  expect(pickerCount).toBe(0);
  const result = await handler(null, { action: 'select', taskId: 'task', scope: f.scope(), projectId: 'project', explicitUserAction: true });
  expect(pickerCount).toBe(1); expect(result.source.enabled).toBe(false); expect(f.attempts).toHaveLength(0);
  await expect(handler(null, { action: 'enable', watcherId: result.source.id, scope: f.scope(), instruction: 'Inspect source revision', eventBound: 2, explicitUserAction: false })).rejects.toThrow('Explicit');
  f.setActive(false);
  await expect(f.enable(result.source.id)).rejects.toThrow('Live explicit Loop Run');
});
