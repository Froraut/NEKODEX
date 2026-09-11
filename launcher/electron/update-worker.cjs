const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { validateStagedApplication } = require("./update-validation.cjs");
const { processIdentity, registerRecovery, unregisterRecovery } = require("./update-recovery.cjs");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function appendLog(job, message) {
  try {
    fs.mkdirSync(path.dirname(job.logPath), { recursive: true, mode: 0o700 });
    fs.appendFileSync(job.logPath, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
  } catch {}
}
function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}
async function waitForParent(pid, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (processAlive(pid)) {
    if (Date.now() >= deadline) throw new Error(`Launcher process ${pid} did not exit in time`);
    await sleep(100);
  }
}
function syncDirectory(directory) {
  let fd;
  try { fd = fs.openSync(directory, "r"); fs.fsyncSync(fd); }
  catch (error) { if (!["EINVAL", "ENOTSUP", "EISDIR", "EPERM", "EBADF", "EACCES"].includes(error.code)) throw error; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function writeJournal(transaction) {
  const filename = path.join(transaction.root, "transaction.json");
  const fd = fs.openSync(`${filename}.next`, "w", 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(transaction)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(`${filename}.next`, filename);
  syncDirectory(transaction.root);
}
function syncTree(root) {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(root)) syncTree(path.join(root, name));
    syncDirectory(root);
  } else if (stat.isFile()) {
    const fd = fs.openSync(root, "r");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
}
function requireFile(filePath, label) {
  if (!filePath || !path.isAbsolute(filePath) || !fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${label} is missing: ${filePath || "unknown"}`);
  }
}
function shellQuote(value) { return `'${String(value).replace(/'/g, `'\\''`)}'`; }
function launch(bin, args = [], env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { detached: true, stdio: "ignore", windowsHide: true, env });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(child); });
  });
}
function executableFor(job, root = job.target) {
  if (job.platform === "darwin") return path.join(root, "Contents", "MacOS", job.productName);
  if (job.platform === "win32") return path.join(root, `${job.productName}.exe`);
  return job.wrapper;
}
function copyTree(source, target, platform) {
  if (fs.existsSync(target)) throw new Error(`Update staging destination already exists: ${target}`);
  if (platform === "darwin") {
    const copied = spawnSync("/usr/bin/ditto", [source, target], { encoding: "utf8", timeout: 180_000 });
    if (copied.error) throw copied.error;
    if (copied.status !== 0) throw new Error(`Could not stage the macOS application: ${copied.stderr.trim()}`);
  } else fs.cpSync(source, target, { recursive: true, verbatimSymlinks: true, errorOnExist: true });
}
function operation(target, next, root, index) {
  if (!path.isAbsolute(target) || !path.isAbsolute(next)) throw new Error("Update paths must be absolute");
  const previous = path.join(path.dirname(target), `.${path.basename(target)}.previous-${path.basename(root)}-${index}`);
  if (fs.existsSync(previous)) throw new Error("An earlier update backup already exists; recover it first");
  return { target, next, previous, failed: `${previous}.failed`, hadOriginal: fs.existsSync(target), state: "prepared" };
}
function prepareTransaction(job, deps = {}) {
  const root = job.transactionRoot;
  if (!root || !path.isAbsolute(root)) throw new Error("Update requires a durable transaction directory");
  if (fs.existsSync(root) && fs.readdirSync(root).length === 0) fs.rmdirSync(root);
  if (fs.existsSync(root)) {
    const existing = JSON.parse(fs.readFileSync(path.join(root, "transaction.json"), "utf8"));
    if (existing.phase === "preparing" && (!existing.workerIdentity || processIdentity(existing.workerPid) !== existing.workerIdentity)) {
      // Preparation has not renamed any installed path, so an abandoned copy can
      // be discarded without needing to stop or relaunch an application.
      rollback(existing);
      cleanup(existing, deps);
      existing.phase = "rolled-back";
    }
    if (!["committed", "rolled-back"].includes(existing.phase)) throw new Error("An interrupted update must finish recovery before another update");
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  fs.mkdirSync(root, { mode: 0o700 });
  const transaction = { schemaVersion: 1, root, job, workerPid: process.pid,
    workerIdentity: processIdentity(process.pid), phase: "preparing", operations: [] };
  writeJournal(transaction);
  try {
    const runtime = path.join(root, job.platform === "win32" ? "bun.exe" : "bun");
    fs.copyFileSync(job.runtimeExecutable, runtime, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(runtime, 0o700);
    for (const name of ["update-worker.cjs", "update-validation.cjs", "update-recovery.cjs", "update-launcher.cjs"]) {
      fs.copyFileSync(path.join(__dirname, name), path.join(root, name), fs.constants.COPYFILE_EXCL);
    }
    transaction.runtime = runtime;
    transaction.readyToken = crypto.randomBytes(32).toString("hex");
    transaction.readyFile = path.join(root, "ready.json");
    const validate = deps.validate || validateStagedApplication;
    validate(job.stagedApplication, job);
    if (job.platform === "linux") {
      requireFile(job.source, "Linux AppImage");
      requireFile(job.runnerSource, "Linux AppImage runner");
      requireFile(job.wrapper, "Stable Linux launcher wrapper");
      const versionsRoot = path.dirname(path.dirname(job.target));
      const nextDirectory = path.join(versionsRoot, `${job.version}-${path.basename(root)}`);
      transaction.newDirectory = nextDirectory;
      writeJournal(transaction);
      fs.mkdirSync(nextDirectory, { mode: 0o700 });
      const nextTarget = path.join(nextDirectory, path.basename(job.target));
      const runner = path.join(nextDirectory, "run-appimage");
      fs.copyFileSync(job.source, nextTarget, fs.constants.COPYFILE_EXCL);
      fs.copyFileSync(job.runnerSource, runner, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(nextTarget, 0o755);
      fs.chmodSync(runner, 0o755);
      const next = path.join(path.dirname(job.wrapper), `.${path.basename(job.wrapper)}.next-${path.basename(root)}`);
      transaction.operations.push(operation(job.wrapper, next, root, 0));
      writeJournal(transaction);
      fs.writeFileSync(next, ["#!/bin/sh", "set -eu",
        `export CODEX_WEB_GPT_LAUNCHER_EXECUTABLE=${shellQuote(job.wrapper)}`,
        `export CODEX_WEB_GPT_APPIMAGE=${shellQuote(nextTarget)}`,
        `exec ${shellQuote(runner)} ${shellQuote(nextTarget)} "$@"`, ""].join("\n"), { flag: "wx", mode: 0o755 });
      transaction.packageTarget = nextTarget;
      syncTree(nextDirectory);
    } else {
      const next = path.join(path.dirname(job.target), `.${path.basename(job.target)}.next-${path.basename(root)}`);
      transaction.operations.push(operation(job.target, next, root, 0));
      writeJournal(transaction);
      (deps.copyTree || copyTree)(job.stagedApplication, next, job.platform);
      if (job.platform === "win32") {
        // Portable replacement must retain the NSIS uninstall entry's executable.
        // No installer is executed and no uninstall registration changes pre-commit.
        const name = `Uninstall ${job.productName}.exe`;
        const uninstall = path.join(job.target, name);
        const stat = fs.lstatSync(uninstall, { throwIfNoEntry: false });
        if (stat?.isFile() && !fs.existsSync(path.join(next, name))) fs.copyFileSync(uninstall, path.join(next, name), fs.constants.COPYFILE_EXCL);
      }
      validate(next, job);
      transaction.packageTarget = job.target;
    }
    for (const op of transaction.operations) syncTree(op.next);
    transaction.phase = "prepared";
    writeJournal(transaction);
    syncTree(root);
    transaction.recovery = (deps.registerRecovery || registerRecovery)(transaction);
    writeJournal(transaction);
    return transaction;
  } catch (error) {
    rollback(transaction);
    cleanup(transaction, deps);
    throw error;
  }
}
function replace(transaction, checkpoint = () => {}) {
  transaction.phase = "replacing";
  writeJournal(transaction);
  for (const [index, op] of transaction.operations.entries()) {
    op.state = "moving";
    writeJournal(transaction);
    checkpoint("before-backup", index);
    if (op.hadOriginal) fs.renameSync(op.target, op.previous);
    syncDirectory(path.dirname(op.target));
    checkpoint("after-backup", index);
    op.state = "backed-up";
    writeJournal(transaction);
    fs.renameSync(op.next, op.target);
    syncDirectory(path.dirname(op.target));
    checkpoint("after-replace", index);
    op.state = "applied";
    writeJournal(transaction);
  }
  transaction.phase = "awaiting-readiness";
  writeJournal(transaction);
}
function rollback(transaction, checkpoint = () => {}) {
  if (transaction.phase === "committed") return false;
  for (const [index, op] of [...transaction.operations].reverse().entries()) {
    if (fs.existsSync(op.previous)) {
      if (fs.existsSync(op.target)) {
        fs.rmSync(op.failed, { force: true, recursive: true });
        fs.renameSync(op.target, op.failed);
      }
      checkpoint("before-restore", index);
      fs.renameSync(op.previous, op.target);
      syncDirectory(path.dirname(op.target));
      checkpoint("after-restore", index);
    } else if (!op.hadOriginal && op.state !== "prepared" && !fs.existsSync(op.next)) {
      fs.rmSync(op.target, { recursive: true, force: true });
    }
    fs.rmSync(op.failed, { recursive: true, force: true });
    fs.rmSync(op.next, { recursive: true, force: true });
    op.state = "restored";
    writeJournal(transaction);
  }
  if (transaction.newDirectory) fs.rmSync(transaction.newDirectory, { recursive: true, force: true });
  transaction.phase = "rolled-back";
  writeJournal(transaction);
  return true;
}
function launchedReplacement(transaction) {
  const filename = path.join(transaction.root, "launched.json");
  const stat = fs.statSync(filename, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isFile() || stat.size < 1 || stat.size > 4096) throw new Error("Invalid replacement process identity record; preserving the previous installation");
  const record = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (record.token !== transaction.readyToken || !Number.isSafeInteger(record.pid) || record.pid <= 0
    || typeof record.identity !== "string" || !record.identity || record.identity.length > 256) {
    throw new Error("Invalid replacement process identity record; preserving the previous installation");
  }
  return record;
}
function processGroup(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "pgid="], { encoding: "utf8", timeout: 15_000 });
  const value = result.stdout?.trim();
  return !result.error && result.status === 0 && /^[1-9][0-9]*$/.test(value || "") ? Number(value) : null;
}
function groupAlive(pid) {
  try { process.kill(-pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}
async function stopReplacement(transaction, deps = {}) {
  const pid = transaction.candidatePid;
  if (!pid) return;
  const isAlive = deps.processAlive || processAlive;
  const identityOf = deps.processIdentity || processIdentity;
  const child = launchedReplacement(transaction);
  const matches = (savedPid, identity) => Boolean(identity && isAlive(savedPid) && identityOf(savedPid) === identity);
  const supervisorOwned = matches(pid, transaction.candidateIdentity);
  const childOwned = child && matches(child.pid, child.identity);
  const owned = [];
  if (supervisorOwned) owned.push({ pid, identity: transaction.candidateIdentity });
  if (childOwned) owned.push(child);
  if (transaction.job.platform === "win32") {
    // A dead supervisor does not imply its app exited. Its durable child identity
    // is independent authority for stopping the remaining Windows process tree.
    const stopPid = supervisorOwned ? pid : childOwned ? child.pid : null;
    if (!stopPid) {
      if (!child && fs.existsSync(path.join(transaction.root, "launch-authorized.json"))) {
        throw new Error("Cannot establish replacement child identity after launch authorization; preserving the previous installation for recovery");
      }
      return;
    }
    const result = (deps.spawnSync || spawnSync)("taskkill.exe", ["/PID", String(stopPid), "/T", "/F"], { windowsHide: true, timeout: 15_000 });
    if (result.error) throw result.error;
  } else {
    // The detached supervisor is the group leader. A surviving recorded app must
    // still belong to that group before its descendants can be stopped safely.
    const childInGroup = childOwned && (deps.processGroup || processGroup)(child.pid) === pid;
    if (!supervisorOwned && !childInGroup) {
      if ((deps.groupAlive || groupAlive)(pid)) {
        throw new Error("Cannot establish replacement process-group identity; preserving the previous installation for recovery");
      }
      return;
    }
    const kill = deps.kill || process.kill.bind(process);
    try { kill(-pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    await sleep(300);
    try { kill(-pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  const deadline = Date.now() + 10_000;
  while (owned.some(process => matches(process.pid, process.identity))) {
    if (Date.now() >= deadline) throw new Error("Replacement process is still running; previous application is preserved for recovery");
    await sleep(100);
  }
}
async function waitForReadiness(transaction, { timeoutMs = 90_000, graceMs = 1_000, isAlive = processAlive } = {}) {
  const deadline = Date.now() + timeoutMs;
  const job = transaction.job;
  while (Date.now() < deadline) {
    if (!isAlive(transaction.candidatePid)) throw new Error("Replacement launcher exited before readiness");
    if (fs.existsSync(transaction.readyFile) && (job.platform === "linux" || fs.existsSync(path.join(transaction.root, "launched.json")))) {
      if (fs.statSync(transaction.readyFile).size > 4096) throw new Error("Replacement readiness proof is oversized");
      const ready = JSON.parse(fs.readFileSync(transaction.readyFile, "utf8"));
      if (ready.token !== transaction.readyToken || ready.version !== job.version || ready.platform !== job.platform
        || ready.arch !== job.arch || ready.packageTarget !== transaction.packageTarget || !isAlive(ready.pid)
        || (job.platform !== "linux" && ready.pid !== JSON.parse(fs.readFileSync(path.join(transaction.root, "launched.json"), "utf8")).pid)) {
        throw new Error("Replacement readiness proof does not match the staged launcher");
      }
      await sleep(graceMs);
      if (!isAlive(ready.pid) || !isAlive(transaction.candidatePid)) throw new Error("Replacement launcher exited after its readiness signal");
      return ready;
    }
    await sleep(50);
  }
  throw new Error("Replacement launcher did not prove readiness before its deadline");
}
function commit(transaction) {
  // The commit reaches disk before deleting any byte of the prior installation.
  transaction.phase = "committed";
  writeJournal(transaction);
  for (const op of transaction.operations) fs.rmSync(op.previous, { recursive: true, force: true });
  // Linux retains the old version and old runner for a separate explicit cleanup.
}
function cleanup(transaction, deps = {}) {
  if (transaction.phase === "committed") {
    for (const op of transaction.operations) fs.rmSync(op.previous, { recursive: true, force: true });
  }
  (deps.unregisterRecovery || unregisterRecovery)(transaction);
  try { fs.rmSync(transaction.job.tempRoot, { recursive: true, force: true }); } catch {}
  // Windows can retain the running Bun file until a later terminal-journal cleanup.
  if (transaction.job.platform !== "win32") {
    try { fs.rmSync(transaction.root, { recursive: true, force: true }); } catch {}
  }
}
async function runTransaction(transaction, deps = {}) {
  const launchProcess = deps.launch || launch;
  try {
    replace(transaction, deps.checkpoint);
    const child = await launchProcess(transaction.runtime, [path.join(transaction.root, "update-launcher.cjs"), transaction.root], {
      ...process.env,
      CODEX_WEB_GPT_UPDATE_READY_FILE: transaction.readyFile,
      CODEX_WEB_GPT_UPDATE_READY_TOKEN: transaction.readyToken,
    });
    transaction.candidatePid = child.pid;
    transaction.candidateIdentity = processIdentity(child.pid);
    if (!transaction.candidateIdentity) throw new Error("Could not establish replacement supervisor process identity");
    writeJournal(transaction);
    const authorization = fs.openSync(path.join(transaction.root, "launch-authorized.json.next"), "wx", 0o600);
    try { fs.writeFileSync(authorization, JSON.stringify({ pid: child.pid, token: transaction.readyToken })); fs.fsyncSync(authorization); }
    finally { fs.closeSync(authorization); }
    fs.renameSync(path.join(transaction.root, "launch-authorized.json.next"), path.join(transaction.root, "launch-authorized.json"));
    syncDirectory(transaction.root);
    await (deps.waitForReadiness || waitForReadiness)(transaction);
    commit(transaction);
    appendLog(transaction.job, `v${transaction.job.version} committed after launcher and runtime readiness`);
  } catch (error) {
    if (transaction.phase === "committed") throw error;
    await (deps.stopReplacement || stopReplacement)(transaction);
    rollback(transaction);
    await launchProcess(executableFor(transaction.job));
    appendLog(transaction.job, `update rolled back: ${error.message}`);
    throw error;
  } finally {
    if (["committed", "rolled-back"].includes(transaction.phase)) cleanup(transaction, deps);
  }
}
async function recover(transactionPath, deps = {}) {
  const transaction = JSON.parse(fs.readFileSync(transactionPath, "utf8"));
  if (transaction.schemaVersion !== 1 || path.join(transaction.root, "transaction.json") !== transactionPath) {
    throw new Error("Invalid update recovery journal");
  }
  if (transaction.workerIdentity && processIdentity(transaction.workerPid) === transaction.workerIdentity) return;
  const lock = path.join(transaction.root, "recovery.lock");
  try {
    const fd = fs.openSync(lock, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, identity: processIdentity(process.pid) }));
    fs.closeSync(fd);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
    if (owner.identity && processIdentity(owner.pid) === owner.identity) return;
    fs.unlinkSync(lock);
    return recover(transactionPath, deps);
  }
  try {
  if (!["committed", "rolled-back"].includes(transaction.phase)) {
    await (deps.stopReplacement || stopReplacement)(transaction);
    rollback(transaction);
    await (deps.launch || launch)(executableFor(transaction.job));
    appendLog(transaction.job, "Recovered interrupted update; relaunched the previous installation");
  }
  cleanup(transaction, deps);
  } finally {
    try { fs.unlinkSync(lock); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
async function main() {
  const jobPath = process.argv[2];
  if (!jobPath || !path.isAbsolute(jobPath)) throw new Error("Update worker requires an absolute job path");
  if (process.argv.includes("--recover")) { await recover(jobPath); return; }
  if (process.argv.includes("--guard")) {
    process.stdin.resume();
    await new Promise(resolve => process.stdin.once("end", resolve));
    if (fs.existsSync(jobPath)) {
      const saved = JSON.parse(fs.readFileSync(jobPath, "utf8"));
      while (saved.workerIdentity && processIdentity(saved.workerPid) === saved.workerIdentity) await sleep(100);
      if (fs.existsSync(jobPath)) await recover(jobPath);
    }
    return;
  }
  const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
  appendLog(job, `waiting for launcher PID ${job.parentPid} before installing v${job.version}`);
  await waitForParent(job.parentPid);
  let transaction;
  try {
    transaction = prepareTransaction(job);
    const guard = spawn(transaction.runtime, [path.join(transaction.root, "update-worker.cjs"),
      path.join(transaction.root, "transaction.json"), "--guard"], {
      detached: true, stdio: ["pipe", "ignore", "ignore"], windowsHide: true,
    });
    await new Promise((resolve, reject) => { guard.once("spawn", resolve); guard.once("error", reject); });
    guard.unref();
    await runTransaction(transaction);
    guard.stdin.end();
  } catch (error) {
    appendLog(job, `update failed: ${error.stack || error.message}`);
    if (!transaction) await launch(executableFor(job));
    throw error;
  }
}
module.exports = { cleanup, commit, executableFor, launch, main, operation, prepareTransaction, processAlive,
  recover, replace, rollback, runTransaction, stopReplacement, waitForReadiness, writeJournal };
if (require.main === module) void main().catch(() => process.exit(1));
