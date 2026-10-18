/** Fixed application-owned sources, never supplied by a skill or prompt. Kept as strings
 * so the ordinary runtime bundler carries them without a runtime source-file lookup. */
export const SKILL_SCRIPT_BOOTSTRAP = String.raw`
import { dlopen } from "bun:ffi";
import { readFileSync, writeSync, closeSync } from "node:fs";
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
// No selected code can start until the supervisor durably records its exact PID/start.
const permitDeadline = Date.now() + 2000;
while (true) {
  try { if (readFileSync(config.launchPermit, "utf8") === "owned") break; } catch {}
  if (Date.now() > permitDeadline) process.exit(125);
  await new Promise(resolve => setTimeout(resolve, 10));
}
const sandbox = dlopen("/usr/lib/libSystem.B.dylib", { sandbox_init: { args: ["cstring", "u64", "ptr"], returns: "i32" } });
if (sandbox.symbols.sandbox_init(config.profile, 0, null) !== 0) process.exit(125);
writeSync(3, "sealed\n"); closeSync(3);
process.argv = [process.execPath, config.entry, ...config.argv];
await import(config.entry);
`;

export const SKILL_SCRIPT_SUPERVISOR = String.raw`
import { spawn } from "node:child_process";
import { dlopen, ptr } from "bun:ffi";
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync } from "node:fs";
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const proc = dlopen("/usr/lib/libproc.dylib", { proc_pidinfo: { args: ["i32", "i32", "u64", "ptr", "i32"], returns: "i32" } });
function identity(pid) {
  const b = Buffer.alloc(136);
  if (proc.symbols.proc_pidinfo(pid, 3, 0, ptr(b), b.length) !== b.length) throw new Error("Process start identity unavailable");
  return { pid, start: b.readBigUInt64LE(120).toString() + ":" + b.readBigUInt64LE(128).toString() };
}
const owner = { supervisor: identity(process.pid), child: null, sealed: false, reaped: false, reason: null };
function persist(value) {
  const path = config.receipt + ".pending";
  writeFileSync(path, JSON.stringify({ ...value, operationId: config.operationId, scope: config.scope, executionDigest: config.executionDigest }), { mode: 0o600 });
  const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(path, config.receipt);
  const dir = openSync(config.root, "r"); try { fsyncSync(dir); } finally { closeSync(dir); }
}
// No shell, inherited environment, extra descriptors, package command or account startup.
const child = spawn(config.bunPath, ["--no-install", "--no-env-file", "--config=" + config.bunfig, config.bootstrap, config.childConfig], { cwd: config.cwd, env: config.env, stdio: ["ignore", "pipe", "pipe", "pipe"] });
let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), outputBytes = 0, truncated = false, settled = false;
function stop(reason) { if (settled) return; owner.reason ??= reason; child.kill("SIGKILL"); }
function consume(which, bytes) {
  outputBytes += bytes.length;
  const available = Math.max(0, config.maxOutputBytes - stdout.length - stderr.length);
  if (which === "stdout") stdout = Buffer.concat([stdout, bytes.subarray(0, available)]);
  else stderr = Buffer.concat([stderr, bytes.subarray(0, available)]);
  if (outputBytes > config.maxOutputBytes) { truncated = true; stop("output-limit"); }
}
child.stdout.on("data", b => consume("stdout", b)); child.stderr.on("data", b => consume("stderr", b));
let seal = "";
child.stdio[3].on("data", b => { seal += b.toString(); if (seal.length > 32) stop("invalid-bootstrap-receipt"); });
child.stdio[3].on("end", () => { owner.sealed = seal === "sealed\n"; if (owner.sealed) persist({ state: "unknown", owner }); });
child.on("spawn", () => { try { owner.child = identity(child.pid); persist({ state: "unknown", owner }); writeFileSync(config.launchPermit, "owned", { mode: 0o400, flag: "wx" }); } catch { stop("identity-unavailable"); } });
const timer = setTimeout(() => stop("timeout"), config.timeoutMs);
process.stdin.on("data", () => stop("cancelled")); process.stdin.on("end", () => stop("core-owner-eof")); process.stdin.resume();
process.on("SIGTERM", () => stop("supervisor-termination")); process.on("SIGINT", () => stop("supervisor-termination"));
child.on("error", () => { owner.reason ??= "spawn-failed"; });
child.on("close", (exitCode, signal) => {
  settled = true; clearTimeout(timer); owner.reaped = true;
  const result = { state: owner.sealed && exitCode === 0 && !owner.reason ? "completed" : "failed", exitCode, signal, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), truncated, owner };
  persist(result); process.stdout.write(JSON.stringify(result), () => process.exit(0));
});
`;
