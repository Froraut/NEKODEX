import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { waitForUpdateCommit } = require("../launcher/electron/update-commit.cjs");
const { compareReleaseVersions, pruneRuntimeVersions } = require("../launcher/electron/runtime-install.cjs");

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function transaction(phase?: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-commit-"));
  roots.push(root);
  const recovery = path.join(root, "NEKODEX.app.update-recovery");
  fs.mkdirSync(recovery);
  const executable = path.join(root, "NEKODEX");
  fs.writeFileSync(executable, "new launcher");
  if (phase) fs.writeFileSync(path.join(recovery, "transaction.json"), JSON.stringify({ phase }));
  return { root, recovery, executable, handoff: { filename: path.join(recovery, "ready.json"), token: "a".repeat(64) } };
}

test("a committed journal authorizes the runtime switch", async () => {
  const { handoff, executable } = transaction("committed");
  expect(await waitForUpdateCommit(handoff, { executablePath: executable, timeoutMs: 1_000 }))
    .toMatchObject({ status: "committed", evidence: "journal" });
});

test("a rollback phase keeps the previous runtime for the restored application", async () => {
  const { handoff, executable } = transaction("rollback-pending-stop");
  expect(await waitForUpdateCommit(handoff, { executablePath: executable, timeoutMs: 1_000 }))
    .toMatchObject({ status: "rolled-back" });
});

test("a removed journal proves the commit only while this launcher's executable is unchanged", async () => {
  const kept = transaction("awaiting-readiness");
  const keptWait = waitForUpdateCommit(kept.handoff, { executablePath: kept.executable, timeoutMs: 5_000, intervalMs: 20 });
  await Bun.sleep(60);
  fs.rmSync(kept.recovery, { recursive: true, force: true });
  expect(await keptWait).toMatchObject({ status: "committed", evidence: "journal-removed", phase: "awaiting-readiness" });

  const replaced = transaction("awaiting-readiness");
  const replacedWait = waitForUpdateCommit(replaced.handoff, { executablePath: replaced.executable, timeoutMs: 5_000, intervalMs: 20 });
  await Bun.sleep(60);
  // A rollback moves this app aside and restores the previous one at the same path.
  fs.renameSync(replaced.executable, `${replaced.executable}.failed`);
  fs.writeFileSync(replaced.executable, "previous launcher");
  fs.rmSync(replaced.recovery, { recursive: true, force: true });
  expect(await replacedWait).toMatchObject({ status: "rolled-back", evidence: "executable-replaced" });
});

test("no evidence before the deadline or a quitting launcher never switches the runtime", async () => {
  const pending = transaction("awaiting-readiness");
  expect(await waitForUpdateCommit(pending.handoff, { executablePath: pending.executable, timeoutMs: 50, intervalMs: 10 }))
    .toMatchObject({ status: "unknown", phase: "awaiting-readiness" });
  expect(await waitForUpdateCommit(pending.handoff, { executablePath: pending.executable, isCancelled: () => true }))
    .toMatchObject({ status: "cancelled" });
});

test("release versions order numerically, including the fork prerelease", () => {
  expect(["6.1.9-nekodex.1", "6.1.29-nekodex.1", "6.1.10-nekodex.2", "6.1.10-nekodex.1"].sort(compareReleaseVersions))
    .toEqual(["6.1.9-nekodex.1", "6.1.10-nekodex.1", "6.1.10-nekodex.2", "6.1.29-nekodex.1"]);
});

test("pruning keeps live versions, one rollback release and newer unknown installs", () => {
  const coreHome = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-prune-"));
  roots.push(coreHome);
  const versions = path.join(coreHome, "versions");
  const now = Date.now();
  const names = ["6.1.15", "6.1.27", "6.1.28", "6.1.29", "6.1.30"].map(version => `${version}-nekodex.1-darwin-arm64`)
    .concat(["6.1.10-nekodex.1-linux-x64", `6.1.29-nekodex.1-darwin-arm64.tmp-1-${now - 2 * 60 * 60 * 1000}`,
      `6.1.29-nekodex.1-darwin-arm64.tmp-2-${now}`]);
  for (const name of names) fs.mkdirSync(path.join(versions, name), { recursive: true });
  const result = pruneRuntimeVersions({ coreHome, keepVersions: ["6.1.29-nekodex.1", undefined],
    platform: "darwin", arch: "arm64", now });
  expect(result.removed.sort()).toEqual([
    "6.1.15-nekodex.1-darwin-arm64", "6.1.27-nekodex.1-darwin-arm64",
    `6.1.29-nekodex.1-darwin-arm64.tmp-1-${now - 2 * 60 * 60 * 1000}`,
  ].sort());
  expect(fs.readdirSync(versions).sort()).toEqual([
    "6.1.10-nekodex.1-linux-x64", "6.1.28-nekodex.1-darwin-arm64", "6.1.29-nekodex.1-darwin-arm64",
    `6.1.29-nekodex.1-darwin-arm64.tmp-2-${now}`, "6.1.30-nekodex.1-darwin-arm64",
  ].sort());
  expect(pruneRuntimeVersions({ coreHome: path.join(coreHome, "missing"), keepVersions: [] })).toEqual({ removed: [], kept: [] });
});
