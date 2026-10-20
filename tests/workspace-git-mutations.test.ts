import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
  statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceGitService } from "../launcher/electron/workspace-git-mutations.cjs";
const require = createRequire(import.meta.url);
const { createWorkspaceGitService } = require("../launcher/electron/workspace-git-mutations.cjs");
const { createLocalWorkspaceService } = require("../launcher/electron/local-workspace.cjs");
const { registerWorkspaceGitIpc } = require("../launcher/electron/ipc/workspace-git.cjs");

async function fixture() {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-worktree-")));
  const root = join(parent, "repo"); mkdirSync(root);
  const gitAt = (directory: string, ...args: string[]) => execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  }).trim();
  const git = (...args: string[]) => gitAt(root, ...args);
  git("init", "-q"); git("config", "user.email", "workspace@example.invalid"); git("config", "user.name", "Workspace fixture");
  writeFileSync(join(root, "one.txt"), "first\n"); writeFileSync(join(root, "two.txt"), "second\n");
  git("add", "."); git("commit", "-qm", "fixture");
  const grants = createLocalWorkspaceService({ pickDirectory: async () => root, registryPath: join(parent, "grants", "registry.json") });
  const selected = await grants.pickRoot();
  const storagePath = join(parent, "private");
  const open = (options: { canArchiveWorktree?: (sourceRootId: string, worktreeId: string) => boolean } = {}) => createWorkspaceGitService({ resolveWorkspace: (id: string) => grants.resolveGrant(id), storagePath, ...options }) as WorkspaceGitService;
  return { parent, root, id: selected.id as string, grants, storagePath, git, gitAt, open, close: () => rmSync(parent, { recursive: true, force: true }) };
}

test("managed worktree checkout blocks hooks and filter callbacks, captures OID and reuses only owned work", async () => {
  const f = await fixture();
  try {
    const marker = join(f.parent, "executed");
    const callback = join(f.parent, "callback.sh");
    writeFileSync(callback, `#!/bin/sh\necho invoked >> '${marker}'\ncat\n`); chmodSync(callback, 0o700);
    const hooks = join(f.parent, "hooks"); mkdirSync(hooks); writeFileSync(join(hooks, "post-checkout"), readFileSync(callback)); chmodSync(join(hooks, "post-checkout"), 0o700);
    f.git("config", "core.hooksPath", hooks); f.git("config", "core.fsmonitor", callback);
    f.git("config", "filter.hostile.smudge", callback); f.git("config", "filter.hostile.clean", callback);
    f.git("config", "filter.hostile.process", callback); f.git("config", "filter.hostile.required", "true");
    // Commit attributes with callback overrides so only the service's checkout could execute the hostile callback.
    writeFileSync(join(f.root, ".gitattributes"), "*.txt filter=hostile\n");
    f.git("-c", "core.fsmonitor=false", "-c", "core.hooksPath=", "-c", "filter.hostile.process=", "-c", "filter.hostile.clean=", "-c", "filter.hostile.required=false", "add", ".gitattributes");
    f.git("-c", "core.fsmonitor=false", "-c", "core.hooksPath=", "-c", "filter.hostile.process=", "-c", "filter.hostile.clean=", "-c", "filter.hostile.required=false", "commit", "-qm", "attributes");
    const head = f.git("-c", "core.fsmonitor=false", "rev-parse", "HEAD");
    const service = f.open();
    const worktree = await service.createWorktree(f.id, { name: "feature-one", expectedHeadOid: head });
    expect(worktree).toMatchObject({ state: "ready", branch: "codex/feature-one", headOid: head, reused: false });
    expect(readFileSync(join(worktree.path, "one.txt"), "utf8")).toBe("first\n");
    expect(existsSync(marker)).toBe(false);
    writeFileSync(join(worktree.path, "one.txt"), "owned dirty work\n");
    const reused = await f.open().createWorktree(f.id, { name: "feature-one", expectedHeadOid: head });
    expect(reused.id).toBe(worktree.id); expect(reused.reused).toBe(true);
    expect(readFileSync(join(worktree.path, "one.txt"), "utf8")).toBe("owned dirty work\n");
    expect((await service.listWorktrees(f.id))[0].dirty).toBe(true);
    expect(existsSync(marker)).toBe(false);
    await expect(service.createWorktree(f.id, { name: "../../escape", expectedHeadOid: head })).rejects.toThrow();
    await expect(service.createWorktree(f.id, { name: "stale", expectedHeadOid: "0".repeat(40) })).rejects.toThrow("HEAD changed");
    expect(statSync(join(f.storagePath, "registry.json")).mode & 0o077).toBe(0);
  } finally { f.close(); }
}, 15000);

test("snapshot selected restore previews changes, survives restart, rejects stale files and retains preimages", async () => {
  const f = await fixture();
  try {
    const service = f.open();
    const snapshot = service.createSnapshot(f.id, { paths: ["one.txt", "two.txt", "new.txt"], label: "Before editing" });
    writeFileSync(join(f.root, "one.txt"), "changed one\n"); writeFileSync(join(f.root, "two.txt"), "leave two\n");
    writeFileSync(join(f.root, "new.txt"), "new file\n");
    const restored = f.open(); expect(restored.listSnapshots(f.id)[0].id).toBe(snapshot.id);
    const stale = restored.previewRestore(f.id, { snapshotId: snapshot.id, paths: ["one.txt"] });
    expect(stale.files[0]).toMatchObject({ currentText: "changed one\n", targetText: "first\n", changed: true });
    writeFileSync(join(f.root, "one.txt"), "another owner\n");
    expect(() => restored.restoreSnapshot(f.id, { previewId: stale.previewId })).toThrow("changed after preview");
    expect(readFileSync(join(f.root, "one.txt"), "utf8")).toBe("another owner\n");
    const preview = restored.previewRestore(f.id, { snapshotId: snapshot.id, paths: ["one.txt", "new.txt"] });
    const receipt = restored.restoreSnapshot(f.id, { previewId: preview.previewId });
    expect(receipt).toMatchObject({ state: "complete", restoredPaths: ["one.txt", "new.txt"] });
    expect(readFileSync(join(f.root, "one.txt"), "utf8")).toBe("first\n");
    expect(readFileSync(join(f.root, "two.txt"), "utf8")).toBe("leave two\n"); expect(existsSync(join(f.root, "new.txt"))).toBe(false);
    const recovery = restored.previewRestore(f.id, { snapshotId: receipt.recoverySnapshotId, paths: ["one.txt", "new.txt"] });
    expect(recovery.files.map((file) => file.targetText)).toEqual(["another owner\n", "new file\n"]);
    restored.restoreSnapshot(f.id, { previewId: recovery.previewId });
    expect(readFileSync(join(f.root, "new.txt"), "utf8")).toBe("new file\n");
    symlinkSync(join(f.parent, "outside"), join(f.root, "link.txt"));
    expect(() => restored.createSnapshot(f.id, { paths: ["link.txt"] })).toThrow("regular files");
    expect(() => restored.createSnapshot(f.id, { paths: ["../outside"] })).toThrow();
    expect(() => restored.createSnapshot(f.root, { paths: ["one.txt"] })).toThrow();
  } finally { f.close(); }
}, 10000);

test("explicit worktree archive retains dirty bytes, ignored data, staged state and committed identity", async () => {
  const f = await fixture();
  try {
    let allowArchive = true;
    const service = f.open({ canArchiveWorktree: (sourceId, worktreeId) => sourceId === f.id && !!worktreeId && allowArchive });
    const head = f.git("rev-parse", "HEAD");
    const worktree = await service.createWorktree(f.id, { name: "archive-me", expectedHeadOid: head });
    writeFileSync(join(worktree.path, "one.txt"), "staged edit\n"); f.gitAt(worktree.path, "add", "one.txt");
    writeFileSync(join(worktree.path, "one.txt"), "unstaged edit\n");
    writeFileSync(join(worktree.path, ".gitignore"), "ignored.dat\n"); writeFileSync(join(worktree.path, "ignored.dat"), "important ignored content\n");
    const stale = await service.previewArchive(f.id, worktree.id);
    writeFileSync(join(worktree.path, "one.txt"), "edit after preview\n");
    await expect(service.archiveWorktree(f.id, { previewId: stale.previewId })).rejects.toThrow("contents changed");
    expect(existsSync(worktree.path)).toBe(true);
    const preview = await service.previewArchive(f.id, worktree.id);
    allowArchive = false;
    await expect(service.previewArchive(f.id, worktree.id)).rejects.toThrow("derived workspace folder first");
    await expect(service.archiveWorktree(f.id, { previewId: preview.previewId })).rejects.toThrow("derived workspace folder first");
    expect(existsSync(worktree.path)).toBe(true); expect(service.listSnapshots(f.id)).toEqual([]);
    allowArchive = true;
    const archive = await service.archiveWorktree(f.id, { previewId: preview.previewId });
    expect(archive.state).toBe("archived"); expect(existsSync(worktree.path)).toBe(false);
    expect(readFileSync(join(archive.archivePath!, "one.txt"), "utf8")).toBe("edit after preview\n");
    expect(readFileSync(join(archive.archivePath!, "ignored.dat"), "utf8")).toBe("important ignored content\n");
    expect(f.gitAt(archive.archivePath!, "show", ":one.txt")).toBe("staged edit");
    expect(f.git("rev-parse", archive.recoveryRef!)).toBe(head);
    expect(f.open().listSnapshots(f.id).some((entry) => entry.id === archive.recoverySnapshotId)).toBe(true);
    const recovery = service.previewRestore(f.id, { snapshotId: archive.recoverySnapshotId!, paths: ["one.txt"] });
    expect(recovery.files[0].targetText).toBe("edit after preview\n");
  } finally { f.close(); }
}, 15000);

test("guarded IPC rejects renderer paths, extra metadata and unexpected arguments", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>(); let calls = 0;
  const service = new Proxy({}, { get: () => () => { calls++; } });
  registerWorkspaceGitIpc({ registerIpcHandler: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler), service });
  const id = "12345678-1234-1234-1234-123456789abc";
  expect(() => handlers.get("launcher:workspace-snapshot-create")!({}, id, { paths: ["one.txt"], storagePath: "/tmp" })).toThrow();
  expect(() => handlers.get("launcher:workspace-snapshot-create")!({}, id, { paths: ["../secret"] })).toThrow();
  expect(() => handlers.get("launcher:workspace-worktrees")!({}, id, "/tmp")).toThrow();
  expect(() => handlers.get("launcher:workspace-worktree-create")!({}, id, { name: "../bad", expectedHeadOid: "a".repeat(40) })).toThrow();
  expect(calls).toBe(0);
  handlers.get("launcher:workspace-snapshot-create")!({}, id, { paths: ["one.txt"] }); expect(calls).toBe(1);
});

test("managed destination parents reject symlinks before Git creates or moves a checkout outside private storage", async () => {
  const f = await fixture();
  try {
    const service = f.open(); const head = f.git("rev-parse", "HEAD");
    const outside = join(f.parent, "outside"); mkdirSync(outside);
    const worktreeParent = join(f.storagePath, "worktrees");
    symlinkSync(outside, worktreeParent, "dir");
    await expect(service.createWorktree(f.id, { name: "outside-create", expectedHeadOid: head })).rejects.toThrow("ancestry");
    expect(f.git("branch", "--list", "codex/outside-create")).toBe("");
    expect(f.git("worktree", "list", "--porcelain").includes(outside)).toBe(false);
    expect((await import("node:fs")).readdirSync(outside)).toEqual([]);
    rmSync(worktreeParent);
    const worktree = await service.createWorktree(f.id, { name: "stay-inside", expectedHeadOid: head });
    symlinkSync(outside, join(f.storagePath, "archives"), "dir");
    const preview = await service.previewArchive(f.id, worktree.id);
    await expect(service.archiveWorktree(f.id, { previewId: preview.previewId })).rejects.toThrow("ancestry");
    expect(existsSync(worktree.path)).toBe(true);
    expect((await import("node:fs")).readdirSync(outside)).toEqual([]);
    expect(f.git("worktree", "list", "--porcelain").includes(`worktree ${worktree.path}`)).toBe(true);
  } finally { f.close(); }
}, 10000);

test("shutdown closes admission and joins the exact Git mutation through its durable receipt", async () => {
  const f = await fixture();
  const childProcess = require("node:child_process");
  const originalSpawn = childProcess.spawn;
  const modulePath = require.resolve("../launcher/electron/workspace-git-mutations.cjs");
  const cached = require.cache[modulePath];
  let releaseTerminal: (() => void) | undefined;
  let reachedTerminal!: () => void;
  const checkoutExited = new Promise<void>((resolve) => { reachedTerminal = resolve; });
  try {
    // Only delay close-event delivery after real Git has created the checkout and exited.
    childProcess.spawn = (command: string, argv: string[], options: object) => {
      const child = originalSpawn(command, argv, options);
      if (argv.includes("worktree") && argv.includes("add")) {
        const emit = child.emit;
        child.emit = function (event: string, ...values: unknown[]) {
          if (event === "close") {
            releaseTerminal = () => { emit.call(child, event, ...values); };
            reachedTerminal(); return false;
          }
          return emit.call(child, event, ...values);
        };
      }
      return child;
    };
    delete require.cache[modulePath];
    const isolated = require(modulePath).createWorkspaceGitService;
    const service = isolated({ resolveWorkspace: (id: string) => f.grants.resolveGrant(id), storagePath: f.storagePath }) as WorkspaceGitService;
    childProcess.spawn = originalSpawn;
    const creation = service.createWorktree(f.id, { name: "shutdown-owner", expectedHeadOid: f.git("rev-parse", "HEAD") });
    await checkoutExited;
    const pending = JSON.parse(readFileSync(join(f.storagePath, "registry.json"), "utf8")).worktrees[0];
    expect(pending.state).toBe("creating"); expect(existsSync(join(pending.path, "one.txt"))).toBe(true);
    expect(service.currentOperation()).toContain(`workspace ${f.id}`);
    await expect(service.resolveManagedRoot(f.id, pending.id)).rejects.toThrow("already active");
    let shutdownSettled = false;
    const shutdown = service.destroy(); void shutdown.then(() => { shutdownSettled = true; });
    expect(service.destroy()).toBe(shutdown);
    await Promise.resolve(); expect(shutdownSettled).toBe(false);
    await expect(service.createWorktree(f.id, { name: "not-admitted", expectedHeadOid: pending.headOid })).rejects.toThrow("shutting down");
    expect(() => service.createSnapshot(f.id, { paths: ["one.txt"] })).toThrow("shutting down");
    await expect(service.listWorktrees(f.id)).rejects.toThrow("shutting down");
    releaseTerminal!(); releaseTerminal = undefined;
    const result = await creation; await shutdown;
    expect(result.state).toBe("ready"); expect(shutdownSettled).toBe(true); expect(service.currentOperation()).toBe(null);
    const saved = JSON.parse(readFileSync(join(f.storagePath, "registry.json"), "utf8")).worktrees[0];
    expect(saved.state).toBe("ready"); expect(saved.id).toBe(result.id);
    const inspector = f.open();
    expect(await inspector.resolveManagedRoot(f.id, result.id)).toEqual({ id: result.id, path: result.path });
    await expect(inspector.resolveManagedRoot(f.id, f.id)).rejects.toThrow("ownership receipt");
    await inspector.destroy();
    // A rejected owner also retires its active slot; it cannot leak a Quit blocker.
    const rejectedOwner = isolated({ resolveWorkspace: (id: string) => f.grants.resolveGrant(id), storagePath: f.storagePath }) as WorkspaceGitService;
    await expect(rejectedOwner.createWorktree(f.id, { name: "../invalid", expectedHeadOid: pending.headOid })).rejects.toThrow();
    expect(rejectedOwner.currentOperation()).toBe(null); await rejectedOwner.destroy();
  } finally {
    releaseTerminal?.(); childProcess.spawn = originalSpawn;
    if (cached) require.cache[modulePath] = cached; else delete require.cache[modulePath];
    f.close();
  }
}, 10000);
