import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentModeRuntime } from '../src/agent-mode/runtime';
import { AgentModeStore } from '../src/agent-mode/store';
import { createAgentModeRoutes } from '../src/agent-mode/http';
import type { AgentTask, CreateAgentTask } from '../src/agent-mode/types';
const { createLoopFileWatcher } = createRequire(import.meta.url)('../launcher/electron/loop-file-watcher.cjs');

const input: CreateAgentTask = { id: 'task', ownerMode: 'agent', mode: 'loop', recurringAuthorized: true,
  originalRequest: 'Inspect synthetic report revisions when explicitly running.', requirements: [{ id: 'r', text: 'Inspect selected revision.' }],
  stages: [{ id: 'a', instruction: 'Inspect source.', requirementIds: ['r'] }, { id: 'b', instruction: 'Report observation.', requirementIds: ['r'], dependsOn: ['a'] }],
  bounds: { maxConcurrent: 1, maxTurns: 20, maxSpend: null }, execution: { provider: 'local-responses', model: 'fixture' } };
function fixture(taskInput = input, reserveSpend?: (task: AgentTask) => number, actualSpend = 0) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'neko-loop-source-run-'))), store = new AgentModeStore(join(home, 'state.sqlite'));
  let offers = 0, fail = false;
  const options = { store, ownerId: 'fixture-owner', models: () => [{ id: 'fixture' }], reserveSpend, executionPort: { async execute(_request: unknown, ack: (value: string) => void) {
    const id = `offer-${++offers}`; ack(id); if (fail) throw new Error('lost synthetic reply');
    return { receiptId: id, outcome: 'completed' as const, summary: 'Synthetic stage.', actualSpend };
  } } };
  const runtime = new AgentModeRuntime(options); runtime.create('create', taskInput);
  const scope = () => { const task = store.getTask('task'); return { familyId: task.familyId, generation: task.generation, revision: task.revision }; };
  const handler = createAgentModeRoutes({ runtime, authorize: () => true });
  const call = async (body: unknown) => (await handler(new Request('http://127.0.0.1/admin/agent-mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })))!;
  const work = (id: string) => ({ workId: id, workKey: id, text: `Inspect substantive synthetic revision ${id}.` });
  return { home, store, runtime, options, scope, call, work, offers: () => offers, fail: () => { fail = true; }, async close() { await runtime.waitForIdle(); store.close(); rmSync(home, { recursive: true, force: true }); } };
}

test('live Run metadata keeps one identity through auto steps and natural cycles, while new Run and restart fence old producers', async () => {
  const f = fixture();
  try {
    expect((await (await f.call({ action: 'get', taskId: 'task' })).json()).value).not.toHaveProperty('loopSourceAuthority');
    f.runtime.step('task', 'run-1', { explicitUserAction: true, automatic: true }, f.scope());
    const started = f.runtime.loopSourceAuthority('task')!; expect(started).toMatchObject({ active: true, ownerId: 'fixture-owner', cycle: 1 });
    await f.runtime.waitForIdle(); expect(f.offers()).toBe(2);
    expect((await (await f.call({ action: 'get', taskId: 'task' })).json()).value.loopSourceAuthority.runId).toBe(started.runId);
    const before = f.scope();
    const enqueue = { action: 'enqueue-work', taskId: 'task', actionId: 'source-2', scope: before, work: f.work('v2'), loopSourceRunId: started.runId };
    expect((await f.call(enqueue)).status).toBe(200); await f.runtime.waitForIdle();
    expect(f.runtime.loopSourceAuthority('task')).toMatchObject({ runId: started.runId, cycle: 2, generation: before.generation + 1, revision: before.revision + 1 });
    expect(f.offers()).toBe(4); expect(f.store.listWork('task')).toHaveLength(1);
    expect((await f.call(enqueue)).status).toBe(409);
    f.runtime.step('task', 'run-1', { explicitUserAction: true, automatic: true }, { familyId: started.familyId, generation: started.generation, revision: started.revision });
    expect(f.runtime.loopSourceAuthority('task')!.runId).toBe(started.runId);
    f.runtime.step('task', 'run-2', { explicitUserAction: true, automatic: true }, f.scope()); await f.runtime.waitForIdle();
    const renewed = f.runtime.loopSourceAuthority('task')!; expect(renewed.runId).not.toBe(started.runId);
    expect(() => f.runtime.enqueueWork('task', 'old-producer', f.scope(), f.work('old'), started.runId)).toThrow('Stale Loop');
    expect(f.store.listWork('task')).toHaveLength(1); expect(f.offers()).toBe(4);
    const reopened = new AgentModeRuntime(f.options); expect(reopened.loopSourceAuthority('task')).toBeUndefined();
    expect(() => reopened.enqueueWork('task', 'restart-producer', f.scope(), f.work('restart'), renewed.runId)).toThrow('Stale Loop');
    expect(f.store.listWork('task')).toHaveLength(1);
  } finally { await f.close(); }
}, 5000);

test('Pause/Resume, correction, Stop and unknown send retire source identity while ordinary mailbox enqueue stays compatible', async () => {
  const f = fixture();
  try {
    f.runtime.enqueueWork('task', 'manual-before-run', f.scope(), f.work('manual'));
    expect(f.store.listWork('task')[0]!.state).toBe('pending'); expect(f.offers()).toBe(0); expect(f.runtime.loopSourceAuthority('task')).toBeUndefined();
    f.runtime.step('task', 'run', { explicitUserAction: true, automatic: true }, f.scope()); await f.runtime.waitForIdle();
    const runId = f.runtime.loopSourceAuthority('task')!.runId;
    f.runtime.control('task', 'pause', { action: 'pause' }, f.scope()); expect(f.runtime.loopSourceAuthority('task')).toBeUndefined();
    f.runtime.control('task', 'resume', { action: 'resume' }, f.scope()); expect(f.runtime.loopSourceAuthority('task')).toBeUndefined();
    expect(() => f.runtime.enqueueWork('task', 'paused-source', f.scope(), f.work('paused'), runId)).toThrow('Stale Loop');
    f.runtime.control('task', 'correct', { action: 'correct', text: 'Inspect corrected synthetic inputs.', requirements: input.requirements, stages: input.stages }, f.scope());
    f.runtime.step('task', 'corrected-run', { explicitUserAction: true, automatic: true }, f.scope()); await f.runtime.waitForIdle();
    const corrected = f.runtime.loopSourceAuthority('task')!; expect(corrected.runId).not.toBe(runId);
    f.runtime.control('task', 'correct-again', { action: 'correct', text: 'Inspect another corrected revision.', requirements: input.requirements,
      stages: input.stages.map(stage => ({ ...stage, instruction: stage.instruction + ' Use the new revision.' })) }, f.scope());
    expect(f.runtime.loopSourceAuthority('task')).toBeUndefined();
    expect(() => f.runtime.enqueueWork('task', 'corrected-old', f.scope(), f.work('corrected-old'), corrected.runId)).toThrow('Stale Loop');
    f.fail(); f.runtime.step('task', 'unknown-run', { explicitUserAction: true, automatic: true }, f.scope()); await f.runtime.waitForIdle();
    expect(f.store.listDispatches('task').some(row => row.state === 'unknown')).toBe(true); expect(f.runtime.loopSourceAuthority('task')).toBeUndefined();
    f.runtime.control('task', 'stop', { action: 'stop' }, f.scope()); expect(f.runtime.loopSourceAuthority('task')).toBeUndefined();
    expect(() => f.runtime.enqueueWork('task', 'stopped-source', f.scope(), f.work('stopped'), corrected.runId)).toThrow('Stale Loop');
    expect(f.store.listWork('task')).toHaveLength(1);
  } finally { await f.close(); }
}, 5000);

test('source fence checks the serialized commit boundary after valid observation, preserving manual mailbox behavior', async () => {
  const f = fixture();
  try {
    f.runtime.step('task', 'run', { explicitUserAction: true, automatic: true }, f.scope()); await f.runtime.waitForIdle();
    const observed = f.runtime.loopSourceAuthority('task')!, observedScope = f.scope();
    const command = f.store.command.bind(f.store); let interpose = true;
    f.store.command = ((...args: Parameters<typeof f.store.command>) => {
      if (args[2] === 'enqueue_work' && interpose) { interpose = false; f.runtime.control('task', 'pause-before-commit', { action: 'pause' }, observedScope); }
      return command(...args);
    }) as typeof f.store.command;
    expect(() => f.runtime.enqueueWork('task', 'race-source', observedScope, f.work('race'), observed.runId)).toThrow('Stale');
    expect(f.store.listWork('task')).toHaveLength(0); expect(f.store.getTask('task').status).toBe('paused');
    const manual = f.runtime.enqueueWork('task', 'manual-after-pause', f.scope(), f.work('manual'));
    expect(manual.packet.state).toBe('pending'); expect(f.store.listWork('task')).toHaveLength(1); expect(f.offers()).toBe(2);
  } finally { await f.close(); }
}, 5000);

test('physical owner release cannot retain or revive a former source run', async () => {
  const f = fixture();
  try {
    f.runtime.step('task', 'run', { explicitUserAction: true, automatic: true }, f.scope()); await f.runtime.waitForIdle();
    const observed = f.runtime.loopSourceAuthority('task')!;
    f.store.release('task', 'fixture-owner'); expect(f.runtime.loopSourceAuthority('task')).toBeUndefined();
    f.store.enableLoopRun('task', 'fixture-owner');
    expect(() => f.runtime.enqueueWork('task', 'released-source', f.scope(), f.work('released'), observed.runId)).toThrow('Stale Loop');
    expect(f.store.listWork('task')).toHaveLength(0); expect(f.offers()).toBe(2);
  } finally { await f.close(); }
}, 5000);

test('exhausted remaining offer slots retire source authority without changing the task on observation', async () => {
  for (const observeAdmitted of [true, false]) {
    const f = fixture({ ...input, stages: input.stages.slice(0, 1), bounds: { ...input.bounds, maxTurns: 1 } });
    try {
      f.runtime.step('task', 'run', { explicitUserAction: true, automatic: true }, f.scope());
      if (observeAdmitted) expect(f.store.listDispatches('task').filter(row => row.state === 'admitted')).toHaveLength(1);
      else await f.runtime.waitForIdle();
      const before = f.store.getTask('task');
      expect(f.runtime.loopSourceAuthority('task')).toBeUndefined();
      expect(f.store.getTask('task')).toEqual(before);
      await f.runtime.waitForIdle();
      expect(f.runtime.loopSourceAuthority('task')).toBeUndefined();
      expect(f.offers()).toBe(1);
    } finally { await f.close(); }
  }
}, 5000);

test('an unaffordable next monetary reservation retires source authority without renewing it when the quote falls', async () => {
  let quote = 2;
  const f = fixture({ ...input, stages: input.stages.slice(0, 1), bounds: { ...input.bounds, maxSpend: 3 } }, () => quote, 2);
  try {
    f.runtime.step('task', 'run', { explicitUserAction: true, automatic: true }, f.scope()); await f.runtime.waitForIdle();
    const before = f.store.getTask('task'); expect(before).toMatchObject({ status: 'review_required', spent: 2, reserved: 0 });
    expect(f.runtime.loopSourceAuthority('task')).toBeUndefined(); expect(f.store.getTask('task')).toEqual(before);
    quote = 1; expect(f.runtime.loopSourceAuthority('task')).toBeUndefined();
    expect(f.offers()).toBe(1); expect(f.store.listWork('task')).toHaveLength(0);
  } finally { await f.close(); }
}, 5000);

test('exact historical work lookup reconciles a lost source reply beyond the bounded mailbox projection without replay', async () => {
  const f = fixture(), project = join(f.home, 'project'), file = join(project, 'selected.txt'); mkdirSync(project); writeFileSync(file, 'initial');
  let attempts = 0, exactUnavailable = false, accepted!: () => void;
  const delivered = new Promise<void>(resolve => { accepted = resolve; });
  const core = async (body: unknown) => { const response = await f.call(body); const receipt = await response.json(); if (!receipt.ok) throw new Error(receipt.error); return receipt.value; };
  const service = createLoopFileWatcher({ directory: join(f.home, 'watcher-private'), resolveProject: async () => ({ id: 'project', path: project }),
    getTask: async (taskId: string, workId?: string) => {
      const value = await core({ action: 'get', taskId, ...(workId === undefined ? {} : { workId }) });
      return exactUnavailable ? { ...value, workPacket: undefined } : value;
    },
    enqueueWork: async (body: unknown) => { attempts++; await core(body); accepted(); throw new Error('lost reply after durable enqueue'); } });
  try {
    f.runtime.step('task', 'run', { explicitUserAction: true, automatic: true }, f.scope()); await f.runtime.waitForIdle();
    const selected = await service.select({ taskId: 'task', scope: f.scope(), projectId: 'project', filePath: file });
    await service.enable({ watcherId: selected.id, scope: f.scope(), instruction: 'Inspect this selected revision.', eventBound: 1, explicitUserAction: true });
    writeFileSync(file, 'changed'); await delivered; await service.waitForIdle(); await f.runtime.waitForIdle();
    const event = service.status().rows[0].events[0]; expect(event.state).toBe('unknown');
    f.runtime.control('task', 'pause-history', { action: 'pause' }, f.scope()); const offers = f.offers();
    for (let index = 0; index < 101; index++) f.runtime.enqueueWork('task', `history-${index}`, f.scope(), f.work(`history-${index}`));
    const normal = await core({ action: 'get', taskId: 'task' });
    expect(normal.workPackets).toHaveLength(100); expect(normal.workPackets.some((packet: any) => packet.workId === event.workId)).toBe(false);
    const exact = await core({ action: 'get', taskId: 'task', workId: event.workId });
    expect(exact.workPacket).toMatchObject({ workId: event.workId, workKey: event.workKey, taskId: 'task' });
    expect(exact.workPackets).toHaveLength(100); expect(exact.loopSourceAuthority).toBeUndefined();
    const absent = await core({ action: 'get', taskId: 'task', workId: 'not-a-retained-work-id' }); expect(absent.workPacket).toBeUndefined();
    exactUnavailable = true;
    const held = await service.reconcile({ watcherId: selected.id, eventId: event.eventId });
    expect(held.events[0].state).toBe('unknown'); expect(held.enabled).toBe(false); expect(attempts).toBe(1);
    exactUnavailable = false;
    const reconciled = await service.reconcile({ watcherId: selected.id, eventId: event.eventId });
    expect(reconciled.events[0].state).toBe('delivered'); expect(reconciled.enabled).toBe(false);
    expect(attempts).toBe(1); expect(f.offers()).toBe(offers); expect(f.store.listWork('task')).toHaveLength(102);
  } finally { await service.close(); await f.close(); }
}, 5000);
