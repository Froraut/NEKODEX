const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function checked(command, args, run = spawnSync) {
  const result = run(command, args, { encoding: "utf8", timeout: 15_000, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Update recovery registration failed (${command}, status ${result.status})`);
  return result.stdout?.trim() || "";
}
function processIdentity(pid, platform = process.platform) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    if (platform === "linux") {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const boot = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      return `${boot}:${stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]}`;
    }
    if (platform === "win32") {
      return checked("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
        `$ErrorActionPreference='Stop'; (Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks`]) || null;
    }
    return checked("/bin/ps", ["-p", String(pid), "-o", "lstart="]) || null;
  } catch { return null; }
}
function xml(value) { return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c])); }
function quoteArgument(value) {
  if (/[\r\n\0]/.test(value)) throw new Error("Invalid update recovery argument");
  return `"${String(value).replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/, "$1$1")}"`;
}
function recoveryRegistration(transaction, { home = os.homedir(), env = process.env } = {}) {
  const id = crypto.createHash("sha256").update(transaction.root).digest("hex").slice(0, 16);
  const args = [transaction.runtime, path.join(transaction.root, "update-worker.cjs"), path.join(transaction.root, "transaction.json"), "--recover"];
  if (transaction.job.platform === "darwin") {
    const name = `dev.codexwebgpt.update-recovery.${id}`;
    return { type: "file", path: path.join(home, "Library", "LaunchAgents", `${name}.plist`),
      contents: `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${name}</string><key>ProgramArguments</key><array>${args.map(a => `<string>${xml(a)}</string>`).join("")}</array><key>RunAtLoad</key><true/></dict></plist>\n` };
  }
  if (transaction.job.platform === "win32") {
    return { type: "registry", key: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", name: `CodexWebGPTUpdateRecovery-${id}`,
      contents: args.map(quoteArgument).join(" ") };
  }
  if (transaction.job.platform === "linux") {
    const config = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, ".config");
    // Desktop-entry Exec quoting also escapes expansion and field-code syntax.
    const quote = value => {
      if (/[\r\n\0]/.test(value)) throw new Error("Invalid update recovery argument");
      return `"${String(value).replace(/[\\"`$]/g, c => `\\${c}`).replace(/%/g, "%%")}"`;
    };
    return { type: "file", path: path.join(config, "autostart", `codex-web-gpt-update-recovery-${id}.desktop`),
      contents: `[Desktop Entry]\nType=Application\nName=NEKODEX update recovery\nExec=${args.map(quote).join(" ")}\nTerminal=false\nNoDisplay=true\n` };
  }
  throw new Error("Unsupported update recovery platform");
}
function registerRecovery(transaction, options = {}) {
  const registration = recoveryRegistration(transaction, options);
  // Save registration identity before creating it so a crash after creation can
  // still remove precisely this update's entry without touching user auto-start.
  transaction.recovery = registration;
  const journal = path.join(transaction.root, "registration.json");
  const fd = fs.openSync(journal, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(registration)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (registration.type === "registry") {
    checked("reg.exe", ["ADD", registration.key, "/v", registration.name, "/t", "REG_SZ", "/d", registration.contents, "/f"], options.run);
  } else {
    fs.mkdirSync(path.dirname(registration.path), { recursive: true, mode: 0o700 });
    const output = fs.openSync(registration.path, "wx", 0o600);
    try { fs.writeFileSync(output, registration.contents); fs.fsyncSync(output); } finally { fs.closeSync(output); }
  }
  return registration;
}
function unregisterRecovery(transaction, options = {}) {
  const journal = path.join(transaction.root, "registration.json");
  const registration = transaction.recovery || (fs.existsSync(journal) ? JSON.parse(fs.readFileSync(journal, "utf8")) : null);
  if (!registration) return;
  if (registration.type === "registry") {
    const run = options.run || spawnSync;
    const settings = { encoding: "utf8", windowsHide: true, timeout: 15_000 };
    const query = run("reg.exe", ["QUERY", registration.key, "/v", registration.name], settings);
    if (query.error) throw query.error;
    if (query.status !== 0) {
      // Values share the parent key's ACL. A readable parent plus an absent value
      // means cleanup already succeeded; an unreadable parent is not that proof.
      const parent = run("reg.exe", ["QUERY", registration.key], settings);
      if (!parent.error && parent.status === 0) return;
      throw new Error("Cannot verify this update's Windows recovery registration; preserving its journal");
    }
    const line = String(query.stdout || "").split(/\r?\n/).find(value => value.trim().startsWith(`${registration.name} `));
    const value = line?.match(/^\s*\S+\s+REG_SZ\s+(.*)$/)?.[1];
    if (value !== registration.contents) throw new Error("Update recovery registration was changed externally; preserving it");
    const result = run("reg.exe", ["DELETE", registration.key, "/v", registration.name, "/f"], settings);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Could not remove this update's Windows recovery registration (status ${result.status}); preserving its journal`);
  } else if (fs.existsSync(registration.path)) {
    if (fs.readFileSync(registration.path, "utf8") !== registration.contents) throw new Error("Update recovery registration was changed externally; preserving it");
    fs.unlinkSync(registration.path);
  }
}
module.exports = { processIdentity, quoteArgument, recoveryRegistration, registerRecovery, unregisterRecovery };
