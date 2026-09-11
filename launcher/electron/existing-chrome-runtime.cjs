const fs = require("node:fs");
const path = require("node:path");
const { parseExistingChromeProgress } = require("./existing-chrome-login.cjs");
const IMPORT_TIMEOUT_MS = 180_000;

function cleanupExistingChromeTransfers(host) {
  const parent = path.join(host.app.getPath("userData"), "existing-chrome-login");
  try {
    const stat = fs.lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid private import directory");
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (/^transfer-[A-Za-z0-9]{6}$/.test(entry.name) && entry.isDirectory() && !entry.isSymbolicLink()) {
        fs.rmSync(path.join(parent, entry.name), { recursive: true, force: true });
      }
    }
  } catch (cause) {
    if (cause?.code === "ENOENT") return;
    const error = new Error("Existing Chrome import cleanup failed");
    error.code = "existing_chrome_cleanup_failed";
    throw error;
  }
}

async function captureExistingChromeLogin(host, onProgress) {
  if (!["darwin", "win32", "linux"].includes(host.platform)) throw new Error("Existing Chrome sign-in is unavailable on this platform");
  if (host.currentOperation() || host.passkeyProgress || host.existingChromeProgress) throw new Error("Another launcher operation is active");
  cleanupExistingChromeTransfers(host);
  const parent = path.join(host.app.getPath("userData"), "existing-chrome-login");
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (host.platform !== "win32") fs.chmodSync(parent, 0o700);
  const root = fs.mkdtempSync(path.join(parent, "transfer-"));
  if (host.platform !== "win32") fs.chmodSync(root, 0o700);
  const storageStatePath = path.join(root, "storage-state.json");
  const markerPath = `${storageStatePath}.verified.json`;
  const cleanup = async () => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {
      const error = new Error("Existing Chrome import cleanup failed");
      error.code = "existing_chrome_cleanup_failed";
      throw error;
    }
  };
  host.existingChromeProgress = onProgress || (() => {});
  try {
    await host.run("existing-chrome-login", ["login", "--existing-chrome", "--launcher-control", "--consent-user-profile", "--storage-state", storageStatePath], {
      embedded: true, controlStdin: true, privateOutput: true, env: host.launcherControlEnvironment(),
      message: "Waiting for Chrome permission to import the existing ChatGPT sign-in",
      successMessage: "Existing Chrome session captured for private Launcher verification",
      timeoutMs: IMPORT_TIMEOUT_MS + 10_000,
      onStdoutLine: line => {
        const progress = parseExistingChromeProgress(line);
        if (progress) host.existingChromeProgress?.(progress);
        // The session helper does not have general-purpose output. Never log raw CDP errors/data.
        return true;
      },
    });
    for (const [file, maxBytes] of [[storageStatePath, 16 * 1024 * 1024], [markerPath, 64 * 1024]]) {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) throw new Error("Invalid existing Chrome capture");
    }
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    const capturedAt = typeof marker?.capturedAt === "string" ? Date.parse(marker.capturedAt) : NaN;
    if (marker?.version !== 1 || marker.captureComplete !== true || marker.source !== "existing-chrome-profile"
      || !Number.isFinite(capturedAt) || capturedAt < Date.now() - IMPORT_TIMEOUT_MS - 60_000 || capturedAt > Date.now() + 60_000) {
      throw new Error("Invalid existing Chrome capture evidence");
    }
    return { storageState: JSON.parse(fs.readFileSync(storageStatePath, "utf8")), cleanup };
  } catch (error) {
    await cleanup();
    const timeout = /timed out/i.test(error?.message ?? "");
    const failure = new Error(timeout ? "Existing Chrome sign-in timed out" : "Existing Chrome sign-in could not be imported");
    if (timeout) failure.code = "existing_chrome_timeout";
    throw failure;
  } finally { host.existingChromeProgress = null; }
}

async function cancelExistingChromeLogin(host) {
  const child = host.activeChild;
  if (host.active !== "existing-chrome-login" || !child || child.exitCode !== null || child.signalCode !== null) {
    throw new Error("No existing Chrome import helper is active");
  }
  const killImporter = () => {
    if (host.activeChild === child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  };
  // The helper only connects to Chrome. It never owns Chrome or any of Chrome's descendants.
  // Cancel closes its WebSocket; a broken pipe can terminate this exact helper only.
  if (!child.stdin?.writable) { killImporter(); return true; }
  return await new Promise(resolve => {
    child.stdin.write(`${JSON.stringify({ version: 1, type: "existing-chrome-login-cancel" })}\n`, error => {
      if (error) killImporter();
      resolve(true);
    });
  });
}

module.exports = { captureExistingChromeLogin, cancelExistingChromeLogin, cleanupExistingChromeTransfers };
