import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createVmExportTools } from '../src/execution-environments/export-tools';
import type { LauncherVmExportBridge, VmExportOutcome, VmExportRequest, VmExportReview } from '../src/execution-environments/launcher-export';

function bridge(receipt: VmExportOutcome | undefined, reconciled: VmExportOutcome | undefined, reviews: VmExportReview[] = []) {
  const calls: string[] = [];
  const value: LauncherVmExportBridge = {
    async list() { calls.push('list'); return { reviews, receipts: [] }; },
    async execute() { calls.push('execute'); throw new Error('Reconciliation must never offer the export again'); },
    async receipt() { calls.push('receipt'); return receipt; },
    async reconcile() { calls.push('reconcile'); return reconciled; },
  };
  return { value, calls };
}
const scope = { taskId: randomUUID(), generation: 3 };
const request: VmExportRequest = { scope: { ...scope, toolCallId: 'export-call' }, tool: 'vm-shell/export',
  arguments: { reviewId: randomUUID(), reviewDigest: 'd'.repeat(64) }, idempotencyKey: 'export-once' };
const unknown: VmExportOutcome = { state: 'outcome_unknown', result: { reviewId: request.arguments.reviewId as string, ownerHeld: true } };
const completed: VmExportOutcome = { state: 'completed', result: { reviewId: request.arguments.reviewId as string, ownerHeld: false, reconciled: true } };

test('unknown export receipt is settled through main reconciliation of its retained publication proof', async () => {
  const b = bridge(unknown, completed), tools = createVmExportTools(b.value);
  expect(await tools.reconcile!(request)).toEqual(completed);
  expect(b.calls).toEqual(['receipt', 'reconcile']);
});

test('terminal or absent receipts are returned without main reconciliation, and unresolved stays unknown', async () => {
  const done = bridge(completed, undefined);
  expect(await createVmExportTools(done.value).reconcile!(request)).toEqual(completed);
  const absent = bridge(undefined, completed);
  expect(await createVmExportTools(absent.value).reconcile!(request)).toBeUndefined();
  const pending = bridge(unknown, undefined);
  expect(await createVmExportTools(pending.value).reconcile!(request)).toEqual(unknown);
  expect([done.calls, absent.calls, pending.calls]).toEqual([['receipt'], ['receipt'], ['receipt', 'reconcile']]);
});

test('export discovery offers only reviews of the exact current task generation', async () => {
  const review = (generation: number): VmExportReview => ({ reviewId: randomUUID(), reviewDigest: 'e'.repeat(64), scope: { ...scope, generation, familyId: randomUUID() },
    workspaceId: randomUUID(), destinationPath: 'out/result.csv', operationId: 'op', candidatePath: 'result.csv', candidateSha256: 'f'.repeat(64), bytes: 1,
    expectedRevision: null, currentSha256: null, currentBytes: 0 });
  const current = review(3), b = bridge(undefined, undefined, [current, review(2)]);
  const [descriptor, ...rest] = await createVmExportTools(b.value).discover({ ...scope, toolCallId: 'discovery' });
  expect(rest).toEqual([]);
  expect(descriptor?.id).toBe('vm-shell/export');
  expect(JSON.stringify(descriptor?.inputSchema)).toContain(current.reviewId);
  expect(await createVmExportTools(bridge(undefined, undefined, [review(2)]).value).discover({ ...scope, toolCallId: 'discovery' })).toEqual([]);
});
