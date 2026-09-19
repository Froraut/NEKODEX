const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { stageWindowsSmoke } = require("../scripts/stage-windows-smoke.cjs");

test("September19 Windows smoke stages payload without executing an installer or using the registry", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-smoke-isolation-"));
  const installer = path.join(scratch, "NEKODEX-installer.exe");
  const calls = [];
  try {
    const executable = stageWindowsSmoke({ installer, scratch, productName: "NEKODEX", run(command, args) {
      assert.notEqual(command, installer);
      assert.equal(path.basename(command), "7z.exe");
      assert.ok(!args.includes("/S") && !args.includes("/currentuser"));
      calls.push(args);
      if (args[0] === "e") fs.writeFileSync(path.join(scratch, "windows-payload", "app-64.7z"), "fixture");
      else fs.writeFileSync(path.join(scratch, "windows-app", "NEKODEX.exe"), "fixture");
    } });
    assert.equal(executable, path.join(scratch, "windows-app", "NEKODEX.exe"));
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes("$PLUGINSDIR/app-64.7z"));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});
