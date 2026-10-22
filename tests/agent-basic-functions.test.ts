import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentModeRuntime, AgentModeStore, createAgentModeRoutes } from '../src/agent-mode';
import { createAgentToolsComposition } from '../src/agent-tools/composition';

test('task browsing reaches older tasks and archives without unfreezing retained ledger', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nekodex-task-browse-'));
  const store = new AgentModeStore(join(home, 'tasks.sqlite'));
  const runtime = new AgentModeRuntime({ store, ownerId: 'fixture', models: () => [{ id: 'inert-model' }] });
  const handler = createAgentModeRoutes({ runtime, authorize: request => request.headers.get('authorization') === 'fixture' });
  const post = async (body: unknown) => {
    const response = (await handler(new Request('http://127.0.0.1/admin/agent-mode', { method: 'POST', headers: { authorization: 'fixture', 'content-type': 'application/json' }, body: JSON.stringify(body) })))!;
    return { status: response.status, ...(await response.json() as any) };
  };
  try {
    for (let index = 0; index < 56; index++) runtime.create(`create-${index}`, { id: `task-${index}`, ownerMode: 'agent', mode: 'manual', originalRequest: `Fixture request ${index}`, requirements: [{ id: 'r', text: 'Retain fixture' }], stages: [{ id: 's', instruction: 'Inert fixture only', requirementIds: ['r'] }], bounds: { maxConcurrent: 1, maxTurns: 1, maxSpend: null }, execution: { provider: 'local-responses', model: 'inert-model' } });
    expect((await post({ action: 'list' })).value.tasks.some((task: any) => task.id === 'task-0')).toBe(false);
    const page1 = (await post({ action: 'list', listing: { view: 'active', offset: 0 } })).value;
    const page2 = (await post({ action: 'list', listing: { view: 'active', offset: page1.nextOffset } })).value;
    const page3 = (await post({ action: 'list', listing: { view: 'active', offset: page2.nextOffset } })).value;
    expect([...page1.tasks, ...page2.tasks, ...page3.tasks].map((task: any) => task.id)).toHaveLength(56);
    expect(page3.tasks.some((task: any) => task.id === 'task-0')).toBe(true);
    expect(page3.nextOffset).toBeNull();
    expect((await post({ action: 'list', listing: { query: 'task-0' } })).value.tasks.map((task: any) => task.id)).toEqual(['task-0']);
    runtime.control('task-0', 'stop-0', { action: 'stop' });
    const stopped = store.getTask('task-0');
    runtime.archive('task-0', 'archive-0', { familyId: stopped.familyId, generation: stopped.generation, revision: stopped.revision });
    const before = store.listReceipts('task-0');
    const archived = (await post({ action: 'list', listing: { view: 'archived', query: 'Fixture request 0' } })).value;
    expect(archived.tasks.map((task: any) => task.id)).toEqual(['task-0']);
    expect((await post({ action: 'get', taskId: 'task-0' })).value.task.archivedAt).toBeNumber();
    const rejected = await post({ action: 'control', taskId: 'task-0', actionId: 'try-unfreeze', scope: { familyId: stopped.familyId, generation: stopped.generation, revision: stopped.revision }, control: { action: 'resume' } });
    expect(rejected.ok).toBe(false);
    expect(store.getTask('task-0').status).toBe('stopped');
    expect(store.listReceipts('task-0')).toEqual(before);
    expect((await post({ action: 'list', listing: { offset: -1 } })).status).toBe(400);
    expect((await post({ action: 'list', listing: { query: 'x'.repeat(201) } })).status).toBe(400);
    expect((await post({ action: 'list', listing: { includeSecret: true } })).status).toBe(400);
  } finally { store.close(); rmSync(home, { recursive: true, force: true }); }
});

test('skill deselection removes only exact identity in selected task and survives reopen', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-skill-detach-')));
  const source = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-skill-source-')));
  writeFileSync(join(source, 'SKILL.md'), 'Inert instructions for exact task selection.');
  const make = () => createAgentToolsComposition({ home, authorize: request => request.headers.get('authorization') === 'fixture', isScopeActive: scope => ['a', 'b'].includes(scope.taskId) && scope.generation === 1 });
  let composition = make();
  const a = { taskId: 'a', generation: 1, toolCallId: 'selection' }, b = { ...a, taskId: 'b' };
  const post = async (body: unknown) => {
    const response = (await composition.handle(new Request('http://127.0.0.1/admin/agent-tools', { method: 'POST', headers: { authorization: 'fixture', 'content-type': 'application/json' }, body: JSON.stringify(body) })))!;
    return { status: response.status, ...(await response.json() as any) };
  };
  try {
    const grant = composition.addSkillRoot({ root: source, label: 'Inert source' }, true);
    const skill = composition.discoverSkills(grant.id).skills[0]!;
    composition.selectSkill(a, skill, true); composition.selectSkill(b, skill, true);
    expect((await post({ action: 'skillsDeselect', scope: { ...a, generation: 2 }, identity: skill, explicitUserAction: true })).ok).toBe(false);
    expect((await post({ action: 'skillsDeselect', scope: a, identity: { ...skill, digest: '0'.repeat(64) }, explicitUserAction: true })).ok).toBe(true);
    expect(composition.selectedSkillContent(a)).toHaveLength(1);
    expect((await post({ action: 'skillsDeselect', scope: a, identity: skill, explicitUserAction: false })).ok).toBe(false);
    expect((await post({ action: 'skillsDeselect', scope: a, identity: skill, explicitUserAction: true })).ok).toBe(true);
    expect(composition.selectedSkillContent(a)).toHaveLength(0);
    expect(composition.selectedSkillContent(b)).toHaveLength(1);
    expect(composition.status().skillRoots).toHaveLength(1);
    await composition.close(); composition = make();
    expect(composition.selectedSkillContent(a)).toHaveLength(0); expect(composition.selectedSkillContent(b)).toHaveLength(1);
  } finally { await composition.close(); rmSync(home, { recursive: true, force: true }); rmSync(source, { recursive: true, force: true }); }
});

test('exact skillsDeselect is admitted through existing main IPC without rewriting scope', async () => {
  const { createRequire } = await import('node:module');
  const { registerAgentTools } = createRequire(import.meta.url)('../launcher/electron/ipc/agent-tools.cjs');
  const handlers = new Map<string, (...args: any[]) => Promise<unknown>>(), requests: unknown[] = [];
  registerAgentTools({ handle: (name: string, handler: any) => handlers.set(name, handler), runtimeHost: { supervisor: {
    readConfig: () => ({ host: '127.0.0.1', port: 17841, controlToken: 'fixture' }),
    ownedAgentRuntimeReady: async () => true,
    control: async (_config: unknown, _path: string, packet: any) => { requests.push(packet.body); return { ok: true, value: { detached: true } }; },
  } } });
  const body = { action: 'skillsDeselect', scope: { taskId: 'fixture-a', generation: 3, toolCallId: 'skill:fixture' }, identity: { id: 'fixture-skill', grantId: 'fixture-root', relativePath: 'SKILL.md', source: 'user', digest: 'a'.repeat(64), bytes: 3 }, explicitUserAction: true };
  expect(await handlers.get('launcher:agent-tools')!({}, body)).toEqual({ detached: true });
  expect(requests).toEqual([body]);
});
