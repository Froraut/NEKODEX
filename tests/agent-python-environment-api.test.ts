import { expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { AgentToolsComposition } from '../src/agent-tools/composition';
import { admitApplePythonRuntime } from '../src/agent-tools/skill-python-runtime';

test.skipIf(process.platform !== 'darwin')('environment admin flow preserves review/prepare/bind authority, bounded metadata and privacy revoke during drain', async () => {
  const runtime = admitApplePythonRuntime(); // Establish the real admission before any negative assertion.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'python-env-api-'))), scope = { taskId: 'environment-api-task', generation: 1, toolCallId: 'ui' };
  let accepting = true, executions = 0;
  const composition = new AgentToolsComposition({ home: root, pythonRuntime: runtime, authorize: request => request.headers.get('authorization') === 'Bearer fixture-only',
    canStart: () => accepting, isScopeActive: value => value.taskId === scope.taskId && value.generation === scope.generation,
    scriptExecutor: { capabilities: () => ({ supported: true, runtimes: { javascript: { supported: true }, python: { supported: true } } }),
      execute: async () => { executions++; throw new Error('Admin preparation must never execute selected code'); }, cancel() {}, close() {} },
  });
  async function call(body: unknown, authorized = true) {
    const response = await composition.handle(new Request('http://127.0.0.1/admin/agent-tools', { method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { authorization: 'Bearer fixture-only' } : {}) }, body: JSON.stringify(body) }));
    if (!response) throw new Error('Expected exact admin route');
    return { status: response.status, packet: await response.json() as any };
  }
  try {
    const envHome = join(root, 'skill-python-environments');
    expect((await call({ action: 'pythonEnvironmentStatus' }, false)).status).toBe(401);
    expect((await call({ action: 'pythonEnvironmentStatus' })).packet.value.environments).toEqual([]);
    expect(existsSync(envHome)).toBe(false);
    const dist = 'facade_dependency-1.0.dist-info', files: Record<string, Uint8Array> = {
      'facade_dependency.py': Buffer.from('VALUE = 42\n'),
      [dist + '/METADATA']: Buffer.from('Metadata-Version: 2.1\nName: facade-dependency\nVersion: 1.0\nRequires-Python: >=3.9\n\n'),
      [dist + '/WHEEL']: Buffer.from('Wheel-Version: 1.0\nGenerator: inert-fixture\nRoot-Is-Purelib: true\nTag: py3-none-any\n\n'),
    };
    files[dist + '/RECORD'] = Buffer.from(Object.entries(files).map(([path, bytes]) => `${path},sha256=${createHash('sha256').update(bytes).digest('base64url')},${bytes.length}`).join('\n') + `\n${dist}/RECORD,,\n`);
    const wheel = join(root, 'facade_dependency-1.0-py3-none-any.whl'); writeFileSync(wheel, zipSync(files), { mode: 0o600 });
    const actionId = randomUUID();
    expect((await call({ action: 'reviewPythonEnvironment', actionId, wheelPaths: [wheel], explicitUserAction: false })).status).toBe(400);
    const review = await call({ action: 'reviewPythonEnvironment', actionId, wheelPaths: [wheel], explicitUserAction: true });
    expect(review.packet.value.state).toBe('reviewed');
    expect(review.packet.value.environment.packages[0].name).toBe('facade-dependency');
    const reviewDigest = review.packet.value.reviewDigest, environmentId = review.packet.value.environment.environmentId;
    expect((await call({ action: 'preparePythonEnvironment', actionId, reviewDigest: '0'.repeat(64), explicitUserAction: true })).status).toBe(409);
    expect((await call({ action: 'pythonEnvironmentAction', actionId })).packet.value.state).toBe('reviewed');
    const prepared = await call({ action: 'preparePythonEnvironment', actionId, reviewDigest, explicitUserAction: true });
    expect(prepared.packet.value).toMatchObject({ actionId, state: 'ready', terminal: true, ownerHeld: false });
    const inode = lstatSync(join(envHome, 'environments', environmentId)).ino;
    expect((await call({ action: 'preparePythonEnvironment', actionId, reviewDigest, explicitUserAction: true })).packet.value.state).toBe('ready');
    expect(lstatSync(join(envHome, 'environments', environmentId)).ino).toBe(inode);
    const metadata = (await call({ action: 'pythonEnvironmentStatus' })).packet.value;
    expect(metadata.environments).toHaveLength(1); expect(metadata.actions).toHaveLength(1);
    expect(JSON.stringify(metadata)).not.toContain(root);
    expect((await call({ action: 'bindPythonEnvironment', scope: { ...scope, generation: 2 }, environmentId, explicitUserAction: true })).status).toBe(409);
    const bound = (await call({ action: 'bindPythonEnvironment', scope, environmentId, explicitUserAction: true })).packet.value;
    expect(bound).toMatchObject({ taskId: scope.taskId, generation: 1, environmentId });
    accepting = false;
    expect((await call({ action: 'reviewPythonEnvironment', actionId: randomUUID(), wheelPaths: [wheel], explicitUserAction: true })).status).toBe(409);
    expect((await call({ action: 'pythonEnvironmentStatus' })).packet.value.environments).toHaveLength(1);
    expect((await call({ action: 'revokePythonEnvironment', scope, bindingId: bound.id, explicitUserAction: true })).packet.value).toEqual({ revoked: true });
    expect(composition.scriptStatus(scope).environmentBindings).toEqual([]);
    accepting = true;
    const missing = await call({ action: 'reviewPythonEnvironment', actionId: randomUUID(), wheelPaths: [join(root, 'missing.whl')], explicitUserAction: true });
    expect(missing.status).toBe(409); expect(JSON.stringify(missing.packet)).not.toContain(root);
    expect((await call({ action: 'pythonEnvironmentStatus', excess: 'x'.repeat(128 * 1024) })).status).toBeGreaterThanOrEqual(400);
    expect(executions).toBe(0);
  } finally {
    await composition.close();
    const writable = (path: string) => { const stat = lstatSync(path); if (stat.isSymbolicLink()) throw new Error('Unexpected fixture link'); if (stat.isDirectory()) { chmodSync(path, 0o700); for (const name of readdirSync(path)) writable(join(path, name)); } };
    writable(root); rmSync(root, { recursive: true, force: true });
  }
}, 30000);
