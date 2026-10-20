import { expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zipSync } from 'fflate';
import { admitApplePythonRuntime } from '../src/agent-tools/skill-python-runtime';
import { SkillPythonEnvironmentStore, assertAdmittedPythonEnvironment } from '../src/agent-tools/skill-python-environment';
import { createSkillScriptToolsProvider, type SkillScriptExecutorPort } from '../src/agent-tools/skill-script-tools';
import { StandaloneMcpHost } from '../src/agent-tools/mcp-host';
import { defaultToolsConfig } from '../src/agent-tools/config';
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let runtime: ReturnType<typeof admitApplePythonRuntime>;
function fixture() {
  runtime ??= admitApplePythonRuntime();
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'neko-env-provider-'))), home = join(root, 'private'), workspace = join(root, 'workspace');
  mkdirSync(home, { mode: 0o700 }); mkdirSync(workspace, { mode: 0o700 });
  const dist = 'fixture_dependency-1.0.dist-info', files: Record<string, Uint8Array> = {
    'fixture_dependency.py': Buffer.from('VALUE = "reviewed-dependency"\n'),
    [dist + '/METADATA']: Buffer.from('Metadata-Version: 2.1\nName: fixture-dependency\nVersion: 1.0\nRequires-Python: >=3.9\n'),
    [dist + '/WHEEL']: Buffer.from('Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n'),
  };
  files[dist + '/RECORD'] = Buffer.from(Object.entries(files).map(([path, bytes]) => `${path},sha256=${createHash('sha256').update(bytes).digest('base64url')},${bytes.length}\n`).join('') + dist + '/RECORD,,\n');
  const wheel = join(root, 'fixture_dependency-1.0-py3-none-any.whl'); writeFileSync(wheel, zipSync(files, { level: 0 }), { mode: 0o600 });
  const store = new SkillPythonEnvironmentStore({ home, runtime }), actionId = randomUUID(), review = store.review(actionId, { wheelPaths: [wheel] }, true);
  const prepared = store.prepare(actionId, review.reviewDigest, true), environmentId = prepared.environment!.environmentId;
  const py = 'import fixture_dependency\nprint(fixture_dependency.VALUE)\n', js = 'console.log("legacy")\n';
  const versionId = 'a'.repeat(64), packageDigest = 'b'.repeat(64);
  const sources = [{ relativePath: 'scripts/run.py', mediaType: 'text/x-python' as const, runtime: 'python' as const, content: py },
    { relativePath: 'scripts/helper.mjs', mediaType: 'text/javascript' as const, content: js }];
  const resources = sources.map(row => ({ ...row, kind: 'script' as const, role: 'selected-skill-source-material' as const, digest: sha(row.content), bytes: Buffer.byteLength(row.content), versionId, packageDigest }));
  const scope = { taskId: 'environment-flow', generation: 1, toolCallId: 'control' };
  const cleanup = () => { const unseal = (path: string) => { if (lstatSync(path).isDirectory()) { chmodSync(path, 0o700); for (const name of readdirSync(path)) unseal(join(path, name)); } }; unseal(root); rmSync(root, { recursive: true, force: true }); };
  return { root, home, workspace, store, environmentId, resources, scope, cleanup };
}

test.skipIf(process.platform !== 'darwin')('real environment owner and existing ToolJournal require exact Python binding without changing JavaScript or stdlib defaults', async () => {
  const f = fixture(); let executions = 0;
  const executor: SkillScriptExecutorPort = { capabilities: () => ({ supported: true, runtimes: { javascript: { supported: true }, python: { supported: true } } }),
    async execute(input) { input.assertCurrent(); if (input.pythonEnvironment) assertAdmittedPythonEnvironment(input.pythonEnvironment, runtime); executions++;
      return { state: 'completed', stdout: 'inert executor handoff', stderr: '', exitCode: 0, truncated: false }; }, cancel() {} };
  const provider = createSkillScriptToolsProvider({ privateOwnerHome: f.home, executor, isScopeActive: () => true, resources: () => f.resources,
    readResource: (_scope, _version, _package, path) => f.resources.find(row => row.relativePath === path)!, resolvePythonEnvironment: id => f.store.admit(id) });
  const config = defaultToolsConfig(); config.enabled = false;
  const host = new StandaloneMcpHost({ config, journalPath: join(f.home, 'tools.sqlite'), builtins: [provider], isScopeActive: () => true });
  try {
    const grant = provider.grant(f.scope, { root: f.workspace, access: 'read-only' }, true);
    const binding = provider.bindPythonEnvironment(f.scope, f.environmentId, true);
    expect(provider.bindPythonEnvironment(f.scope, f.environmentId, true)).toEqual(binding);
    expect(JSON.stringify(provider.status().environmentBindings)).not.toContain(f.home);
    await host.discover(f.scope);
    const args = (path: string, env?: string) => { const row = f.resources.find(row => row.relativePath === path)!; return { versionId: row.versionId, packageDigest: row.packageDigest,
      relativePath: row.relativePath, resourceDigest: row.digest, workspaceGrantId: grant.id, argv: [], ...(env ? { pythonEnvironmentId: env } : {}) }; };
    const invoke = async (id: string, arguments_: Record<string, unknown>) => { const request = { scope: { ...f.scope, toolCallId: id }, tool: 'skill-script/run', idempotencyKey: id, arguments: arguments_ };
      const grantId = host.authorize(request); return { request, grantId, outcome: await host.invoke({ ...request, grantId }) }; };
    expect((await invoke('missing-environment', args('scripts/run.py'))).outcome.state).toBe('failed');
    expect((await invoke('javascript-no-environment', args('scripts/helper.mjs', f.environmentId))).outcome.state).toBe('failed');
    expect(executions).toBe(0);
    const request = { scope: { ...f.scope, toolCallId: 'approved-python' }, tool: 'skill-script/run', idempotencyKey: 'approved-python', arguments: args('scripts/run.py', f.environmentId) };
    await expect(host.invoke({ ...request, grantId: 'not-approved' })).rejects.toThrow('approval');
    const grantId = host.authorize(request), outcome = await host.invoke({ ...request, grantId });
    expect(outcome.state).toBe('completed'); expect(executions).toBe(1);
    expect(await host.invoke({ ...request, grantId })).toEqual(outcome); expect(executions).toBe(1);
    await provider.revokePythonEnvironment(f.scope, binding.id, true); await host.discover(f.scope);
    expect((await invoke('stdlib-after-revoke', args('scripts/run.py'))).outcome.state).toBe('completed');
    expect(provider.status().environmentBindings).toEqual([]);
  } finally { await host.close(); await provider.close(); f.cleanup(); }
}, 15000);

test.skipIf(process.platform !== 'darwin')('resolved unknown receipt keeps exact environment owner held after revocation until passive reap proof', async () => {
  const f = fixture(); let reaped = false, executions = 0, globalCloses = 0;
  const receipt = () => ({ state: 'unknown' as const, stdout: '', stderr: '', exitCode: null, truncated: false, owner: { reaped } });
  const provider = createSkillScriptToolsProvider({ privateOwnerHome: f.home, isScopeActive: () => true, resources: () => f.resources,
    resolvePythonEnvironment: id => f.store.admit(id), readResource: (_s, _v, _p, path) => f.resources.find(row => row.relativePath === path)!,
    executor: { capabilities: () => ({ supported: true, runtimes: { python: { supported: true } } }), async execute() { executions++; return receipt(); },
      cancel() {}, reconcile: () => receipt(), close() { globalCloses++; } } });
  try {
    const grant = provider.grant(f.scope, { root: f.workspace, access: 'read-only' }, true), binding = provider.bindPythonEnvironment(f.scope, f.environmentId, true), row = f.resources[0]!;
    const request = { scope: f.scope, tool: 'skill-script/run', idempotencyKey: 'unknown-held-environment', arguments: { versionId: row.versionId, packageDigest: row.packageDigest,
      relativePath: row.relativePath, resourceDigest: row.digest, workspaceGrantId: grant.id, argv: [], pythonEnvironmentId: f.environmentId } };
    const original = await provider.execute(request); expect(original.state).toBe('outcome_unknown');
    await expect(provider.revokePythonEnvironment(f.scope, binding.id, true)).rejects.toThrow('unresolved execution owner');
    expect(provider.status().environmentBindings).toEqual([]); expect(provider.status().activeOperations).toHaveLength(1);
    expect(() => provider.bindPythonEnvironment(f.scope, f.environmentId, true)).toThrow('settle');
    expect(globalCloses).toBe(0); expect(executions).toBe(1);
    reaped = true;
    await provider.revokePythonEnvironment(f.scope, binding.id, true);
    expect(provider.status().activeOperations).toEqual([]);
    expect(provider.bindPythonEnvironment(f.scope, f.environmentId, true).id).not.toBe(binding.id);
    expect(await provider.execute(request)).toEqual(original); expect(executions).toBe(1);
  } finally { reaped = true; await provider.close(); f.cleanup(); }
}, 15000);

test.skipIf(process.platform !== 'darwin')('environment revocation fences an awaited selected-resource read and drains before another binding', async () => {
  const f = fixture(); let release!: () => void, entered!: () => void, executions = 0, active = true;
  const waiting = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const provider = createSkillScriptToolsProvider({ privateOwnerHome: f.home, isScopeActive: () => active, resources: () => f.resources,
    resolvePythonEnvironment: id => f.store.admit(id), readResource: async (_s, _v, _p, path) => { entered(); await gate; return f.resources.find(row => row.relativePath === path)!; },
    executor: { capabilities: () => ({ supported: true, runtimes: { python: { supported: true } } }), async execute() { executions++; throw new Error('Revoked read must never dispatch'); }, cancel() {} } });
  try {
    const workspace = provider.grant(f.scope, { root: f.workspace, access: 'read-only' }, true), binding = provider.bindPythonEnvironment(f.scope, f.environmentId, true), row = f.resources[0]!;
    const pending = provider.execute({ scope: f.scope, tool: 'skill-script/run', idempotencyKey: 'revoked-read', arguments: { versionId: row.versionId, packageDigest: row.packageDigest,
      relativePath: row.relativePath, resourceDigest: row.digest, workspaceGrantId: workspace.id, argv: [], pythonEnvironmentId: f.environmentId } });
    await waiting;
    const revoked = provider.revokePythonEnvironment(f.scope, binding.id, true);
    expect(provider.status().environmentBindings).toEqual([]);
    expect(() => provider.bindPythonEnvironment(f.scope, f.environmentId, true)).toThrow('settle');
    active = false; release();
    expect((await pending).state).toBe('failed'); await revoked;
    expect(executions).toBe(0);
    active = true;
    expect(provider.bindPythonEnvironment({ ...f.scope, generation: 2 }, f.environmentId, true).generation).toBe(2);
    expect(provider.status(f.scope).environmentBindings).toEqual([]);
  } finally { release(); await provider.close(); f.cleanup(); }
}, 15000);
