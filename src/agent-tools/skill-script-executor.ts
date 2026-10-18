import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import type { ToolScope } from "./types";
import type { SandboxRootGrant } from "./sandbox";
import { assertPinnedBun, buildSkillScriptSandbox, scriptPath, type SkillScriptBoundary } from "./skill-script-sandbox";
import { SKILL_SCRIPT_BOOTSTRAP, SKILL_SCRIPT_SUPERVISOR } from "./skill-script-supervisor";
import { assertAdmittedPythonRuntime, pythonRuntimeStatus, SKILL_PYTHON_BOOTSTRAP, SKILL_PYTHON_BOOTSTRAP_SHA256, type AdmittedPythonRuntime } from "./skill-python-runtime";

export interface SkillScriptOwnerReceipt {
  supervisor: { pid: number; start: string }; child: { pid: number; start: string } | null;
  sealed: boolean; reaped: boolean; reason: string | null;
}
export interface SkillScriptResult {
  state: "completed" | "failed" | "unknown"; stdout: string; stderr: string;
  exitCode: number | null; truncated: boolean; owner?: SkillScriptOwnerReceipt;
  boundary?: SkillScriptBoundary; reason?: string;
}
export interface SkillScriptExecution {
  /** Chosen by the resource owner from verified media type, never script text/shebang. */
  runtime?: "javascript" | "python";
  scope: ToolScope; operationId: string; entryRelativePath: string;
  /** Entire immutable reviewed closure, including the entry point. No disk path resolution. */
  resources: { relativePath: string; bytes: Uint8Array }[];
  argv?: string[]; readRoots: SandboxRootGrant[]; writeRoots: SandboxRootGrant[];
  cwd?: string; timeoutMs?: number; maxOutputBytes?: number; signal?: AbortSignal;
  /** Trusted current attachment/generation/revocation check, repeated immediately before spawn. */
  assertCurrent?: () => void;
}
interface LiveRun { child?: ChildProcess; promise: Promise<SkillScriptResult>; cancelRequested: boolean }
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const safeRelative = (value: string) => typeof value === "string" && value.length <= 512 && /^[a-zA-Z0-9_./-]+$/.test(value)
  && !value.startsWith("/") && value.split("/").every(x => x && x !== "." && x !== "..") && posix.normalize(value) === value;
/** Trusted leaf only. ToolJournal owns admission, approvals, deduplication and final tool receipts. */
export class SkillScriptExecutor {
  private readonly runs = new Map<string, LiveRun>();
  private closing?: Promise<void>;
  private closed = false;
  private readonly unresolved = new Map<string, SkillScriptOwnerReceipt | null>();
  constructor(private readonly options: { bunPath: string; bunSha256: string; home: string; pythonRuntime?: AdmittedPythonRuntime }) {}
  private refreshRetainedOwners(): void {
    this.unresolved.clear();
    const base = join(this.options.home, "skill-script-runs");
    if (!existsSync(base)) return;
    try {
      const baseStat = lstatSync(base);
      if (!baseStat.isDirectory() || realpathSync(base) !== base || baseStat.uid !== process.getuid?.() || (baseStat.mode & 0o077)) throw new Error("Unsafe owner storage");
      const entries = readdirSync(base);
      if (entries.length > 256) throw new Error("Retained owner enumeration bound exceeded");
      const { dlopen, ptr } = require("bun:ffi") as typeof import("bun:ffi");
      const proc = dlopen("/usr/lib/libproc.dylib", { proc_pidinfo: { args: ["i32", "i32", "u64", "ptr", "i32"], returns: "i32" } });
      try {
        for (const name of entries) {
          const key = `retained:${name}`;
          if (!/^[a-f0-9]{64}$/.test(name)) { this.unresolved.set(key, null); continue; }
          // Current live owners already have a supervised control pipe. They are not orphans.
          if ([...this.runs.keys()].some(id => digest(id) === name)) continue;
          const root = join(base, name), receiptPath = join(root, "receipt.json");
          try {
            const stat = lstatSync(root);
            if (!stat.isDirectory() || realpathSync(root) !== root || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error("Unsafe retained owner");
            const fd = openSync(receiptPath, constants.O_RDONLY | constants.O_NOFOLLOW);
            let value: { operationId?: unknown };
            try {
              const receiptStat = fstatSync(fd);
              if (!receiptStat.isFile() || receiptStat.size > 256 * 1024 || receiptStat.uid !== process.getuid?.() || (receiptStat.mode & 0o077)) throw new Error("Unsafe retained receipt");
              value = JSON.parse(readFileSync(fd).toString());
            } finally { closeSync(fd); }
            if (typeof value.operationId !== "string" || digest(value.operationId) !== name) throw new Error("Retained receipt identity mismatch");
            const receipt = this.reconcile(value.operationId);
            if (!receipt?.owner) throw new Error("Retained owner receipt invalid");
            if (receipt.owner.reaped) { this.unresolved.delete(value.operationId); continue; }
            const child = receipt.owner.child;
            if (!child) { this.unresolved.set(value.operationId, receipt.owner); continue; }
            const bytes = Buffer.alloc(136);
            const count = proc.symbols.proc_pidinfo(child.pid, 3, 0, ptr(bytes), bytes.length);
            if (count === bytes.length) {
              if (`${bytes.readBigUInt64LE(120)}:${bytes.readBigUInt64LE(128)}` === child.start) this.unresolved.set(value.operationId, receipt.owner);
              else this.unresolved.delete(value.operationId);
            } else {
              try { process.kill(child.pid, 0); this.unresolved.set(value.operationId, receipt.owner); }
              catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") this.unresolved.delete(value.operationId); else this.unresolved.set(value.operationId, receipt.owner); }
            }
          } catch { this.unresolved.set(key, null); }
        }
      } finally { proc.close(); }
    } catch { this.unresolved.set("retained:unreadable-storage", null); }
  }
  capabilities(): { supported: boolean; available: boolean; platform: string; provider: string; limitation: string; recoveryRequired: boolean; unresolvedOwnerCount: number;
    runtimes: { javascript: { supported: boolean; reason?: string }; python: ReturnType<typeof pythonRuntimeStatus> } } {
    this.refreshRetainedOwners();
    let available = process.platform === "darwin";
    try { assertPinnedBun(this.options.bunPath, this.options.bunSha256); } catch { available = false; }
    const supported = available && !this.unresolved.size && !this.closed;
    const python = pythonRuntimeStatus(this.options.pythonRuntime);
    return { supported, available, platform: process.platform, provider: "macos-seatbelt", recoveryRequired: this.unresolved.size > 0, unresolvedOwnerCount: this.unresolved.size,
      runtimes: { javascript: { supported }, python: { ...python, supported: supported && python.supported } },
      limitation: "Deprecated Seatbelt; supervisor SIGKILL/host loss is unknown, not a universal descendant-cleanup guarantee" };
  }
  private root(operationId: string): string { return join(this.options.home, "skill-script-runs", digest(operationId)); }
  reconcile(operationId: string): SkillScriptResult | undefined {
    const receipt = join(this.root(operationId), "receipt.json");
    if (!existsSync(receipt)) return undefined;
    try {
      const parent = dirname(receipt), parentStat = lstatSync(parent);
      if (!parentStat.isDirectory() || realpathSync(parent) !== parent || parentStat.uid !== process.getuid?.() || (parentStat.mode & 0o077)) return undefined;
      const fd = openSync(receipt, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Buffer;
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > 256 * 1024 || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) return undefined;
        bytes = readFileSync(fd);
      } finally { closeSync(fd); }
      const value = JSON.parse(bytes.toString());
      if (value.operationId !== operationId || !["completed", "failed", "unknown"].includes(value.state)) return undefined;
      const owner = value.owner;
      const validIdentity = (id: unknown): boolean => !!id && typeof id === "object" && Number.isSafeInteger((id as { pid: number }).pid)
        && (id as { pid: number }).pid > 0 && /^\d+:\d+$/.test((id as { start: string }).start);
      if (!owner || !validIdentity(owner.supervisor) || (owner.child !== null && !validIdentity(owner.child))
        || typeof owner.sealed !== "boolean" || typeof owner.reaped !== "boolean") return undefined;
      if (value.state === "completed" && (!owner.sealed || !owner.reaped || value.exitCode !== 0)) return undefined;
      if (value.state === "unknown" && value.owner && !value.owner.reaped) this.unresolved.set(operationId, value.owner);
      else this.unresolved.delete(operationId);
      return { ...value, stdout: value.stdout ?? "", stderr: value.stderr ?? "", exitCode: value.exitCode ?? null, truncated: value.truncated ?? false };
    } catch { return undefined; }
  }
  cancel(operationId: string): void {
    const run = this.runs.get(operationId); if (!run) return;
    run.cancelRequested = true;
    try { run.child?.stdin?.write("cancel\n"); } catch { /* terminal/unknown is settled by the process observer */ }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {
      for (const id of this.runs.keys()) this.cancel(id);
      await Promise.allSettled([...this.runs.values()].map(x => x.promise));
      this.refreshRetainedOwners();
      if (this.unresolved.size) throw new Error("Script child still alive or ownership unresolved; exact-owner recovery required");
    })().catch(error => { this.closing = undefined; throw error; });
    return this.closing;
  }
  execute(input: SkillScriptExecution): Promise<SkillScriptResult> {
    if (this.closed) return Promise.reject(new Error("Script executor is closed"));
    this.refreshRetainedOwners();
    if (this.unresolved.size) return Promise.reject(new Error("Retained script owner requires recovery before new execution"));
    if (this.runs.has(input.operationId)) return Promise.reject(new Error("Script operation already owned; reconcile through ToolJournal"));
    if (this.runs.size >= 2) return Promise.reject(new Error("Concurrent script owner limit reached"));
    const run: LiveRun = { promise: Promise.resolve(undefined as never), cancelRequested: false };
    this.runs.set(input.operationId, run);
    run.promise = this.perform(input, run).finally(() => { this.runs.delete(input.operationId); });
    return run.promise;
  }
  private async perform(input: SkillScriptExecution, run: LiveRun): Promise<SkillScriptResult> {
    let dispatched = false;
    let boundary: SkillScriptBoundary | undefined;
    const failed = (reason: string): SkillScriptResult => ({ state: dispatched ? "unknown" : "failed", stdout: "", stderr: "", exitCode: null, truncated: false, boundary, reason });
    try {
      if (process.platform !== "darwin") throw new Error("Skill scripts require macOS");
      if (!input.scope || !input.scope.taskId || !input.scope.toolCallId || !Number.isSafeInteger(input.scope.generation) || input.scope.generation < 1
        || typeof input.operationId !== "string" || input.operationId.length < 1 || input.operationId.length > 512) throw new Error("Invalid script operation scope");
      const runtime = input.runtime ?? "javascript";
      if (!["javascript", "python"].includes(runtime) || !safeRelative(input.entryRelativePath) || !(runtime === "python" ? /\.py$/ : /\.(m?js)$/).test(input.entryRelativePath)) throw new Error("Script entry must match its selected admitted runtime");
      const python = runtime === "python" ? this.options.pythonRuntime : undefined;
      if (runtime === "python" && !pythonRuntimeStatus(python).supported) throw new Error("Selected Python runtime is unavailable");
      const argv = input.argv ?? [], timeoutMs = input.timeoutMs ?? 15_000, maxOutputBytes = input.maxOutputBytes ?? 16_384;
      if (argv.length > 32 || argv.some(x => typeof x !== "string" || x.length > 4096 || x.includes("\0"))
        || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 || !Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 16_384) throw new Error("Script execution bounds exceeded");
      if (!Array.isArray(input.resources) || input.resources.length < 1 || input.resources.length > 32) throw new Error("Invalid reviewed script closure");
      let total = 0; const paths = new Set<string>();
      for (const item of input.resources) {
        if (!safeRelative(item.relativePath) || paths.has(item.relativePath) || !(item.bytes instanceof Uint8Array)
          || /(^|\/)(package\.json|bunfig\.toml|\.env(?:\..*)?)$/.test(item.relativePath)) throw new Error("Invalid reviewed script resource");
        paths.add(item.relativePath); total += item.bytes.length;
      }
      const closureLimit = input.resources.some(item => /^(?:assets|references)\/.+\.pdf$/i.test(item.relativePath)) ? 4 * 1024 * 1024 : 512 * 1024;
      if (!paths.has(input.entryRelativePath) || total > closureLimit) throw new Error("Reviewed script closure missing entry or exceeds bounds");
      input.assertCurrent?.();
      if (input.signal?.aborted || run.cancelRequested) return failed("cancelled-before-dispatch");
      assertPinnedBun(this.options.bunPath, this.options.bunSha256);
      scriptPath(this.options.home);
      if (realpathSync(this.options.home) !== this.options.home) throw new Error("Executor home must be canonical");
      const base = join(this.options.home, "skill-script-runs");
      mkdirSync(base, { recursive: true, mode: 0o700 });
      const st = lstatSync(base);
      if (!st.isDirectory() || realpathSync(base) !== base || st.uid !== process.getuid?.() || (st.mode & 0o077)) throw new Error("Executor storage must be private");
      const root = this.root(input.operationId);
      if (existsSync(root)) return this.reconcile(input.operationId) ?? { ...failed("Retained operation exists; outcome unknown, never replay"), state: "unknown" };
      if (readdirSync(base).length >= 256) throw new Error("Retained script owner capacity reached; explicit retention cleanup required");
      mkdirSync(root, { mode: 0o700 });
      const code = join(root, "code"), scratch = join(root, "scratch"), home = join(scratch, "home"), tmp = join(scratch, "tmp");
      for (const dir of [code, scratch, home, tmp]) mkdirSync(dir, { mode: 0o700 });
      const fixed = join(code, "__trusted"); mkdirSync(fixed, { mode: 0o700 });
      for (const item of input.resources) {
        if (item.relativePath.startsWith("__trusted/")) throw new Error("Reserved script resource path");
        const path = join(code, item.relativePath); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        writeFileSync(path, item.bytes, { flag: "wx", mode: 0o400 });
      }
      const sandbox = buildSkillScriptSandbox({ bunPath: this.options.bunPath, bunSha256: this.options.bunSha256, codeRoot: code, scratch, ...(python ? { pythonRuntime: python } : {}),
        readRoots: input.readRoots, writeRoots: input.writeRoots }); boundary = sandbox.boundary;
      const cwd = input.cwd ?? code;
      if (cwd !== code && ![...input.readRoots, ...input.writeRoots].some(x => x.path === cwd)) throw new Error("Script cwd must be exact reviewed root");
      const launchPermit = join(root, "launch-permit");
      const bunfig = join(fixed, "bunfig.toml"), bootstrap = join(fixed, python ? "bootstrap.py" : "bootstrap.mjs"), childConfig = join(fixed, "child.json"), supervisor = join(fixed, "supervisor.mjs"), config = join(fixed, "supervisor.json");
      const write = (path: string, data: string) => writeFileSync(path, data, { flag: "wx", mode: 0o400 });
      write(bunfig, "[install]\nauto = \"disable\"\n"); write(bootstrap, python ? SKILL_PYTHON_BOOTSTRAP : SKILL_SCRIPT_BOOTSTRAP); write(supervisor, SKILL_SCRIPT_SUPERVISOR);
      write(childConfig, JSON.stringify({ profile: sandbox.profile, launchPermit, entry: join(code, input.entryRelativePath), argv,
        ...(python ? { executable: python.executable, basePrefix: python.basePrefix, stdlibRoot: python.stdlibRoot, stdlibZip: join(python.basePrefix, "lib/python39.zip"), codeRoot: code,
          entryDigest: digest(input.resources.find(item => item.relativePath === input.entryRelativePath)!.bytes) } : {}) }));
      const env = { HOME: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp, PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
      const executionIdentity = input.resources.map(x => ({ path: x.relativePath, sha256: digest(x.bytes) }));
      write(config, JSON.stringify({ root, launchPermit, operationId: input.operationId, scope: input.scope,
        executionDigest: digest(JSON.stringify(python ? { resources: executionIdentity, runtime: { executable: python.executable, executableSha256: python.executableSha256, closureDigest: python.closureDigest }, bootstrapSha256: SKILL_PYTHON_BOOTSTRAP_SHA256 } : executionIdentity)),
        receipt: join(root, "receipt.json"), bunPath: this.options.bunPath, bunfig, bootstrap, childConfig, cwd, env, timeoutMs, maxOutputBytes,
        ...(python ? { runtime: "python", pythonExecutable: python.executable, pythonExecutableSha256: python.executableSha256, pythonClosureDigest: python.closureDigest, bootstrapSha256: SKILL_PYTHON_BOOTSTRAP_SHA256 } : {}) }));
      // Seatbelt additionally protects staged bytes even from chmod/native syscalls in selected code.
      const sealDirectory = (path: string) => chmodSync(path, 0o500);
      for (const item of input.resources) { for (let path = dirname(join(code, item.relativePath)); path !== code; path = dirname(path)) sealDirectory(path); }
      sealDirectory(fixed); sealDirectory(code);
      if (python) {
        assertAdmittedPythonRuntime(python);
        if (digest(readFileSync(bootstrap)) !== SKILL_PYTHON_BOOTSTRAP_SHA256) throw new Error("Trusted Python bootstrap changed before dispatch");
      }
      sandbox.assertCurrent(); input.assertCurrent?.();
      if (input.signal?.aborted || run.cancelRequested) return failed("cancelled-before-dispatch");
      const child = spawn(this.options.bunPath, ["--no-install", "--no-env-file", `--config=${bunfig}`, supervisor, config], { cwd: code, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
      run.child = child; dispatched = true;
      const abort = () => this.cancel(input.operationId); input.signal?.addEventListener("abort", abort, { once: true });
      try {
        return await new Promise<SkillScriptResult>(resolve => {
          let protocol = "", diagnostic = "";
          child.stdout?.on("data", chunk => { if (protocol.length < 256 * 1024) protocol += chunk.toString(); });
          child.stderr?.on("data", chunk => { if (diagnostic.length < 4096) diagnostic += chunk.toString(); });
          child.once("error", () => resolve(failed("Supervisor launch failed")));
          child.once("close", (supervisorCode, supervisorSignal) => {
            const receipt = this.reconcile(input.operationId);
            if (!receipt) this.unresolved.set(input.operationId, null);
            if (receipt?.owner?.reaped && receipt.state !== "unknown") resolve({ ...receipt, boundary });
            else resolve({ ...(receipt ?? failed("Supervisor terminal receipt unavailable")), state: "unknown", boundary,
              reason: "Supervisor lost before child reap proof; retained identity requires recovery, never replay" + ` (exit=${supervisorCode}, signal=${supervisorSignal}): ${diagnostic || protocol.slice(0, 2000)}` });
          });
        });
      } finally { input.signal?.removeEventListener("abort", abort); }
    } catch (error) { return failed(error instanceof Error ? error.message : "Script executor failed"); }
  }
}
