import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentToolsComposition } from '../src/agent-tools/composition';
import { ToolJournal, invocationFingerprint } from '../src/agent-tools/journal';
import type { ToolInvocation } from '../src/agent-tools/types';
import { vmShellActionId } from '../src/execution-environments/tools';
import { sha256 } from '../src/execution-environments/protocol';
import type { VmExecutionResult } from '../src/execution-environments/executor';
import type { VmExecutorPort } from '../src/execution-environments/types';

type SavedCall = Omit<ToolInvocation, 'grantId'>;
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'neko-vm-product-recovery-'))), home = join(root, 'owner');
  mkdirSync(home, { mode: 0o700 });
  const original: SavedCall = { scope: { taskId: 'retained-vm-product-task', generation: 1, toolCallId: 'original-call' }, tool: 'vm-shell/run', idempotencyKey: 'retained-vm-product-once',
    arguments: { bindingId: 'original-opaque-binding', script: 'cat source.txt | tr a-z A-Z > result.txt', inputPaths: ['source.txt'], outputPaths: ['result.txt'], timeoutMs: 1000 } };
  const journalPath = join(home, 'agent-tool-calls.sqlite'), journal = new ToolJournal(journalPath);
  const admitted = journal.begin({ ...original, grantId: 'original-admitted-grant' }, 'vm');
  expect(admitted.inserted).toBe(true); expect(admitted.outcome.state).toBe('outcome_unknown');
  journal.settle({ ...admitted.outcome, state: 'completed', result: { structuredContent: { state: 'stopped', candidates: [{ path: 'forged-from-journal.txt', size: 1, sha256: sha256('x'), mode: 0o600 }], resultDigest: 'f'.repeat(64) } } });
  journal.close();
  const originalBytes = readFileSync(journalPath), bytes = Buffer.from('ORIGINAL RETAINED RESULT\n'), actionId = vmShellActionId(original);
  const candidate = Object.freeze({ path: 'result.txt', size: bytes.length, mode: 0o600 as const, sha256: sha256(bytes) });
  const retained: VmExecutionResult = Object.freeze({ actionId, state: 'stopped', ownerHeld: false, reason: 'vm-guest-result-captured', guestExitCode: 0, guestSignal: null,
    stdout: 'retained stdout', stderr: '', logsTruncated: false, candidates: Object.freeze([candidate]) as unknown as VmExecutionResult['candidates'], resultDigest: 'b'.repeat(64) });
  const calls = { execute: 0, protectedPaths: 0, reconcile: [] as string[], readResult: [] as string[], readCandidate: [] as string[], cancel: 0 };
  const port: VmExecutorPort = {
    execute() { calls.execute++; throw new Error('Recovery must not execute or snapshot new inputs'); },
    protectedPaths() { calls.protectedPaths++; throw new Error('Recovery must not admit a runtime or snapshot a workspace'); },
    reconcile(id) { calls.reconcile.push(id); return id === actionId ? retained : undefined; },
    readResult(id) { calls.readResult.push(id); return id === actionId ? retained : undefined; },
    readCandidate(id, path, digest) { calls.readCandidate.push(id); expect([id, path, digest]).toEqual([actionId, candidate.path, candidate.sha256]); return Uint8Array.from(bytes); },
    status: () => ({ available: false, ownerHeld: false, reason: 'No execution runtime prepared in this fresh composition' }),
    cancel() { calls.cancel++; },
  };
  let saved: readonly SavedCall[] = [original];
  const composition = new AgentToolsComposition({ home, authorize: () => false, isScopeActive: () => true, vmExecutor: port,
    resolveSavedVmCalls: () => saved });
  return { root, home, original, bytes, candidate, retained, actionId, calls, composition, journalPath, originalBytes,
    saved(value: readonly SavedCall[]) { saved = value; },
    async close() { await composition.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('fresh product VM status restores completed journal call from exact retained owner, without runtime preparation or replay', async () => {
  const f = fixture();
  try {
    const status = await f.composition.vmStatus(f.original.scope), operationId = invocationFingerprint(f.original);
    expect(status.vmEnvironment.prepared).toBe(false); expect(status.vmEnvironment.review).toBeUndefined();
    expect(status.vmTools.bindings).toEqual([]); expect(status.vmTools.activeOperations).toEqual([]);
    expect(status.vmTools.operations).toEqual([expect.objectContaining({ operationId, actionId: f.actionId, taskId: f.original.scope.taskId, generation: 1,
      bindingId: 'original-opaque-binding', state: 'stopped', ownerHeld: false, candidates: [f.candidate], resultDigest: f.retained.resultDigest })]);
    expect(JSON.stringify(status.vmTools.operations)).not.toContain('forged-from-journal');
    expect(await f.composition.readVmCandidate(f.original.scope, operationId, f.candidate.path, f.candidate.sha256)).toEqual(Uint8Array.from(f.bytes));
    expect(f.calls.reconcile).toEqual([f.actionId]); expect(f.calls.readResult).toEqual([f.actionId]); expect(f.calls.readCandidate).toEqual([f.actionId]);
    expect([f.calls.execute, f.calls.protectedPaths, f.calls.cancel]).toEqual([0, 0, 0]);
    expect(readFileSync(f.journalPath)).toEqual(f.originalBytes);
  } finally { await f.close(); }
});

test('same saved id with changed canonical arguments or generation refuses before retained-owner access and cannot hydrate a foreign generation', async () => {
  const f = fixture();
  try {
    f.saved([{ ...f.original, arguments: { ...f.original.arguments, script: 'different approved operation' } }]);
    await expect(f.composition.vmStatus(f.original.scope)).rejects.toThrow('Retained tool identity conflict');
    const foreignScope = { ...f.original.scope, generation: 2 };
    f.saved([{ ...f.original, scope: foreignScope }]);
    await expect(f.composition.vmStatus(foreignScope)).rejects.toThrow('Retained tool identity conflict');
    expect(f.calls).toEqual({ execute: 0, protectedPaths: 0, reconcile: [], readResult: [], readCandidate: [], cancel: 0 });
    expect(readFileSync(f.journalPath)).toEqual(f.originalBytes);
  } finally { await f.close(); }
});

test('current generation can review its same-task historical output without reviving old execution authority', async () => {
  const f = fixture();
  try {
    const current = { ...f.original.scope, generation: 2 }, operationId = invocationFingerprint(f.original);
    const status = await f.composition.vmStatus(current);
    expect(status.vmTools.operations).toEqual([expect.objectContaining({ operationId, generation: 1, candidates: [f.candidate] })]);
    expect(await f.composition.readVmCandidate(current, operationId, f.candidate.path, f.candidate.sha256)).toEqual(Uint8Array.from(f.bytes));
    await expect(f.composition.readVmCandidate({ ...current, taskId: 'another-task' }, operationId, f.candidate.path, f.candidate.sha256)).rejects.toThrow('vm-candidate-unavailable');
    f.saved([{ ...f.original, scope: { ...current, generation: 3 } }]);
    await f.composition.vmStatus(current); // Future calls cannot become a current task's retained source.
    expect(f.calls.reconcile).toEqual([f.actionId]); expect(f.calls.readCandidate).toEqual([f.actionId]);
    expect([f.calls.execute, f.calls.protectedPaths, f.calls.cancel]).toEqual([0, 0, 0]);
    expect(status.vmTools.bindings).toEqual([]); expect(status.vmEnvironment.prepared).toBe(false);
    expect(readFileSync(f.journalPath)).toEqual(f.originalBytes);
  } finally { await f.close(); }
});
