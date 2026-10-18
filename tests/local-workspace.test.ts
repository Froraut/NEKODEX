import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync,
  rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalWorkspaceService } from "../launcher/electron/local-workspace.cjs";

const require = createRequire(import.meta.url);
const { createLocalWorkspaceService, LIMITS } = require("../launcher/electron/local-workspace.cjs");

function fixture() {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-workspace-")));
  const root = join(parent, "repo");
  mkdirSync(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  }).trim();
  git("init", "-q");
  git("config", "user.email", "workspace-test@example.invalid");
  git("config", "user.name", "Workspace fixture");
  writeFileSync(join(root, "note.txt"), "original\n");
  git("add", "note.txt"); git("commit", "-qm", "fixture");
  const registryPath = join(parent, "private", "registry.json");
  const open = () => createLocalWorkspaceService({ pickDirectory: async () => root, registryPath }) as LocalWorkspaceService;
  return { parent, root, registryPath, git, open, close: () => rmSync(parent, { recursive: true, force: true }) };
}

test("a picker grant survives restart; conflicting editor text survives without overwriting an external edit", async () => {
  const f = fixture();
  try {
    const service = f.open();
    expect(service.listRoots()).toEqual([]);
    expect(() => service.preview(f.root, "note.txt")).toThrow("Select a workspace");
    const selected = (await service.pickRoot())!;
    expect((await service.pickRoot())!.id).toBe(selected.id);
    const opened = service.preview(selected.id, "note.txt");
    expect(opened.text).toBe("original\n");
    writeFileSync(join(f.root, "note.txt"), "another editor\n");
    const conflict = service.save(selected.id, { path: "note.txt", expectedRevision: opened.revision, text: "my draft\n" });
    expect(conflict.state).toBe("conflict");
    expect(readFileSync(join(f.root, "note.txt"), "utf8")).toBe("another editor\n");
    const restored = f.open();
    expect(restored.listRoots()[0].id).toBe(selected.id);
    expect(restored.listDrafts(selected.id)[0].text).toBe("my draft\n");
    expect(() => restored.forgetRoot(selected.id)).toThrow("drafts");
    const draft = restored.listDrafts(selected.id)[0];
    const refreshed = restored.preview(selected.id, draft.path);
    const saved = restored.save(selected.id, { path: draft.path, expectedRevision: refreshed.revision,
      text: draft.text, draftId: draft.id });
    expect(saved.state).toBe("saved");
    expect(readFileSync(join(f.root, "note.txt"), "utf8")).toBe("my draft\n");
    expect(restored.listDrafts(selected.id)).toEqual([]);
    expect(statSync(f.registryPath).mode & 0o077).toBe(0);
    expect(restored.forgetRoot(selected.id)).toBe(true);
    expect(() => restored.preview(selected.id, "note.txt")).toThrow("Select a workspace");
  } finally { f.close(); }
}, 10000);

test("symlinks and replaced parents cannot turn an existing grant into access to another directory", async () => {
  const f = fixture();
  try {
    const service = f.open(); const selected = (await service.pickRoot())!;
    const outside = join(f.parent, "outside"); mkdirSync(outside);
    writeFileSync(join(outside, "secret.txt"), "untouched");
    mkdirSync(join(f.root, "nested"));
    writeFileSync(join(f.root, "nested", "secret.txt"), "inside");
    const opened = service.preview(selected.id, "nested/secret.txt");
    renameSync(join(f.root, "nested"), join(f.root, "old-nested"));
    symlinkSync(outside, join(f.root, "nested"), "dir");
    expect(service.list(selected.id).entries.find((entry) => entry.name === "nested")!.kind).toBe("blocked-link");
    expect(() => service.preview(selected.id, "nested/secret.txt")).toThrow("Symbolic links");
    const blocked = service.save(selected.id, { path: "nested/secret.txt", text: "overwrite", expectedRevision: opened.revision });
    expect(blocked).toMatchObject({ state: "blocked", code: "SYMLINK_BLOCKED" });
    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("untouched");
    expect(service.listDrafts(selected.id)[0].text).toBe("overwrite");
    expect(() => service.preview(selected.id, "../outside/secret.txt")).toThrow("escaping");
    expect(() => service.preview(selected.id, "/etc/passwd")).toThrow("relative");
    writeFileSync(join(f.root, "large.txt"), "x".repeat(LIMITS.previewBytes + 1));
    expect(service.preview(selected.id, "large.txt").state).toBe("truncated");
    writeFileSync(join(f.root, "binary.dat"), Buffer.from([0, 1, 2]));
    expect(service.preview(selected.id, "binary.dat")).toMatchObject({ state: "binary", text: null });
    renameSync(f.root, join(f.parent, "moved-repo"));
    mkdirSync(f.root); writeFileSync(join(f.root, "note.txt"), "replacement");
    expect(() => service.preview(selected.id, "note.txt")).toThrow("parent changed");
    expect(service.listDrafts(selected.id)[0].text).toBe("overwrite");
  } finally { f.close(); }
}, 10000);

test("Git inspection disables repository callbacks and keeps an immutable stale diff with captured commit identities", async () => {
  const f = fixture();
  try {
    const marker = join(f.parent, "callback-ran");
    const callback = join(f.parent, "callback.sh");
    writeFileSync(callback, `#!/bin/sh\necho invoked > '${marker}'\n`); chmodSync(callback, 0o700);
    const filterMarker = join(f.parent, "filter-ran");
    const filter = join(f.parent, "filter.sh");
    writeFileSync(filter, `#!/bin/sh\necho invoked > '${filterMarker}'\ncat\n`); chmodSync(filter, 0o700);
    f.git("config", "filter.fixture.clean", filter);
    f.git("config", "filter.fixture.smudge", filter);
    f.git("config", "filter.fixture.required", "true");
    f.git("config", "core.fsmonitor", callback);
    f.git("config", "diff.external", callback);
    f.git("config", "diff.fixture.textconv", callback);
    writeFileSync(join(f.root, ".gitattributes"), "*.txt diff=fixture filter=fixture\n");
    // Keep the tracked byte length so status must compare content rather than
    // short-circuiting from the size difference.
    writeFileSync(join(f.root, "note.txt"), "edit one\n");
    // Establish that this valid fixture reaches the dangerous boundary: an
    // ordinary status really invokes its configured clean filter.
    f.git("-c", "core.fsmonitor=false", "status", "--porcelain");
    expect(existsSync(filterMarker)).toBe(true);
    rmSync(filterMarker);
    const service = f.open(); const selected = (await service.pickRoot())!;
    const snapshot = await service.gitStatus(selected.id);
    expect(snapshot.state).toBe("ready");
    if (snapshot.state !== "ready") throw new Error("Expected fixture Git snapshot");
    expect(snapshot.headOid).toBe(f.git("rev-parse", "HEAD"));
    expect(snapshot.baseOid).toBe(snapshot.headOid);
    const first = await service.gitDiff(selected.id, snapshot.snapshotId);
    expect(first.state).toBe("current"); expect(first.text).toContain("+edit one");
    writeFileSync(join(f.root, "note.txt"), "second edit\n");
    const stale = await service.gitDiff(selected.id, snapshot.snapshotId);
    expect(stale.state).toBe("stale"); expect(stale.text).toContain("+edit one");
    expect(stale.text).not.toContain("+second edit");
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(filterMarker)).toBe(false);
    // A fresh snapshot explicitly selects the new bytes; the old snapshot never shifts.
    const refreshed = await service.gitStatus(selected.id);
    expect(refreshed.state).toBe("ready");
    if (refreshed.state === "ready") expect((await service.gitDiff(selected.id, refreshed.snapshotId)).text).toContain("+second edit");
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(filterMarker)).toBe(false);
  } finally { f.close(); }
}, 15000);
