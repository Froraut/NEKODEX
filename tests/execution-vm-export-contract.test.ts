import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { vmExportRequestSchema, vmExportTaskScopeSchema, VM_EXPORT_LIMITS } from '../src/execution-environments/export-contract';
import { createVmExportControlRoutes } from '../src/execution-environments/control';
import type { AgentModeRuntime } from '../src/agent-mode/runtime';
import type { AgentToolsComposition } from '../src/agent-tools/composition';
const main = createRequire(import.meta.url)('../launcher/electron/vm-export-contract.cjs');

test('main and private core accept the same journal-bound export request and reject an over-limit identity before effect admission', async () => {
  const task = { id: randomUUID(), familyId: randomUUID(), generation: 1, ownerMode: 'agent', ownerId: 'owner', status: 'awaiting_input' };
  const request = { scope: { taskId: task.id, generation: 1, toolCallId: 'c'.repeat(VM_EXPORT_LIMITS.toolCallId) }, tool: 'vm-shell/export',
    arguments: { reviewId: randomUUID(), reviewDigest: 'a'.repeat(64) }, idempotencyKey: 'k'.repeat(VM_EXPORT_LIMITS.idempotencyKey) };
  let admitted = 0;
  const route = createVmExportControlRoutes({ authorize: () => true, canStart: () => true,
    runtime: () => ({ store: { getTask: () => task }, runner: { ownerId: 'owner' } }) as unknown as AgentModeRuntime,
    tools: () => ({ validateBegunVmExportInvocation: () => { admitted++; } }) as unknown as AgentToolsComposition });
  const post = (value: unknown) => route(new Request('http://127.0.0.1/admin/agent-vm-export', { method: 'POST', body: JSON.stringify({ action: 'validate-intent', request: value }) }));
  expect(main.parseVmExportRequest(request)).toEqual(vmExportRequestSchema.parse(request));
  expect((await post(request)).status).toBe(200); expect(admitted).toBe(1);
  for (const invalid of [
    { ...request, scope: { ...request.scope, toolCallId: request.scope.toolCallId + 'x' } },
    { ...request, idempotencyKey: request.idempotencyKey + 'x' },
    { ...request, scope: { ...request.scope, generation: Number.MAX_SAFE_INTEGER + 1 } },
    { ...request, arguments: { ...request.arguments, hostPath: '/private/forbidden' } },
  ]) {
    expect(() => main.parseVmExportRequest(invalid)).toThrow();
    expect(vmExportRequestSchema.safeParse(invalid).success).toBe(false);
    expect((await post(invalid)).status).toBe(400);
  }
  expect(admitted).toBe(1);
  expect(vmExportTaskScopeSchema.parse({ taskId: task.id, generation: 1 })).toEqual(main.parseVmExportTaskScope({ taskId: task.id, generation: 1 }));
});
