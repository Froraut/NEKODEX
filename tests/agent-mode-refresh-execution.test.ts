import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentModeRuntime, AgentModeStore, createAgentModeRoutes } from '../src/agent-mode';
import type { AgentTask, CreateAgentTask } from '../src/agent-mode';

const scopeOf = (task: AgentTask) => ({ familyId: task.familyId, generation: task.generation, revision: task.revision });
const input = (): CreateAgentTask => ({ id: 'refresh-fixture', ownerMode: 'agent', mode: 'manual', originalRequest: 'Create and inspect a retained VM report.',
  requirements: [{ id: 'report', text: 'Retain and inspect the report.' }], stages: [
    { id: 'create', instruction: 'Create the retained report.', requirementIds: ['report'] },
    { id: 'inspect', instruction: 'Inspect the retained report.', requirementIds: ['report'], dependsOn: ['create'] },
  ], bounds: { maxConcurrent: 1, maxTurns: 4, maxSpend: null }, execution: { provider: 'owned-native', model: 'fixture-model', admissionId: 'old-admission' } });

test('explicit authenticated refresh preserves completed work and history, changes only current pins/scope, and sends nothing', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agent-refresh-')), store = new AgentModeStore(join(home, 'state.sqlite'));
  let admissionId = 'old-admission', sends = 0, invalidations = 0;
  const runtime = new AgentModeRuntime({ store, ownerId: 'fixture-owner', models: () => [{ id: 'fixture-model', provider: 'owned-native', admissionId, available: true }],
    onTaskScopeInvalidated: () => { invalidations++; }, executionPort: { async execute() { sends++; return { receiptId: 'first-result', outcome: 'completed', summary: 'Retained report created.', actualSpend: null }; } } });
  const handler = createAgentModeRoutes({ runtime, authorize: request => request.headers.get('authorization') === 'Bearer fixture' });
  const call = async (body: object, authorized = true) => (await handler(new Request('http://localhost/admin/agent-mode', { method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { authorization: 'Bearer fixture' } : {}) }, body: JSON.stringify(body) })))!;
  try {
    const task = runtime.create('create', input());
    runtime.step(task.id, 'first-stage', { explicitUserAction: true }, scopeOf(task)); await runtime.waitForIdle();
    const before = store.getTask(task.id), history = store.listDispatches(task.id), messages = store.listMessages(task.id);
    expect(before.stages.map(row => row.status)).toEqual(['completed', 'pending']);
    admissionId = 'fresh-admission';
    const body = { action: 'refresh-execution', taskId: task.id, actionId: 'refresh', scope: scopeOf(before), explicitUserAction: true };
    expect((await call(body, false)).status).toBe(401);
    expect((await call({ ...body, explicitUserAction: false })).status).toBe(409);
    const response = await call(body); expect(response.status).toBe(200);
    const after = (await response.json() as { value: { task: AgentTask } }).value.task;
    expect(after).toMatchObject({ generation: before.generation + 1, revision: before.revision, originalRequest: before.originalRequest, status: 'ready', execution: { provider: 'owned-native', model: 'fixture-model', admissionId: 'fresh-admission' }, bounds: before.bounds });
    expect(after.stages).toEqual(before.stages); expect(store.listDispatches(task.id)).toEqual(history); expect(store.listMessages(task.id)).toEqual(messages);
    expect(sends).toBe(1); expect(invalidations).toBe(1); expect(runtime.activeCount).toBe(0);
    expect((await call(body)).status).toBe(200); expect(invalidations).toBe(1);
    expect((await call({ ...body, actionId: 'stale-refresh' })).status).toBe(409);
    expect(() => runtime.step(task.id, 'stale-run', { explicitUserAction: true }, scopeOf(before))).toThrow('Stale task action scope');
    expect(sends).toBe(1);
  } finally { store.close(); rmSync(home, { recursive: true, force: true }); }
});

test('refresh refuses retained unknown execution and cannot switch to another configured model', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agent-refresh-refusal-')), store = new AgentModeStore(join(home, 'state.sqlite'));
  let selectedModel = 'fixture-model', sends = 0;
  const runtime = new AgentModeRuntime({ store, ownerId: 'fixture-owner', models: () => [{ id: selectedModel, provider: 'owned-native', admissionId: 'old-admission', available: true }],
    executionPort: { async execute() { sends++; throw new Error('Uncertain external offer'); } } });
  try {
    const task = runtime.create('create', input());
    selectedModel = 'other-model';
    expect(() => runtime.refreshExecution(task.id, 'different-model', scopeOf(task), true)).toThrow('no unique available current binding');
    selectedModel = 'fixture-model';
    runtime.step(task.id, 'unknown-offer', { explicitUserAction: true }, scopeOf(task)); await runtime.waitForIdle();
    const before = store.getTask(task.id);
    expect(store.listDispatches(task.id)[0]!.state).toBe('unknown');
    expect(() => runtime.refreshExecution(task.id, 'unknown-refresh', scopeOf(before), true)).toThrow('live or unknown execution');
    expect(store.getTask(task.id)).toEqual(before); expect(sends).toBe(1);
  } finally { store.close(); rmSync(home, { recursive: true, force: true }); }
});
