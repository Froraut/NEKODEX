import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createVmExportControlRoutes } from '../src/execution-environments/control';
import { sha256 } from '../src/execution-environments/protocol';
import type { AgentModeRuntime } from '../src/agent-mode/runtime';
import type { AgentToolsComposition } from '../src/agent-tools/composition';

test('private export review accepts the current completed task; publication still requires active exact intent', async () => {
  const task = { id: randomUUID(), familyId: randomUUID(), generation: 2, status: 'review_required', ownerMode: 'agent', ownerId: 'current-owner' };
  const bytes = Buffer.from('retained result'), scope = { taskId: task.id, generation: task.generation };
  let accepting = true, intents = 0, reads = 0;
  const runtime = { store: { getTask: () => task }, runner: { ownerId: 'current-owner' } } as unknown as AgentModeRuntime;
  const tools = { readVmCandidate: async () => { reads++; return bytes; }, validateBegunVmExportInvocation: () => { intents++; } } as unknown as AgentToolsComposition;
  const route = createVmExportControlRoutes({ runtime: () => runtime, tools: () => tools, authorize: req => req.headers.get('authorization') === 'Bearer fixture', canStart: () => accepting });
  const post = (body: unknown) => route(new Request('http://127.0.0.1/admin/agent-vm-export', { method: 'POST', headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const candidate = { action: 'candidate', scope, operationId: 'a'.repeat(64), path: 'result.csv', sha256: sha256(bytes) };
  expect((await post({ action: 'validate-task', scope })).status).toBe(200);
  const reply = await (await post(candidate)).json(); expect(reply.value.dataBase64).toBe(bytes.toString('base64')); expect(reads).toBe(1);
  const intent = { action: 'validate-intent', request: { scope: { ...scope, toolCallId: 'exact-export-call' }, tool: 'vm-shell/export', arguments: { reviewId: randomUUID(), reviewDigest: 'b'.repeat(64) }, idempotencyKey: 'exact-export-intent' } };
  expect((await post(intent)).status).toBe(409); expect(intents).toBe(0);
  task.status = 'awaiting_input'; expect((await post(intent)).status).toBe(200); expect(intents).toBe(1);
  expect((await post({ ...candidate, scope: { ...scope, generation: 1 } })).status).toBe(409);
  task.ownerId = 'another-owner'; expect((await post(candidate)).status).toBe(409);
  task.ownerId = 'current-owner'; accepting = false; expect((await post(candidate)).status).toBe(409);
  expect(reads).toBe(1);
});
