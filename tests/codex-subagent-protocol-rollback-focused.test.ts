import { afterEach, expect, spyOn, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fs from "node:fs";
import * as configModule from "../src/config";
import { installCodexIntegration, setCodexSubagentProtocol } from "../src/codex-integration";
import { getCodexJournalPath, getCodexJournalRecoveryPath, restoreFileSnapshot, snapshotFile, writeFileSnapshot } from "../src/codex-integration-shared";

const originalEnv = { codex: process.env.CODEX_HOME, app: process.env.CODEX_CHATGPT_WEB_HOME };
let root: string;
let restoreSpy: (() => void) | undefined;
afterEach(() => {
  restoreSpy?.(); restoreSpy = undefined;
  for (const [key, value] of [["CODEX_HOME", originalEnv.codex], ["CODEX_CHATGPT_WEB_HOME", originalEnv.app]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
  if (root) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  root = mkdtempSync(join(tmpdir(), "protocol-rollback-"));
  process.env.CODEX_HOME = join(root, "codex");
  process.env.CODEX_CHATGPT_WEB_HOME = join(root, "app");
  mkdirSync(process.env.CODEX_HOME);
  const configPath = join(process.env.CODEX_HOME, "config.toml");
  const hooksPath = join(process.env.CODEX_HOME, "hooks.json");
  writeFileSync(join(root, "config-target"), 'model = "gpt-5.6-sol"\n');
  writeFileSync(join(root, "hooks-target"), '{"hooks":{}}\n');
  symlinkSync(join(root, "config-target"), configPath);
  symlinkSync(join(root, "hooks-target"), hooksPath);
  const config = { ...configModule.defaultConfig(), subagentProtocol: "native" as const };
  configModule.saveConfig(config);
  installCodexIntegration(config);
  const paths = [configPath, hooksPath, getCodexJournalPath(), getCodexJournalRecoveryPath(), configModule.getConfigPath()];
  const before = paths.map(path => readFileSync(path, "utf8"));
  return { config, configPath, hooksPath, paths, before };
}
function failRuntimeWrite(beforeFailure: () => void = () => {}) {
  const original = configModule.atomicWriteFile;
  const runtimePath = configModule.getConfigPath();
  const spy = spyOn(configModule, "atomicWriteFile").mockImplementation((path, data, options) => {
    if (path.startsWith(`${runtimePath}.integration-`)) { beforeFailure(); throw new Error("runtime save injected failure"); }
    return original(path, data, options);
  });
  restoreSpy = () => spy.mockRestore();
}
test("runtime save failure rolls back committed symlink targets and journals without replacing links", () => {
  const f = fixture();
  const identities = [f.configPath, f.hooksPath].map(path => lstatSync(path).ino);
  failRuntimeWrite();
  expect(() => setCodexSubagentProtocol(f.config, "compatibility-v1")).toThrow("runtime save injected failure");
  expect(f.paths.map(path => readFileSync(path, "utf8"))).toEqual(f.before);
  expect([f.configPath, f.hooksPath].map(path => lstatSync(path).ino)).toEqual(identities);
});
test("concurrent edit survives protocol compensation and is reported with the primary failure", () => {
  const f = fixture();
  failRuntimeWrite(() => writeFileSync(f.configPath, "# concurrent owner\n"));
  let failure: unknown;
  try { setCodexSubagentProtocol(f.config, "compatibility-v1"); } catch (error) { failure = error; }
  expect(String(failure)).toContain("runtime save injected failure");
  expect(String(failure)).toContain("preserving the external edit");
  expect(readFileSync(f.configPath, "utf8")).toBe("# concurrent owner\n");
  expect(readFileSync(f.hooksPath, "utf8")).toBe(f.before[1]!);
});
test("successful two-way protocol switch updates runtime and journals and preserves symlinks", () => {
  const f = fixture();
  for (const protocol of ["compatibility-v1", "native"] as const) {
    expect(setCodexSubagentProtocol(f.config, protocol).installed.subagent_protocol).toBe(protocol);
    expect(configModule.loadConfig().subagentProtocol).toBe(protocol);
    expect(JSON.parse(readFileSync(getCodexJournalPath(), "utf8")).installed.subagent_protocol).toBe(protocol);
    expect(lstatSync(f.configPath).isSymbolicLink()).toBe(true);
    expect(lstatSync(f.hooksPath).isSymbolicLink()).toBe(true);
  }
});

test("replacement symlink to the same target survives compensation", () => {
  const f = fixture();
  let replacementInode = 0;
  failRuntimeWrite(() => {
    // Retain the original link so its inode cannot be reused by the replacement.
    fs.renameSync(f.configPath, `${f.configPath}.previous-link`);
    symlinkSync(join(root, "config-target"), f.configPath);
    replacementInode = lstatSync(f.configPath).ino;
  });
  expect(() => setCodexSubagentProtocol(f.config, "compatibility-v1")).toThrow("preserving the external edit");
  expect(lstatSync(f.configPath).ino).toBe(replacementInode);
});

test("committed receipt does not adopt a destination replaced immediately after publication", () => {
  fixture();
  const path = join(root, "receipt.txt");
  writeFileSync(path, "original");
  const before = snapshotFile(path);
  const rename = fs.renameSync;
  const spy = spyOn(fs, "renameSync").mockImplementation((from, to) => {
    rename(from, to);
    if (to === path) { rename(path, `${path}.owned`); writeFileSync(path, "external replacement"); }
  });
  let receipt;
  try { receipt = writeFileSnapshot(before, "owned"); } finally { spy.mockRestore(); }
  expect(() => restoreFileSnapshot(before, { expectedCurrent: receipt })).toThrow("preserving the external edit");
  expect(readFileSync(path, "utf8")).toBe("external replacement");
});

for (const guard of ["expectedSnapshot", "expectedData-only"] as const) {
test(`${guard}: Windows rename retry rechecks ownership after backoff and preserves a concurrent edit`, () => {
  fixture();
  const path = join(root, "retry.txt");
  writeFileSync(path, "original");
  const before = snapshotFile(path);
  const rename = fs.renameSync;
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  let attempts = 0;
  const spy = spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (to === path && ++attempts === 1) {
      writeFileSync(path, "concurrent edit during retry");
      throw Object.assign(new Error("busy injected"), { code: "EBUSY" });
    }
    rename(from, to);
  });
  try {
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });
    expect(() => writeFileSnapshot(before, "owned", guard === "expectedSnapshot"
      ? { expectedSnapshot: before } : { expectedData: before.data })).toThrow("preserving the external edit");
  } finally {
    Object.defineProperty(process, "platform", platform);
    spy.mockRestore();
  }
  expect(attempts).toBe(1);
  expect(readFileSync(path, "utf8")).toBe("concurrent edit during retry");
  expect(fs.readdirSync(root).some(name => name.startsWith("retry.txt.integration-"))).toBe(false);
});
}
