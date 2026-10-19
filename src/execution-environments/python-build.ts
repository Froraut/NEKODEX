import { isKnownPythonBuildCredentialName } from '../../launcher/electron/python-build-source-policy.cjs';
import { readFileSync } from 'node:fs';
import type { AdmittedVmRuntime, VmExecutionInput, VmExecutionResult } from './executor';
import type { VmExecutorPort } from './types';
import { isActionId, isSha256, safeVmPath, sha256, uniqueVmPaths, vmAssert, type VmFile } from './protocol';
import { inspectPythonBuildWheel, type PythonBuildWheel } from './python-build-wheel';
import { PYTHON_BUILD_GUEST } from './python-build-guest';
import { pythonVersionSatisfies, validatePythonArtifactUrl, validatePythonDependencyGraph, type PythonDirectArtifactPin } from '../agent-tools/skill-python-requirements';

const ACCEPTED_GUEST_MANIFEST = '3234621868c7ba5eeb31d1a29e95c204fa4140f54c5b2c209588ba4c534789e0';
const MARKERS = Object.freeze({ os_name: 'posix', sys_platform: 'linux', platform_machine: 'aarch64', platform_system: 'Linux', platform_python_implementation: 'CPython', python_version: '3.14', python_full_version: '3.14.8', implementation_name: 'cpython', implementation_version: '3.14.8' });
export interface PythonBuildArtifact { filename: string; bytes: Uint8Array; sha256: string }
export interface PythonBuildSelection {
  source: { kind: 'tree'; files: { path: string; bytes: Uint8Array; sha256: string }[] } | { kind: 'zip' | 'tar.gz'; artifact: PythonBuildArtifact };
  name: string; version: string; backend: string; backendPath?: string[];
  buildRequires: string[]; additionalBuildRequires?: string[]; buildWheels: PythonBuildArtifact[];
  runtimeWheels?: PythonBuildArtifact[]; directArtifacts?: PythonDirectArtifactPin[];
  configSettings?: Record<string, string | string[]>; timeoutMs?: number;
}
export interface PythonBuildReview {
  actionId: string; reviewDigest: string; runtimeDigest: string; name: string; version: string; sourceKind: 'tree' | 'zip' | 'tar.gz'; directArtifacts: PythonDirectArtifactPin[]; target: 'cp314-cp314-linux_aarch64';
  source: { path: string; sha256: string; bytes: number }[];
  buildWheels: { filename: string; name: string; version: string; artifactSha256: string }[];
  runtimeWheels: { filename: string; name: string; version: string; artifactSha256: string }[];
  backend: string; backendPath: string[]; buildRequires: string[]; additionalBuildRequires: string[];
  configSettings: Record<string, string | string[]>; timeoutMs: number; network: false; hostShares: false;
}
export interface LinuxVmPythonEnvironment {
  readonly kind: 'linux-vm-python-environment'; readonly runtimeDigest: string; readonly closureDigest: string;
  readonly packages: readonly { name: string; version: string; artifactSha256: string }[];
}
export interface PythonBuildAction {
  review: PythonBuildReview; state: 'reviewed' | 'preparing' | 'ready' | 'failed' | 'unknown'; ownerHeld: boolean;
  reason?: string; resultDigest?: string; environment?: LinuxVmPythonEnvironment;
}
interface PrivatePlan { runtime: AdmittedVmRuntime; files: VmFile[]; review: PythonBuildReview; runtimeWheels: PythonBuildWheel[]; name: string; version: string; directArtifacts: PythonDirectArtifactPin[]; action: PythonBuildAction; scope?: VmExecutionInput['scope'] }
const environments = new WeakMap<LinuxVmPythonEnvironment, { runtime: AdmittedVmRuntime; files: VmFile[] }>();
function runtimeCheck(runtime: AdmittedVmRuntime, executor: VmExecutorPort) {
  vmAssert((runtime.kind === 'development-linux-vm' || runtime.kind === 'production-linux-vm') && isSha256(runtime.runtimeDigest), 'python-build-runtime-required');
  const paths = executor.protectedPaths(runtime); // validates the actual nonserializable executor brand and pins
  const manifest = paths[4]; vmAssert(manifest && sha256(readFileSync(manifest)) === ACCEPTED_GUEST_MANIFEST, 'python-build-toolchain-not-reviewed');
}
/** Passive readiness uses the same brand, file pins and toolchain as Review. */
export function isPythonBuildRuntimeSupported(runtime: AdmittedVmRuntime | undefined, executor: VmExecutorPort): boolean {
  if (!runtime) return false;
  try { runtimeCheck(runtime, executor); return true; } catch { return false; }
}
function artifact(a: PythonBuildArtifact) { vmAssert(a.bytes instanceof Uint8Array && a.bytes.length > 0 && a.bytes.length <= 16 * 1024 * 1024 && sha256(a.bytes) === a.sha256, 'python-build-artifact-pin'); return Uint8Array.from(a.bytes); }
function packageRow(w: PythonBuildWheel) { return { filename: w.filename, name: w.name, version: w.version, artifactSha256: w.artifactSha256 }; }
function wheel(a: PythonBuildArtifact, buildDependency = false, budget?: {bytes: number; files: number}) { const w = inspectPythonBuildWheel(artifact(a), a.filename, { buildDependency, budget }); vmAssert(!w.requiresPython || pythonVersionSatisfies('3.14.8', w.requiresPython), 'python-build-python-version-mismatch'); return w; }
function combinedFiles(wheels: PythonBuildWheel[]): VmFile[] {
  const files: VmFile[] = []; const names = new Set<string>();
  for (const w of wheels) for (const [path, bytes] of w.files) { const key = path.toLowerCase(); vmAssert(!names.has(key), 'python-build-wheel-file-collision'); names.add(key); files.push({ path: 'python-environment/' + path, bytes: Uint8Array.from(bytes), mode: 0o600 }); }
  uniqueVmPaths(files.map(f => f.path), 4096); vmAssert(files.reduce((n, f) => n + f.bytes.length, 0) <= 48 * 1024 * 1024, 'python-build-environment-limit'); return files;
}
/** Main-owned Review -> explicit Prepare -> explicit Attach coordinator. Build
 * execution uses the existing durable VM owner; no host interpreter is invoked. */
export class PythonBuildController {
  private readonly plans = new Map<string, PrivatePlan>();
  constructor(private readonly options: { getRuntime(): AdmittedVmRuntime | undefined; executor: VmExecutorPort }) {}
  actions(): PythonBuildAction[] { return [...this.plans.keys()].map(id => this.inspect(id)!); }
  inspect(actionId: string): PythonBuildAction | undefined { const row = this.plans.get(actionId); return row ? { ...row.action, review: structuredClone(row.review) } : undefined; }
  review(actionId: string, input: PythonBuildSelection, explicit: boolean): PythonBuildReview {
    vmAssert(explicit && isActionId(actionId) && !this.plans.has(actionId) && this.plans.size < 32, 'python-build-explicit-new-review-required');
    const runtime = this.options.getRuntime(); vmAssert(runtime, 'python-build-runtime-required'); runtimeCheck(runtime, this.options.executor);
    vmAssert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.name) && /^[A-Za-z0-9_.+!]+$/.test(input.version) && /^[A-Za-z_][A-Za-z0-9_.]*(?::[A-Za-z_][A-Za-z0-9_.]*)?$/.test(input.backend), 'python-build-identity-invalid');
    vmAssert(input.buildWheels.length <= 16 && (input.runtimeWheels?.length ?? 0) <= 16 && input.buildRequires.length <= 128 && (input.additionalBuildRequires?.length ?? 0) <= 128, 'python-build-selection-limit');
    const backendPath = (input.backendPath ?? []).map(p => p === '.' ? p : safeVmPath(p)), configSettings = structuredClone(input.configSettings ?? {});
    vmAssert(backendPath.length <= 16 && Object.keys(configSettings).length <= 32 && Object.entries(configSettings).every(([k, v]) => k.length <= 128 && (typeof v === 'string' ? v.length <= 4096 : Array.isArray(v) && v.length <= 32 && v.every(s => typeof s === 'string' && s.length <= 4096))), 'python-build-config-invalid');
    vmAssert([...input.buildWheels, ...input.runtimeWheels ?? []].reduce((n, w) => n + w.bytes.length, 0) <= 32 * 1024 * 1024, 'python-build-artifact-aggregate-limit');
    const buildBudget = {bytes: 0, files: 0}, runtimeBudget = {bytes: 0, files: 0};
    const buildWheels = input.buildWheels.map(w => wheel(w, true, buildBudget)), runtimeWheels = (input.runtimeWheels ?? []).map(w => wheel(w, false, runtimeBudget)), directArtifacts = structuredClone(input.directArtifacts ?? []);
    for (const pin of directArtifacts) validatePythonArtifactUrl(pin.url);
    vmAssert(directArtifacts.length <= 256 && new Set(directArtifacts.map(p => p.url)).size === directArtifacts.length && directArtifacts.every(p => [...buildWheels, ...runtimeWheels].some(w => w.artifactSha256 === p.artifactSha256)), 'python-build-direct-pin-invalid');
    const requirements = [...input.buildRequires, ...input.additionalBuildRequires ?? []];
    if (buildWheels.length) validatePythonDependencyGraph(buildWheels, MARKERS, { requirements, directArtifacts: directArtifacts.filter(p => buildWheels.some(w => w.artifactSha256 === p.artifactSha256)) }); else vmAssert(requirements.length === 0 && backendPath.length > 0, 'python-build-backend-closure-missing');
    combinedFiles(buildWheels); combinedFiles(runtimeWheels);
    const files: VmFile[] = [], source: PythonBuildReview['source'] = [];
    if (input.source.kind === 'tree') {
      vmAssert(input.source.files.length > 0 && input.source.files.length <= 2048, 'python-build-source-limit'); uniqueVmPaths(input.source.files.map(f => f.path), 2048);
      vmAssert(input.source.files.some(f => f.path === 'pyproject.toml'), 'python-build-pyproject-required');
      for (const f of input.source.files) { vmAssert(!f.path.split('/').some(isKnownPythonBuildCredentialName), 'python-build-source-credential-path'); vmAssert(f.bytes instanceof Uint8Array && f.bytes.length <= 16 * 1024 * 1024 && sha256(f.bytes) === f.sha256, 'python-build-artifact-pin'); const bytes = Uint8Array.from(f.bytes); files.push({ path: 'python-build/source/' + f.path, bytes, mode: 0o600 }); source.push({ path: f.path, sha256: f.sha256, bytes: bytes.length }); }
    } else { const bytes = artifact(input.source.artifact); vmAssert(input.source.kind === 'zip' || input.source.kind === 'tar.gz', 'python-build-source-format'); files.push({ path: 'python-build/source.archive', bytes, mode: 0o600 }); source.push({ path: safeVmPath(input.source.artifact.filename), sha256: sha256(bytes), bytes: bytes.length }); }
    input.buildWheels.forEach((w, i) => files.push({ path: `python-build/wheel-${i}.whl`, bytes: artifact(w), mode: 0o600 }));
    vmAssert(files.reduce((n, f) => n + f.bytes.length, 0) <= 48 * 1024 * 1024, 'python-build-input-limit');
    const timeoutMs = input.timeoutMs ?? 120000; vmAssert(Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 600000, 'python-build-timeout-invalid');
    const proposal = { actionId, name: input.name, version: input.version, sourceKind: input.source.kind, directArtifacts, runtimeDigest: runtime.runtimeDigest, target: 'cp314-cp314-linux_aarch64' as const, source, buildWheels: buildWheels.map(packageRow), runtimeWheels: runtimeWheels.map(packageRow), backend: input.backend, backendPath, buildRequires: [...input.buildRequires], additionalBuildRequires: [...input.additionalBuildRequires ?? []], configSettings, timeoutMs, network: false as const, hostShares: false as const };
    const reviewDigest = sha256(JSON.stringify({ policy: 1, guestScriptSha256: sha256(PYTHON_BUILD_GUEST), ...proposal, name: input.name, version: input.version, sourceKind: input.source.kind, directArtifacts }));
    const review = { ...proposal, reviewDigest };
    files.push({ path: 'python-build/plan.json', mode: 0o600, bytes: Buffer.from(JSON.stringify({ ...review, sourceKind: input.source.kind, planDigest: reviewDigest })) }, { path: 'python-build/build.py', mode: 0o600, bytes: Buffer.from(PYTHON_BUILD_GUEST) });
    this.plans.set(actionId, { runtime, files, review, runtimeWheels, name: input.name, version: input.version, directArtifacts, action: { review, state: 'reviewed', ownerHeld: false } }); return structuredClone(review);
  }
  async prepare(actionId: string, reviewDigest: string, scope: VmExecutionInput['scope'], explicit: boolean, signal?: AbortSignal, assertCurrent?: () => void): Promise<PythonBuildAction> {
    const p = this.plans.get(actionId); vmAssert(explicit && p && p.review.reviewDigest === reviewDigest, 'python-build-exact-review-required');
    if (p.scope) vmAssert(p.scope.taskId === scope.taskId && p.scope.generation === scope.generation && p.scope.toolCallId === scope.toolCallId, 'python-build-action-scope-mismatch');
    if (p.action.state !== 'reviewed') return this.inspect(actionId)!;
    vmAssert(this.options.getRuntime() === p.runtime, 'python-build-reviewed-runtime-changed'); runtimeCheck(p.runtime, this.options.executor); assertCurrent?.(); p.scope = { ...scope }; p.action.state = 'preparing'; p.action.ownerHeld = true;
    let pending: Promise<VmExecutionResult>;
    try { pending = this.options.executor.execute({ actionId, scope: { ...scope }, runtime: p.runtime, files: p.files.map(f => ({ ...f, bytes: Uint8Array.from(f.bytes) })), script: '/usr/bin/python3 -I -S python-build/build.py', outputPaths: ['python-build/output.whl', 'python-build/output.json'], timeoutMs: p.review.timeoutMs, signal, assertCurrent }); }
    catch { p.action = { review: p.review, state: 'failed', ownerHeld: false, reason: 'python-build-not-admitted' }; return this.inspect(actionId)!; }
    try { await this.accept(p, await pending); } catch { p.action = { review: p.review, state: 'unknown', ownerHeld: true, reason: 'python-build-reconcile-required' }; }
    return this.inspect(actionId)!;
  }
  /** Passive same-action reconciliation. It never calls execute or starts a VM. */
  async reconcile(actionId: string, explicit: boolean): Promise<PythonBuildAction> {
    const p = this.plans.get(actionId); vmAssert(explicit && p && p.action.state !== 'reviewed', 'python-build-action-required');
    if (p.action.state === 'ready' || p.action.state === 'failed') return this.inspect(actionId)!;
    const result = await this.options.executor.reconcile(actionId);
    if (result) await this.accept(p, result.ownerHeld ? result : await this.options.executor.readResult?.(actionId) ?? result);
    return this.inspect(actionId)!;
  }
  private async accept(p: PrivatePlan, result: VmExecutionResult) {
    vmAssert(result.actionId === p.review.actionId, 'python-build-result-owner-mismatch');
    if (result.ownerHeld || result.state === 'unknown') { p.action = { review: p.review, state: 'unknown', ownerHeld: true, reason: 'python-build-reconcile-required' }; return; }
    p.action = { review: p.review, state: 'failed', ownerHeld: false, resultDigest: result.resultDigest, reason: 'python-build-output-validation-failed' };
    if (result.state !== 'stopped' || result.guestExitCode !== 0 || result.guestSignal !== null || result.logsTruncated || !isSha256(result.resultDigest) || result.candidates.length !== 2 || !this.options.executor.readCandidate) return;
    const read = async (path: string) => { const c = result.candidates.find(c => c.path === path); vmAssert(c && c.mode === 0o600 && c.size <= 16 * 1024 * 1024, 'python-build-output-missing'); const bytes = await this.options.executor.readCandidate!(result.actionId, path, c.sha256); vmAssert(bytes.length === c.size && sha256(bytes) === c.sha256, 'python-build-output-changed'); return bytes; };
    try {
      const infoBytes = await read('python-build/output.json'); vmAssert(infoBytes.length <= 16384, 'python-build-output-metadata-limit'); const info = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(infoBytes));
      vmAssert(info.version === 1 && info.planDigest === p.review.reviewDigest && info.python === '3.14.8' && info.platform === 'linux_aarch64' && info.extensionSuffix === '.cpython-314-aarch64-linux-musl.so', 'python-build-output-scope');
      const bytes = await read('python-build/output.whl'), built = inspectPythonBuildWheel(bytes, info.filename);
      vmAssert(built.artifactSha256 === info.sha256 && built.name === p.name && built.version === p.version && built.native && (!built.requiresPython || pythonVersionSatisfies('3.14.8', built.requiresPython)), 'python-build-output-identity');
      const wheels = [built, ...p.runtimeWheels]; validatePythonDependencyGraph(wheels, MARKERS, { directArtifacts: p.directArtifacts.filter(pin => wheels.some(w => w.artifactSha256 === pin.artifactSha256)) }); const files = combinedFiles(wheels);
      const packages = wheels.map(({ name, version, artifactSha256 }) => ({ name, version, artifactSha256 }));
      const environment: LinuxVmPythonEnvironment = Object.freeze({ kind: 'linux-vm-python-environment', runtimeDigest: p.runtime.runtimeDigest, closureDigest: sha256(JSON.stringify({ runtime: p.runtime.runtimeDigest, packages })), packages: Object.freeze(packages.map(p => Object.freeze(p))) });
      environments.set(environment, { runtime: p.runtime, files }); p.action = { review: p.review, state: 'ready', ownerHeld: false, resultDigest: result.resultDigest, environment };
    } catch { /* Physically stopped output remains a failed proposal; never executes or retries. */ }
  }
  cancel(actionId: string, explicit: boolean) { vmAssert(explicit && this.plans.has(actionId), 'python-build-explicit-cancel-required'); return this.options.executor.cancel(actionId); }
}
/** Explicit runtime-specific attachment. The returned snapshots can only enter
 * that Linux VM's next input; no Apple runtime/environment brand is issued. */
export function attachPythonBuildEnvironment(environment: LinuxVmPythonEnvironment, runtime: AdmittedVmRuntime, executor: VmExecutorPort, explicit: boolean): VmFile[] {
  const entry = environments.get(environment); vmAssert(explicit && entry && entry.runtime === runtime && environment.runtimeDigest === runtime.runtimeDigest, 'python-build-environment-runtime-mismatch'); runtimeCheck(runtime, executor);
  return entry.files.map(f => ({ ...f, bytes: Uint8Array.from(f.bytes) }));
}
