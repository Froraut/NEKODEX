const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function captureUpdateReadiness(env = process.env) {
  const filename = env.CODEX_WEB_GPT_UPDATE_READY_FILE;
  const token = env.CODEX_WEB_GPT_UPDATE_READY_TOKEN;
  // Do not leak the nonce or marker path into core/browser/helper subprocesses.
  delete env.CODEX_WEB_GPT_UPDATE_READY_FILE;
  delete env.CODEX_WEB_GPT_UPDATE_READY_TOKEN;
  if (!filename && !token) return null;
  if (!path.isAbsolute(filename || "") || path.basename(filename) !== "ready.json" || !/^[a-f0-9]{64}$/.test(token || "")) {
    throw new Error("Invalid updater readiness handoff");
  }
  return { filename, token };
}

function acknowledgeUpdateReady(handoff, { version, platform = process.platform, arch = process.arch,
  executablePath = process.execPath, pid = process.pid, env = process.env, ...lifecycle } = {}) {
  if (!handoff) return false;
  let packageTarget;
  if (platform === "darwin") packageTarget = executablePath.match(/^(.*\.app)[\\/]Contents[\\/]MacOS[\\/][^\\/]+$/)?.[1];
  else if (platform === "win32") packageTarget = path.dirname(executablePath);
  else packageTarget = env.CODEX_WEB_GPT_APPIMAGE;
  if (!packageTarget || !path.isAbsolute(packageTarget)) throw new Error("Cannot prove updater package identity");
  if (fs.existsSync(handoff.filename)) throw new Error("Updater readiness has already been acknowledged");
  const next = `${handoff.filename}.next`;
  const fd = fs.openSync(next, "wx", 0o600);
  try {
    // Lifecycle details are descriptive. They must never override the updater's
    // authorization token or the package/process identity established above.
    fs.writeFileSync(fd, JSON.stringify({ ...lifecycle, token: handoff.token, version, platform, arch, pid, packageTarget }));
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(next, handoff.filename);
  return true;
}
function proveUpdateReadiness(handoff, options, runtimeInvocation, run = spawnSync) {
  if (!handoff) return false;
  const result = run(runtimeInvocation.executable, runtimeInvocation.args, {
    cwd: runtimeInvocation.cwd, encoding: "utf8", timeout: 30_000, windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || result.stdout.trim() !== options.version) {
    throw new Error("Replacement runtime did not report the expected launcher version");
  }
  if (!(["local-usable", "not-configured"].includes(options.lifecycleStatus))
    || options.readinessSchema !== 2
    || !Number.isSafeInteger(options.lifecycleRevision)
    || options.lifecycleRevision < 0
    || (options.lifecycleStatus === "local-usable" && (options.nativeAvailability !== "ready"
      || typeof options.configVersion !== "string" || !options.configVersion
      || (options.configVersion !== options.version && options.legacyCommittedRuntime !== true)))) {
    throw new Error("Replacement launcher has not reached a locally usable lifecycle state");
  }
  return acknowledgeUpdateReady(handoff, options);
}
module.exports = { acknowledgeUpdateReady, captureUpdateReadiness, proveUpdateReadiness };
