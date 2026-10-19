import { createHash } from 'node:crypto';

export const VM_PROTOCOL = 'neko-vm-v1' as const;
export const VM_LIMITS = Object.freeze({ frameBytes: 262144, chunkBytes: 65536, frames: 20000,
  inputBytes: 64 * 1024 * 1024, inputFiles: 4096, outputBytes: 16 * 1024 * 1024,
  outputFiles: 256, logBytes: 1048576, scriptBytes: 65536, timeoutMs: 600000 });
export interface VmScope { protocol: typeof VM_PROTOCOL; actionId: string; nonce: string }
export interface VmFile { path: string; mode: 0o600 | 0o700; bytes: Uint8Array }
export type VmStopReason = 'cancelled' | 'timeout' | 'parent-eof' | 'protocol-error' | 'output-limit' | 'guest-result' | 'transport-error';
export interface VmGuestResult { type: 'result'; exitCode: number | null; signal: number | null; outputs: string[];
  stdoutTruncated: boolean; stderrTruncated: boolean; errorCode: string | null }
export const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
export const isSha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const isActionId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export function vmAssert(value: unknown, code = 'vm-protocol-invalid'): asserts value {
  if (!value) throw new Error(code);
}
export function record(value: unknown): Record<string, unknown> {
  vmAssert(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, expected: string[]): void {
  vmAssert(Object.keys(value).length === expected.length && expected.every(k => Object.hasOwn(value, k)));
}
export function safeVmPath(value: unknown): string {
  vmAssert(typeof value === 'string' && value.length <= 512 && /^[A-Za-z0-9_.+@/-]+$/.test(value)
    && !value.startsWith('/') && value.split('/').every(p => p && p !== '.' && p !== '..'), 'vm-path-invalid');
  return value;
}
export function uniqueVmPaths(values: unknown, max: number): string[] {
  vmAssert(Array.isArray(values) && values.length <= max);
  const result = values.map(safeVmPath), set = new Set(result); vmAssert(set.size === result.length, 'vm-path-collision');
  for (const path of result) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) vmAssert(!set.has(parts.slice(0, i).join('/')), 'vm-path-collision');
  }
  return result;
}
export function base64(value: unknown, max: number, empty = false): Buffer {
  vmAssert(typeof value === 'string' && value.length <= 4 * Math.ceil(max / 3)
    && (empty || value.length > 0) && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value));
  const bytes = Buffer.from(value, 'base64');
  vmAssert(bytes.length <= max && bytes.toString('base64') === value && (empty || bytes.length > 0));
  return bytes;
}
export function checkedScope(value: Record<string, unknown>, scope: VmScope): void {
  vmAssert(value.protocol === scope.protocol && value.actionId === scope.actionId && value.nonce === scope.nonce, 'vm-scope-mismatch');
}
/** Bounded byte framing before UTF-8/JSON decoding. A missing LF cannot grow memory indefinitely. */
export class VmJsonLines {
  private pending = Buffer.alloc(0);
  private count = 0;
  constructor(private readonly accept: (value: Record<string, unknown>) => void, private readonly max = VM_LIMITS.frameBytes) {}
  push(data: Uint8Array): void {
    let offset = 0;
    while (offset < data.length) {
      const newline = data.indexOf(10, offset), end = newline === -1 ? data.length : newline;
      vmAssert(this.pending.length + end - offset <= this.max, 'vm-frame-limit');
      this.pending = Buffer.concat([this.pending, data.subarray(offset, end)]);
      if (newline === -1) return;
      vmAssert(++this.count <= VM_LIMITS.frames && this.pending.length > 0, 'vm-frame-limit');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(this.pending); this.pending = Buffer.alloc(0);
      this.accept(record(JSON.parse(text))); offset = end + 1;
    }
  }
  end(): void { vmAssert(this.pending.length === 0, 'vm-truncated-frame'); }
}
interface PendingFile { path: string; mode: 0o600 | 0o700; size: number; sha256: string; chunks: Buffer[]; length: number }
/** Guest output is an untrusted, bounded proposal. It conveys no host filesystem authority. */
export class VmGuestCapture {
  private ready = false;
  private pending?: PendingFile;
  private readonly outputs = new Map<string, VmFile>();
  private outputBytes = 0;
  private logBytes = 0;
  private readonly out: Buffer[] = [];
  private readonly err: Buffer[] = [];
  result?: VmGuestResult;
  constructor(private readonly scope: VmScope, private readonly allowlist: string[]) { uniqueVmPaths(allowlist, VM_LIMITS.outputFiles); }
  accept(raw: Record<string, unknown>): 'ready' | 'result' | undefined {
    checkedScope(raw, this.scope); vmAssert(!this.result, 'vm-frame-after-result');
    const common = ['protocol', 'actionId', 'nonce', 'type'];
    if (raw.type === 'ready') {
      keys(raw, [...common, 'agentVersion', 'architecture', 'capability']);
      vmAssert(!this.ready && raw.agentVersion === 1 && raw.architecture === 'arm64' && raw.capability === 'linux-shell');
      this.ready = true; return 'ready';
    }
    vmAssert(this.ready, 'vm-guest-not-ready');
    if (raw.type === 'stdout' || raw.type === 'stderr') {
      keys(raw, [...common, 'dataBase64']); const bytes = base64(raw.dataBase64, VM_LIMITS.chunkBytes);
      this.logBytes += bytes.length; vmAssert(this.logBytes <= VM_LIMITS.logBytes, 'vm-output-limit');
      (raw.type === 'stdout' ? this.out : this.err).push(bytes); return;
    }
    if (raw.type === 'output-begin') {
      keys(raw, [...common, 'path', 'mode', 'size', 'sha256']); const path = safeVmPath(raw.path);
      vmAssert(!this.pending && !this.outputs.has(path) && this.allowlist.includes(path) && this.outputs.size < VM_LIMITS.outputFiles);
      vmAssert((raw.mode === 0o600 || raw.mode === 0o700) && Number.isSafeInteger(raw.size) && Number(raw.size) >= 0
        && Number(raw.size) <= VM_LIMITS.outputBytes - this.outputBytes && isSha256(raw.sha256));
      this.pending = { path, mode: raw.mode, size: Number(raw.size), sha256: raw.sha256, chunks: [], length: 0 }; return;
    }
    if (raw.type === 'output-chunk') {
      keys(raw, [...common, 'path', 'offset', 'dataBase64']); const p = this.pending;
      vmAssert(p && raw.path === p.path && raw.offset === p.length); const bytes = base64(raw.dataBase64, VM_LIMITS.chunkBytes);
      vmAssert(p.length + bytes.length <= p.size); p.length += bytes.length; p.chunks.push(bytes); return;
    }
    if (raw.type === 'output-end') {
      keys(raw, [...common, 'path']); const p = this.pending; vmAssert(p && raw.path === p.path && p.length === p.size);
      const bytes = Buffer.concat(p.chunks, p.length); vmAssert(sha256(bytes) === p.sha256, 'vm-output-hash-mismatch');
      this.outputs.set(p.path, { path: p.path, mode: p.mode, bytes }); this.outputBytes += p.length; this.pending = undefined; return;
    }
    vmAssert(raw.type === 'result'); keys(raw, [...common, 'exitCode', 'signal', 'outputs', 'stdoutTruncated', 'stderrTruncated', 'errorCode']);
    vmAssert(!this.pending && (raw.exitCode === null || Number.isInteger(raw.exitCode) && Number(raw.exitCode) >= 0 && Number(raw.exitCode) <= 255)
      && (raw.signal === null || Number.isInteger(raw.signal) && Number(raw.signal) > 0 && Number(raw.signal) <= 64)
      && !(raw.exitCode !== null && raw.signal !== null) && typeof raw.stdoutTruncated === 'boolean' && typeof raw.stderrTruncated === 'boolean'
      && (raw.errorCode === null || ['protocol-error', 'input-error', 'execution-error', 'output-error', 'output-limit', 'timeout', 'cancelled'].includes(String(raw.errorCode))));
    const paths = uniqueVmPaths(raw.outputs, VM_LIMITS.outputFiles);
    vmAssert(paths.length === this.outputs.size && paths.every(p => this.outputs.has(p)), 'vm-output-set-mismatch');
    this.result = { type: 'result', exitCode: raw.exitCode as number | null, signal: raw.signal as number | null, outputs: paths,
      stdoutTruncated: raw.stdoutTruncated, stderrTruncated: raw.stderrTruncated, errorCode: raw.errorCode as string | null };
    return 'result';
  }
  snapshot(): { stdout: string; stderr: string; outputs: VmFile[]; result?: VmGuestResult } {
    return { stdout: Buffer.concat(this.out).toString('utf8'), stderr: Buffer.concat(this.err).toString('utf8'),
      outputs: [...this.outputs.values()].map(f => ({ ...f, bytes: Uint8Array.from(f.bytes) })), result: this.result && structuredClone(this.result) };
  }
}
export function validateVmInput(input: { script: string; files: VmFile[]; outputPaths: string[]; timeoutMs: number }): void {
  vmAssert(typeof input.script === 'string' && !input.script.includes('\0') && Buffer.byteLength(input.script) <= VM_LIMITS.scriptBytes
    && Number.isSafeInteger(input.timeoutMs) && input.timeoutMs > 0 && input.timeoutMs <= VM_LIMITS.timeoutMs, 'vm-input-invalid');
  vmAssert(Array.isArray(input.files) && input.files.length <= VM_LIMITS.inputFiles); uniqueVmPaths(input.files.map(f => f.path), VM_LIMITS.inputFiles);
  let size = 0;
  for (const file of input.files) { vmAssert((file.mode === 0o600 || file.mode === 0o700) && file.bytes instanceof Uint8Array); size += file.bytes.length; }
  vmAssert(size <= VM_LIMITS.inputBytes, 'vm-input-limit'); uniqueVmPaths(input.outputPaths, VM_LIMITS.outputFiles);
}
