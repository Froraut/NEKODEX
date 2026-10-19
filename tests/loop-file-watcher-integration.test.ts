import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createLoopFileWatcherIntegration } = require('../launcher/electron/loop-file-watcher-integration.cjs');
const { registerAgentMode } = require('../launcher/electron/ipc/agent-mode.cjs');
const { createLifecycleAdmission } = require('../launcher/electron/lifecycle-admission.cjs');
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-loop-integration-'))), root = join(home, 'project'); mkdirSync(root);
  const file = join(root, 'selected.txt'); writeFileSync(file, 'private original bytes');
  const task = { id: 'task', familyId: 'family', generation: 1, revision: 1, cycle: 0, mode: 'loop', status: 'review_required', ownerId: 'owner', loopRun: { ownerId: 'owner', generation: 1 }, bounds: { maxTurns: 3, maxConcurrent: 1, maxSpend: null } };
  const scope = { familyId: task.familyId, generation: 1, revision: 1 }, calls: any[] = [], readyOptions: any[] = [], handlers = new Map<string, any>();
  const lifecycle = createLifecycleAdmission(), accepted = deferred<any>(); let version = 'current', ready = true, held: ReturnType<typeof deferred> | null = null;
  const supervisor = { launcherProfile: 'production', readConfig: () => ({ releaseVersion: version, port: 1234 }),
    ownedAgentRuntimeReady: async (_config: any, options: any) => { readyOptions.push(options); return ready; },
    control: async (_config: any, endpoint: string, envelope: any) => {
      expect(endpoint).toBe('agent-mode'); expect(envelope.returnErrorReceipt).toBe(true); calls.push(envelope.body);
      if (envelope.body.action === 'get') return { ok: true, value: { task, loopSourceAuthority: { active: true, runId: 'run', ownerId: 'owner', ...scope, cycle: 0 } } };
      if (envelope.body.action === 'enqueue-work') { accepted.resolve(envelope.body); if (held) await held.promise; return { ok: true, value: { packet: { ...envelope.body.work, taskId: task.id } } }; }
      expect(integration.service.status().rows[0].enabled).toBe(false); return { ok: true, value: { task } };
    } };
  const integration = createLoopFileWatcherIntegration({ directory: join(home, 'private'), workspaceService: { resolveGrant: (id: string) => { if (id !== 'project') throw new Error('No grant'); return { id, path: root }; } }, runtimeHost: { supervisor }, getApplicationVersion: () => 'current', canRequest: () => !lifecycle.busy() });
  integration.register({ privacyHandle: (channel: string, handler: any, privacy: any) => handlers.set(channel,
    (event: any, body: any) => privacy(body) ? handler(event, body) : lifecycle.guard(channel, handler)(event, body)),
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) } });
  registerAgentMode({ handle: (channel: string, handler: any) => handlers.set(channel, handler), runtimeHost: { supervisor }, getApplicationVersion: () => 'current', beforeTaskAuthorityChange: (body: any) => integration.beforeTaskAuthorityChange(body) });
  const call = (body: any) => Promise.resolve().then(() => handlers.get('launcher:loop-file-watcher')(undefined, body));
  cleanups.push(async () => { held?.resolve(); await integration.close(); rmSync(home, { recursive: true, force: true }); });
  return { integration, call, file, scope, calls, readyOptions, lifecycle, accepted,
    select: () => call({ action: 'select', taskId: task.id, scope, projectId: 'project', explicitUserAction: true }),
    enable: (watcherId: string) => call({ action: 'enable', watcherId, scope, instruction: 'Inspect the selected source revision for changed risks.', eventBound: 2, explicitUserAction: true }),
    agent: (body: any) => handlers.get('launcher:agent-mode')(undefined, body),
    setVersion: (value: string) => { version = value; }, setReady: (value: boolean) => { ready = value; },
    hold: () => { held = deferred(); return () => held!.resolve(); },
  };
}
test('actual selected-file IPC reaches only the owned core adapter and explicit task controls invalidate before forwarding', async () => {
  const f = fixture(), selected = await f.select(); expect(selected.source.enabled).toBe(false);
  await f.enable(selected.source.id); writeFileSync(f.file, 'new private payload');
  const packet = await f.accepted.promise; await f.integration.service.waitForIdle();
  expect(packet).toMatchObject({ action: 'enqueue-work', taskId: 'task', loopSourceRunId: 'run', scope: f.scope });
  expect(packet.work.text).not.toContain('new private payload'); expect(packet.work.text).toContain('sha256');
  expect(f.calls.filter(body => body.action === 'enqueue-work')).toHaveLength(1);
  await f.agent({ action: 'control', taskId: 'task', actionId: 'pause', control: { action: 'pause' } });
  expect(f.integration.service.status().rows[0]).toMatchObject({ enabled: false, reason: 'task_authority_invalidated' });
  expect(f.calls.at(-1).control).toEqual({ action: 'pause' });
}, 3000);
test('pending versions block enable before source reads; privacy disable remains exact and available while lifecycle is busy', async () => {
  const f = fixture(), selected = await f.select(), before = f.calls.length;
  f.setVersion('older'); await expect(f.enable(selected.source.id)).rejects.toThrow('automatic safe runtime switch');
  expect(f.calls).toHaveLength(before); expect(f.integration.service.status().rows[0].baseline).toBeNull();
  f.setVersion('current'); await f.enable(selected.source.id); const owner = f.lifecycle.acquire('replacement');
  await expect(f.call({ action: 'refresh', watcherId: selected.source.id })).rejects.toThrow('Wait for replacement');
  expect(await f.call({ action: 'disable', watcherId: selected.source.id })).toMatchObject({ enabled: false });
  await expect(f.call({ action: 'disable', watcherId: selected.source.id, enable: true })).rejects.toThrow('Invalid Loop file source request');
  f.lifecycle.release(owner); f.setReady(false);
  await expect(f.enable(selected.source.id)).rejects.toThrow('Start the current NEKODEX runtime');
}, 3000);
test('project/owner teardown fences sources and close retains an already committed enqueue until its receipt settles', async () => {
  const f = fixture(), selected = await f.select(); await f.enable(selected.source.id);
  f.integration.beforeForget('project'); expect(f.integration.service.status().rows[0]).toMatchObject({ enabled: false, reason: 'project_grant_revoked' });
  await f.enable(selected.source.id); const release = f.hold(); writeFileSync(f.file, 'changed before close'); await f.accepted.promise;
  expect(f.integration.currentOperation()).toBe('Loop local-file event enqueue');
  f.integration.beforeOwnerTeardown(); let closed = false; const closing = f.integration.close().then(() => { closed = true; });
  await Promise.resolve(); expect(closed).toBe(false); release(); await closing;
  expect(f.integration.service.status().rows[0].events[0].state).toBe('delivered');
  expect(f.calls.filter(body => body.action === 'enqueue-work')).toHaveLength(1); expect(f.integration.currentOperation()).toBeNull();
}, 3000);

test('unclean owner exit isolates the optional source without reading files, changing receipts or claiming Disable', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-loop-unclean-'))), project = join(home, 'project'), directory = join(home, 'private');
  mkdirSync(project); const file = join(project, 'selected.txt'); writeFileSync(file, 'retained selected file');
  cleanups.push(async () => { rmSync(home, { recursive: true, force: true }); });
  const child = spawnSync(process.execPath, ['-e', `
    const { createLoopFileWatcherIntegration } = require(${JSON.stringify(require.resolve('../launcher/electron/loop-file-watcher-integration.cjs'))});
    const task = { id: 'task', mode: 'loop', familyId: 'family', generation: 1, revision: 1, status: 'ready' };
    const owner = createLoopFileWatcherIntegration({ directory: ${JSON.stringify(directory)},
      workspaceService: { resolveGrant: id => ({ id, path: ${JSON.stringify(project)} }) },
      runtimeHost: { supervisor: { readConfig: () => ({ releaseVersion: 'current' }),
        ownedAgentRuntimeReady: async () => true, control: async () => ({ ok: true, value: { task } }) } },
      getApplicationVersion: () => 'current' });
    owner.service.select({ taskId: 'task', projectId: 'project', scope: { familyId: 'family', generation: 1, revision: 1 }, filePath: ${JSON.stringify(file)} })
      .then(() => process.exit(23)).catch(error => { console.error(error.message); process.exit(24); });
  `], { encoding: 'utf8', timeout: 2000 });
  expect(child.error).toBeUndefined(); expect(child.status).toBe(23); expect(child.stderr).toBe('');
  const lock = readFileSync(join(directory, 'owner.lock')), journal = readFileSync(join(directory, 'watchers.json'));
  expect(JSON.parse(lock.toString()).pid).toBeGreaterThan(0); expect(JSON.parse(journal.toString()).rows).toHaveLength(1);
  let accesses = 0, picks = 0; const handlers = new Map<string, any>();
  const unavailable = createLoopFileWatcherIntegration({ directory,
    workspaceService: { resolveGrant: () => { accesses++; throw new Error('Must not resolve/read a source'); } },
    runtimeHost: { supervisor: { readConfig: () => { accesses++; throw new Error('Must not dispatch core work'); } } },
    getApplicationVersion: () => 'current' });
  unavailable.register({ privacyHandle: (channel: string, handler: any) => handlers.set(channel, handler),
    dialog: { showOpenDialog: () => { picks++; throw new Error('Must not open a picker'); } } });
  const call = (body: any) => Promise.resolve().then(() => handlers.get('launcher:loop-file-watcher')(undefined, body));
  await expect(call({ action: 'status' })).rejects.toMatchObject({ code: 'LOOP_SOURCE_OWNER_RECOVERY_REQUIRED' });
  await expect(call({ action: 'select', taskId: 'task', scope: { familyId: 'family', generation: 1, revision: 1 }, projectId: 'project', explicitUserAction: true })).rejects.toThrow('physical owner and unfinished work have not been reconciled');
  await expect(call({ action: 'disable', watcherId: 'retained' })).rejects.toThrow('Explicit owner recovery is required');
  unavailable.beforeTaskAuthorityChange({ action: 'run', taskId: 'task' }); unavailable.beforeForget('project'); unavailable.beforeOwnerTeardown(); await unavailable.close();
  expect(accesses).toBe(0); expect(picks).toBe(0);
  expect(readFileSync(join(directory, 'owner.lock'))).toEqual(lock); expect(readFileSync(join(directory, 'watchers.json'))).toEqual(journal);
}, 3000);
