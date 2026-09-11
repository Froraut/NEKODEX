// A replacement cannot start until its supervisor PID has reached the durable
// journal. Killing the worker between spawn and journal therefore launches no app.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { processIdentity } = require("./update-recovery.cjs");

async function main(root) {
  if (!root || !path.isAbsolute(root)) throw new Error("Missing update launch directory");
  const transaction = JSON.parse(fs.readFileSync(path.join(root, "transaction.json"), "utf8"));
  const authorizationPath = path.join(root, "launch-authorized.json");
  const deadline = Date.now() + 30_000;
  let authorized = false;
  while (Date.now() < deadline) {
    if (fs.existsSync(authorizationPath)) {
      const authorization = JSON.parse(fs.readFileSync(authorizationPath, "utf8"));
      if (authorization.pid !== process.pid || authorization.token !== transaction.readyToken) throw new Error("Invalid update launch authorization");
      authorized = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (!authorized) throw new Error("Update worker did not authorize replacement launch");
  const job = transaction.job;
  const executable = job.platform === "darwin" ? path.join(job.target, "Contents", "MacOS", job.productName)
    : job.platform === "win32" ? path.join(job.target, `${job.productName}.exe`) : job.wrapper;
  const child = spawn(executable, [], { stdio: "ignore", windowsHide: true, detached: false });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  const fd = fs.openSync(path.join(root, "launched.json.next"), "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({ pid: child.pid, identity: processIdentity(child.pid), token: transaction.readyToken })); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(path.join(root, "launched.json.next"), path.join(root, "launched.json"));
  // Stay as parent so Windows taskkill /T and POSIX process-group termination can
  // stop every replacement descendant before restoring files.
  await new Promise(resolve => {
    const timer = setInterval(() => {
      const journal = path.join(root, "transaction.json");
      let committed = false;
      try { committed = !fs.existsSync(journal) || JSON.parse(fs.readFileSync(journal, "utf8")).phase === "committed"; } catch {}
      if (committed) {
        clearInterval(timer);
        child.unref();
        resolve();
      }
    }, 250);
    child.once("exit", () => { clearInterval(timer); resolve(); });
  });
}
if (require.main === module) void main(process.argv[2]).catch(() => process.exit(1));
module.exports = { main };
