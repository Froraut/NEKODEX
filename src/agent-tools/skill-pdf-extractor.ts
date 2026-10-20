import type { PinnedSkillPdfHelper } from "./skill-pdf-helper-path";
export interface SkillPdfExtractorIdentity { provider: "macos-pdfkit"; version: 1; executableSha256?: string; sourceSha256?: string }
export interface SkillPdfOwnerReceipt { supervisor: { pid: number; start: string }; child: { pid: number; start: string } | null; sealed: boolean; reaped: boolean; reason: string | null }
export interface SkillPdfExtractionResult {
  state: "completed" | "failed" | "unknown" | "unavailable"; text?: string;
  sourceSha256: string; sourceBytes: number; pageCount?: number; pagesWithText?: number; pagesWithoutText?: number;
  coverage: "text-layer-only"; reason?: string; extractor: SkillPdfExtractorIdentity; owner?: SkillPdfOwnerReceipt;
}
export interface SkillPdfExtractorPort {
  capabilities(): { supported: boolean; provider: "macos-pdfkit"; recoveryRequired: boolean; reason?: string; extractor: SkillPdfExtractorIdentity; [key: string]: unknown };
  extract(input: { operationId: string; bytes: Uint8Array; sha256: string; signal?: AbortSignal }): Promise<SkillPdfExtractionResult>;
  cancel(operationId: string): void; reconcile(operationId: string): SkillPdfExtractionResult | undefined; close(): Promise<void>;
}
export interface SkillPdfExtractorOptions { home: string; bunPath: string; bunSha256: string; helper?: PinnedSkillPdfHelper }

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync, fsyncSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { assertPinnedSkillPdfHelper, assertPinnedSkillPdfHelperMetadata } from "./skill-pdf-helper-path";
import { assertPinnedBun, scriptPath } from "./skill-script-sandbox";
import { SKILL_PDF_SUPERVISOR } from "./skill-pdf-supervisor";
const MAX_PDF = 2 * 1024 * 1024, MAX_TEXT = 32 * 1024;
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const operation = (value: string) => { if (typeof value !== "string" || !value || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("Invalid PDF operation identity"); return value; };
const identity = (owner: unknown): owner is { pid: number; start: string } => Boolean(owner && typeof owner === "object" && Number.isSafeInteger((owner as { pid: number }).pid) && (owner as { pid: number }).pid > 0 && /^\d+:\d+$/.test((owner as { start: string }).start));
function privateJson(file: string): any {
  const parent = lstatSync(dirname(file));
  if (!parent.isDirectory() || realpathSync(dirname(file)) !== dirname(file) || parent.uid !== process.getuid?.() || (parent.mode & 0o077)) throw new Error("PDF owner directory is unsafe");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = fstatSync(fd); if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.size > 512 * 1024) throw new Error("PDF receipt is unsafe"); return JSON.parse(readFileSync(fd).toString("utf8")); }
  finally { closeSync(fd); }
}
export interface SkillPdfSandbox { profile: string; boundary: { provider: "macos-seatbelt"; network: "deny"; processFork: "deny"; processExec: "deny"; input: string; scratch: string; systemReadRoots: string[]; ancestorDirectoryReads: string[]; metadata: "scoped" }; assertCurrent(): void }
/** Trusted owner helper only; none of these paths/profile strings are model inputs. */
export function buildSkillPdfSandbox(input: { helper: PinnedSkillPdfHelper; input: string; scratch: string }): SkillPdfSandbox {
  if (process.platform !== "darwin") throw new Error("PDF extraction requires macOS");
  assertPinnedSkillPdfHelper(input.helper);
  const capture = (file: string, directory: boolean) => { scriptPath(file); const stat = lstatSync(file); if (realpathSync(file) !== file || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error("PDF parser path must be canonical"); return { file, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, directory }; };
  const captured = [capture(input.input, false), capture(input.scratch, true)];
  if (lstatSync(input.input).uid !== process.getuid?.() || (lstatSync(input.input).mode & 0o777) !== 0o400 || lstatSync(input.input).size > MAX_PDF
    || lstatSync(input.scratch).uid !== process.getuid?.() || (lstatSync(input.scratch).mode & 0o077)) throw new Error("PDF parser input/scratch must be private owned files");
  const systemReadRoots = ["/System/Library", "/usr/lib", "/System/Volumes/Preboot/Cryptexes/OS/System/Library", "/System/Volumes/Preboot/Cryptexes/OS/usr/lib", "/System/Cryptexes/OS/System/Library", "/System/Cryptexes/OS/usr/lib"].filter(existsSync);
  const parents = new Set<string>();
  for (const target of [input.input, input.scratch, input.helper.executable, ...systemReadRoots]) {
    for (let path = dirname(target); ; path = dirname(path)) { parents.add(path); if (dirname(path) === path) break; }
  }
  const quote = (value: string) => { scriptPath(value); return `"${value}"`; };
  const literal = (value: string) => `(literal ${quote(value)})`, subpath = (value: string) => `(subpath ${quote(value)})`;
  const readRoots = [...systemReadRoots, input.scratch];
  const files = [input.input, input.helper.executable, "/dev/null", "/dev/random", "/dev/urandom", ...parents];
  const profile = `(version 1)\n(deny default)\n(deny process-fork)\n(deny process-exec)\n(allow signal (target self))\n(allow sysctl-read (sysctl-name-prefix "hw.") (sysctl-name "kern.osrelease") (sysctl-name "kern.osversion") (sysctl-name "kern.ostype") (sysctl-name "vm.pagesize") (sysctl-name "sysctl.proc_translated"))\n(allow file-read-metadata ${readRoots.map(subpath).join(" ")} ${files.map(literal).join(" ")})\n(allow file-read-data ${readRoots.map(subpath).join(" ")} ${files.map(literal).join(" ")})\n(allow file-map-executable ${systemReadRoots.map(subpath).join(" ")} ${literal(input.helper.executable)})\n(allow file-write* ${subpath(input.scratch)})\n(allow file-write-data (literal "/dev/null"))\n`;
  return { profile, boundary: { provider: "macos-seatbelt", network: "deny", processFork: "deny", processExec: "deny", input: input.input, scratch: input.scratch, systemReadRoots, ancestorDirectoryReads: [...parents], metadata: "scoped" },
    assertCurrent() { assertPinnedSkillPdfHelper(input.helper); for (const old of captured) { const now = capture(old.file, old.directory); if (now.dev !== old.dev || now.ino !== old.ino || !old.directory && (now.size !== old.size || now.mtimeMs !== old.mtimeMs || now.ctimeMs !== old.ctimeMs)) throw new Error("PDF parser boundary changed"); } } };
}
interface PdfRun { child?: ChildProcess; promise: Promise<SkillPdfExtractionResult>; cancelled: boolean }
export class SkillPdfExtractor implements SkillPdfExtractorPort {
  private readonly runs = new Map<string, PdfRun>(); private readonly unresolved = new Map<string, SkillPdfOwnerReceipt | null>(); private closed = false; private closing?: Promise<void>;
  private bunMetadata?: string;
  constructor(private readonly options: SkillPdfExtractorOptions) { if (!isAbsolute(options.home) || realpathSync(options.home) !== options.home) throw new Error("PDF owner home must be canonical"); }
  private get extractor(): SkillPdfExtractorIdentity { const helper = this.options.helper; return { provider: "macos-pdfkit", version: 1, ...(helper ? { executableSha256: helper.executableSha256, sourceSha256: helper.sourceSha256 } : {}) }; }
  private root(id: string): string { return join(this.options.home, "skill-pdf-runs", hash(operation(id))); }
  private retained(): void {
    this.unresolved.clear(); const base = join(this.options.home, "skill-pdf-runs"); if (!existsSync(base)) return;
    try {
      const stat = lstatSync(base); if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || realpathSync(base) !== base) throw new Error();
      const entries = readdirSync(base); if (entries.length > 256) throw new Error();
      const { dlopen, ptr } = require("bun:ffi") as typeof import("bun:ffi");
      const proc = dlopen("/usr/lib/libproc.dylib", { proc_pidinfo: { args: ["i32", "i32", "u64", "ptr", "i32"], returns: "i32" } });
      try {
        for (const name of entries) {
          if ([...this.runs.keys()].some(id => hash(id) === name)) continue;
          const key = `retained:${name}`;
          try {
            if (!/^[a-f0-9]{64}$/.test(name)) throw new Error();
            const value = privateJson(join(base, name, "receipt.json"));
            if (typeof value.operationId !== "string" || hash(value.operationId) !== name || !identity(value.owner?.supervisor) || value.owner.child !== null && !identity(value.owner.child) || typeof value.owner.reaped !== "boolean") throw new Error();
            if (value.owner.reaped) continue;
            const child = value.owner.child ?? value.owner.supervisor, bytes = Buffer.alloc(136);
            if (proc.symbols.proc_pidinfo(child.pid, 3, 0, ptr(bytes), bytes.length) === bytes.length) {
              if (`${bytes.readBigUInt64LE(120)}:${bytes.readBigUInt64LE(128)}` === child.start) this.unresolved.set(value.operationId, value.owner);
            } else { try { process.kill(child.pid, 0); this.unresolved.set(value.operationId, value.owner); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") this.unresolved.set(value.operationId, value.owner); } }
          } catch { this.unresolved.set(key, null); }
        }
      } finally { proc.close(); }
    } catch { this.unresolved.set("retained:unverified-storage", null); }
  }
  get activeCount(): number { return Math.max(this.runs.size, this.unresolved.size); }
  private assertRuntimeStatus(): void {
    const file = this.options.bunPath, st = lstatSync(file, { bigint: true });
    if (!st.isFile() || st.isSymbolicLink() || realpathSync(file) !== file) throw new Error("PDF runtime metadata changed");
    const metadata = [st.dev, st.ino, st.size, st.mode, st.mtimeNs, st.ctimeNs].join(":");
    if (!this.bunMetadata) { assertPinnedBun(file, this.options.bunSha256); this.bunMetadata = metadata; }
    else if (metadata !== this.bunMetadata) throw new Error("PDF runtime metadata changed");
  }
  capabilities() {
    this.retained(); let reason: string | undefined;
    try { if (process.platform !== "darwin") throw new Error(); this.assertRuntimeStatus(); if (!this.options.helper) throw new Error(); assertPinnedSkillPdfHelperMetadata(this.options.helper); }
    catch { reason = "Pinned macOS PDF helper/runtime is unavailable"; }
    if (this.unresolved.size) reason = "Retained PDF parser owner requires reconciliation";
    if (this.closed) reason = "PDF parser owner is closed";
    return { supported: !reason, provider: "macos-pdfkit" as const, recoveryRequired: this.unresolved.size > 0, ...(reason ? { reason } : {}), extractor: this.extractor,
      activeCount: this.activeCount, limits: { sourceBytes: MAX_PDF, pages: 32, textBytes: MAX_TEXT, timeoutMs: 15000, outputBytes: 256 * 1024, concurrent: 2, retained: 256, observedResidentBytes: 256 * 1024 * 1024 }, coverage: "text-layer-only" };
  }
  private project(value: any): SkillPdfExtractionResult {
    if (!/^[a-f0-9]{64}$/.test(value.sourceSha256) || !Number.isSafeInteger(value.sourceBytes) || value.sourceBytes < 0 || value.sourceBytes > MAX_PDF
      || !identity(value.owner?.supervisor) || value.owner.child !== null && !identity(value.owner.child) || typeof value.owner.sealed !== "boolean" || typeof value.owner.reaped !== "boolean"
      || value.extractor?.provider !== "macos-pdfkit" || value.extractor.version !== 1 || !/^[a-f0-9]{64}$/.test(value.extractor.executableSha256) || !/^[a-f0-9]{64}$/.test(value.extractor.sourceSha256)) throw new Error("PDF receipt identity unavailable");
    const base = { sourceSha256: value.sourceSha256, sourceBytes: value.sourceBytes, coverage: "text-layer-only" as const, extractor: value.extractor as SkillPdfExtractorIdentity, owner: value.owner as SkillPdfOwnerReceipt };
    if (!value.owner.reaped) return { ...base, state: "unknown", reason: "parser_owner_unsettled" };
    if (value.state !== "completed" || !value.owner.sealed || value.exitCode !== 0 || value.truncated) return { ...base, state: "failed", reason: value.owner.reason || "parser_failed" };
    try {
      const parsed = JSON.parse(value.stdout);
      if (parsed.provider !== "macos-pdfkit" || parsed.version !== 1 || parsed.helperSourceSha256 !== value.extractor.sourceSha256 || parsed.sourceSha256 !== value.sourceSha256 || parsed.sourceBytes !== value.sourceBytes || parsed.coverage !== "text-layer-only") throw new Error();
      const pages = Number.isSafeInteger(parsed.pageCount) && parsed.pageCount > 0 && parsed.pageCount <= 1_000_000 && Number.isSafeInteger(parsed.pagesWithText) && parsed.pagesWithText >= 0 && Number.isSafeInteger(parsed.pagesWithoutText) && parsed.pagesWithoutText >= 0 && parsed.pagesWithText + parsed.pagesWithoutText === parsed.pageCount
        ? { pageCount: parsed.pageCount, pagesWithText: parsed.pagesWithText, pagesWithoutText: parsed.pagesWithoutText } : {};
      if (parsed.state === "unavailable" && typeof parsed.reason === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(parsed.reason)) return { ...base, ...pages, state: "unavailable", reason: parsed.reason };
      if (parsed.state !== "completed" || !pages.pageCount || pages.pageCount > 32 || pages.pagesWithText! < 1 || typeof parsed.text !== "string" || !parsed.text.trim() || parsed.text.includes("\0") || Buffer.byteLength(parsed.text) > MAX_TEXT || Buffer.from(parsed.text).toString("utf8") !== parsed.text) throw new Error();
      return { ...base, ...pages, state: "completed", text: parsed.text, ...(pages.pagesWithoutText ? { reason: "nontext_pages_not_extracted" } : {}) };
    } catch { return { ...base, state: "failed", reason: "invalid_parser_receipt" }; }
  }
  reconcile(id: string): SkillPdfExtractionResult | undefined { operation(id); const file = join(this.root(id), "receipt.json"); if (!existsSync(file)) return undefined; try { const value = privateJson(file); if (value.operationId !== id) return undefined; return this.project(value); } catch { return undefined; } }
  cancel(id: string): void { operation(id); const run = this.runs.get(id); if (run) { run.cancelled = true; try { run.child?.stdin?.write("cancel\n"); } catch {} } }
  extract(input: { operationId: string; bytes: Uint8Array; sha256: string; signal?: AbortSignal }): Promise<SkillPdfExtractionResult> {
    operation(input.operationId); const bytes = Uint8Array.from(input.bytes), sourceSha256 = hash(bytes), base = { sourceSha256, sourceBytes: bytes.length, coverage: "text-layer-only" as const, extractor: this.extractor };
    if (bytes.length > MAX_PDF || !bytes.length) return Promise.resolve({ ...base, state: "unavailable", reason: "source_size_limit" });
    if (input.sha256 !== sourceSha256) return Promise.resolve({ ...base, state: "failed", reason: "source_identity_mismatch" });
    if (this.runs.has(input.operationId)) return Promise.reject(new Error("PDF operation is already owned; inspect its exact receipt"));
    const existing = this.reconcile(input.operationId);
    if (existing) return Promise.resolve(existing.sourceSha256 === sourceSha256 && existing.sourceBytes === bytes.length ? existing : { ...base, state: "failed", reason: "operation_identity_conflict" });
    if (existsSync(this.root(input.operationId))) return Promise.resolve({ ...base, state: "unknown", reason: "retained_owner_receipt_unavailable" });
    const capability = this.capabilities();
    if (!capability.supported || this.runs.size >= 2) return Promise.resolve({ ...base, state: "unavailable", reason: capability.recoveryRequired ? "retained_owner_recovery_required" : "extractor_unavailable" });
    const run: PdfRun = { cancelled: false, promise: Promise.resolve(undefined as never) };
    this.runs.set(input.operationId, run);
    run.promise = this.perform({ ...input, bytes, sha256: sourceSha256 }, run).finally(() => { this.runs.delete(input.operationId); });
    return run.promise;
  }
  private async perform(input: { operationId: string; bytes: Uint8Array; sha256: string; signal?: AbortSignal }, run: PdfRun): Promise<SkillPdfExtractionResult> {
    const base: Omit<SkillPdfExtractionResult, "state"> = { sourceSha256: input.sha256, sourceBytes: input.bytes.length, coverage: "text-layer-only", extractor: this.extractor };
    let dispatched = false;
    try {
      if (input.signal?.aborted || run.cancelled) return { ...base, state: "failed", reason: "cancelled_before_dispatch" };
      const helper = this.options.helper!; assertPinnedBun(this.options.bunPath, this.options.bunSha256); assertPinnedSkillPdfHelper(helper);
      const directory = join(this.options.home, "skill-pdf-runs"); mkdirSync(directory, { recursive: true, mode: 0o700 });
      const parent = lstatSync(directory); if (realpathSync(directory) !== directory || parent.uid !== process.getuid?.() || (parent.mode & 0o077) || readdirSync(directory).length >= 256) throw new Error("PDF retained owner storage unavailable");
      const root = this.root(input.operationId); mkdirSync(root, { mode: 0o700 });
      const scratch = join(root, "scratch"), home = join(scratch, "home"), tmp = join(scratch, "tmp");
      for (const folder of [scratch, home, tmp]) mkdirSync(folder, { mode: 0o700 });
      const write = (file: string, bytes: string | Uint8Array) => { const fd = openSync(file, "wx", 0o400); try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); } };
      const source = join(root, "input.pdf"); write(source, input.bytes); const sourceStat = lstatSync(source, { bigint: true });
      const sandbox = buildSkillPdfSandbox({ helper, input: source, scratch });
      const profile = join(root, "profile.sb"), supervisor = join(root, "supervisor.mjs"), config = join(root, "supervisor.json"), bunfig = join(root, "bunfig.toml"), launchPermit = join(root, "launch-permit");
      write(profile, sandbox.profile); write(supervisor, SKILL_PDF_SUPERVISOR); write(bunfig, '[install]\nauto = "disable"\n');
      const env = { HOME: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp, PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
      write(config, JSON.stringify({ root, scratch, launchPermit, operationId: input.operationId, input: source, inputDev: String(sourceStat.dev), inputIno: String(sourceStat.ino), sourceSha256: input.sha256, sourceBytes: input.bytes.length,
        receipt: join(root, "receipt.json"), helper: helper.executable, profile, extractor: this.extractor, supervisorSha256: hash(SKILL_PDF_SUPERVISOR), env }));
      sandbox.assertCurrent(); assertPinnedBun(this.options.bunPath, this.options.bunSha256);
      if (input.signal?.aborted || run.cancelled) return { ...base, state: "failed", reason: "cancelled_before_dispatch" };
      const child = spawn(this.options.bunPath, ["--no-install", "--no-env-file", `--config=${bunfig}`, supervisor, config], { cwd: root, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
      run.child = child; dispatched = true;
      const abort = () => this.cancel(input.operationId); input.signal?.addEventListener("abort", abort, { once: true });
      try {
        return await new Promise(resolve => {
          child.stdout?.resume(); child.stderr?.resume();
          child.once("error", () => { this.unresolved.set(input.operationId, null); resolve({ ...base, state: "unknown", reason: "supervisor_spawn_outcome_unknown" }); });
          child.once("close", () => { const receipt = this.reconcile(input.operationId); if (!receipt || !receipt.owner?.reaped) this.unresolved.set(input.operationId, receipt?.owner ?? null); resolve(receipt ?? { ...base, state: "unknown", reason: "supervisor_receipt_unavailable" }); });
        });
      } finally { input.signal?.removeEventListener("abort", abort); }
    } catch { return { ...base, state: dispatched ? "unknown" : "failed", reason: dispatched ? "parser_outcome_unknown" : "parser_preflight_failed" }; }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing; this.closed = true;
    this.closing = (async () => { for (const id of this.runs.keys()) this.cancel(id); await Promise.allSettled([...this.runs.values()].map(run => run.promise)); this.retained(); if (this.unresolved.size) throw new Error("PDF parser physical owner requires reconciliation"); })().catch(reason => { this.closing = undefined; throw reason; });
    return this.closing;
  }
}
