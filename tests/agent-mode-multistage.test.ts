import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentModeRuntime } from '../src/agent-mode/runtime';
import { AgentModeStore } from '../src/agent-mode/store';
import { nativeDigest, nativeToolCallId } from '../src/agent-mode/native-protocol';
import type { AgentExecutionPort, CreateAgentTask, ExecutionRequest, ExecutionResult } from '../src/agent-mode/types';

const definition = (mode: 'goal' | 'loop' = 'goal'): CreateAgentTask => ({
  id: 'task', ownerMode: 'agent', mode, recurringAuthorized: mode === 'loop', originalRequest: 'Produce and independently inspect a substantive synthetic report.',
  requirements: [{ id: 'r', text: 'Report reflects both independent inputs.' }],
  stages: [{ id: 'a', instruction: 'Inspect the first input.', requirementIds: ['r'] }, { id: 'b', instruction: 'Inspect the second input.', requirementIds: ['r'] },
    { id: 'c', instruction: 'Combine both observations and report FINAL_MARKER.', requirementIds: ['r'], dependsOn: ['a', 'b'] }],
  bounds: { maxConcurrent: 2, maxTurns: 12, maxSpend: null }, execution: { provider: 'local-responses', model: 'fixture' },
});
const done = (id: string, outcome: ExecutionResult['outcome'] = 'completed'): ExecutionResult => ({ receiptId: id, outcome, summary: `${id}: synthetic ${outcome}`, actualSpend: 0 });
function fixture(port: AgentExecutionPort, mode: 'goal' | 'loop' = 'goal', input = definition(mode)) {
  const home = mkdtempSync(join(tmpdir(), 'neko-multistage-'));
  const store = new AgentModeStore(join(home, 'state.sqlite'));
  const runtime = new AgentModeRuntime({ store, executionPort: port, ownerId: 'owner', models: () => input.execution?.provider === 'owned-native' ? [{ id: 'fixture', provider: 'owned-native', admissionId: 'fixture-admission', available: true }] : [{ id: 'fixture' }] });
  runtime.create('create', input);
  return { store, runtime, async close() { await runtime.waitForIdle(); store.close(); rmSync(home, { recursive: true, force: true }); } };
}
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

test('bounded workers join dependencies and preserve sibling human wait until an explicit substantive reply', async () => {
  const first = gate<ExecutionResult>(), second = gate<ExecutionResult>(), started = gate<void>();
  const requests: ExecutionRequest[] = [];
  const f = fixture({ async execute(request, ack) {
    requests.push(request); ack(`ack-${requests.length}`);
    if (requests.length === 2) started.resolve();
    if (requests.length <= 2) return request.stage.id === 'a' ? first.promise : second.promise;
    return done(`result-${requests.length}`);
  } });
  try {
    const run = { explicitUserAction: true, automatic: true };
    f.runtime.step('task', 'run', run); await started.promise;
    expect(requests.map(row => row.stage.id)).toEqual(['a', 'b']); expect(f.store.listWorkers('task')).toHaveLength(2);
    first.resolve(done('question', 'awaiting_input'));
    await first.promise; await new Promise(resolve => setTimeout(resolve, 0));
    second.resolve(done('second-input')); await f.runtime.waitForIdle();
    expect(f.store.getTask('task').status).toBe('awaiting_input'); expect(requests).toHaveLength(2);
    expect(() => f.runtime.control('task', 'bypass', { action: 'resume' })).toThrow('substantive reply');
    f.runtime.control('task', 'pause-wait', { action: 'pause' }); expect(f.store.getTask('task').status).toBe('paused');
    f.runtime.control('task', 'resume-wait', { action: 'resume' }); expect(f.store.getTask('task').status).toBe('awaiting_input'); expect(requests).toHaveLength(2);
    f.runtime.control('task', 'reply', { action: 'reply', text: 'Use the approved first input value 17.' });
    expect(requests).toHaveLength(2); expect(f.store.getTask('task').status).toBe('ready');
    f.runtime.step('task', 'new-run', run); await f.runtime.waitForIdle();
    expect(requests.map(row => row.stage.id)).toEqual(['a', 'b', 'a', 'c']);
    expect(requests[2]!.messages.some(row => row.sender === 'user' && row.text.includes('17'))).toBe(true);
    expect(f.store.getTask('task').status).toBe('review_required');
    f.runtime.review('task', 'review'); expect(f.store.getTask('task').review!.findings).toHaveLength(1);
    expect(() => f.runtime.verify('task', 'verify', f.store.getTask('task').review!.id)).toThrow('Current complete');
    expect(f.runtime.step('task', 'new-run', run).duplicate).toBe(true); expect(requests).toHaveLength(4);
  } finally { first.resolve(done('cleanup-a')); second.resolve(done('cleanup-b')); await f.close(); }
}, 5000);

test('a successful sibling cannot clear a failure or run a dependent stage', async () => {
  const first = gate<ExecutionResult>(), second = gate<ExecutionResult>(), started = gate<void>(); let offers = 0;
  const f = fixture({ async execute(request, ack) { offers++; ack(`ack-${offers}`); if (offers === 2) started.resolve(); return request.stage.id === 'a' ? first.promise : second.promise; } });
  try {
    f.runtime.step('task', 'run', { explicitUserAction: true, automatic: true }); await started.promise;
    first.resolve(done('failed-input', 'failed')); await first.promise; await new Promise(resolve => setTimeout(resolve, 0));
    second.resolve(done('good-input')); await f.runtime.waitForIdle();
    expect(f.store.getTask('task').status).toBe('paused'); expect(offers).toBe(2); expect(f.store.getTask('task').stages.find(row => row.id === 'c')!.status).toBe('pending');
  } finally { first.resolve(done('cleanup-a')); second.resolve(done('cleanup-b')); await f.close(); }
}, 5000);

test('new substantive Loop work preserves the complete dependency plan and final instruction without duplicate dispatch', async () => {
  const requests: ExecutionRequest[] = [];
  const f = fixture({ async execute(request, ack) { requests.push(request); ack(`ack-${requests.length}`); return done(`loop-result-${requests.length}`); } }, 'loop');
  try {
    f.runtime.step('task', 'run', { explicitUserAction: true, automatic: true }); await f.runtime.waitForIdle();
    const scope = () => { const task = f.store.getTask('task'); return { familyId: task.familyId, generation: task.generation, revision: task.revision }; };
    const work = { workId: 'business-item-2', workKey: 'revision-2', text: 'Inspect the updated first and second values, 23 and 29, and regenerate the report.' };
    f.runtime.enqueueWork('task', 'enqueue', scope(), work); await f.runtime.waitForIdle();
    const task = f.store.getTask('task');
    expect(task.cycle).toBe(2); expect(task.stages.map(row => row.id)).toEqual(['a', 'b', 'c']); expect(task.stages[2]!.dependsOn).toEqual(['a', 'b']);
    expect(requests).toHaveLength(6); expect(requests[5]!.stage.instruction).toContain('FINAL_MARKER');
    expect(requests.slice(3).every(row => row.messages.some(message => message.text === work.text))).toBe(true);
    f.runtime.enqueueWork('task', 'duplicate-business-item', scope(), work); await f.runtime.waitForIdle();
    expect(requests).toHaveLength(6); expect(f.store.listWork('task')).toHaveLength(1); expect(task.status).toBe('review_required');
  } finally { await f.close(); }
}, 5000);

test('Native semantic stages get fresh bindings while exact tool continuation and dependency receipt context are retained', async () => {
  const requests: ExecutionRequest[] = [];
  const input = definition(); input.bounds.maxConcurrent = 1;
  input.execution = { provider: 'owned-native', model: 'fixture', admissionId: 'fixture-admission' };
  input.stages = [input.stages[0]!, { ...input.stages[2]!, dependsOn: ['a'] }];
  const f = fixture({ async execute(request, ack) {
    requests.push(request); ack(`native-ack-${requests.length}`);
    if (requests.length === 1) {
      const call = { protocol: 'neko-agent-v1' as const, requestId: 'read', toolCallId: nativeToolCallId(request.dispatch.id, 'read'), tool: 'fixture/read', arguments: {} };
      return { ...done('native-proposal', 'awaiting_input'), continuation: { kind: 'owned-native', version: 1, protocol: 'neko-agent-v1', rootDispatchId: request.dispatch.id,
        taskGeneration: request.task.generation, taskRevision: request.task.revision, workerBindingId: 'binding-a', workerGeneration: 1, nativeTurnReceiptId: 'turn-a',
        catalog: [], catalogDigest: nativeDigest([]), requestIds: ['read'], pending: [call] } };
    }
    return done(`native-final-${requests.length}`);
  } }, 'goal', input);
  try {
    f.runtime.step('task', 'run', { explicitUserAction: true, automatic: true }); await f.runtime.waitForIdle();
    const proposal = f.store.listDispatches('task')[0]!, call = proposal.result!.continuation!.pending[0]!;
    f.runtime.recordToolOutcome({ idempotencyKey: f.store.toolCallReceiptKey(proposal.id, call.toolCallId), scope: { taskId: 'task', generation: proposal.generation, toolCallId: call.toolCallId },
      tool: call.tool, state: 'completed', result: { total: 17, marker: 'observed-input' } }); await f.runtime.waitForIdle();
    expect(requests).toHaveLength(3); expect(requests[1]!.worker.id).toBe(requests[0]!.worker.id); expect(requests[2]!.worker.id).not.toBe(requests[0]!.worker.id);
    expect(requests[2]!.continuation).toBeUndefined(); expect(requests[2]!.priorToolContext).toMatchObject({ complete: true, receipts: [{ dispatchId: proposal.id, stageId: 'a', outcome: { state: 'completed', result: { total: 17, marker: 'observed-input' } } }] });
    expect(f.store.getTask('task').status).toBe('review_required'); expect(f.store.listWorkers('task')).toHaveLength(2);
  } finally { await f.close(); }
}, 5000);

test('selected immutable Native bytes persist across correction without sending and tampered task admission is rejected', async () => {
  const bytes = Buffer.from('Synthetic selected report input: 17\n');
  const input = definition(); input.bounds.maxConcurrent = 1; input.execution = { provider: 'owned-native', model: 'fixture', admissionId: 'fixture-admission' };
  input.nativeAttachments = [{ selectionId: 'selected-1', receipt: 'selected-file:selected-1', name: 'input.txt', mimeType: 'text/plain', data: bytes.toString('base64'), byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') }];
  let offers = 0;
  const f = fixture({ async execute() { offers++; return done('unused'); } }, 'goal', input);
  try {
    f.runtime.control('task', 'correct', { action: 'correct', text: 'Retain the selected report while refining the final summary.', requirements: input.requirements, stages: input.stages });
    expect(f.store.getTask('task').nativeAttachments).toEqual(input.nativeAttachments); expect(offers).toBe(0);
    const tampered = structuredClone(input); tampered.id = 'tampered'; tampered.nativeAttachments![0]!.data = Buffer.from('Synthetic selected report input: 18\n').toString('base64');
    expect(() => f.runtime.create('tampered-create', tampered)).toThrow(); expect(f.store.listTasks()).toHaveLength(1); expect(offers).toBe(0);
  } finally { await f.close(); }
}, 5000);
