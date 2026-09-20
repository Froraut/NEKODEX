import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { beginDirectoryBuild } = require("../scripts/build-output.cjs");

test("hardening: build output retains the last good bundle and refuses source or unowned paths", () => {
  const root = mkdtempSync(join(tmpdir(), "nekodex-output-owner-"));
  const repo = join(root, "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  const target = join(repo, "dist", "runtime");
  mkdirSync(target, { recursive: true });
  const manifest = { schemaVersion: 2, appVersion: "5.4.0-nekodex.1", entrypoint: "app/cli.js", launcher: "bin/codex-chatgpt-web", files: [] };
  writeFileSync(join(target, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(target, "usable"), "old");
  const options = { repositoryRoot: repo, kind: "runtime" };
  try {
    expect(() => beginDirectoryBuild(repo, options)).toThrow("repository");
    expect(() => beginDirectoryBuild(join(repo, "src"), options)).toThrow("generated-output");
    const foreign = join(root, "documents"); mkdirSync(foreign); writeFileSync(join(foreign, "private"), "keep");
    expect(() => beginDirectoryBuild(foreign, options)).toThrow("unowned");
    const failed = beginDirectoryBuild(target, options);
    writeFileSync(join(failed.staging, "partial"), "incomplete");
    failed.dispose();
    expect(readFileSync(join(target, "usable"), "utf8")).toBe("old");
    const next = beginDirectoryBuild(target, options);
    writeFileSync(join(next.staging, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(next.staging, "usable"), "new");
    next.commit(); next.dispose();
    expect(readFileSync(join(target, "usable"), "utf8")).toBe("new");
    expect(existsSync(next.staging)).toBe(false);
    expect(readFileSync(join(foreign, "private"), "utf8")).toBe("keep");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
