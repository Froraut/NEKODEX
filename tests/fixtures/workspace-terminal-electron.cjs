"use strict";
// Run only via the checkout's Electron with ELECTRON_RUN_AS_NODE=1. Never opens
// a GUI, user profile, provider connection, or existing terminal.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWorkspaceTerminalService } = require("../../launcher/electron/workspace-terminal.cjs");
assert.ok(process.versions.electron, "This fixture must test the real Electron native ABI");
const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-owned-pty-")));
const service = createWorkspaceTerminalService({ shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh" });
const grant = { id: "12345678-1234-1234-1234-123456789012", path: directory };
let session; let output = ""; let cursor = 0;
const deadline = setTimeout(() => { console.error("Owned PTY smoke timed out"); service.closeAll(); process.exitCode = 1; }, 8000);
(async () => {
  assert.equal(service.availability().available, true);
  session = service.open(grant, { cols: 93, rows: 27 });
  service.resize(session, { cols: 101, rows: 31 }, grant);
  service.write(session, process.platform === "win32"
    ? "echo OWNED_PTY_READY\r\nexit 7\r\n"
    : "test -t 0 && test -t 1 && printf '\\nOWNED_PTY_READY\\n'; pwd; stty size; exit 7\r", grant);
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const read = service.read(session, cursor); cursor = read.cursor;
    output += read.chunks.map((chunk) => chunk.data).join("");
    if (!read.eof) continue;
    assert.equal(read.session.state, "exited"); assert.equal(read.session.exitCode, 7);
    assert.match(output, /OWNED_PTY_READY/);
    if (process.platform !== "win32") { assert.ok(output.includes(directory)); assert.match(output, /31\s+101/); }
    console.log(JSON.stringify({ ok: true, provider: "node-pty", electron: process.versions.electron,
      abi: process.versions.modules, platform: process.platform, arch: process.arch, tty: true, exitCode: read.session.exitCode,
      cwd: "owned-temporary-directory", resized: "101x31" }));
    service.close(session); break;
  }
  // Prove app teardown settles a still-running, owned terminal rather than only
  // observing a shell that already exited naturally.
  const active = service.open(grant);
  service.write(active, process.platform === "win32" ? "echo CLOSE_READY\r\n" : "printf '\\nCLOSE_READY\\n'\r", grant);
  let closeCursor = 0; let closeOutput = "";
  while (!closeOutput.includes("\r\nCLOSE_READY\r\n")) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const read = service.read(active, closeCursor); closeCursor = read.cursor;
    closeOutput += read.chunks.map((chunk) => chunk.data).join("");
  }
  assert.ok(service.currentOperation());
  await service.destroy(); assert.equal(service.currentOperation(), null);
  console.log(JSON.stringify({ ok: true, ownedLivePtyCleanup: "exit-observed" }));
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { clearTimeout(deadline); service.closeAll(); fs.rmSync(directory, { recursive: true, force: true }); });
