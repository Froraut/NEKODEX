import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { base64, isActionId, isSha256, keys, record, VM_PROTOCOL, vmAssert } from './protocol';

export interface VmProcessIdentity { pid: number; start: string }
export interface VmJobRecord {
  version: 1; actionId: string; nonce: string; fingerprint: string; configSha256: string;
  phase: 'prepared' | 'bound' | 'starting' | 'running' | 'unknown' | 'settled';
  helper: VmProcessIdentity | null; launchAttempted: boolean; outcome?: 'never-started' | 'stopped';
  reason?: string; guestExitCode?: number | null; resultDigest?: string; updatedAt: number;
}
interface Gate { version: 1; actionId: string; held: boolean }
export interface VmStoppedReceipt {
  protocol: typeof VM_PROTOCOL; actionId: string; nonce: string; configSha256: string; helperPid: number;
  vmState: 'stopped'; channelsClosed: true; stopEvidence: 'host-stop-completion' | 'delegate-stopped';
  reason: string; timestampMs: number;
}
export function assertPrivatePath(path: string, directory = false): void {
  const s = lstatSync(path);
  vmAssert(s.uid === process.getuid?.() && !(s.mode & 0o077) && realpathSync(path) === path
    && (directory ? s.isDirectory() : s.isFile() && s.nlink === 1), 'vm-private-path-invalid');
}
export function readPrivate(path: string, max: number): Buffer {
  assertPrivatePath(path); const before = lstatSync(path, { bigint: true }); vmAssert(before.size <= BigInt(max), 'vm-storage-limit');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd, { bigint: true }); vmAssert(opened.dev === before.dev && opened.ino === before.ino);
    const chunks: Buffer[] = []; let total = 0;
    for (;;) { const bytes = Buffer.alloc(Math.min(65536, max + 1 - total)); const n = readSync(fd, bytes);
      if (!n) break; total += n; vmAssert(total <= max, 'vm-storage-limit'); chunks.push(bytes.subarray(0, n)); }
    const after = lstatSync(path, { bigint: true });
    vmAssert(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode'].every(k => after[k as keyof typeof after] === before[k as keyof typeof before]), 'vm-storage-changed');
    return Buffer.concat(chunks, total);
  } finally { closeSync(fd); }
}
export function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); }
}
export function createPrivateFile(path: string, bytes: string | Uint8Array, mode = 0o400): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
/** Kernel start identity, not a PID-only liveness claim. Passive and macOS-only. */
export function vmProcessIdentity(pid: number): VmProcessIdentity | null {
  vmAssert(process.platform === 'darwin' && Number.isInteger(pid) && pid > 0, 'vm-platform-unavailable');
  const { dlopen, ptr } = require('bun:ffi') as typeof import('bun:ffi');
  const lib = dlopen('/usr/lib/libproc.dylib', { proc_pidinfo: { args: ['i32', 'i32', 'u64', 'ptr', 'i32'], returns: 'i32' } });
  try {
    const bytes = Buffer.alloc(136), count = lib.symbols.proc_pidinfo(pid, 3, 0, ptr(bytes), bytes.length);
    if (count === bytes.length) return { pid, start: `${bytes.readBigUInt64LE(120)}:${bytes.readBigUInt64LE(128)}` };
    try { process.kill(pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') return null; }
    throw new Error('vm-process-observation-unavailable');
  } finally { lib.close(); }
}
/** The default authority is user-wide, deliberately independent of app profiles. */
export const defaultVmAuthorityDirectory = (): string => join(homedir(), '.nekodex-execution-vm');
export class VmJobStore {
  private key?: Buffer;
  private lockFd?: number;
  private lockIdentity?: { dev: number; ino: number };
  private uncertain = false;
  constructor(readonly home = defaultVmAuthorityDirectory()) {}
  private initialize(): void {
    if (!existsSync(this.home)) { vmAssert(realpathSync(dirname(this.home)) === dirname(this.home)); mkdirSync(this.home, { mode: 0o700 }); syncDirectory(dirname(this.home)); }
    assertPrivatePath(this.home, true);
  }
  /** Darwin O_EXLOCK|O_NONBLOCK; retained intent remains authoritative after OS lock loss. */
  acquire(): void {
    vmAssert(process.platform === 'darwin', 'vm-platform-unavailable'); vmAssert(this.lockFd === undefined, 'vm-owner-busy'); this.initialize();
    const path = join(this.home, '.lock'), fd = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | 0x20 | 0x04, 0o600);
    try {
      assertPrivatePath(path); const st = fstatSync(fd), named = lstatSync(path);
      vmAssert(st.dev === named.dev && st.ino === named.ino); this.lockIdentity = { dev: st.dev, ino: st.ino }; this.lockFd = fd;
      const keyPath = join(this.home, 'integrity.key');
      if (!existsSync(keyPath)) { createPrivateFile(keyPath, randomBytes(32)); syncDirectory(this.home); }
      this.key = readPrivate(keyPath, 32); vmAssert(this.key.length === 32);
      const jobs = join(this.home, 'jobs'); if (!existsSync(jobs)) { mkdirSync(jobs, { mode: 0o700 }); syncDirectory(this.home); } assertPrivatePath(jobs, true);
    } catch (e) { closeSync(fd); this.lockFd = undefined; throw e; }
  }
  releaseLock(): void { if (this.lockFd !== undefined) { closeSync(this.lockFd); this.lockFd = undefined; } }
  private assertLock(): void {
    vmAssert(this.lockFd !== undefined && !this.uncertain, 'vm-owner-write-uncertain');
    const named = lstatSync(join(this.home, '.lock')); vmAssert(named.dev === this.lockIdentity?.dev && named.ino === this.lockIdentity?.ino);
  }
  private encode(value: unknown): string {
    vmAssert(this.key); const body = JSON.stringify(value); return JSON.stringify({ body, macHex: createHmac('sha256', this.key).update(body).digest('hex') });
  }
  private decode(path: string): unknown {
    vmAssert(this.key); const e = record(JSON.parse(readPrivate(path, 128 * 1024).toString('utf8'))); keys(e, ['body', 'macHex']);
    vmAssert(typeof e.body === 'string' && isSha256(e.macHex));
    vmAssert(timingSafeEqual(createHmac('sha256', this.key).update(e.body).digest(), Buffer.from(e.macHex, 'hex')), 'vm-journal-authentication-failed');
    return JSON.parse(e.body);
  }
  private publish(path: string, value: unknown): void {
    this.assertLock(); const next = path + '.pending';
    try { createPrivateFile(next, this.encode(value), 0o600); renameSync(next, path); syncDirectory(dirname(path)); }
    catch (e) { this.uncertain = true; throw e; }
  }
  jobRoot(actionId: string): string { vmAssert(isActionId(actionId)); return join(this.home, 'jobs', actionId); }
  receiptKey(actionId: string, nonce: string): Buffer { vmAssert(this.key && isActionId(actionId) && isSha256(nonce)); return createHmac('sha256', this.key).update(`receipt:${actionId}:${nonce}`).digest(); }
  get(actionId: string): VmJobRecord | undefined {
    this.assertLock(); const root = this.jobRoot(actionId), path = join(root, 'job.json'); if (!existsSync(root)) return;
    assertPrivatePath(root, true); vmAssert(!existsSync(path + '.pending'), 'vm-journal-pending');
    if (!existsSync(path)) throw new Error('vm-incomplete-job-preserved');
    const row = record(this.decode(path));
    vmAssert(row.version === 1 && row.actionId === actionId && isSha256(row.nonce) && isSha256(row.fingerprint) && isSha256(row.configSha256)
      && ['prepared', 'bound', 'starting', 'running', 'unknown', 'settled'].includes(String(row.phase)) && typeof row.launchAttempted === 'boolean'
      && Number.isSafeInteger(row.updatedAt));
    vmAssert(row.helper === null || record(row.helper) && Number.isInteger((row.helper as VmProcessIdentity).pid) && (row.helper as VmProcessIdentity).pid > 0
      && /^\d+:\d+$/.test((row.helper as VmProcessIdentity).start));
    return row as unknown as VmJobRecord;
  }
  heldAction(): string | undefined {
    this.assertLock(); const path = join(this.home, 'gate.json'); vmAssert(!existsSync(path + '.pending'), 'vm-gate-pending');
    if (!existsSync(path)) return;
    const gate = record(this.decode(path)); keys(gate, ['version', 'actionId', 'held']);
    vmAssert(gate.version === 1 && isActionId(gate.actionId) && typeof gate.held === 'boolean');
    if (gate.held) return gate.actionId;
    vmAssert(this.get(gate.actionId)?.phase === 'settled', 'vm-gate-terminal-mismatch'); return;
  }
  begin(row: VmJobRecord): void {
    this.assertLock(); vmAssert(!this.heldAction(), 'vm-prior-owner-held');
    const jobs = join(this.home, 'jobs'); vmAssert(readdirSync(jobs).length < 64, 'vm-retention-limit');
    const root = this.jobRoot(row.actionId); vmAssert(!existsSync(root), 'vm-action-retained');
    mkdirSync(root, { mode: 0o700 }); syncDirectory(jobs); this.publish(join(root, 'job.json'), row);
    this.publish(join(this.home, 'gate.json'), { version: 1, actionId: row.actionId, held: true } satisfies Gate);
  }
  save(row: VmJobRecord): void {
    this.assertLock(); vmAssert(this.heldAction() === row.actionId, 'vm-owner-mismatch');
    const prior = this.get(row.actionId); vmAssert(prior && prior.fingerprint === row.fingerprint && prior.configSha256 === row.configSha256 && prior.nonce === row.nonce);
    vmAssert(prior.phase !== 'settled' && (!prior.launchAttempted || row.launchAttempted));
    this.publish(join(this.jobRoot(row.actionId), 'job.json'), { ...row, updatedAt: Date.now() });
  }
  settle(row: VmJobRecord, outcome: 'never-started' | 'stopped', reason: string, extra: Partial<Pick<VmJobRecord, 'guestExitCode' | 'resultDigest'>> = {}): VmJobRecord {
    vmAssert(outcome === 'stopped' || !row.launchAttempted, 'vm-stop-proof-required');
    const next: VmJobRecord = { ...row, ...extra, phase: 'settled', outcome, reason, updatedAt: Date.now() };
    this.save(next); this.publish(join(this.home, 'gate.json'), { version: 1, actionId: row.actionId, held: false } satisfies Gate); return next;
  }
  /** Complete only the exact local release publication after physical proof was
   * independently rechecked. This never re-executes the accepted job. */
  releaseSettled(row: VmJobRecord): void {
    this.assertLock(); vmAssert(row.phase === 'settled' && JSON.stringify(this.get(row.actionId)) === JSON.stringify(row));
    const path = join(this.home, 'gate.json'), pending = path + '.pending';
    const expected = { version: 1, actionId: row.actionId, held: false } satisfies Gate;
    if (existsSync(pending)) {
      vmAssert(JSON.stringify(this.decode(pending)) === JSON.stringify(expected), 'vm-foreign-pending-gate');
      const gate = record(this.decode(path)); vmAssert(gate.actionId === row.actionId && gate.held === true, 'vm-owner-mismatch');
      try { renameSync(pending, path); syncDirectory(this.home); } catch (e) { this.uncertain = true; throw e; }
      return;
    }
    const held = this.heldAction();
    if (held === row.actionId) this.publish(path, expected);
    else vmAssert(!held, 'vm-foreign-owner-preserved');
  }
  stopped(row: VmJobRecord): VmStoppedReceipt | undefined {
    this.assertLock(); vmAssert(row.helper, 'vm-helper-identity-missing'); const path = join(this.jobRoot(row.actionId), 'stopped.json'); if (!existsSync(path)) return;
    const e = record(JSON.parse(readPrivate(path, 16384).toString('utf8'))); keys(e, ['bodyBase64', 'macHex']);
    const bytes = base64(e.bodyBase64, 8192); vmAssert(isSha256(e.macHex));
    vmAssert(timingSafeEqual(createHmac('sha256', this.receiptKey(row.actionId, row.nonce)).update(bytes).digest(), Buffer.from(e.macHex, 'hex')), 'vm-stop-authentication-failed');
    const body = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    keys(body, ['protocol', 'actionId', 'nonce', 'configSha256', 'helperPid', 'vmState', 'channelsClosed', 'stopEvidence', 'reason', 'timestampMs']);
    vmAssert(body.protocol === VM_PROTOCOL && body.actionId === row.actionId && body.nonce === row.nonce && body.configSha256 === row.configSha256
      && body.helperPid === row.helper.pid && body.vmState === 'stopped' && body.channelsClosed === true
      && ['host-stop-completion', 'delegate-stopped'].includes(String(body.stopEvidence))
      && typeof body.reason === 'string' && /^[a-z-]{1,64}$/.test(body.reason) && Number.isSafeInteger(body.timestampMs) && Number(body.timestampMs) > 0, 'vm-stop-identity-mismatch');
    return body as unknown as VmStoppedReceipt;
  }
}
