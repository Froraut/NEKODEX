/** Explicit isolated development fixture. Does not load/restart the application,
 * grant model access, publish workspace outputs or use an installed runtime. */
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { admitDevelopmentVmRuntime, VmExecutor, type VmRuntimeSelection } from '../src/execution-environments/executor';
import { sha256, vmAssert } from '../src/execution-environments/protocol';
import { VmJobStore } from '../src/execution-environments/storage';

const args = process.argv.slice(2);
vmAssert(args.length === 4 && args[0] === '--case' && ['pipeline', 'inherited', 'cancel', 'timeout', 'eof'].includes(args[1]!) && args[2] === '--receipt',
  'Usage: bun scripts/dev-execution-vm.ts --case pipeline|inherited|cancel|timeout|eof --receipt ABSOLUTE_PATH');
const caseName = args[1]!, receiptPath = resolve(args[3]!);
const pipeline = caseName === 'pipeline' || caseName === 'inherited';
vmAssert(receiptPath === args[3], 'Receipt path must be absolute');
const repository = realpathSync(join(import.meta.dir, '..'));
const helperManifestPath = join(repository, 'launcher/electron/execution-vm-helper/darwin-arm64/manifest.json');
const guestManifestPath = join(repository, 'launcher/native/execution-guest/.build/bundle/manifest.json');
const helperBytes = readFileSync(helperManifestPath), guestBytes = readFileSync(guestManifestPath);
const helper = JSON.parse(helperBytes.toString()), guest = JSON.parse(guestBytes.toString());
const selection: VmRuntimeSelection = { helperPath: join(repository, 'launcher/electron/execution-vm-helper/darwin-arm64/nekodex-execution-vm-helper'),
  helperSha256: helper.executableSha256, helperManifestPath, helperManifestSha256: sha256(helperBytes),
  kernelPath: guest.kernel.path, kernelSha256: guest.kernel.sha256, initrdPath: guest.initrd.path, initrdSha256: guest.initrd.sha256,
  guestManifestPath, guestManifestSha256: sha256(guestBytes) };
const runtime = admitDevelopmentVmRuntime(selection), store = new VmJobStore(), executor = new VmExecutor(store), actionId = randomUUID(), abort = new AbortController();
const started = Date.now();
writeFileSync(receiptPath, JSON.stringify({ phase: 'admitted', actionId, caseName, started, selection, runtimeDigest: runtime.runtimeDigest }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
const script = pipeline ? `set -eu
test "$(/bin/busybox id -u)" = 1000
test "$PWD" = /workspace
test ! -e /Users
test "$(/bin/busybox ls /sys/class/net)" = lo
/bin/busybox cat lines.txt | /bin/busybox tr 'a-z' 'A-Z' | /bin/busybox sort > result.txt
(printf 'SUBSHELL_OK\\n' >> result.txt)
/bin/busybox setsid /bin/sh -c 'while :; do /bin/busybox sleep 1; done' </dev/null >/dev/null 2>&1 &
printf 'PIPELINE_AND_DETACHED_BACKGROUND_OK\\n'
${caseName === 'inherited' ? '/bin/busybox sleep 60 &\n' : ''}
` : `set -eu
/bin/busybox setsid /bin/sh -c 'while :; do /bin/busybox sleep 1; done' </dev/null >/dev/null 2>&1 &
printf 'CANCEL_BOUNDARY_REACHED\\n'
while :; do /bin/busybox sleep 1; done
`;
let cancel: ReturnType<typeof setTimeout> | undefined;
if (caseName === 'cancel') cancel = setTimeout(() => abort.abort(), 10000);
if (caseName === 'eof') cancel = setTimeout(() => {
  const job = store.get(actionId);
  vmAssert(job?.phase === 'running' && job.launchAttempted && job.helper, 'EOF fixture did not reach the owned running boundary');
  writeFileSync(receiptPath, JSON.stringify({ phase: 'core-exit-with-owned-vm', actionId, caseName, started, elapsedMs: Date.now() - started,
    helper: job.helper, configSha256: job.configSha256, limitation: 'Intentional owner process exit; exact passive stopped receipt reconciliation still required.' }, null, 2) + '\n', { mode: 0o600 });
  // Intentionally bypass close(): this exact task-owned process loss is the
  // fixture. Kernel pipe EOF must make the same Swift owner stop and record.
  process.exit(0);
}, 6000);
let helperSample: unknown = null;
const sample = setTimeout(() => {
  try {
    const job = store.get(actionId); if (!job?.helper) return;
    const observed = spawnSync('/bin/ps', ['-p', String(job.helper.pid), '-o', 'pid=,%cpu=,rss=,etime='], { encoding: 'utf8', timeout: 1000, maxBuffer: 4096 });
    helperSample = { helper: job.helper, phase: job.phase, psExit: observed.status, ps: observed.stdout.trim(), limitation: 'Helper process sample; not total VM/XPC or whole-system memory.' };
  } catch { /* a completed owner has already released its observation lock */ }
}, 5000);
try {
  const input = { actionId, scope: { taskId: 'execution-vm-development-fixture', generation: 1, toolCallId: actionId }, runtime,
    script, files: pipeline ? [{ path: 'lines.txt', mode: 0o600 as const, bytes: Buffer.from('bravo\nalpha\ncharlie\n') }] : [],
    outputPaths: pipeline ? ['result.txt'] : [], timeoutMs: caseName === 'timeout' ? 1500 : 30000, signal: abort.signal };
  const outcome = await executor.execute(input);
  let artifactChecked = false;
  if (pipeline && outcome.state === 'stopped' && outcome.candidates.length === 1) {
    const bytes = executor.readCandidate(actionId, 'result.txt', outcome.candidates[0]!.sha256);
    artifactChecked = Buffer.from(bytes).toString() === 'ALPHA\nBRAVO\nCHARLIE\nSUBSHELL_OK\n';
  }
  const boundaryReached = outcome.stdout.includes(pipeline ? 'PIPELINE_AND_DETACHED_BACKGROUND_OK' : 'CANCEL_BOUNDARY_REACHED');
  let duplicateAndReconcile = false;
  if (outcome.state === 'stopped' && !outcome.ownerHeld && outcome.resultDigest) {
    const duplicate = await executor.execute(input), retained = new VmExecutor().reconcile(actionId);
    duplicateAndReconcile = duplicate.state === 'stopped' && !duplicate.ownerHeld && duplicate.resultDigest === outcome.resultDigest
      && retained?.state === 'stopped' && !retained.ownerHeld && retained.resultDigest === outcome.resultDigest;
  }
  const passed = outcome.state === 'stopped' && outcome.ownerHeld === false && boundaryReached && duplicateAndReconcile
    && (!pipeline || outcome.guestExitCode === 0 && artifactChecked)
    && (caseName !== 'inherited' || outcome.logsTruncated)
    && (pipeline || outcome.reason === caseName || caseName === 'cancel' && outcome.reason === 'cancelled');
  writeFileSync(receiptPath, JSON.stringify({ phase: passed ? 'passed' : 'failed', actionId, caseName, started, durationMs: Date.now() - started,
    runtimeDigest: runtime.runtimeDigest, helperSha256: selection.helperSha256, guestManifestSha256: selection.guestManifestSha256,
    outcome, artifactChecked, boundaryReached, duplicateAndReconcile, helperSample, passed, limitation: 'Development Linux guest; no workspace export, Native model, compiler/Python, network or installed delivery claim.' }, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ actionId, caseName, passed, state: outcome.state, ownerHeld: outcome.ownerHeld, reason: outcome.reason, durationMs: Date.now() - started }));
  if (!passed) process.exitCode = 1;
} finally { clearTimeout(cancel); clearTimeout(sample); await executor.close(); }
