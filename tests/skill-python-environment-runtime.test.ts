import { expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { admitApplePythonRuntime } from '../src/agent-tools/skill-python-runtime';
import { SkillPythonEnvironmentStore, type AdmittedPythonEnvironment } from '../src/agent-tools/skill-python-environment';
import { SkillScriptExecutor } from '../src/agent-tools/skill-script-executor';
import { reviewTrustedSandboxConfig } from '../src/agent-tools/sandbox';
const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
let runtime: ReturnType<typeof admitApplePythonRuntime>;
function fixture() {
  runtime ??= admitApplePythonRuntime();
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'neko-env-kernel-'))), home = join(root, 'private'), workspace = join(root, 'workspace'), executorHome = join(root, 'executor');
  for (const path of [home, workspace, executorHome]) mkdirSync(path, { mode: 0o700 });
  const dist = 'selected_math-1.0.dist-info', files: Record<string, Uint8Array> = { 'selected_math.py': Buffer.from('def subtotal(quantity, unit):\n return quantity * unit\n'),
    [dist + '/METADATA']: Buffer.from('Metadata-Version: 2.1\nName: selected-math\nVersion: 1.0\nRequires-Python: >=3.9\n'),
    [dist + '/WHEEL']: Buffer.from('Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n') };
  files[dist + '/RECORD'] = Buffer.from(Object.entries(files).map(([path, bytes]) => `${path},sha256=${createHash('sha256').update(bytes).digest('base64url')},${bytes.length}\n`).join('') + dist + '/RECORD,,\n');
  const wheel = join(root, 'selected_math-1.0-py3-none-any.whl'); writeFileSync(wheel, zipSync(files, { level: 0 }), { mode: 0o600 });
  const store = new SkillPythonEnvironmentStore({ home, runtime }), id = randomUUID(), reviewed = store.review(id, { wheelPaths: [wheel] }, true), prepared = store.prepare(id, reviewed.reviewDigest, true);
  const environment = store.admit(prepared.environment!.environmentId), bunPath = realpathSync(process.execPath);
  const executor = new SkillScriptExecutor({ home: executorHome, bunPath, bunSha256: sha(readFileSync(bunPath)), pythonRuntime: runtime });
  const grants = reviewTrustedSandboxConfig({ codeRoots: [], readRoots: [workspace], writeRoots: [workspace] });
  const execute = (operationId: string, text: string, extra: Record<string, unknown> = {}) => executor.execute({ operationId, runtime: 'python', pythonEnvironment: environment,
    scope: { taskId: 'environment-kernel', generation: 1, toolCallId: operationId }, entryRelativePath: 'scripts/run.py', resources: [{ relativePath: 'scripts/run.py', bytes: Buffer.from(text) }],
    readRoots: grants.readRoots, writeRoots: grants.writeRoots, cwd: workspace, ...extra });
  const cleanup = async () => { await executor.close(); const unseal = (path: string) => { if (lstatSync(path).isDirectory()) { chmodSync(path, 0o700); for (const name of readdirSync(path)) unseal(join(path, name)); } }; unseal(root); rmSync(root, { recursive: true, force: true }); };
  return { root, workspace, environment, executor, execute, cleanup };
}

test.skipIf(process.platform !== 'darwin')('prepared pure wheel imports after sealing while environment writes, outside writes, fork and direct network remain denied', async () => {
  const f = fixture(), outside = join(f.root, 'outside.txt'); writeFileSync(outside, 'preserved');
  const source = `import selected_math, decimal, os, ctypes, socket, json, sys\nfacts={"total":str(selected_math.subtotal(3,decimal.Decimal("8.25"))),"noSite":sys.flags.no_site}\nfor key,path in [("dependencyWrite",selected_math.__file__),("outsideWrite",${JSON.stringify(outside)})]:\n try:\n  with open(path,"w") as out:out.write("changed")\n  facts[key]=False\n except OSError:facts[key]=True\nlib=ctypes.CDLL("/usr/lib/libSystem.B.dylib",use_errno=True);lib.fork.restype=ctypes.c_int\npid=lib.fork()\nif pid==0:os._exit(0)\nif pid>0:os.waitpid(pid,0)\nfacts["forkDenied"]=pid==-1\ns=None\ntry:\n s=socket.socket();s.connect(("127.0.0.1",9));facts["networkDenied"]=False\nexcept OSError as error:facts["networkDenied"]=error.errno in (1,13)\nfinally:\n if s is not None:s.close()\nprint(json.dumps(facts))\n`;
  try {
    const result = await f.execute('import-boundary', source);
    if (result.state !== 'completed') throw new Error(JSON.stringify(result));
    expect(JSON.parse(result.stdout)).toEqual({ total: '24.75', noSite: 1, dependencyWrite: true, outsideWrite: true, forkDenied: true, networkDenied: true });
    expect(result.owner).toMatchObject({ sealed: true, reaped: true });
    expect(result.pythonEnvironment).toEqual({ environmentId: f.environment.environmentId, runtimeClosureDigest: runtime.closureDigest, closureDigest: f.environment.closureDigest });
    expect(result.boundary).toMatchObject({ processFork: 'deny', processExec: 'deny', network: 'deny-network-operations', pythonEnvironment: { environmentId: f.environment.environmentId } });
    expect(JSON.stringify(result.boundary)).not.toContain(f.environment.readRoot);
    expect(JSON.stringify(result.boundary)).not.toContain(join(f.root, 'private'));
    expect(readFileSync(outside, 'utf8')).toBe('preserved');
    expect(readFileSync(join(f.environment.readRoot, 'selected_math.py'), 'utf8')).toContain('def subtotal');
    const replay = f.executor.reconcile('import-boundary'); expect(replay?.pythonEnvironment).toEqual(result.pythonEnvironment);
    const forged = await f.execute('forged', 'raise RuntimeError("must not execute")', { pythonEnvironment: { ...f.environment } as AdmittedPythonEnvironment });
    expect(forged.state).toBe('failed'); expect(forged.owner).toBeUndefined();
    const overlap = reviewTrustedSandboxConfig({ codeRoots: [], readRoots: [f.environment.readRoot], writeRoots: [f.environment.readRoot] });
    const denied = await f.execute('overlap', 'raise RuntimeError("must not execute")', { readRoots: overlap.readRoots, writeRoots: overlap.writeRoots, cwd: f.environment.readRoot });
    expect(denied.state).toBe('failed'); expect(denied.owner).toBeUndefined();
  } finally { await f.cleanup(); }
}, 20000);

test.skipIf(process.platform !== 'darwin')('environment-backed cancellation proves child reap and later dependency drift blocks another launch', async () => {
  const f = fixture(), ready = join(f.workspace, 'ready.txt');
  try {
    const seen = new Promise<void>((resolve, reject) => { const watcher = watch(f.workspace, () => { if (existsSync(ready)) { clearTimeout(timer); watcher.close(); resolve(); } });
      const timer = setTimeout(() => { watcher.close(); reject(new Error('Owned dependency import did not reach its readiness artifact')); }, 4000); });
    const controller = new AbortController();
    const pending = f.execute('cancel-environment', `import selected_math\nwith open(${JSON.stringify(ready)},"w") as out:out.write(str(selected_math.subtotal(2,4)))\nwhile True:pass\n`, { signal: controller.signal });
    try { await seen; } finally { controller.abort(); }
    const result = await pending;
    expect(result.state).toBe('failed'); expect(result.owner).toMatchObject({ reaped: true, sealed: true });
    expect(readFileSync(ready, 'utf8')).toBe('8');
    const module = join(f.environment.readRoot, 'selected_math.py'); chmodSync(module, 0o600); writeFileSync(module, 'raise RuntimeError("changed")\n');
    const changed = await f.execute('changed-environment', 'import selected_math');
    expect(changed.state).toBe('failed'); expect(changed.owner).toBeUndefined();
  } finally { await f.cleanup(); }
}, 20000);
