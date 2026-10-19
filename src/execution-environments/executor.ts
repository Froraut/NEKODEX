import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, openSync, closeSync, readSync, readFileSync, realpathSync, fstatSync } from 'node:fs';
import { join } from 'node:path';
import { productionVmRuntimePaths, resolveProductionVmOrigin, validateProductionVmRuntimeManifest, VM_APP_IDENTIFIER, VM_BUNDLE_FILES, VM_HELPER_IDENTIFIER, VM_PUBLISHER_TEAM_ID, type ProductionVmOriginPins, type ProductionVmRuntimePins } from './production-runtime';
import { base64, checkedScope, isActionId, isSha256, keys, record, sha256, validateVmInput, VM_LIMITS, VM_PROTOCOL, VmGuestCapture, VmJsonLines, vmAssert,
  type VmFile, type VmScope, type VmStopReason } from './protocol';
import { createPrivateFile, readPrivate, syncDirectory, VmJobStore, vmProcessIdentity, type VmJobRecord } from './storage';

export interface VmRuntimeSelection { helperPath: string; helperSha256: string; helperManifestPath: string; helperManifestSha256: string;
  kernelPath: string; kernelSha256: string; initrdPath: string; initrdSha256: string; guestManifestPath: string; guestManifestSha256: string; production?: ProductionVmRuntimePins }
export interface AdmittedVmRuntime { readonly kind: 'development-linux-vm' | 'production-linux-vm'; readonly runtimeDigest: string }
interface Pin { path: string; sha256: string; dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint; mode: bigint }
const runtimes = new WeakMap<AdmittedVmRuntime, { selection: VmRuntimeSelection; pins: Pin[] }>();
function artifact(path: string, expected: string, max: number): Pin {
  vmAssert(isSha256(expected) && realpathSync(path) === path, 'vm-artifact-path-invalid');
  const before = lstatSync(path, { bigint: true }); vmAssert(before.isFile() && before.nlink === 1n && !(before.mode & 0o022n)
    && before.size > 0n && before.size <= BigInt(max), 'vm-artifact-invalid');
  const fd = openSync(path, 'r');
  try {
    const opened = fstatSync(fd, { bigint: true }); vmAssert(opened.ino === before.ino && opened.dev === before.dev);
    const hash = createHash('sha256'); let total = 0;
    for (;;) { const b = Buffer.alloc(1024 * 1024); const n = readSync(fd, b); if (!n) break; total += n;
      vmAssert(total <= max); hash.update(b.subarray(0, n)); }
    vmAssert(hash.digest('hex') === expected, 'vm-artifact-hash-mismatch');
  } finally { closeSync(fd); }
  const after = lstatSync(path, { bigint: true });
  vmAssert(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode'].every(k => after[k as keyof typeof after] === before[k as keyof typeof before]), 'vm-artifact-changed');
  return { path, sha256: expected, dev: before.dev, ino: before.ino, size: before.size, mtimeNs: before.mtimeNs, ctimeNs: before.ctimeNs, mode: before.mode };
}
function productionOriginArtifactPins(origin: ProductionVmOriginPins): Pin[] {
  const files: [string, string, number][] = [
    [origin.runtimeEntryPath, origin.entrySha256, 64 * 1024 * 1024],
    [origin.bundledEntryPath, origin.entrySha256, 64 * 1024 * 1024],
    [origin.runtimeExecutablePath, origin.executableSha256, 256 * 1024 * 1024],
    [origin.bundledExecutablePath, origin.executableSha256, 256 * 1024 * 1024],
    [origin.runtimeManifestPath, origin.manifestSha256, 16 * 1024 * 1024],
    [origin.bundledManifestPath, origin.manifestSha256, 16 * 1024 * 1024],
  ];
  return [...new Map(files.map(file => [file[0], file])).values()].map(([path, hash, max]) => artifact(path, hash, max));
}
/** Verifies only the copied execution identity, without granting a runtime brand
 * or launching signature tools/helpers. Admission uses these same file pins. */
export function verifyProductionVmOriginFiles(origin: ProductionVmOriginPins): void {
  productionOriginArtifactPins(origin);
}
function assertRuntime(runtime: AdmittedVmRuntime): VmRuntimeSelection {
  const entry = runtimes.get(runtime); vmAssert(entry, 'vm-runtime-not-admitted');
  for (const pin of entry.pins) {
    const s = lstatSync(pin.path, { bigint: true });
    vmAssert(realpathSync(pin.path) === pin.path && s.isFile() && s.nlink === 1n
      && ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode'].every(k => s[k as keyof typeof s] === pin[k as keyof Pin]), 'vm-runtime-changed');
  }
  return entry.selection;
}
/** Trusted grant validation only. Do not serialize these private paths into a
 * model descriptor or renderer result. No helper/process is started. */
export function vmRuntimeProtectedPaths(runtime: AdmittedVmRuntime): readonly string[] {
  const selection = assertRuntime(runtime);
  return Object.freeze([selection.helperPath, selection.helperManifestPath, selection.kernelPath, selection.initrdPath, selection.guestManifestPath,
    ...(selection.production ? [selection.production.runtimeManifestPath, selection.production.appBundlePath,
      ...(selection.production.origin ? [selection.production.origin.runtimeEntryPath, selection.production.origin.runtimeExecutablePath, selection.production.origin.runtimeManifestPath] : [])] : [])]);
}
/** Explicit development preparation only. Not called by discovery/status; no VM is booted. */
export function admitDevelopmentVmRuntime(selection: VmRuntimeSelection): AdmittedVmRuntime {
  vmAssert(!selection.production, 'vm-development-selection-required');
  return admitVmRuntime(selection);
}

/** Explicit fixed-bundle preparation, sharing the same private runtime brand and
 * physical lifecycle as development. No launch or automatic fallback occurs. */
export function admitVmRuntime(original: VmRuntimeSelection): AdmittedVmRuntime {
  const selection: VmRuntimeSelection = { ...original, ...(original.production ? { production: Object.freeze({ ...original.production, ...(original.production.origin ? { origin: Object.freeze({ ...original.production.origin }) } : {}) }) } : {}) };
  vmAssert(process.platform === 'darwin' && process.arch === 'arm64', 'vm-platform-unavailable');
  const limits = { helper: 32 * 1024 * 1024, manifest: 2 * 1024 * 1024, kernel: 128 * 1024 * 1024, initrd: 512 * 1024 * 1024 };
  if (selection.production) {
    const p = selection.production, paths = productionVmRuntimePaths(join(p.appBundlePath, 'Contents/Resources/runtime/app/cli.js'));
    vmAssert(paths && [
      [selection.helperPath, VM_BUNDLE_FILES.helper], [selection.helperManifestPath, VM_BUNDLE_FILES.helperManifest],
      [selection.guestManifestPath, VM_BUNDLE_FILES.guestManifest], [selection.kernelPath, VM_BUNDLE_FILES.kernel],
      [selection.initrdPath, VM_BUNDLE_FILES.initrd], [p.runtimeManifestPath, VM_BUNDLE_FILES.manifest],
    ].every(([path, name]) => path === join(paths.directory, name!)), 'vm-production-layout-invalid');
    vmAssert(realpathSync(p.appBundlePath) === p.appBundlePath, 'vm-production-app-path-invalid');
    // The app seal authenticates the fixed manifests and image provenance. A
    // signed helper alone cannot authenticate an attacker-selected Linux image.
    verifyPublisherSignature(p.appBundlePath, VM_APP_IDENTIFIER, true);
    const origin = p.origin;
    vmAssert(origin && origin.runtimeExecutablePath === process.execPath && process.argv[1] === origin.runtimeEntryPath, 'vm-production-running-origin-required');
    const resolved = resolveProductionVmOrigin(origin.runtimeEntryPath, process.execPath, JSON.stringify({ version: 1,
      bundledEntryPath: origin.bundledEntryPath, runtimeEntryPath: origin.runtimeEntryPath, runtimeExecutablePath: origin.runtimeExecutablePath,
      runtimeManifestSha256: origin.manifestSha256 }));
    vmAssert(resolved && resolved.appBundlePath === p.appBundlePath && JSON.stringify(resolved.origin) === JSON.stringify(origin), 'vm-production-origin-changed');
  }
  const pins = [artifact(selection.helperPath, selection.helperSha256, limits.helper), artifact(selection.helperManifestPath, selection.helperManifestSha256, limits.manifest),
    artifact(selection.kernelPath, selection.kernelSha256, limits.kernel), artifact(selection.initrdPath, selection.initrdSha256, limits.initrd),
    artifact(selection.guestManifestPath, selection.guestManifestSha256, limits.manifest),
    ...(selection.production ? [artifact(selection.production.runtimeManifestPath, selection.production.runtimeManifestSha256, limits.manifest)] : []),
    ...(selection.production?.origin ? productionOriginArtifactPins(selection.production.origin) : [])];
  // The caller selected and pinned both manifests; verify their directly executed closure too.
  const read = (path: string) => record(JSON.parse(readFileSync(path, 'utf8')));
  const helper = read(selection.helperManifestPath), guest = read(selection.guestManifestPath);
  vmAssert(helper.version === 1 && helper.protocol === VM_PROTOCOL && helper.provider === 'macos-virtualization' && helper.target === 'darwin-arm64'
    && helper.development === !selection.production && helper.executableSha256 === selection.helperSha256 && isSha256(helper.sourceSha256) && isSha256(helper.entitlementsSha256)
    && helper.cpuCount === 2 && helper.memoryBytes === 2147483648 && helper.guestPort === 4041, 'vm-helper-manifest-invalid');
  vmAssert(guest.version === 1 && guest.protocol === VM_PROTOCOL && guest.architecture === 'arm64'
    && record(guest.kernel).sha256 === selection.kernelSha256 && record(guest.initrd).sha256 === selection.initrdSha256, 'vm-guest-manifest-invalid');
  const run = (args: string[], input?: string) => spawnSync('/usr/bin/codesign', args, { encoding: 'utf8', timeout: 15000, maxBuffer: 128 * 1024, ...(input ? { input } : {}) });
  const verify = run(['--verify', '--strict', selection.helperPath]); vmAssert(!verify.error && verify.status === 0, 'vm-helper-signature-invalid');
  if (selection.production) {
    validateProductionVmRuntimeManifest(read(selection.production.runtimeManifestPath), readFileSync(selection.helperManifestPath), readFileSync(selection.guestManifestPath));
    verifyPublisherSignature(selection.helperPath, VM_HELPER_IDENTIFIER, false);
  } else {
    const signature = run(['-dvvv', selection.helperPath]); vmAssert(!signature.error && signature.status === 0 && signature.stderr.includes('Signature=adhoc')
      && signature.stderr.includes('Identifier=com.nekodex.execution-vm-helper.dev\n'), 'vm-helper-development-signature-required');
  }
  const entitlements = run(['-d', '--entitlements', ':-', selection.helperPath]); vmAssert(!entitlements.error && entitlements.status === 0);
  const xml = entitlements.stdout;
  const plist = spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], { input: xml, encoding: 'utf8', maxBuffer: 128 * 1024, timeout: 15000 });
  vmAssert(!plist.error && plist.status === 0, 'vm-helper-entitlements-invalid'); const e = record(JSON.parse(plist.stdout)); keys(e, ['com.apple.security.virtualization']); vmAssert(e['com.apple.security.virtualization'] === true);
  const admitted: AdmittedVmRuntime = Object.freeze({ kind: selection.production ? 'production-linux-vm' : 'development-linux-vm', runtimeDigest: sha256(JSON.stringify(selection)) });
  runtimes.set(admitted, { selection: { ...selection }, pins }); assertRuntime(admitted); return admitted;
}
/** Fixed Apple trust anchor and team/identifier requirement, in addition to
 * signature verification. Environment-selected certificates never define trust. */
export function assertVmPublisherDetails(details: string, identifier: string): void {
  const lines = details.split('\n');
  vmAssert(lines.includes(`Identifier=${identifier}`) && lines.includes(`TeamIdentifier=${VM_PUBLISHER_TEAM_ID}`)
    && lines.some(line => /^Authority=Developer ID Application: .+ \(CNMWGJF2CG\)$/.test(line))
    && lines.some(line => line.startsWith('Timestamp=') && line.length > 10) && !lines.includes('Signature=adhoc'), 'vm-publisher-signature-required');
}
function verifyPublisherSignature(path: string, identifier: string, deep: boolean): void {
  const requirement = `anchor apple generic and identifier "${identifier}" and certificate leaf[subject.OU] = "${VM_PUBLISHER_TEAM_ID}"`;
  const verified = spawnSync('/usr/bin/codesign', ['--verify', '--strict', ...(deep ? ['--deep'] : []), '-R', requirement, path],
    { encoding: 'utf8', timeout: 15000, maxBuffer: 128 * 1024 });
  vmAssert(!verified.error && verified.status === 0, 'vm-publisher-seal-invalid');
  const signature = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', path], { encoding: 'utf8', timeout: 15000, maxBuffer: 128 * 1024 });
  vmAssert(!signature.error && signature.status === 0, 'vm-publisher-signature-invalid');
  assertVmPublisherDetails(signature.stderr, identifier);
}
export interface VmExecutionInput {
  actionId: string; scope: { taskId: string; generation: number; toolCallId: string }; runtime: AdmittedVmRuntime;
  script: string; files: VmFile[]; outputPaths: string[]; timeoutMs: number; signal?: AbortSignal; assertCurrent?: () => void;
}
export interface VmExecutionResult {
  actionId: string; state: 'stopped' | 'never-started' | 'unknown'; ownerHeld: boolean; reason: string;
  guestExitCode: number | null; guestSignal: number | null; stdout: string; stderr: string; logsTruncated: boolean;
  candidates: { path: string; size: number; mode: number; sha256: string }[]; resultDigest?: string;
}
interface LiveVm { child?: ChildProcessWithoutNullStreams; stop?: (reason: VmStopReason) => void; promise: Promise<VmExecutionResult> }
/** Trusted execution leaf. ToolJournal remains the eventual product approval/dedup owner.
 * This class exposes no host workspace writes or arbitrary executable configuration. */
export class VmExecutor {
  private live?: { actionId: string; run: LiveVm };
  private closed = false;
  private unresolvedAction?: string;
  constructor(private readonly store = new VmJobStore()) {}
  protectedPaths(runtime: AdmittedVmRuntime): readonly string[] { return vmRuntimeProtectedPaths(runtime); }
  status(): { available: boolean; ownerHeld: boolean; actionId?: string; reason?: string } {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') return { available: false, ownerHeld: false, reason: 'vm-platform-unavailable' };
    const state = this.store.inspectHeld();
    return { ...state, available: state.available && !this.closed && !this.unresolvedAction,
      ...(this.unresolvedAction ? { ownerHeld: true, actionId: this.unresolvedAction, reason: 'vm-owner-recovery-required' } : {}) };
  }
  cancel(actionId: string): void { if (this.live?.actionId === actionId) this.live.run.stop?.('cancelled'); }
  async close(): Promise<void> {
    this.closed = true;
    if (this.live) { this.live.run.stop?.('cancelled'); await this.live.run.promise; }
    if (this.unresolvedAction) throw new Error('vm-owner-recovery-required');
  }
  /** Exact immutable proposal lookup after physical settlement. This grants no
   * destination/write authority; a future export action belongs to its workspace owner. */
  readCandidate(actionId: string, path: string, expectedSha256: string): Uint8Array {
    vmAssert(!this.live && isSha256(expectedSha256), 'vm-owner-busy'); this.store.acquire();
    try {
      const row = this.store.get(actionId); vmAssert(row && row.phase === 'settled' && row.outcome === 'stopped'
        && row.resultDigest && !this.retained(row).ownerHeld, 'vm-candidate-not-settled');
      const root = this.store.jobRoot(actionId), bytes = readPrivate(join(root, 'result.json'), 8 * 1024 * 1024);
      vmAssert(sha256(bytes) === row.resultDigest, 'vm-result-changed'); const result = record(JSON.parse(bytes.toString('utf8')));
      vmAssert(Array.isArray(result.candidates) && result.candidates.length <= VM_LIMITS.outputFiles);
      const selected = result.candidates.map(record).find(c => c.path === path);
      vmAssert(selected && selected.sha256 === expectedSha256 && Number.isSafeInteger(selected.size) && Number(selected.size) <= VM_LIMITS.outputBytes, 'vm-candidate-identity-mismatch');
      const proposed = readPrivate(join(root, 'candidates', sha256(path)), VM_LIMITS.outputBytes);
      vmAssert(proposed.length === selected.size && sha256(proposed) === expectedSha256, 'vm-candidate-changed'); return Uint8Array.from(proposed);
    } finally { this.store.releaseLock(); }
  }
  /** Reads the original retained controller result, never a recomputed guest
   * result. EOF/lost-core cases may have physical proof without a semantic result. */
  readResult(actionId: string): VmExecutionResult | undefined {
    vmAssert(!this.live, 'vm-owner-busy'); this.store.acquire();
    try {
      const row = this.store.get(actionId);
      if (!row || row.phase !== 'settled' || row.outcome !== 'stopped' || !row.resultDigest || this.retained(row).ownerHeld) return;
      const bytes = readPrivate(join(this.store.jobRoot(actionId), 'result.json'), 8 * 1024 * 1024);
      vmAssert(sha256(bytes) === row.resultDigest, 'vm-result-changed'); const value = record(JSON.parse(bytes.toString('utf8')));
      vmAssert(value.actionId === actionId && value.state === 'stopped' && value.ownerHeld === false && Array.isArray(value.candidates));
      return { ...(value as unknown as VmExecutionResult), resultDigest: row.resultDigest };
    } finally { this.store.releaseLock(); }
  }
  private retained(row: VmJobRecord): VmExecutionResult {
    let released = false;
    if (row.phase === 'settled') { try { released = this.store.heldAction() !== row.actionId; } catch { /* pending release stays held */ } }
    if (released && this.unresolvedAction === row.actionId) this.unresolvedAction = undefined;
    return { actionId: row.actionId, state: released ? row.outcome! : 'unknown', ownerHeld: !released,
      reason: row.reason ?? 'vm-retained-owner', guestExitCode: row.guestExitCode ?? null, guestSignal: null, stdout: '', stderr: '', logsTruncated: false, candidates: [], resultDigest: row.resultDigest };
  }
  /** Passive exact-owner reconciliation. Never spawns a helper or replays a job. */
  reconcile(actionId: string): VmExecutionResult | undefined {
    vmAssert(!this.live, 'vm-owner-busy'); this.store.acquire();
    try {
      const row = this.store.get(actionId); if (!row) return;
      if (row.phase === 'settled') {
        const projected = this.retained(row); if (!projected.ownerHeld) return projected;
        if (row.helper) { const current = vmProcessIdentity(row.helper.pid); if (current?.start === row.helper.start) return projected; }
        if (row.launchAttempted && !this.store.stopped(row)) return projected;
        this.store.releaseSettled(row); return this.retained(row);
      }
      vmAssert(this.store.heldAction() === actionId, 'vm-owner-mismatch');
      if (row.helper) { const current = vmProcessIdentity(row.helper.pid); if (current?.start === row.helper.start) return this.retained(row); }
      if (!row.launchAttempted) return this.retained(this.store.settle(row, 'never-started', 'vm-gated-helper-exited'));
      const stopped = this.store.stopped(row); if (!stopped) return this.retained(row);
      return this.retained(this.store.settle(row, 'stopped', 'vm-authenticated-late-stop'));
    } finally { this.store.releaseLock(); }
  }
  execute(original: VmExecutionInput): Promise<VmExecutionResult> {
    vmAssert(!this.closed && !this.live && !this.unresolvedAction, 'vm-owner-busy');
    validateVmInput(original); vmAssert(isActionId(original.actionId) && original.scope && typeof original.scope.taskId === 'string' && original.scope.taskId.length > 0
      && original.scope.taskId.length <= 200 && Number.isSafeInteger(original.scope.generation) && original.scope.generation >= 1
      && typeof original.scope.toolCallId === 'string' && original.scope.toolCallId.length > 0 && original.scope.toolCallId.length <= 200, 'vm-scope-invalid');
    // Snapshot bytes now; caller mutation after approval cannot change the execution closure.
    const input = { ...original, scope: { ...original.scope }, files: original.files.map(f => ({ ...f, bytes: Uint8Array.from(f.bytes) })), outputPaths: [...original.outputPaths] };
    const run: LiveVm = { promise: Promise.resolve(undefined as never) }; this.live = { actionId: input.actionId, run };
    run.promise = this.perform(input, run).then(result => { this.unresolvedAction = result.ownerHeld ? input.actionId : undefined; return result; })
      .finally(() => { if (this.live?.run === run) this.live = undefined; }); return run.promise;
  }
  private async perform(input: VmExecutionInput, run: LiveVm): Promise<VmExecutionResult> {
    const unknown = (reason: string): VmExecutionResult => ({ actionId: input.actionId, state: 'unknown', ownerHeld: true, reason,
      guestExitCode: null, guestSignal: null, stdout: '', stderr: '', logsTruncated: false, candidates: [] });
    let acquired = false, row: VmJobRecord | undefined, child: ChildProcessWithoutNullStreams | undefined;
    let joined = false, stderrBytes = 0, helperFrameCount = 0, stopRequested = false, parentError = false, startAttempted = false;
    const consoleChunks: Buffer[] = [], diagnostics: string[] = [];
    let bootTimer: ReturnType<typeof setTimeout> | undefined, jobTimer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const selection = assertRuntime(input.runtime); input.assertCurrent?.(); this.store.acquire(); acquired = true;
      const fingerprint = sha256(JSON.stringify({ scope: input.scope, runtime: input.runtime.runtimeDigest, script: sha256(input.script),
        files: input.files.map(f => ({ path: f.path, mode: f.mode, size: f.bytes.length, sha256: sha256(f.bytes) })), outputPaths: input.outputPaths, timeoutMs: input.timeoutMs }));
      const existing = this.store.get(input.actionId);
      if (existing) { vmAssert(existing.fingerprint === fingerprint, 'vm-action-conflict'); return this.retained(existing); }
      vmAssert(!this.store.heldAction(), 'vm-prior-owner-held');
      const nonce = randomBytes(32).toString('hex'), root = this.store.jobRoot(input.actionId);
      const scope: VmScope = { protocol: VM_PROTOCOL, actionId: input.actionId, nonce };
      const config = { ...scope, kernelPath: selection.kernelPath, kernelSha256: selection.kernelSha256, initrdPath: selection.initrdPath,
        initrdSha256: selection.initrdSha256, jobRoot: root, cpuCount: 2, memoryBytes: 2147483648, bootTimeoutMs: 60000,
        maxFrameBytes: VM_LIMITS.frameBytes, logLimitBytes: VM_LIMITS.logBytes, receiptKeyHex: this.store.receiptKey(input.actionId, nonce).toString('hex') };
      const configBytes = JSON.stringify(config), configSha256 = sha256(configBytes), configPath = join(root, 'config.json');
      row = { version: 1, actionId: input.actionId, nonce, fingerprint, configSha256, helper: null, launchAttempted: false, phase: 'prepared', updatedAt: Date.now() };
      this.store.begin(row); createPrivateFile(configPath, configBytes); syncDirectory(root);
      if (input.signal?.aborted) return this.retained(this.store.settle(row, 'never-started', 'vm-cancelled-before-spawn'));
      assertRuntime(input.runtime); input.assertCurrent?.();
      child = spawn(selection.helperPath, ['--run', configPath, configSha256], { shell: false, stdio: ['pipe', 'pipe', 'pipe'],
        env: { HOME: root, TMPDIR: root, PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' } }); run.child = child;
      const actualChild = child;
      const closed = new Promise<void>(resolve => { actualChild.once('close', () => { joined = true; resolve(); }); });
      let helperReady = false, connected = false, executeSent = false, currentError = 'vm-helper-exited-without-proof';
      const capture = new VmGuestCapture(scope, input.outputPaths);
      const send = (command: string, extra: Record<string, unknown> = {}): Promise<void> => new Promise((resolve, reject) => {
        const line = JSON.stringify({ ...scope, configSha256, command, ...extra }) + '\n';
        if (Buffer.byteLength(line) > VM_LIMITS.frameBytes) { reject(new Error('vm-frame-limit')); return; }
        actualChild.stdin.write(line, error => error ? reject(error) : resolve());
      });
      const stop = (reason: VmStopReason): void => {
        if (stopRequested || joined) return; stopRequested = true; currentError = reason;
        void send('stop', { reason }).catch(() => { /* durable ownership stays held until independently verified stop+join */ });
      }; run.stop = stop; onAbort = () => stop('cancelled'); input.signal?.addEventListener('abort', onAbort, { once: true });
      actualChild.stdin.on('error', () => { if (!stopRequested) { parentError = true; stop('transport-error'); } });
      actualChild.on('error', () => { parentError = true; currentError = 'vm-helper-spawn-error'; });
      actualChild.stderr.on('data', (data: Buffer) => { stderrBytes += data.length; if (stderrBytes > VM_LIMITS.logBytes) stop('output-limit'); });
      // Order callbacks even when a single read includes several frames. No guest frame can alter lifecycle events.
      let events = Promise.resolve(), pendingEvents = 0, pendingBytes = 0, consoleBytes = 0, poisoned = false;
      const parser = new VmJsonLines(event => {
        if (poisoned) return;
        vmAssert(++helperFrameCount <= VM_LIMITS.frames);
        const eventBytes = Buffer.byteLength(JSON.stringify(event));
        if (++pendingEvents > 64 || (pendingBytes += eventBytes) > 2 * 1024 * 1024) {
          poisoned = true; parentError = true; stop('output-limit'); return;
        }
        events = events.then(async () => {
          checkedScope(event, scope); vmAssert(event.configSha256 === configSha256);
          const common = ['protocol', 'actionId', 'nonce', 'configSha256', 'event'];
          if (event.event === 'helper-ready') {
            keys(event, [...common, 'pid']); vmAssert(!helperReady && event.pid === actualChild.pid && !stopRequested);
            helperReady = true; const identity = vmProcessIdentity(actualChild.pid!); vmAssert(identity, 'vm-helper-not-observed');
            row = { ...row!, helper: identity, phase: 'bound' }; this.store.save(row);
            input.assertCurrent?.(); assertRuntime(input.runtime);
            if (input.signal?.aborted) { stop('cancelled'); return; }
            row = { ...row!, launchAttempted: true, phase: 'starting' }; this.store.save(row);
            startAttempted = true; await send('start'); return;
          }
          vmAssert(helperReady);
          if (event.event === 'guest-connected') {
            keys(event, common); vmAssert(startAttempted && !connected && !stopRequested); connected = true;
            await send('guest-frame', { payload: { ...scope, type: 'hello' } }); return;
          }
          if (event.event === 'guest-frame') {
            keys(event, [...common, 'payload']); vmAssert(connected && !stopRequested); const payload = record(event.payload);
            vmAssert(payload.type === 'ready' || executeSent, 'vm-output-before-execute'); const phase = capture.accept(payload);
            if (phase === 'ready') {
              vmAssert(!executeSent);
              for (const file of input.files) {
                if (stopRequested) return;
                await send('guest-frame', { payload: { ...scope, type: 'file-begin', path: file.path, mode: file.mode, size: file.bytes.length, sha256: sha256(file.bytes) } });
                for (let offset = 0; offset < file.bytes.length; offset += VM_LIMITS.chunkBytes) {
                  if (stopRequested) return;
                  await send('guest-frame', { payload: { ...scope, type: 'file-chunk', path: file.path, offset, dataBase64: Buffer.from(file.bytes.subarray(offset, offset + VM_LIMITS.chunkBytes)).toString('base64') } });
                }
                await send('guest-frame', { payload: { ...scope, type: 'file-end', path: file.path } });
              }
              if (stopRequested) return; input.assertCurrent?.(); executeSent = true; clearTimeout(bootTimer);
              row = { ...row!, phase: 'running' }; this.store.save(row);
              jobTimer = setTimeout(() => stop('timeout'), input.timeoutMs);
              await send('guest-frame', { payload: { ...scope, type: 'execute', script: input.script, outputPaths: input.outputPaths, timeoutMs: input.timeoutMs } });
            } else if (phase === 'result') { vmAssert(executeSent); stop('guest-result'); }
            return;
          }
          if (event.event === 'console') { keys(event, [...common, 'dataBase64']); const chunk = base64(event.dataBase64, VM_LIMITS.chunkBytes); consoleBytes += chunk.length;
            vmAssert(consoleBytes <= VM_LIMITS.logBytes, 'vm-console-limit'); consoleChunks.push(chunk); return; }
          if (event.event === 'error') { keys(event, [...common, 'code']); vmAssert(typeof event.code === 'string' && /^[a-z-]{1,64}$/.test(event.code));
            if (diagnostics.length < 64) diagnostics.push(event.code); currentError = 'vm-helper-error'; stop('transport-error'); return; }
          if (event.event === 'vm-starting' || event.event === 'vm-running') keys(event, common);
          else if (event.event === 'stopping') { keys(event, [...common, 'reason']); vmAssert(typeof event.reason === 'string' && /^[a-z-]{1,64}$/.test(event.reason)); }
          else if (event.event === 'vm-stopped') { keys(event, [...common, 'stopEvidence', 'reason']); vmAssert(['host-stop-completion', 'delegate-stopped'].includes(String(event.stopEvidence))); }
          else if (event.event === 'terminal') { keys(event, [...common, 'state', 'reason']); vmAssert(['never-started', 'stopped'].includes(String(event.state))); }
          else vmAssert(false);
          // Lifecycle messages aid diagnostics only; physical acceptance uses the authenticated file plus exact join.
        }).catch(() => { poisoned = true; parentError = true; stop('protocol-error'); })
          .finally(() => { pendingEvents--; pendingBytes -= eventBytes; });
      });
      actualChild.stdout.on('data', (data: Buffer) => { try { parser.push(data); } catch { parentError = true; stop('protocol-error'); } });
      bootTimer = setTimeout(() => stop('timeout'), 60000);
      if (input.signal?.aborted) stop('cancelled');
      await closed; await events; try { parser.end(); } catch { parentError = true; }
      clearTimeout(bootTimer); clearTimeout(jobTimer);
      if (!row.launchAttempted) return this.retained(this.store.settle(row, 'never-started', currentError));
      const stopped = this.store.stopped(row); if (!stopped) return unknown('vm-stopped-proof-missing');
      const captured = capture.snapshot(), candidates = captured.outputs.map(f => ({ path: f.path, size: f.bytes.length, mode: f.mode, sha256: sha256(f.bytes) }));
      const candidateRoot = join(root, 'candidates'); mkdirSync(candidateRoot, { mode: 0o700 });
      // Host paths are digest names. Guest paths remain metadata and never enter host path resolution.
      for (const file of captured.outputs) createPrivateFile(join(candidateRoot, sha256(file.path)), file.bytes);
      syncDirectory(candidateRoot);
      const result = { actionId: input.actionId, state: 'stopped' as const, ownerHeld: false, reason: parentError ? 'vm-protocol-or-transport-error' : captured.result ? 'vm-guest-result-captured' : currentError,
        guestExitCode: captured.result?.exitCode ?? null, guestSignal: captured.result?.signal ?? null, stdout: captured.stdout, stderr: captured.stderr,
        logsTruncated: captured.result?.stdoutTruncated === true || captured.result?.stderrTruncated === true, candidates,
        guestErrorCode: captured.result?.errorCode ?? null, stoppedEvidence: stopped.stopEvidence };
      const resultBytes = JSON.stringify(result), resultDigest = sha256(resultBytes); createPrivateFile(join(root, 'result.json'), resultBytes); syncDirectory(root);
      this.store.settle(row, 'stopped', result.reason, { guestExitCode: result.guestExitCode, resultDigest }); return { ...result, resultDigest };
    } catch {
      if (child && !joined) { run.stop?.('transport-error'); return unknown('vm-owner-held-after-error'); }
      if (row && !row.launchAttempted && !startAttempted) {
        try { return this.retained(this.store.settle(row, 'never-started', 'vm-prelaunch-failed')); } catch { /* uncertain journal retained */ }
      }
      if (!row) return { ...unknown('vm-preparation-unavailable'), state: 'never-started', ownerHeld: false };
      return unknown('vm-owner-or-preparation-unavailable');
    } finally {
      clearTimeout(bootTimer); clearTimeout(jobTimer); if (onAbort) input.signal?.removeEventListener('abort', onAbort);
      // If the helper is still alive after a local observer error, its durable gate stays held.
      // EOF asks that same helper to stop; no SIGKILL, replacement or alternate owner is started.
      if (child && !joined) child.stdin.end();
      if (row && child) {
        try { const root = this.store.jobRoot(row.actionId); createPrivateFile(join(root, 'diagnostics.json'), JSON.stringify({ joined, helperFrameCount, stderrBytes, parentError, codes: diagnostics }));
          createPrivateFile(join(root, 'boot-console.txt'), Buffer.concat(consoleChunks)); syncDirectory(root); } catch { /* diagnostics never replace ownership/stop evidence */ }
      }
      if (acquired) this.store.releaseLock();
    }
  }
}
