import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createUpdateController } = require("../launcher/electron/update.cjs");

test("Check for updates asks GitHub again right away, with no cooldown", async () => {
  const logsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-recheck-"));
  let fetches = 0;
  const controller = createUpdateController({
    currentVersion: "6.1.30-nekodex.1", platform: "darwin", arch: "arm64", packaged: true,
    executablePath: "/Applications/NEKODEX.app/Contents/MacOS/NEKODEX", runtimeExecutable: "/usr/bin/true",
    logsDirectory, publish: () => {},
    dependencies: { fetchRelease: async () => { fetches += 1; return []; } },
  });
  try {
    expect((await controller.recheck()).status).toBe("up-to-date");
    expect((await controller.recheck()).status).toBe("up-to-date");
    expect(fetches).toBe(2);
    // Overlapping clicks still share one request.
    await Promise.all([controller.recheck(), controller.recheck()]);
    expect(fetches).toBe(3);
  } finally {
    controller.dispose?.();
    fs.rmSync(logsDirectory, { recursive: true, force: true });
  }
});
