import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
const { registerAgentMode } = createRequire(import.meta.url)('../launcher/electron/ipc/agent-mode.cjs');

test('pending production upgrade preserves exact task cleanup and reads without allowing new offers', async () => {
  let handler!: (_event: unknown, body: unknown) => Promise<unknown>;
  let version = '6.1.32-nekodex.8', coreError = '', ready = true;
  const received: any[] = [], readiness: any[] = [];
  registerAgentMode({ handle: (_channel: string, callback: typeof handler) => { handler = callback; },
    getApplicationVersion: () => '6.1.32-nekodex.10',
    runtimeHost: { supervisor: { launcherProfile: 'production', readConfig: () => ({ releaseVersion: version }),
      ownedAgentRuntimeReady: async (_config: unknown, options: unknown) => { readiness.push(options); return ready; },
      control: async (_config: unknown, _endpoint: string, packet: any) => {
        received.push(packet.body); if (coreError) throw new Error(coreError);
        return { ok: true, value: { retained: true } };
      } } } });
  const call = (body: unknown) => handler(undefined, body);
  for (const body of [{ action: 'run' }, { action: 'workspace-grant' }, { action: 'cycle' },
    { action: 'control', control: { action: 'resume' } }, { action: 'control', control: { action: 'stop', mode: 'goal' } }]) {
    await expect(call(body)).rejects.toThrow('Application 6.1.32-nekodex.10 is installed; runtime 6.1.32-nekodex.8 is still active');
  }
  expect(received).toHaveLength(0); expect(readiness).toHaveLength(0);
  for (const body of [{ action: 'list' }, { action: 'get', taskId: 'task' },
    { action: 'control', taskId: 'task', actionId: 'pause-id', control: { action: 'pause' } },
    { action: 'control', taskId: 'task', actionId: 'stop-id', control: { action: 'stop' } }]) {
    expect(await call(body)).toEqual({ retained: true });
    expect(received.at(-1)).toEqual(body); expect(readiness.at(-1)).toEqual({ allowDraining: true });
  }
  ready = false;
  await expect(call({ action: 'control', control: { action: 'stop' } })).rejects.toThrow('Start the current NEKODEX runtime');
  expect(received).toHaveLength(4);
  ready = true; coreError = 'HTTP 404: absent';
  await expect(call({ action: 'list' })).rejects.toThrow('Application 6.1.32-nekodex.10 is installed; runtime 6.1.32-nekodex.8 is still active');
  expect(received).toHaveLength(5);
  coreError = 'HTTP 409: stale generation';
  await expect(call({ action: 'control', control: { action: 'stop' } })).rejects.toThrow('HTTP 409: stale generation');
  coreError = ''; version = '6.1.32-nekodex.10';
  expect(await call({ action: 'run' })).toEqual({ retained: true });
  expect(readiness.at(-1)).toEqual({ allowDraining: false }); expect(received).toHaveLength(7);
});

function registrar(ready: boolean, receipt: unknown = { ok: true, value: { tasks: [] } }) {
  let handler: (_event: unknown, body: unknown) => Promise<unknown>;
  const calls: unknown[] = [];
  const config = { port: 17841 };
  registerAgentMode({
    handle: (channel: string, callback: typeof handler) => { expect(channel).toBe('launcher:agent-mode'); handler = callback; },
    runtimeHost: { supervisor: {
      readConfig: () => config,
      ownedAgentRuntimeReady: async (value: unknown) => { expect(value).toBe(config); return ready; },
      ownedRuntimeReady: () => { throw new Error('Agent IPC must not require Web tunnel readiness'); },
      control: async (...args: unknown[]) => { calls.push(args); return receipt; },
    } },
  });
  return { call: (body: unknown) => handler(undefined, body), calls, config };
}

test('Agent IPC requires the owned runtime and never dispatches when unavailable', async () => {
  const fixture = registrar(false);
  await expect(fixture.call({ action: 'step', taskId: 'task', actionId: 'action', explicitUserAction: true })).rejects.toThrow('Start the current NEKODEX runtime');
  expect(fixture.calls).toEqual([]);
});

test('Agent IPC preserves action identity and returns the durable runtime receipt', async () => {
  const value = { task: { id: 'task', status: 'paused' } };
  const fixture = registrar(true, { ok: true, value });
  const body = { action: 'control', taskId: 'task', actionId: 'action', control: { action: 'pause' } };
  expect(await fixture.call(body)).toBe(value);
  expect(fixture.calls).toEqual([[fixture.config, 'agent-mode', { body, returnErrorReceipt: true }]]);
});

test('Agent IPC preserves explicit mailbox work and cycle scope without adding a send', async () => {
  const fixture = registrar(true);
  const scope = { familyId: 'family', generation: 3, revision: 4 };
  const packet = { action: 'enqueue-work', taskId: 'task', actionId: 'enqueue', scope, work: { workId: 'packet', workKey: 'source-v2', text: 'Inspect the new source revision and report the changed requirement.' } };
  const cycle = { action: 'cycle', taskId: 'task', actionId: 'load', scope, workId: 'packet', explicitUserAction: true };
  await fixture.call(packet); await fixture.call(cycle);
  expect(fixture.calls).toEqual([[fixture.config, 'agent-mode', { body: packet, returnErrorReceipt: true }], [fixture.config, 'agent-mode', { body: cycle, returnErrorReceipt: true }]]);
});

test('Agent IPC restricts retained tool reconciliation to scoped receipt identity without caller outcomes', async () => {
  const fixture = registrar(true);
  const body = { action: 'reconcile-tool', taskId: 'task', actionId: 'reconciliation', scope: { familyId: 'family', generation: 5, revision: 3 }, idempotencyKey: 'agent-tool:exact-original-receipt' };
  await fixture.call(body);
  expect(fixture.calls).toEqual([[fixture.config, 'agent-mode', { body, returnErrorReceipt: true }]]);
  await expect(fixture.call({ ...body, outcome: { state: 'completed' } })).rejects.toThrow('owned tool journal');
  await expect(fixture.call({ ...body, arguments: { command: 'caller supplied command' } })).rejects.toThrow('Invalid retained tool outcome lookup');
  expect(fixture.calls).toHaveLength(1);
});

test('Agent IPC refuses malformed/oversized commands and propagates a failed receipt', async () => {
  const fixture = registrar(true);
  for (const body of [null, [], { action: 'execute-shell' }, { action: 'create', input: 'a'.repeat(600001) }]) {
    await expect(fixture.call(body)).rejects.toThrow('Invalid Agent mode request');
  }
  expect(fixture.calls).toEqual([]);
  const failure = registrar(true, { ok: false, error: 'Task revision changed' });
  await expect(failure.call({ action: 'verify', taskId: 'task', actionId: 'action', reviewId: 'review' })).rejects.toThrow('Task revision changed');
});

const taskId = '11111111-1111-4111-8111-111111111111';
const rootId = '22222222-2222-4222-8222-222222222222';
const familyId = '33333333-3333-4333-8333-333333333333';
function workspaceRegistrar() {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const calls: Record<string, unknown>[] = [];
  const preparations: unknown[] = [];
  const observations: unknown[] = [];
  const signed = { id: 'signed-main-only', signature: 'opaque', generation: 3 };
  const observedProof = { signature: 'main-observation-only', capture: { exists: true, sha256: 'a'.repeat(64) } };
  registerAgentMode({
    handle: (channel: string, callback: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, callback),
    workspaceService: {
      prepareAgentWorkspaceGrant: (...args: unknown[]) => { preparations.push(args); return signed; },
      listRoots: () => [{ id: rootId, name: 'Picked root', path: '/main/only' }],
      listAgentWorkspaceGrants: () => [{ id: rootId, taskId, generation: 3, state: 'active' }],
      revokeAgentWorkspaceGrant: (id: string) => ({ grantId: id, state: 'revoked' }),
    },
    workspaceEvidenceService: { observe: (input: unknown) => { observations.push(input); return observedProof; } },
    runtimeHost: { supervisor: {
      readConfig: () => ({}), ownedAgentRuntimeReady: async () => true,
      control: async (_config: unknown, _kind: unknown, { body }: { body: Record<string, unknown> }) => {
        calls.push(body);
        return { ok: true, value: body.action === 'get' ? { task: { id: taskId, familyId, generation: 3, revision: 2, requirements: [{ id: 'r1', text: 'Artifact requirement' }] } } : { task: { id: taskId } } };
      },
    } },
  });
  return { call: (body: unknown) => handlers.get('launcher:agent-mode')!(undefined, body), handlers, preparations, calls, signed, observations, observedProof };
}

test('Agent workspace permission is signed only from selected root metadata in main', async () => {
  const fixture = workspaceRegistrar();
  const body = { action: 'create', actionId: 'create-action', input: { id: taskId, familyId }, workspaceSelection: { rootId, paths: ['src/main.ts'] } };
  await fixture.call(body);
  expect(fixture.preparations).toEqual([[rootId, ['src/main.ts'], { taskId, familyId, generation: 1 }]]);
  expect(fixture.calls[0]).toEqual({ action: 'create', actionId: 'create-action', input: { id: taskId, familyId, workspaceSnapshotGrant: fixture.signed } });
  expect(body.input).not.toHaveProperty('workspaceSnapshotGrant');
  for (const input of [
    { action: 'create', input: { id: taskId, workspaceSnapshotGrant: fixture.signed } },
    { action: 'workspace-grant', grant: fixture.signed },
    { action: 'create', input: { id: taskId }, workspaceSelection: { rootId, paths: ['/arbitrary/absolute'] } },
  ]) await expect(fixture.call(input)).rejects.toThrow();
  expect(fixture.preparations).toHaveLength(1);
});

test('Agent workspace renewal derives current scope, blocks stale scope and exposes no root paths', async () => {
  const fixture = workspaceRegistrar();
  const scope = { familyId, generation: 3, revision: 2 };
  await fixture.call({ action: 'workspace-grant', actionId: 'renew', taskId, scope, workspaceSelection: { rootId, paths: ['README.md'] } });
  expect(fixture.preparations).toEqual([[rootId, ['README.md'], { taskId, familyId, generation: 3 }]]);
  expect(fixture.calls[0]).toEqual({ action: 'get', taskId });
  expect(fixture.calls[1]).toEqual({ action: 'workspace-grant', actionId: 'renew', taskId, scope, grant: fixture.signed });
  await expect(fixture.call({ action: 'workspace-grant', actionId: 'stale', taskId, scope: { ...scope, generation: 1 }, workspaceSelection: { rootId, paths: ['README.md'] } })).rejects.toThrow('Task generation changed');
  expect(fixture.preparations).toHaveLength(1);
  expect(await fixture.handlers.get('launcher:agent-workspace-roots')!(undefined)).toEqual([{ id: rootId, name: 'Picked root' }]);
  expect(await fixture.handlers.get('launcher:agent-workspace-revoke')!(undefined, rootId)).toEqual({ grantId: rootId, state: 'revoked' });
  expect(fixture.calls).toHaveLength(3);
});

test('Artifact evidence is observed in main with owned task scope and never accepts a caller proof', async () => {
  const fixture = workspaceRegistrar();
  const scope = { familyId, generation: 3, revision: 2 };
  const actionId = '44444444-4444-4444-8444-444444444444';
  const evidenceSelection = { workspaceId: rootId, relativePath: 'output/report.md', requirementId: 'r1', property: 'file-sha256', expectedSha256: 'a'.repeat(64) };
  await fixture.call({ action: 'workspace-evidence', taskId, actionId, scope, evidenceSelection });
  expect(fixture.observations).toEqual([{ task: { id: taskId, familyId, generation: 3, revision: 2, requirements: [{ id: 'r1', text: 'Artifact requirement' }] }, observationId: actionId, ...evidenceSelection }]);
  expect(fixture.calls).toEqual([{ action: 'get', taskId }, { action: 'workspace-evidence', taskId, actionId, scope, proof: fixture.observedProof }]);
  await expect(fixture.call({ action: 'workspace-evidence', taskId, actionId, scope, proof: fixture.observedProof })).rejects.toThrow('observed by the main process');
  await expect(fixture.call({ action: 'workspace-evidence', taskId, actionId, scope: { ...scope, revision: 1 }, evidenceSelection })).rejects.toThrow('Task generation changed');
  await expect(fixture.call({ action: 'workspace-evidence', taskId, actionId, scope, evidenceSelection: { ...evidenceSelection, outcome: 'passed' } })).rejects.toThrow('Invalid workspace artifact observation');
  expect(fixture.observations).toHaveLength(1);
});
