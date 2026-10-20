import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { createLocalWorkspaceService } = require("../launcher/electron/local-workspace.cjs");

test("managed workspace opening accepts owner identities only, persists derived authority and rechecks its source after awaiting", async () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-derived-root-")));
  try {
    const source = join(parent, "source"); const owned = join(parent, "owned-checkout"); const spoof = join(parent, "spoof");
    for (const directory of [source, owned, spoof]) mkdirSync(directory);
    writeFileSync(join(owned, "file.txt"), "owned checkout"); writeFileSync(join(spoof, "file.txt"), "not granted");
    const worktreeId = randomUUID(); const pendingId = randomUUID();
    let resolverCalls = 0; let release: ((value: { id: string; path: string }) => void) | undefined;
    const options = { pickDirectory: async () => source, registryPath: join(parent, "private", "registry.json"),
      resolveManagedWorktree: async (sourceId: string, selectedId: string) => {
        resolverCalls++; expect(sourceId).toBe(selected.id);
        if (selectedId === worktreeId) return { id: worktreeId, path: owned };
        if (selectedId === pendingId) return await new Promise<{ id: string; path: string }>((resolve) => { release = resolve; });
        throw new Error("Not an owned READY checkout");
      } };
    const service = createLocalWorkspaceService(options);
    const selected = await service.pickRoot();
    await expect(service.openManagedRoot(selected.id, worktreeId, spoof)).rejects.toThrow("identifiers only");
    await expect(service.openManagedRoot(selected.id, spoof)).rejects.toThrow("identifiers only");
    expect(resolverCalls).toBe(0);
    const opened = await service.openManagedRoot(selected.id, worktreeId);
    expect(opened.path).toBe(owned);
    expect(service.preview(opened.id, "file.txt").text).toBe("owned checkout");
    expect(service.hasManagedRootGrant(selected.id, worktreeId)).toBe(true);
    expect((await service.openManagedRoot(selected.id, worktreeId)).id).toBe(opened.id);
    expect(service.listRoots()).toHaveLength(2);
    const restored = createLocalWorkspaceService(options);
    expect(restored.hasManagedRootGrant(selected.id, worktreeId)).toBe(true);
    expect(restored.preview(opened.id, "file.txt").text).toBe("owned checkout");
    expect(() => restored.forgetRoot(selected.id)).toThrow("derived worktree");
    const preview = restored.preview(opened.id, "file.txt");
    const draft = restored.retainDraft(opened.id, { path: "file.txt", text: "retained work", expectedRevision: preview.revision });
    expect(() => restored.forgetRoot(opened.id)).toThrow("drafts");
    restored.discardDraft(opened.id, draft.id);
    expect(restored.forgetRoot(opened.id)).toBe(true);
    expect(restored.hasManagedRootGrant(selected.id, worktreeId)).toBe(false);
    const opening = restored.openManagedRoot(selected.id, pendingId);
    expect(release).toBeDefined();
    expect(restored.hasManagedRootGrant(selected.id, pendingId)).toBe(true);
    renameSync(source, `${source}-original`); mkdirSync(source);
    release!({ id: pendingId, path: owned });
    await expect(opening).rejects.toThrow("parent changed");
    expect(restored.listRoots()).toHaveLength(1);
    expect(restored.hasManagedRootGrant(selected.id, pendingId)).toBe(false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
}, 10000);
