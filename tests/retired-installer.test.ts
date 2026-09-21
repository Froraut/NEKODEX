import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test.skipIf(process.platform === "win32")("retired installer exits without downloading, executing, or changing an existing installation", () => {
  const root = mkdtempSync(join(tmpdir(), "retired-installer-"));
  try {
    const bin = join(root, "commands");
    const library = join(root, "library");
    const marker = join(root, "unexpected-command");
    mkdirSync(bin); mkdirSync(library);
    writeFileSync(join(library, "existing-runtime"), "preserve-existing-runtime");
    for (const name of ["curl", "tar", "install", "shasum"]) {
      writeFileSync(join(bin, name), '#!/bin/sh\nprintf "%s" called > "$INSTALLER_COMMAND_MARKER"\nexit 99\n', { mode: 0o755 });
    }
    const result = spawnSync("/bin/sh", [resolve("scripts/install.sh"), "--full"], {
      encoding: "utf8", timeout: 3_000,
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, INSTALLER_COMMAND_MARKER: marker,
        CODEX_CHATGPT_WEB_LIB_DIR: library, CODEX_CHATGPT_WEB_BIN_DIR: join(root, "output-bin"),
        CODEX_CHATGPT_WEB_DOC_DIR: join(root, "output-docs") },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("retired");
    expect(result.stderr).toContain("https://github.com/Froraut/NEKODEX/releases");
    expect(existsSync(marker)).toBe(false);
    expect(readdirSync(library)).toEqual(["existing-runtime"]);
    expect(readFileSync(join(library, "existing-runtime"), "utf8")).toBe("preserve-existing-runtime");
    expect(existsSync(join(root, "output-bin"))).toBe(false);
    expect(existsSync(join(root, "output-docs"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
