import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createVmShellToolsProvider, vmShellActionId } from '../src/execution-environments/tools';
import type { VmExecutorPort } from '../src/execution-environments/types';
import type { AdmittedVmRuntime, VmExecutionInput, VmExecutionResult } from '../src/execution-environments/executor';
import { defaultToolsConfig } from '../src/agent-tools/config';
import { StandaloneMcpHost } from '../src/agent-tools/mcp-host';
import { invocationFingerprint } from '../src/agent-tools/journal';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const scope = { taskId: 'vm-tools-fixture', generation: 1, toolCallId: 'selection' };
function fixture(port?: Partial<VmExecutorPort>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'neko-vm-tools-'))), home = join(root, 'owner'), workspace = join(root, 'workspace'), artifacts = join(root, 'runtime');
  for (const path of [home, workspace, artifacts]) mkdirSync(path, { mode: 0o700 });
  writeFileSync(join(workspace, 'selected.txt'), 'selected snapshot\n'); writeFileSync(join(workspace, 'not-selected.txt'), 'must not copy');
  const runtime: AdmittedVmRuntime = Object.freeze({ kind: 'development-linux-vm', runtimeDigest: 'a'.repeat(64) });
  let active = true; const calls: VmExecutionInput[] = [], cancelled: string[] = []; const retained = new Map<string, VmExecutionResult>();
  const result = (actionId: string): VmExecutionResult => ({ actionId, state: 'stopped', ownerHeld: false, reason: 'vm-guest-result-captured', guestExitCode: 0, guestSignal: null,
    stdout: 'observed', stderr: '', logsTruncated: false, candidates: [{ path: 'result.txt', size: 6, mode: 0o600, sha256: sha('result') }], resultDigest: 'b'.repeat(64) });
  const executor: VmExecutorPort = { protectedPaths: () => [artifacts], async execute(input) { input.assertCurrent?.(); calls.push(input); const row = result(input.actionId); retained.set(row.actionId, row); return row; },
    reconcile: id => retained.get(id), readResult: id => retained.get(id), readCandidate: () => Buffer.from('result'), cancel: id => { cancelled.push(id); }, ...port };
  let selectedRuntime: AdmittedVmRuntime | undefined = runtime;
  const options = { executor, privateOwnerHome: home, getRuntime: () => selectedRuntime, isScopeActive: () => active };
  const provider = createVmShellToolsProvider(options);
  const request = (bindingId: string, id = 'call') => ({ scope: { ...scope, toolCallId: id }, tool: 'vm-shell/run', idempotencyKey: id,
    arguments: { bindingId, script: 'cat selected.txt | tr a-z A-Z > result.txt', inputPaths: ['selected.txt'], outputPaths: ['result.txt'], timeoutMs: 1000 } });
  return { root, home, workspace, artifacts, provider, executor, options, calls, cancelled, retained, result, request, setActive: (value: boolean) => { active = value; }, setRuntime: (value: AdmittedVmRuntime | undefined) => { selectedRuntime = value; }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('VM builtin is passive until existing exact ToolJournal approval, snapshots only named files and keeps candidates private', async () => {
  const f = fixture(); const config = defaultToolsConfig(); config.enabled = false;
  const host = new StandaloneMcpHost({ config, journalPath: join(f.home, 'journal.sqlite'), builtins: [f.provider], isScopeActive: () => true });
  try {
    expect(f.provider.status().activeOperations).toEqual([]); expect(await host.discover(scope)).toEqual([]); expect(f.calls).toHaveLength(0);
    const binding = f.provider.attach(scope, { root: f.workspace, label: 'Selected input snapshot' }, true);
    expect(JSON.stringify(f.provider.status())).not.toContain(f.workspace); await host.discover(scope);
    const request = f.request(binding.id);
    await expect(host.invoke({ ...request, grantId: 'not-approved' })).rejects.toThrow('approval'); expect(f.calls).toHaveLength(0);
    const grantId = host.authorize(request), outcome = await host.invoke({ ...request, grantId });
    expect(outcome.state).toBe('completed'); expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.files.map(file => file.path)).toEqual(['selected.txt']); expect(Buffer.from(f.calls[0]!.files[0]!.bytes).toString()).toBe('selected snapshot\n');
    expect(f.calls[0]!.actionId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(await host.invoke({ ...request, grantId })).toEqual(outcome); expect(f.calls).toHaveLength(1);
    const metadata = (outcome.result as any).structuredContent;
    expect(metadata).toMatchObject({ operationId: invocationFingerprint(request), hostWrites: false, candidateDisposition: 'private-untrusted-proposals-not-exported', taskResultVerification: false });
    expect(await f.provider.readCandidate(scope, metadata.operationId, 'result.txt', sha('result'))).toEqual(Buffer.from('result'));
    expect(readFileSync(join(f.workspace, 'selected.txt'), 'utf8')).toBe('selected snapshot\n');
  } finally { await host.close(); await f.provider.close(); f.cleanup(); }
});

test('VM snapshot refuses symlinks, protected overlap and changed runtime or scope before dispatch', async () => {
  const f = fixture();
  try {
    expect(() => f.provider.attach(scope, { root: f.home }, true)).toThrow('overlap');
    expect(() => f.provider.attach(scope, { root: f.artifacts }, true)).toThrow('overlap');
    const binding = f.provider.attach(scope, { root: f.workspace }, true), request = f.request(binding.id, 'symlink');
    symlinkSync(join(f.home, 'private.txt'), join(f.workspace, 'link.txt')); writeFileSync(join(f.home, 'private.txt'), 'must not read');
    request.arguments.inputPaths = ['link.txt']; expect((await f.provider.execute(request)).state).toBe('failed'); expect(f.calls).toHaveLength(0);
    f.setActive(false); expect((await f.provider.execute(f.request(binding.id, 'stale'))).state).toBe('failed'); expect(f.calls).toHaveLength(0);
    f.setActive(true);
    f.setRuntime({ kind: 'development-linux-vm', runtimeDigest: 'f'.repeat(64) });
    expect((await f.provider.execute(f.request(binding.id, 'changed-runtime'))).state).toBe('failed'); expect(f.calls).toHaveLength(0);
    f.executor.status = () => ({ available: false, ownerHeld: true, actionId: 'foreign-profile', reason: 'Foreign VM owner active' });
    expect(f.provider.status().available).toBe(false); expect(f.provider.activeCount).toBe(0);
    expect(() => f.provider.attach(scope, { root: f.workspace }, true)).toThrow('global-owner');
  } finally { await f.provider.close(); f.cleanup(); }
});

test('named snapshot revalidation rejects a changed file at the trusted start gate', async () => {
  let gateChecks = 0;
  const f = fixture({ async execute(input) {
    writeFileSync(join(f.workspace, 'selected.txt'), 'concurrent changed source');
    expect(() => input.assertCurrent?.()).toThrow('vm-input-changed'); gateChecks++;
    return { ...f.result(input.actionId), state: 'never-started', reason: 'vm-prelaunch-failed', candidates: [], guestExitCode: null };
  } });
  try {
    const binding = f.provider.attach(scope, { root: f.workspace }, true);
    expect((await f.provider.execute(f.request(binding.id, 'snapshot-drift'))).state).toBe('failed');
    expect(gateChecks).toBe(1); expect(f.provider.activeCount).toBe(0);
  } finally { await f.provider.close(); f.cleanup(); }
});

test('VM unknown ownership survives settled promise/revoke and exact late reconciliation never recaptures or replays', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let started!: () => void; const entered = new Promise<void>(resolve => { started = resolve; });
  const f = fixture({ async execute(input) { f.calls.push(input); started(); await gate; const value: VmExecutionResult = { ...f.result(input.actionId), state: 'unknown', ownerHeld: true, reason: 'vm-stopped-proof-missing', candidates: [] }; f.retained.set(input.actionId, value); return value; } });
  try {
    const binding = f.provider.attach(scope, { root: f.workspace }, true), request = f.request(binding.id, 'unknown'); const pending = f.provider.execute(request); await entered;
    const revoked = f.provider.revoke(scope, binding.id, true); release();
    expect((await pending).state).toBe('outcome_unknown'); await expect(revoked).rejects.toThrow('still-held');
    expect(f.provider.status().bindings).toEqual([]); expect(f.provider.activeCount).toBe(1);
    expect(() => f.provider.attach(scope, { root: f.workspace }, true)).toThrow('held'); expect(f.calls).toHaveLength(1);
    const recovered = createVmShellToolsProvider(f.options);
    expect((await recovered.reconcile!(request))?.state).toBe('outcome_unknown'); expect(recovered.activeCount).toBe(1);
    expect(recovered.status().activeOperations).toHaveLength(1);
    expect(() => recovered.attach(scope, { root: f.workspace }, true)).toThrow('held');
    const actionId = vmShellActionId(request); f.retained.set(actionId, f.result(actionId));
    writeFileSync(join(f.workspace, 'selected.txt'), 'changed after original VM');
    const late = await f.provider.reconcileOperation(scope, invocationFingerprint(request), true);
    expect(late?.state).toBe('completed'); expect(f.provider.activeCount).toBe(0); expect(f.calls).toHaveLength(1);
    await recovered.close();
    const fresh = createVmShellToolsProvider(f.options);
    expect((await fresh.reconcile!(request))?.state).toBe('completed'); expect(f.calls).toHaveLength(1);
    expect(await fresh.readCandidate(scope, invocationFingerprint(request), 'result.txt', sha('result'))).toEqual(Buffer.from('result')); await fresh.close();
  } finally { release(); for (const [id] of f.retained) f.retained.set(id, f.result(id)); await f.provider.close(); f.cleanup(); }
});

test('VM result projection bounds escaped logs and scope invalidation drains without a second execution', async () => {
  const f = fixture({ async execute(input) { input.assertCurrent?.(); f.calls.push(input); const value = { ...f.result(input.actionId), stdout: '\u0000"\\'.repeat(100000), stderr: 'suffix' }; f.retained.set(value.actionId, value); return value; } });
  try {
    const binding = f.provider.attach(scope, { root: f.workspace }, true), request = f.request(binding.id, 'bounded'); const outcome = await f.provider.execute(request);
    expect(outcome.state).toBe('completed'); expect(Buffer.byteLength(JSON.stringify(outcome.result))).toBeLessThanOrEqual(224 * 1024);
    expect((outcome.result as any).structuredContent.logsTruncated).toBe(true);
    f.provider.invalidate(scope.taskId); expect(f.provider.status().bindings).toEqual([]);
    expect((await f.provider.execute(f.request(binding.id, 'revoked'))).state).toBe('failed'); expect(f.calls).toHaveLength(1);
  } finally { await f.provider.close(); f.cleanup(); }
});

test('trusted synchronous VM preclaim refusal is failed without inventing a held physical owner', async () => {
  let attempts = 0;
  const f = fixture({ execute() { attempts++; throw new Error('vm-owner-busy'); } });
  try {
    const binding = f.provider.attach(scope, { root: f.workspace }, true), request = f.request(binding.id, 'sync-refused');
    expect((await f.provider.execute(request)).state).toBe('failed'); expect(f.provider.activeCount).toBe(0);
    expect(f.provider.status().operations[0]!.state).toBe('never-started');
    expect((await f.provider.execute(request)).state).toBe('failed'); expect(attempts).toBe(1);
  } finally { await f.provider.close(); f.cleanup(); }
});
