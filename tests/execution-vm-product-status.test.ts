import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
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

/** A begun run whose journal receipt is still outcome_unknown, as while the VM is live. */
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'neko-vm-product-status-'))), home = join(root, 'owner');
  mkdirSync(home, { mode: 0o700 });
  const call: SavedCall = { scope: { taskId: 'busy-vm-product-task', generation: 1, toolCallId: 'busy-call' }, tool: 'vm-shell/run', idempotencyKey: 'busy-vm-product-once',
    arguments: { bindingId: 'busy-binding', script: 'echo ok > out.txt', inputPaths: [], outputPaths: ['out.txt'], timeoutMs: 1000 } };
  const journal = new ToolJournal(join(home, 'agent-tool-calls.sqlite'));
  expect(journal.begin({ ...call, grantId: 'busy-grant' }, 'vm').outcome.state).toBe('outcome_unknown');
  journal.close();
  const bytes = Buffer.from('ok\n'), actionId = vmShellActionId(call);
  const settled: VmExecutionResult = { actionId, state: 'stopped', ownerHeld: false, reason: 'vm-guest-result-captured', guestExitCode: 0, guestSignal: null,
    stdout: '', stderr: '', logsTruncated: false, candidates: [{ path: 'out.txt', size: bytes.length, mode: 0o600, sha256: sha256(bytes) }], resultDigest: 'c'.repeat(64) };
  const state = { busy: true, reconcile: 0 };
  const busy = () => { if (state.busy) throw new Error('vm-owner-busy'); };
  const port: VmExecutorPort = {
    execute() { throw new Error('Status must never execute'); },
    protectedPaths() { throw new Error('Status must never admit a runtime'); },
    reconcile(id) { state.reconcile++; busy(); return id === actionId ? settled : undefined; },
    readResult(id) { busy(); return id === actionId ? settled : undefined; },
    status: () => ({ available: false, ownerHeld: true, reason: 'vm-authority-held' }),
    cancel() {},
  };
  const composition = new AgentToolsComposition({ home, authorize: () => false, isScopeActive: () => true, vmExecutor: port, resolveSavedVmCalls: () => [call] });
  return { call, state, composition, async close() { await composition.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('VM status stays observable while the retained owner is busy and restores the result once it settles', async () => {
  const f = fixture();
  try {
    const busy = await f.composition.vmStatus(f.call.scope);
    expect(busy.vmTools.operations).toEqual([]);
    expect(f.state.reconcile).toBe(1);
    f.state.busy = false;
    const restored = await f.composition.vmStatus(f.call.scope);
    expect(restored.vmTools.operations).toEqual([expect.objectContaining({ operationId: invocationFingerprint(f.call), state: 'stopped', ownerHeld: false })]);
    expect(f.state.reconcile).toBe(2);
  } finally { await f.close(); }
});
