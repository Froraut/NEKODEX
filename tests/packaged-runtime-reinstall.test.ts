import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { ensurePackagedRuntime, installedRuntimeRoot } = require("../launcher/electron/runtime-install.cjs");

const VERSION = "9.9.9-reinstall";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function writeBundle(root: string, build: Record<string, unknown>) {
  const contents: Record<string, string> = {
    "app/browser-helper.cjs": "module.exports = {};\n",
    "app/cli.js": "console.log('cli');\n",
    "bin/codex-chatgpt-web": "#!/bin/sh\n",
    "runtime/bun": "#!/bin/sh\n",
  };
  const files = Object.keys(contents).sort().map(path => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), contents[path]!);
    return { path, size: Buffer.byteLength(contents[path]!), sha256: createHash("sha256").update(contents[path]!).digest("hex") };
  });
  chmodSync(join(root, "runtime/bun"), 0o755);
  const digest = createHash("sha256");
  for (const file of files) digest.update(`${file.path}\0${file.size}\0${file.sha256}\0`);
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify({ schemaVersion: 2, appVersion: VERSION,
    platform: process.platform, arch: process.arch, launcher: "bin/codex-chatgpt-web", entrypoint: "app/cli.js",
    bunVersion: "1.4.0", playwright: "1.0.0", build, bundleId: digest.digest("hex"), files }, null, 2)}\n`);
}

function install(build: Record<string, unknown>, coreHome: string) {
  const resourcesPath = mkdtempSync(join(tmpdir(), "nekodex-resources-"));
  roots.push(resourcesPath);
  writeBundle(join(resourcesPath, "runtime"), build);
  const app = { isPackaged: true, getVersion: () => VERSION };
  const runtimeRoot = ensurePackagedRuntime({ app, coreHome, resourcesPath });
  return { runtimeRoot, sealed: readFileSync(join(resourcesPath, "runtime", "manifest.json")) };
}

test("a same-version rebuild with unchanged files replaces the durable manifest", () => {
  const coreHome = mkdtempSync(join(tmpdir(), "nekodex-core-"));
  roots.push(coreHome);
  const first = install({ commit: "aaaa", builtAt: "2026-10-20T18:28:00.000Z" }, coreHome);
  expect(readFileSync(join(first.runtimeRoot, "manifest.json")).equals(first.sealed)).toBe(true);

  // Same files, so the same bundleId; only the build metadata in the manifest differs.
  const second = install({ commit: "bbbb", builtAt: "2026-10-20T18:43:00.000Z" }, coreHome);
  expect(second.runtimeRoot).toBe(first.runtimeRoot);
  expect(readFileSync(join(second.runtimeRoot, "manifest.json")).equals(second.sealed)).toBe(true);
});

test("an identical durable copy is reused as it is", () => {
  const coreHome = mkdtempSync(join(tmpdir(), "nekodex-core-"));
  roots.push(coreHome);
  const build = { commit: "aaaa", builtAt: "2026-10-20T18:28:00.000Z" };
  const first = install(build, coreHome);
  // A reinstall renames a fresh copy into place, which changes the directory's inode.
  const inode = statSync(first.runtimeRoot).ino;
  const second = install(build, coreHome);
  expect(second.runtimeRoot).toBe(first.runtimeRoot);
  expect(statSync(second.runtimeRoot).ino).toBe(inode);
});

test("Finder metadata does not make a committed runtime unusable; any other unmanifested file does", () => {
  const coreHome = mkdtempSync(join(tmpdir(), "nekodex-core-"));
  roots.push(coreHome);
  const root = join(coreHome, "versions", `${VERSION}-${process.platform}-${process.arch}`);
  writeBundle(root, { commit: "aaaa" });
  // Revealing the desktop helper in Finder leaves this behind; it rolled back an app update.
  writeFileSync(join(root, "app", ".DS_Store"), "finder");
  expect(installedRuntimeRoot({ coreHome, version: VERSION })).toBe(root);
  writeFileSync(join(root, "app", "injected.js"), "process.exit(1)");
  expect(() => installedRuntimeRoot({ coreHome, version: VERSION })).toThrow(/unmanifested file/);
});
