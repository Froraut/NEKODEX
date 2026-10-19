import { expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zipSync, type Zippable } from 'fflate';
import { PythonBuildController, attachPythonBuildEnvironment, type PythonBuildSelection } from '../src/execution-environments/python-build';
import { inspectPythonBuildWheel } from '../src/execution-environments/python-build-wheel';
import { sha256 } from '../src/execution-environments/protocol';
import type { AdmittedVmRuntime, VmExecutionInput, VmExecutionResult } from '../src/execution-environments/executor';
import type { VmExecutorPort } from '../src/execution-environments/types';

function wheel(options: { badRecord?: boolean; wrongMachine?: boolean; tag?: string } = {}) {
  const filename = `fixture-1.0-${options.tag ?? 'cp314-cp314-linux_aarch64'}.whl`, base = 'fixture-1.0.dist-info';
  const elf = new Uint8Array(64); elf.set([127, 69, 76, 70, 2, 1]); elf[16] = 3; elf[18] = options.wrongMachine ? 62 : 183;
  const files: Record<string, Uint8Array> = { 'fixture.cpython-314-aarch64-linux-musl.so': elf,
    [base + '/METADATA']: Buffer.from('Metadata-Version: 2.1\nName: fixture\nVersion: 1.0\nRequires-Python: >=3.14\n'),
    [base + '/WHEEL']: Buffer.from('Wheel-Version: 1.0\nRoot-Is-Purelib: false\nTag: cp314-cp314-linux_aarch64\n') };
  files[base + '/RECORD'] = Buffer.from(Object.entries(files).map(([p, b]) => `${p},sha256=${options.badRecord ? 'bad' : createHash('sha256').update(b).digest('base64url')},${b.length}\n`).join('') + base + '/RECORD,,\n');
  const z: Zippable = {}; for (const [p, b] of Object.entries(files)) z[p] = [b, { os: 3, attrs: 0o100600 << 16 }];
  const bytes = zipSync(z); return { filename, bytes, sha256: sha256(bytes) };
}
function fixture(options: { ownerHeld?: boolean; invalidWheel?: boolean } = {}) {
  // Injected trusted port is a fixture only. Production executor checks its own
  // WeakMap runtime brand before returning these protected manifest paths.
  const runtime: AdmittedVmRuntime = Object.freeze({ kind: 'development-linux-vm', runtimeDigest: 'a'.repeat(64) });
  const manifest = fileURLToPath(new URL('../launcher/native/execution-guest/.build/bundle/manifest.json', import.meta.url));
  let calls = 0, retained: VmExecutionResult | undefined; const candidates = new Map<string, Uint8Array>();
  const executor: VmExecutorPort = {
    protectedPaths: () => ['', '', '', '', manifest], cancel() {}, reconcile: () => retained, readResult: () => retained,
    readCandidate: (_action, path) => candidates.get(path)!,
    async execute(input: VmExecutionInput) {
      calls++; expect(input.script).toBe('/usr/bin/python3 -I -S python-build/build.py');
      const plan = JSON.parse(Buffer.from(input.files.find(f => f.path === 'python-build/plan.json')!.bytes).toString());
      expect(plan.backend).toBe('backend'); expect(plan.network).toBe(false); expect(plan.hostShares).toBe(false);
      expect(Buffer.from(input.files.find(f => f.path === 'python-build/source/backend.py')!.bytes).toString()).toBe('# selected backend\n');
      const built = wheel({ badRecord: options.invalidWheel }); candidates.set('python-build/output.whl', built.bytes);
      candidates.set('python-build/output.json', Buffer.from(JSON.stringify({ version: 1, planDigest: plan.planDigest, filename: built.filename, sha256: built.sha256, python: '3.14.8', platform: 'linux_aarch64', extensionSuffix: '.cpython-314-aarch64-linux-musl.so' })));
      retained = { actionId: input.actionId, state: options.ownerHeld ? 'unknown' : 'stopped', ownerHeld: !!options.ownerHeld, reason: 'fixture', guestExitCode: options.ownerHeld ? null : 0, guestSignal: null, stdout: '', stderr: '', logsTruncated: false, resultDigest: 'b'.repeat(64), candidates: [...candidates].map(([path, bytes]) => ({ path, sha256: sha256(bytes), size: bytes.length, mode: 0o600 })) }; return retained;
    },
  };
  const data = (path: string, text: string) => { const bytes = Buffer.from(text); return { path, bytes, sha256: sha256(bytes) }; };
  const selection: PythonBuildSelection = { name: 'fixture', version: '1.0', backend: 'backend', backendPath: ['.'], buildRequires: [], buildWheels: [], source: { kind: 'tree', files: [data('pyproject.toml', '[build-system]\nrequires=[]\nbuild-backend="backend"\nbackend-path=["."]\n'), data('backend.py', '# selected backend\n')] } };
  return { controller: new PythonBuildController({ getRuntime: () => runtime, executor }), selection, executor, runtime, get calls() { return calls; } };
}
const acceptedImageAvailable = existsSync(fileURLToPath(new URL('../launcher/native/execution-guest/.build/bundle/manifest.json', import.meta.url)));
const scope = () => ({ taskId: randomUUID(), generation: 1, toolCallId: 'build-call' });

test.skipIf(!acceptedImageAvailable)('offline exact reviewed build snapshots sources and attaches only validated Linux runtime output', async () => {
  const f = fixture(), action = randomUUID(), current = scope(), review = f.controller.review(action, f.selection, true);
  if (f.selection.source.kind === 'tree') f.selection.source.files[1]!.bytes.fill(120);
  expect(f.calls).toBe(0); const result = await f.controller.prepare(action, review.reviewDigest, current, true);
  expect(result.state).toBe('ready'); expect(result.ownerHeld).toBe(false); expect(result.environment!.kind).toBe('linux-vm-python-environment');
  const files = attachPythonBuildEnvironment(result.environment!, f.runtime, f.executor, true); expect(files.some(f => f.path.endsWith('.so'))).toBe(true);
  files[0]!.bytes.fill(0); expect(attachPythonBuildEnvironment(result.environment!, f.runtime, f.executor, true)[0]!.bytes.some(b => b !== 0)).toBe(true);
  expect(() => attachPythonBuildEnvironment({ ...result.environment! }, f.runtime, f.executor, true)).toThrow();
  expect(() => attachPythonBuildEnvironment(result.environment!, { ...f.runtime }, f.executor, true)).toThrow();
  await f.controller.prepare(action, review.reviewDigest, current, true); expect(f.calls).toBe(1);
  await expect(f.controller.prepare(action, review.reviewDigest, scope(), true)).rejects.toThrow('scope');
});

test.skipIf(!acceptedImageAvailable)('invalid native ABI or RECORD cannot acquire runtime authority', async () => {
  const f = fixture({ invalidWheel: true }), action = randomUUID(), current = scope(), review = f.controller.review(action, f.selection, true);
  const result = await f.controller.prepare(action, review.reviewDigest, current, true); expect(result.state).toBe('failed'); expect(result.ownerHeld).toBe(false); expect(result.environment).toBeUndefined();
  await f.controller.prepare(action, review.reviewDigest, current, true); expect(f.calls).toBe(1);
});

test.skipIf(!acceptedImageAvailable)('uncertain owner stays held and passive reconciliation never replays a build', async () => {
  const f = fixture({ ownerHeld: true }), action = randomUUID(), current = scope(), review = f.controller.review(action, f.selection, true);
  expect((await f.controller.prepare(action, review.reviewDigest, current, true)).state).toBe('unknown');
  expect((await f.controller.reconcile(action, true)).ownerHeld).toBe(true);
  await f.controller.prepare(action, review.reviewDigest, current, true); expect(f.calls).toBe(1);
});

test('untrusted Linux output wheel must satisfy metadata, RECORD and architecture before attachment', () => {
  const good = wheel(); expect(inspectPythonBuildWheel(good.bytes, good.filename).native).toBe(true);
  expect(() => inspectPythonBuildWheel(wheel({ badRecord: true }).bytes, good.filename)).toThrow('record');
  expect(() => inspectPythonBuildWheel(wheel({ wrongMachine: true }).bytes, good.filename)).toThrow('abi');
  expect(() => inspectPythonBuildWheel(good.bytes, 'fixture-1.0-cp314-cp314-macosx_14_0_arm64.whl')).toThrow('unsupported');
});
