import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { installCodexIntegration, deactivateCodexIntegration, uninstallCodexIntegration } from "../src/codex-integration";
import { getCodexJournalPath, getCodexJournalRecoveryPath, snapshotFile, writeFileSnapshot, restoreFileSnapshot } from "../src/codex-integration-shared";

import { defaultConfig } from "../src/config";

const env = { ...process.env };
let root: string;
afterEach(() => {
  for (const key of ["CODEX_HOME", "CODEX_CHATGPT_WEB_HOME"]) {
    if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
  }
  if (root) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  root = fs.mkdtempSync(join(tmpdir(), "integration-wave3-"));
  process.env.CODEX_HOME = join(root, "codex");
  process.env.CODEX_CHATGPT_WEB_HOME = join(root, "app");
  fs.mkdirSync(process.env.CODEX_HOME);
  return join(process.env.CODEX_HOME, "config.toml");
}
for (const timing of ["before", "after"] as const) {
test(`legacy uninstall preserves intended-byte replacement ${timing} publication`, () => {
  const path = fixture();
  const providerBlock = '[model_providers.bridge]\nname = "bridge"\n';
  fs.writeFileSync(path, 'model_provider = "bridge"\nmodel_catalog_json = "catalog.json"\n' + providerBlock);
  const journal = {
    version: 2, configPath: path, catalogPath: join(root, "absent-catalog"), catalogSha256: "unused", providerBlock,
    installed: { model_provider: "bridge", model_catalog_json: "catalog.json" },
    previous: { model_provider: { present: false }, model_catalog_json: { present: false } },
  };
  fs.mkdirSync(dirname(getCodexJournalPath()), { recursive: true });
  for (const p of [getCodexJournalPath(), getCodexJournalRecoveryPath()]) fs.writeFileSync(p, JSON.stringify(journal));
  const rename = fs.renameSync;
  const remove = fs.rmSync;
  let externalBytes: Buffer | undefined;
  let externalInode: number | undefined;
  const renameSpy = spyOn(fs, "renameSync").mockImplementation((from, to) => {
    rename(from, to);
    const replacesBeforeGuard = timing === "before" && String(to).startsWith(`${path}.integration-`);
    if ((replacesBeforeGuard || (timing === "after" && to === path)) && !externalBytes) {
      externalBytes = fs.readFileSync(replacesBeforeGuard ? to : path);
      rename(path, `${path}.owned`);
      fs.writeFileSync(path, externalBytes);
      externalInode = fs.lstatSync(path).ino;
    }
  });
  const removeSpy = spyOn(fs, "rmSync").mockImplementation((p, options) => {
    if (p === getCodexJournalPath()) throw new Error("journal removal injected");
    return remove(p, options);
  });
  try {
    expect(() => uninstallCodexIntegration()).toThrow("preserving the external edit");
    expect(fs.readFileSync(path).equals(externalBytes!)).toBe(true);
    expect(fs.lstatSync(path).ino).toBe(externalInode!);
  } finally { renameSpy.mockRestore(); removeSpy.mockRestore(); }
});
}
for (const phase of ["write", "rollback"] as const) {
  test(`symlink target permission edit survives guarded ${phase}`, () => {
    const path = fixture();
    const target = join(root, "target");
    fs.writeFileSync(target, "original", { mode: 0o640 });
    fs.symlinkSync(target, path);
    const before = snapshotFile(path, { followSymlink: true });
    const owned = phase === "rollback" ? writeFileSnapshot(before, "managed", { expectedSnapshot: before }) : before;
    fs.chmodSync(target, 0o600);
    expect(() => phase === "rollback"
      ? restoreFileSnapshot(before, { expectedCurrent: owned })
      : writeFileSnapshot(before, "managed", { expectedSnapshot: before })).toThrow("preserving the external edit");
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(target, "utf8")).toBe(phase === "rollback" ? "managed" : "original");
    expect(fs.lstatSync(path).isSymbolicLink()).toBe(true);
  });
}

test("regular-file rollback preserves external chmod and managed writes still default to 0600", () => {
  const path = fixture();
  fs.writeFileSync(path, "original", { mode: 0o640 });
  const before = snapshotFile(path);
  const owned = writeFileSnapshot(before, "managed", { expectedSnapshot: before });
  expect(fs.statSync(path).mode & 0o777).toBe(0o600);
  fs.chmodSync(path, 0o640);
  const inode = fs.lstatSync(path).ino;
  expect(() => restoreFileSnapshot(before, { expectedCurrent: owned })).toThrow("preserving the external edit");
  expect(fs.readFileSync(path, "utf8")).toBe("managed");
  expect(fs.statSync(path).mode & 0o777).toBe(0o640);
  expect(fs.lstatSync(path).ino).toBe(inode);
});

test("uninstall compensates committed journal removal when later removal fails", () => {
  const path = fixture();
  fs.writeFileSync(path, 'model = "gpt-5.6-sol"\n');
  installCodexIntegration({ ...defaultConfig(), subagentProtocol: "native" });
  deactivateCodexIntegration();
  const before = [path, getCodexJournalPath(), getCodexJournalRecoveryPath()]
    .map(p => fs.readFileSync(p, "utf8"));
  const remove = fs.rmSync;
  const spy = spyOn(fs, "rmSync").mockImplementation((p, options) => {
    if (p === getCodexJournalRecoveryPath()) throw new Error("recovery removal injected");
    return remove(p, options);
  });
  try {
    expect(() => uninstallCodexIntegration()).toThrow("recovery removal injected");
    expect([path, getCodexJournalPath(), getCodexJournalRecoveryPath()]
      .map(p => fs.readFileSync(p, "utf8"))).toEqual(before);
  } finally { spy.mockRestore(); }
});
