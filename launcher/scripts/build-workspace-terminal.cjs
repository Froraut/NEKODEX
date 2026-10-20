"use strict";
// Native prerequisite only. The probe uses Electron's Node mode, never a GUI or
// user profile. Compatible bindings are reused; a failed rebuild/probe stops startup.
const path = require("node:path");
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");

function ensureWorkspaceTerminal({ root = path.resolve(__dirname, ".."), force = false,
  run = spawnSync, log = console.log,
  node = process.env.CODEX_WEB_GPT_NODE || (process.versions.bun ? "node" : process.execPath) } = {}) {
  const localRequire = createRequire(path.join(root, "package.json"));
  const version = localRequire("electron/package.json").version;
  const electron = localRequire("electron");
  const probeSource = `const p = require('node-pty');
    if (!process.versions.electron || typeof p.spawn !== 'function') throw new Error('Native PTY provider unavailable');
    console.log(JSON.stringify({ electron: process.versions.electron, abi: process.versions.modules,
      platform: process.platform, arch: process.arch }));`;
  const probe = () => {
    const result = run(electron, ["-e", probeSource], { cwd: root, encoding: "utf8", windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 15000, maxBuffer: 65536 });
    if (result.error || result.status !== 0) return null;
    try {
      const receipt = JSON.parse(result.stdout.trim());
      return receipt.electron === version && receipt.platform === process.platform && receipt.arch === process.arch
        && typeof receipt.abi === "string" ? receipt : null;
    } catch { return null; }
  };
  let receipt = force ? null : probe();
  if (receipt) {
    log(`PTY native provider compatible: Electron ${receipt.electron}, ABI ${receipt.abi}, ${receipt.platform}-${receipt.arch}; rebuild skipped.`);
    return { rebuilt: false, ...receipt };
  }
  const rebuild = path.join(path.dirname(localRequire.resolve("@electron/rebuild")), "cli.js");
  const result = run(node, [rebuild, "--version", version, "--only", "node-pty", "--force"], {
    cwd: root, stdio: "inherit", windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error("The native PTY rebuild failed. Development startup stopped before opening a window.");
  receipt = probe();
  if (!receipt) throw new Error("The rebuilt PTY binding could not load in the installed Electron. Development startup stopped before opening a window.");
  log(`PTY native provider rebuilt and verified: Electron ${receipt.electron}, ABI ${receipt.abi}, ${receipt.platform}-${receipt.arch}.`);
  return { rebuilt: true, ...receipt };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--force")) throw new Error("Usage: build-workspace-terminal.cjs [--force]");
  ensureWorkspaceTerminal({ force: args.includes("--force") });
}
module.exports = { ensureWorkspaceTerminal };
