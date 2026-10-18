/** Fixed application-owned parser supervisor; same PID/start, durable permit,
 * sealed FD, cancellation and reap contract as the script supervisor. */
export const SKILL_PDF_SUPERVISOR = String.raw`
import { spawn } from "node:child_process";
import { dlopen, ptr } from "bun:ffi";
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync, unlinkSync, lstatSync } from "node:fs";
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const proc = dlopen("/usr/lib/libproc.dylib", { proc_pidinfo: { args: ["i32", "i32", "u64", "ptr", "i32"], returns: "i32" } });
function identity(pid) {
  const bytes = Buffer.alloc(136);
  if (proc.symbols.proc_pidinfo(pid, 3, 0, ptr(bytes), bytes.length) !== bytes.length) throw new Error("Parser process identity unavailable");
  return { pid, start: bytes.readBigUInt64LE(120).toString() + ":" + bytes.readBigUInt64LE(128).toString() };
}
const owner = { supervisor: identity(process.pid), child: null, sealed: false, reaped: false, reason: null };
function persist(value) {
  const temporary = config.receipt + ".pending";
  writeFileSync(temporary, JSON.stringify({ ...value, operationId: config.operationId, sourceSha256: config.sourceSha256, sourceBytes: config.sourceBytes, extractor: config.extractor }), { mode: 0o600 });
  const fd = openSync(temporary, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, config.receipt);
  const directory = openSync(config.root, "r"); try { fsyncSync(directory); } finally { closeSync(directory); }
}
const child = spawn(config.helper, ["extract", config.profile, config.input, config.launchPermit, config.sourceSha256, String(config.sourceBytes)], { cwd: config.scratch, env: config.env, stdio: ["ignore", "pipe", "pipe", "pipe"] });
let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), outputBytes = 0, settled = false, truncated = false;
function stop(reason) { if (settled) return; owner.reason ??= reason; child.kill("SIGKILL"); }
function consume(which, data) {
  outputBytes += data.length;
  const available = Math.max(0, 256 * 1024 - stdout.length - stderr.length);
  if (which === "stdout") stdout = Buffer.concat([stdout, data.subarray(0, available)]);
  else stderr = Buffer.concat([stderr, data.subarray(0, available)]);
  if (outputBytes > 256 * 1024) { truncated = true; stop("output-limit"); }
}
child.stdout.on("data", data => consume("stdout", data)); child.stderr.on("data", data => consume("stderr", data));
let seal = "";
child.stdio[3].on("data", data => { seal += data.toString(); if (seal.length > 32) stop("invalid-seal"); });
child.stdio[3].on("end", () => { owner.sealed = seal === "sealed\n"; if (owner.sealed) persist({ state: "unknown", owner }); });
child.on("spawn", () => { try { owner.child = identity(child.pid); persist({ state: "unknown", owner }); writeFileSync(config.launchPermit, "owned", { flag: "wx", mode: 0o400 }); } catch { stop("identity-unavailable"); } });
const timer = setTimeout(() => stop("timeout"), 15000);
// This is an observed resident-memory bound, not a universal hard VM limit.
const memory = setInterval(() => {
  if (!owner.child || settled) return;
  const bytes = Buffer.alloc(96);
  if (proc.symbols.proc_pidinfo(owner.child.pid, 4, 0, ptr(bytes), bytes.length) === bytes.length && bytes.readBigUInt64LE(8) > 256n * 1024n * 1024n) stop("memory-limit");
}, 50);
process.stdin.on("data", () => stop("cancelled")); process.stdin.on("end", () => stop("core-owner-eof")); process.stdin.resume();
process.on("SIGTERM", () => stop("supervisor-termination")); process.on("SIGINT", () => stop("supervisor-termination"));
child.on("error", () => { owner.reason ??= "spawn-failed"; });
child.on("close", (exitCode, signal) => {
  settled = true; clearTimeout(timer); clearInterval(memory); owner.reaped = true;
  const value = { state: owner.sealed && exitCode === 0 && !owner.reason && !truncated ? "completed" : "failed", exitCode, signal, stdout: stdout.toString("utf8"), truncated, owner };
  persist(value);
  // Staged input is an expendable private copy. Retained skill bytes stay with
  // ManagedSkillStore. Unknown/live owners retain this copy for reconciliation.
  try { const stat = lstatSync(config.input, { bigint: true }); if (stat.isFile() && !stat.isSymbolicLink() && String(stat.dev) === config.inputDev && String(stat.ino) === config.inputIno) unlinkSync(config.input); } catch {}
  process.stdout.write(JSON.stringify({ terminal: true }), () => process.exit(0));
});
`;
