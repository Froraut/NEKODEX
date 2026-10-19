"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");
const { createAgentWorkspaceGrantAuthority } = require("./agent-workspace-grant.cjs");

const LIMITS = Object.freeze({ roots: 32, entries: 300, treeEntries: 600, depth: 4,
  previewBytes: 256 * 1024, gitBytes: 512 * 1024, drafts: 40, snapshots: 24, baseRefs: 128, bases: 512 });
const digest = (value) => createHash("sha256").update(value).digest("hex");
const sameNode = (a, b) => String(a.dev) === String(b.dev) && String(a.ino) === String(b.ino);
const identity = (stat) => ({ dev: String(stat.dev), ino: String(stat.ino) });
const binaryIdentity = (stat) => ({ ...identity(stat), birthtimeNs: String(stat.birthtimeNs) });
const sameBinaryNode = (a, b) => a && b && sameNode(a, b) && /^\d+$/.test(a.birthtimeNs) && a.birthtimeNs === b.birthtimeNs;
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function relativeParts(value, allowRoot = false) {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\0")
      || path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.includes("\\")) {
    fail("INVALID_PATH", "Use a workspace-relative path.");
  }
  if (value === "" && allowRoot) return [];
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) {
    fail("INVALID_PATH", "The path contains a reserved or escaping component.");
  }
  return parts;
}
function ancestry(directory) {
  const result = [];
  for (let current = directory; ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("ROOT_CHANGED", "Workspace ancestry changed.");
    result.push({ path: current, ...identity(stat) });
    if (path.dirname(current) === current) break;
  }
  return result;
}
function textOf(bytes) {
  if (bytes.includes(0)) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return null; }
}

/** Only the composition root supplies pickDirectory. No renderer-supplied path grants access. */
function createLocalWorkspaceService({ pickDirectory, registryPath = null, agentWorkspaceGrantKeyPath = null,
  resolveManagedWorktree = null } = {}) {
  if (typeof pickDirectory !== "function") throw new TypeError("A trusted directory picker port is required.");
  if (resolveManagedWorktree !== null && typeof resolveManagedWorktree !== "function") {
    throw new TypeError("Managed worktrees require a trusted main-process resolver.");
  }
  if (registryPath !== null && (!path.isAbsolute(registryPath) || typeof registryPath !== "string")) {
    throw new TypeError("registryPath must be an absolute private application file.");
  }
  const roots = new Map();
  const drafts = new Map();
  const snapshots = new Map();
  const gitBaseChoices = new Map();
  const managedOpenings = new Map();
  const binaryCaptures = new WeakMap();
  const agentGrants = agentWorkspaceGrantKeyPath ? createAgentWorkspaceGrantAuthority({ keyPath: agentWorkspaceGrantKeyPath }) : null;
  let picking = false;

  function persist() {
    if (!registryPath) return;
    if (fs.existsSync(registryPath) && fs.lstatSync(registryPath).isSymbolicLink()) {
      fail("REGISTRY_UNSAFE", "Workspace registry must be a private regular file.");
    }
    writePrivateFileAtomic(registryPath, JSON.stringify({ version: 1,
      roots: [...roots.values()], drafts: [...drafts.values()] }),
    { protectDirectory: false, durable: true });
  }
  if (registryPath && fs.existsSync(registryPath)) {
    const stat = fs.lstatSync(registryPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024
        || (typeof process.getuid === "function" && stat.uid !== process.getuid())
        || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
      fail("REGISTRY_UNSAFE", "Workspace registry must be a bounded private regular file.");
    }
    const saved = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    if (saved.version !== 1 || !Array.isArray(saved.roots) || !Array.isArray(saved.drafts)
        || saved.roots.length > LIMITS.roots || saved.drafts.length > LIMITS.drafts) {
      fail("REGISTRY_INVALID", "Workspace registry is invalid; preserve it for recovery.");
    }
    for (const root of saved.roots) {
      if (typeof root.id !== "string" || !/^[-a-f0-9]{36}$/.test(root.id)
          || typeof root.path !== "string" || !path.isAbsolute(root.path)
          || !["native-directory-picker", "managed-worktree"].includes(root.provenance) || !Array.isArray(root.ancestry)
          || root.ancestry.length === 0 || root.ancestry[0]?.path !== root.path
          || !root.ancestry.every((node) => typeof node.path === "string" && path.isAbsolute(node.path)
            && /^\d+$/.test(node.dev) && /^\d+$/.test(node.ino))) {
        fail("REGISTRY_INVALID", "Workspace grant is invalid.");
      }
      if ((root.managedWorktrees !== undefined && (!Array.isArray(root.managedWorktrees) || root.managedWorktrees.length > 32
          || root.managedWorktrees.some((binding) => !binding || typeof binding.sourceRootId !== "string"
            || !/^[a-f0-9-]{36}$/.test(binding.sourceRootId) || binding.sourceRootId === root.id
            || typeof binding.worktreeId !== "string" || !/^[a-f0-9-]{36}$/.test(binding.worktreeId))
          || new Set(root.managedWorktrees.map((binding) => `${binding.sourceRootId}:${binding.worktreeId}`)).size !== root.managedWorktrees.length))
          || (root.provenance === "managed-worktree" && !root.managedWorktrees?.length)) {
        fail("REGISTRY_INVALID", "Managed workspace provenance is invalid.");
      }
      roots.set(root.id, Object.freeze(root));
    }
    for (const root of roots.values()) for (const binding of root.managedWorktrees || []) {
      if (!roots.has(binding.sourceRootId)) fail("REGISTRY_INVALID", "Managed workspace source grant is missing.");
    }
    for (const draft of saved.drafts) {
      if (typeof draft.id !== "string" || !roots.has(draft.workspaceId)
          || typeof draft.text !== "string" || Buffer.byteLength(draft.text) > LIMITS.previewBytes
          || (draft.expectedRevision !== null && typeof draft.expectedRevision !== "string")) {
        fail("REGISTRY_INVALID", "Workspace draft is invalid.");
      }
      relativeParts(draft.path);
      drafts.set(draft.id, Object.freeze(draft));
    }
  }

  function rootFor(id, visited = new Set()) {
    const root = roots.get(id);
    if (!root) fail("WORKSPACE_UNKNOWN", "Select a workspace first.");
    if (visited.has(id)) fail("REGISTRY_INVALID", "Workspace provenance has a cycle.");
    visited.add(id);
    if (root.provenance === "managed-worktree") {
      for (const binding of root.managedWorktrees) rootFor(binding.sourceRootId, new Set(visited));
    }
    try {
      const actual = ancestry(root.path);
      if (fs.realpathSync(root.path) !== root.path || actual.length !== root.ancestry.length
          || actual.some((node, i) => node.path !== root.ancestry[i].path || !sameNode(node, root.ancestry[i]))) {
        fail("ROOT_CHANGED", "The selected directory or a parent changed. Select it again.");
      }
    } catch (error) {
      if (error.code === "ROOT_CHANGED") throw error;
      fail("ROOT_CHANGED", "The selected directory is unavailable. Select it again.");
    }
    return root;
  }
  function resolve(id, relative, { allowRoot = false, missing = false } = {}) {
    const root = rootFor(id);
    const parts = relativeParts(relative, allowRoot);
    let target = root.path;
    const parents = [];
    for (let index = 0; index < parts.length; index++) {
      target = path.join(target, parts[index]);
      let stat;
      try { stat = fs.lstatSync(target); } catch (error) {
        if (missing && index === parts.length - 1 && error.code === "ENOENT") {
          return { root, target, stat: null, parents };
        }
        throw error;
      }
      if (stat.isSymbolicLink()) fail("SYMLINK_BLOCKED", "Symbolic links are not followed by workspace operations.");
      if (index < parts.length - 1 && !stat.isDirectory()) fail("INVALID_PATH", "A parent is not a directory.");
      if (index < parts.length - 1) parents.push({ path: target, ...identity(stat) });
    }
    const stat = fs.lstatSync(target);
    return { root, target, stat, parents };
  }
  function unchangedParents(captured) {
    rootFor(captured.root.id);
    for (const parent of captured.parents) {
      const actual = fs.lstatSync(parent.path);
      if (actual.isSymbolicLink() || !actual.isDirectory() || !sameNode(actual, parent)) {
        fail("PARENT_CHANGED", "A file parent changed; the draft is retained.");
      }
    }
  }
  function readFile(id, relative) {
    const captured = resolve(id, relative, { missing: true });
    if (!captured.stat) return { path: relative, state: "missing", revision: null, text: "", size: 0 };
    if (!captured.stat.isFile()) fail("NOT_FILE", "Select a regular file.");
    if (captured.stat.nlink !== 1) fail("HARDLINK_BLOCKED", "Files with multiple hard links are not opened by the workspace editor.");
    const fd = fs.openSync(captured.target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const before = fs.fstatSync(fd);
      if (!sameNode(before, captured.stat)) fail("FILE_CHANGED", "The file changed while opening it.");
      const buffer = Buffer.alloc(Math.min(before.size, LIMITS.previewBytes) + 1);
      const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const bytes = buffer.subarray(0, Math.min(count, LIMITS.previewBytes));
      const after = fs.fstatSync(fd);
      unchangedParents(captured);
      const current = resolve(id, relative);
      if (!sameNode(after, current.stat) || before.size !== after.size
          || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
        fail("FILE_CHANGED", "The file changed while reading it.");
      }
      const truncated = after.size > LIMITS.previewBytes || count > LIMITS.previewBytes;
      const text = textOf(bytes);
      return { path: relative, state: text === null ? "binary" : truncated ? "truncated" : "text",
        revision: digest(Buffer.concat([Buffer.from(JSON.stringify({ ...identity(after), size: after.size,
          mtime: after.mtimeMs, ctime: after.ctimeMs })), bytes])),
        text: text === null ? null : text, size: after.size, truncated };
    } finally { fs.closeSync(fd); }
  }
  // Main-only binary publication seam. Shares root/ancestry ownership with the
  // editor; no renderer path grant or second filesystem writer is introduced.
  function captureBinary(id, relative) {
    const captured = resolve(id, relative, { missing: true });
    const retained = [...drafts.values()].some(d => {
      const grant = roots.get(d.workspaceId); if (!grant) return false;
      const target = path.join(grant.path, d.path);
      if (target !== captured.target && !(process.platform === "darwin" && target.toLowerCase() === captured.target.toLowerCase())) return false;
      // Parent/nested picker grants can address the same target. Validate only
      // the matching grant's ancestry; never inspect another draft's contents.
      rootFor(d.workspaceId); return true;
    });
    if (retained) fail("DRAFTS_RETAINED", "Resolve this file's retained draft before exporting.");
    const parentDigest = digest(JSON.stringify([captured.root.ancestry, captured.parents]));
    const metadata = { workspaceId: id, path: relative, rootIdentity: identity(fs.lstatSync(captured.root.path)), parentDigest,
      revision: null, sha256: null, size: 0, mode: null, node: null };
    if (captured.stat) {
      if (!captured.stat.isFile() || captured.stat.nlink !== 1 || (captured.stat.mode & 0o7000)) fail("BINARY_UNSAFE", "Export requires an ordinary single-link file.");
      const fd = fs.openSync(captured.target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const before = fs.fstatSync(fd, { bigint: true });
        if (!sameNode(before, captured.stat) || before.nlink !== 1n || (before.mode & 0o7000n) || before.size > 16n * 1024n * 1024n) fail("BINARY_UNSAFE", "Export destination exceeds its bounded file policy.");
        const hasher = createHash("sha256"), buffer = Buffer.alloc(65536); let total = 0;
        while (true) { const n = fs.readSync(fd, buffer, 0, buffer.length, null); if (!n) break; total += n; if (total > 16 * 1024 * 1024) fail("FILE_CHANGED", "Export destination grew while reading."); hasher.update(buffer.subarray(0, n)); }
        const after = fs.fstatSync(fd, { bigint: true }); unchangedParents(captured); const current = resolve(id, relative);
        if (!sameNode(after, current.stat) || after.nlink !== 1n || current.stat.nlink !== 1 || ["size", "mtimeNs", "ctimeNs", "mode", "uid", "gid"].some(k => after[k] !== before[k])) fail("FILE_CHANGED", "Export destination changed while reading.");
        metadata.sha256 = hasher.digest("hex"); metadata.size = total; metadata.mode = Number(after.mode & 0o777n);
        metadata.node = { ...binaryIdentity(after), size: String(after.size), mtimeNs: String(after.mtimeNs), ctimeNs: String(after.ctimeNs), mode: String(after.mode), uid: String(after.uid), gid: String(after.gid) };
        metadata.revision = digest(JSON.stringify({ node: metadata.node, sha256: metadata.sha256 }));
      } finally { fs.closeSync(fd); }
    }
    const value = Object.freeze(metadata); binaryCaptures.set(value, captured); return value;
  }
  function publishBinary(capture, data, beforePublish) {
    const captured = binaryCaptures.get(capture);
    if (!captured || !Buffer.isBuffer(data) && !(data instanceof Uint8Array) || data.byteLength > 16 * 1024 * 1024 || typeof beforePublish !== "function") fail("BINARY_UNSAFE", "Exact main-owned binary publication required.");
    const bytes = Buffer.from(data), candidateSha256 = digest(bytes); let temporary = null, candidateNode = null, renameAttempted = false;
    try {
      const fresh = captureBinary(capture.workspaceId, capture.path);
      if (fresh.revision !== capture.revision || fresh.parentDigest !== capture.parentDigest || !sameNode(fresh.rootIdentity, capture.rootIdentity)) return { state: "conflict", code: "DESTINATION_STALE" };
      const candidatePath = path.join(path.dirname(captured.target), `.nekodex-vm-export-${randomUUID()}`);
      const fd = fs.openSync(candidatePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, capture.mode ?? 0o600);
      temporary = candidatePath; candidateNode = binaryIdentity(fs.fstatSync(fd, { bigint: true }));
      try { fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, capture.mode ?? 0o600); fs.fsyncSync(fd); candidateNode = binaryIdentity(fs.fstatSync(fd, { bigint: true })); } finally { fs.closeSync(fd); }
      beforePublish(Object.freeze({ node: candidateNode, sha256: candidateSha256, size: bytes.length, rootIdentity: capture.rootIdentity, parentDigest: capture.parentDigest }));
      unchangedParents(captured); const current = captureBinary(capture.workspaceId, capture.path);
      if (current.revision !== capture.revision || current.parentDigest !== capture.parentDigest || !sameNode(current.rootIdentity, capture.rootIdentity)) return { state: "conflict", code: "DESTINATION_STALE" };
      // Synchronous final checks/rename prevent application-turn interleaving;
      // this is not adversarial OS filesystem CAS or a multi-file transaction.
      const staged = fs.lstatSync(temporary, { bigint: true });
      if (!staged.isFile() || staged.nlink !== 1n || !sameBinaryNode(binaryIdentity(staged), candidateNode)) return { state: "blocked", code: "PUBLICATION_NOT_STARTED" };
      renameAttempted = true; fs.renameSync(temporary, captured.target); temporary = null;
      const written = captureBinary(capture.workspaceId, capture.path);
      if (!sameBinaryNode(written.node, candidateNode) || written.sha256 !== candidateSha256 || written.size !== bytes.length) return { state: "unknown", code: "PUBLICATION_UNCONFIRMED" };
      const parent = fs.openSync(path.dirname(captured.target), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
      unchangedParents(captured); return { state: "written", revision: written.revision, sha256: written.sha256, size: written.size, node: written.node };
    } catch { return { state: renameAttempted ? "unknown" : "blocked", code: renameAttempted ? "PUBLICATION_UNCONFIRMED" : "PUBLICATION_NOT_STARTED" }; }
    finally { if (temporary) { try { unchangedParents(captured); const node = fs.lstatSync(temporary, { bigint: true }); if (node.isFile() && !node.isSymbolicLink() && candidateNode && sameBinaryNode(binaryIdentity(node), candidateNode)) fs.unlinkSync(temporary); } catch {} } }
  }
  function confirmBinaryPublication(id, relative, proof) {
    const capture = captureBinary(id, relative);
    if (!proof || !capture.node || !sameBinaryNode(capture.node, proof.node) || capture.sha256 !== proof.sha256 || capture.size !== proof.size
        || !sameNode(capture.rootIdentity, proof.rootIdentity) || capture.parentDigest !== proof.parentDigest) return null;
    const captured = binaryCaptures.get(capture), fd = fs.openSync(path.dirname(captured.target), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const current = captureBinary(id, relative); if (current.revision !== capture.revision) return null;
    return { state: "written", revision: current.revision, sha256: current.sha256, size: current.size, node: current.node };
  }
  function list(id, relative = "") {
    const captured = resolve(id, relative, { allowRoot: true });
    if (!captured.stat.isDirectory()) fail("NOT_DIRECTORY", "Select a directory.");
    const entries = [];
    const directory = fs.opendirSync(captured.target);
    let more = false;
    try {
      for (let entry; (entry = directory.readSync());) {
        if (entry.name.toLowerCase() === ".git") continue;
        if (entries.length >= LIMITS.entries) { more = true; break; }
        entries.push({ name: entry.name, path: relative ? `${relative}/${entry.name}` : entry.name,
          kind: entry.isSymbolicLink() ? "blocked-link" : entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "unsupported" });
      }
      unchangedParents(captured);
      if (!sameNode(resolve(id, relative, { allowRoot: true }).stat, captured.stat)) {
        fail("PARENT_CHANGED", "The directory changed during listing.");
      }
    } finally { directory.closeSync(); }
    entries.sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name));
    return { path: relative, entries, truncated: more };
  }
  function publicRoot(root) {
    return { id: root.id, name: path.basename(root.path) || root.path, path: root.path, selectedAt: root.selectedAt };
  }
  async function pickRoot() {
    if (picking) fail("PICKER_BUSY", "A workspace picker is already open.");
    picking = true;
    try {
      const selected = await pickDirectory();
      if (selected === null || selected === undefined) return null;
      if (typeof selected !== "string" || !path.isAbsolute(selected)) fail("INVALID_PICKER_RESULT", "The native picker returned an invalid directory.");
      const canonical = fs.realpathSync(selected);
      const chain = ancestry(canonical);
      for (const existing of roots.values()) {
        if (existing.path === canonical && sameNode(existing.ancestry[0], chain[0])) {
          try { rootFor(existing.id); return publicRoot(existing); } catch {}
        }
      }
      if (roots.size >= LIMITS.roots) fail("ROOT_LIMIT", "Remove an unused workspace before selecting another.");
      const root = Object.freeze({ id: randomUUID(), path: canonical, selectedAt: new Date().toISOString(),
        provenance: "native-directory-picker", ancestry: chain });
      roots.set(root.id, root);
      try { persist(); } catch (error) { roots.delete(root.id); throw error; }
      return publicRoot(root);
    } finally { picking = false; }
  }
  async function openManagedRoot(sourceRootId, worktreeId) {
    if (arguments.length !== 2 || typeof sourceRootId !== "string" || !/^[a-f0-9-]{36}$/.test(sourceRootId)
        || typeof worktreeId !== "string" || !/^[a-f0-9-]{36}$/.test(worktreeId)) {
      fail("INVALID_MANAGED_WORKTREE", "Open a managed worktree by source and worktree identifiers only.");
    }
    const key = `${sourceRootId}:${worktreeId}`;
    managedOpenings.set(key, (managedOpenings.get(key) || 0) + 1);
    try { return await resolveAndRegisterManagedRoot(sourceRootId, worktreeId); }
    finally {
      const remaining = managedOpenings.get(key) - 1;
      if (remaining > 0) managedOpenings.set(key, remaining); else managedOpenings.delete(key);
    }
  }
  async function resolveAndRegisterManagedRoot(sourceRootId, worktreeId) {
    if (!resolveManagedWorktree) fail("MANAGED_WORKTREE_UNAVAILABLE", "The managed worktree resolver is unavailable.");
    rootFor(sourceRootId);
    // Only the captured main-process owner can turn these identities into a path.
    const resolved = await resolveManagedWorktree(sourceRootId, worktreeId);
    rootFor(sourceRootId);
    if (!resolved || resolved.id !== worktreeId || typeof resolved.path !== "string" || !path.isAbsolute(resolved.path)
        || fs.realpathSync(resolved.path) !== resolved.path) {
      fail("INVALID_MANAGED_WORKTREE", "The owner did not return the exact canonical managed checkout.");
    }
    const captured = ancestry(resolved.path);
    const binding = Object.freeze({ sourceRootId, worktreeId });
    for (const existing of roots.values()) {
      if (existing.path !== resolved.path || !sameNode(existing.ancestry[0], captured[0])) continue;
      rootFor(existing.id);
      const seen = new Set();
      const dependsOn = (id) => {
        if (id === existing.id) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return (roots.get(id)?.managedWorktrees || []).some((entry) => dependsOn(entry.sourceRootId));
      };
      if (dependsOn(sourceRootId)) fail("INVALID_MANAGED_WORKTREE", "A managed checkout cannot become its own provenance source.");
      if ((existing.managedWorktrees || []).some((entry) => entry.sourceRootId === sourceRootId && entry.worktreeId === worktreeId)) {
        return publicRoot(existing);
      }
      if ((existing.managedWorktrees || []).length >= 32) fail("ROOT_LIMIT", "This workspace has too many managed checkout bindings.");
      const updated = Object.freeze({ ...existing, managedWorktrees: [...(existing.managedWorktrees || []), binding] });
      roots.set(existing.id, updated);
      try { persist(); } catch (error) { roots.set(existing.id, existing); throw error; }
      return publicRoot(updated);
    }
    if (roots.size >= LIMITS.roots) fail("ROOT_LIMIT", "Remove an unused workspace before opening another.");
    const root = Object.freeze({ id: randomUUID(), path: resolved.path, selectedAt: new Date().toISOString(),
      provenance: "managed-worktree", ancestry: captured, managedWorktrees: [binding] });
    roots.set(root.id, root);
    try { persist(); } catch (error) { roots.delete(root.id); throw error; }
    return publicRoot(root);
  }
  function retainDraft(id, input) {
    rootFor(id);
    relativeParts(input.path);
    if (typeof input.text !== "string" || Buffer.byteLength(input.text) > LIMITS.previewBytes
        || input.text.includes("\0") || (input.expectedRevision !== null
          && (typeof input.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedRevision)))) {
      fail("INVALID_DRAFT", "Save requires bounded UTF-8 text and the opened file revision.");
    }
    const previous = input.draftId ? drafts.get(input.draftId)
      : [...drafts.values()].find((draft) => draft.workspaceId === id && draft.path === input.path);
    if (input.draftId && (!previous || previous.workspaceId !== id || previous.path !== input.path)) {
      fail("DRAFT_UNKNOWN", "The draft does not belong to this workspace and file.");
    }
    if (!previous && drafts.size >= LIMITS.drafts) fail("DRAFT_LIMIT", "Resolve or discard an existing draft first.");
    const draft = Object.freeze({ id: previous?.id || randomUUID(), workspaceId: id, path: input.path,
      text: input.text, expectedRevision: input.expectedRevision, updatedAt: new Date().toISOString() });
    drafts.set(draft.id, draft);
    try { persist(); } catch (error) {
      if (previous) drafts.set(previous.id, previous); else drafts.delete(draft.id);
      throw error;
    }
    return draft;
  }
  function save(id, input) {
    const draft = retainDraft(id, input);
    let temporary = null;
    let writeBoundary = null;
    try {
      const before = readFile(id, draft.path);
      if (before.revision !== draft.expectedRevision || !["text", "missing"].includes(before.state)) {
        return { state: "conflict", draftId: draft.id, currentRevision: before.revision, currentState: before.state };
      }
      const captured = resolve(id, draft.path, { missing: true });
      writeBoundary = captured;
      temporary = path.join(path.dirname(captured.target), `.nekodex-save-${randomUUID()}`);
      const fd = fs.openSync(temporary, "wx", captured.stat ? captured.stat.mode & 0o777 : 0o600);
      try { fs.writeFileSync(fd, draft.text, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      unchangedParents(captured);
      const current = readFile(id, draft.path);
      if (current.revision !== draft.expectedRevision) {
        return { state: "conflict", draftId: draft.id, currentRevision: current.revision, currentState: current.state };
      }
      // All filesystem checks and the final rename are synchronous: no application turn
      // can interleave them. Node has no portable renameat/CAS against hostile OS races.
      fs.renameSync(temporary, captured.target);
      temporary = null;
      const saved = readFile(id, draft.path);
      drafts.delete(draft.id);
      let draftRetained = false;
      try { persist(); } catch { drafts.set(draft.id, draft); draftRetained = true; }
      return { state: "saved", path: draft.path, revision: saved.revision, draftId: draft.id, draftRetained };
    } catch (error) {
      return { state: "blocked", draftId: draft.id, code: error.code || "SAVE_FAILED",
        message: "The file was not confirmed saved. Your draft is retained; reopen the file before retrying." };
    } finally {
      // Recheck ancestry before cleanup; never follow a swapped parent into another root.
      if (temporary) {
        try { unchangedParents(writeBoundary); fs.unlinkSync(temporary); } catch {}
      }
    }
  }
  function runGit(root, args, filterOverrides = []) {
    rootFor(root.id);
    return new Promise((resolveResult) => {
      const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
      Object.assign(environment, { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat",
        GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_NO_LAZY_FETCH: "1", GIT_LFS_SKIP_SMUDGE: "1", GIT_ALLOW_PROTOCOL: "", GIT_PROTOCOL_FROM_USER: "0",
        GIT_ASKPASS: "", SSH_ASKPASS: "" });
      const child = spawn("git", ["--no-pager", "--no-optional-locks", "-c", "core.fsmonitor=false",
        "-c", "core.untrackedCache=false", "-c", "core.hooksPath=", "-c", "diff.external=",
        "-c", "submodule.recurse=false", "-c", "protocol.allow=never", "-c", "protocol.ssh.allow=never",
        "-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=never", "-c", "credential.helper=",
        "-c", "core.askPass=", "-c", "core.sshCommand=", ...filterOverrides, "-C", root.path, ...args],
      { env: environment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false });
      const output = []; let bytes = 0; let truncated = false; let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, 5000);
      child.stdout.on("data", (chunk) => {
        const remaining = LIMITS.gitBytes - bytes;
        if (remaining > 0) { output.push(chunk.subarray(0, remaining)); bytes += Math.min(chunk.length, remaining); }
        if (chunk.length > remaining) { truncated = true; child.kill(); }
      });
      // Bound diagnostics too, but do not expose repository-controlled text as a host error.
      let errorBytes = 0;
      child.stderr.on("data", (chunk) => { errorBytes += chunk.length; if (errorBytes > LIMITS.gitBytes) child.kill(); });
      child.on("error", () => { clearTimeout(timer); resolveResult({ ok: false, output: "", truncated: false }); });
      child.on("close", (code) => { clearTimeout(timer); resolveResult({ ok: code === 0 && !timedOut, exitCode: code,
        output: Buffer.concat(output).toString("utf8"), truncated, timedOut }); });
    });
  }
  async function git(root, args) {
    // Reading config names does not compare worktree/index bytes, so it cannot
    // invoke clean/smudge/process filters. Call the raw runner to avoid recursion.
    const config = await runGit(root, ["config", "--null", "--name-only", "--get-regexp",
      "^filter\\..*\\.(clean|smudge|process|required)$"]);
    if (config.truncated || config.timedOut || (!config.ok && config.exitCode !== 1)) {
      return { ok: false, output: "", truncated: false };
    }
    const drivers = new Set();
    for (const key of config.output.split("\0").filter(Boolean)) {
      const match = /^filter\.(.+)\.(?:clean|smudge|process|required)$/i.exec(key);
      // Unrepresentable or excessive subsection names fail closed instead of
      // passing an ambiguous -c key or silently leaving a driver executable.
      if (!match || !/^[A-Za-z0-9._/-]{1,200}$/.test(match[1])) return { ok: false, output: "", truncated: false };
      drivers.add(match[1]);
      if (drivers.size > 128) return { ok: false, output: "", truncated: false };
    }
    const overrides = [];
    for (const driver of drivers) for (const [key, value] of [
      ["clean", ""], ["smudge", ""], ["process", ""], ["required", "false"],
    ]) overrides.push("-c", `filter.${driver}.${key}=${value}`);
    return runGit(root, args, overrides);
  }
  const fullOid = (value) => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
  async function headReference(root) {
    const result = await git(root, ["symbolic-ref", "--quiet", "HEAD"]);
    if (!result.ok && result.exitCode !== 1) return { ok: false, ref: null };
    return { ok: true, ref: result.ok ? result.output.trim() : null };
  }
  async function gitBases(id) {
    const root = rootFor(id);
    const head = await git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
    if (!head.ok || !fullOid(head.output.trim())) return { state: "unavailable", reason: "No readable committed Git HEAD." };
    const branch = await headReference(root);
    const refs = await git(root, ["for-each-ref", "--sort=refname", `--count=${LIMITS.baseRefs + 1}`,
      "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)", "refs/heads/", "refs/remotes/"]);
    const after = await git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
    const branchAfter = await headReference(root);
    rootFor(id);
    if (!branch.ok || !refs.ok || refs.truncated || !after.ok || head.output !== after.output
        || !branchAfter.ok || branch.ref !== branchAfter.ref) {
      return { state: "unavailable", reason: "Git references changed or could not be read. Refresh base choices." };
    }
    const headOid = head.output.trim();
    const records = [{ ref: null, oid: headOid, kind: "head" }];
    const refLines = refs.output.split("\n").filter(Boolean);
    let truncated = refLines.length > LIMITS.baseRefs;
    for (const line of refLines) {
      const [ref, oid, type, symbolic] = line.split("\0");
      if (symbolic || type !== "commit" || !fullOid(oid) || !/^refs\/(heads|remotes)\/[^\x00-\x20]+$/.test(ref)) continue;
      if (records.length > LIMITS.baseRefs) { truncated = true; break; }
      records.push({ ref, oid, kind: ref.startsWith("refs/heads/") ? "local" : "remote" });
    }
    const choices = records.map((record) => {
      const baseId = randomUUID();
      gitBaseChoices.set(baseId, { ...record, workspaceId: id, headOid, headRef: branch.ref });
      return { baseId, ...record };
    });
    while (gitBaseChoices.size > LIMITS.bases) gitBaseChoices.delete(gitBaseChoices.keys().next().value);
    return { state: "ready", headOid, headRef: branch.ref, choices, truncated };
  }
  async function captureGit(id, baseOid, baseRef = null, expectedHead = null) {
    const root = rootFor(id);
    if (baseOid !== undefined && !fullOid(baseOid)) fail("INVALID_BASE", "Use a captured full commit OID.");
    const head = await git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
    if (!head.ok || !fullOid(head.output.trim())) return { state: "unavailable", reason: "No readable committed Git HEAD." };
    const branch = await headReference(root);
    if (!branch.ok) return { state: "unavailable", reason: "The current Git branch could not be read." };
    const headOid = head.output.trim();
    if (expectedHead && (expectedHead.headOid !== headOid || expectedHead.headRef !== branch.ref)) {
      return { state: "unavailable", reason: "Git HEAD changed after the base choices were captured. Refresh choices." };
    }
    const base = baseOid || headOid;
    if (baseRef) {
      // This ref came from our bounded repository enumeration, never from a renderer Git expression.
      const selected = await git(root, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`]);
      if (!selected.ok || selected.output.trim() !== base) {
        return { state: "unavailable", staleBase: true, reason: "The selected base branch changed. Capture changes again." };
      }
    }
    const resolved = await git(root, ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]);
    if (!resolved.ok || resolved.output.trim() !== base) return { state: "unavailable", reason: "The captured base commit is unavailable." };
    const status = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--ignore-submodules=all"]);
    const diff = await git(root, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--ignore-submodules=all", base, "--"]);
    const after = await git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
    const branchAfter = await headReference(root);
    const statusAfter = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--ignore-submodules=all"]);
    const baseAfter = baseRef ? await git(root, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`]) : null;
    rootFor(id);
    if (!after.ok || head.output !== after.output || !branchAfter.ok || branch.ref !== branchAfter.ref
        || status.output !== statusAfter.output || (baseAfter && (!baseAfter.ok || baseAfter.output.trim() !== base))) {
      return { state: "unavailable", reason: "Git changed while reading. Refresh the snapshot." };
    }
    if ((!status.ok && !status.truncated) || (!statusAfter.ok && !statusAfter.truncated) || (!diff.ok && !diff.truncated)) {
      return { state: "unavailable", reason: "Git inspection failed or exceeded its read deadline." };
    }
    return { state: "ready", headOid, headRef: branch.ref, baseOid: base, baseRef,
      status: status.output.split("\0").filter(Boolean), statusTruncated: status.truncated, diff: diff.output,
      truncated: diff.truncated, binary: /(?:^|\n)Binary files .* differ(?:\n|$)/.test(diff.output),
      fingerprint: digest(`${headOid}\0${branch.ref || ""}\0${baseRef || ""}\0${base}\0${status.output}\0${diff.output}`) };
  }
  async function gitStatus(id, { baseOid, baseId } = {}) {
    if (baseOid !== undefined && baseId !== undefined) fail("INVALID_BASE", "Select one captured base.");
    let selection = null;
    if (baseId !== undefined) {
      if (typeof baseId !== "string" || !/^[a-f0-9-]{36}$/.test(baseId)) fail("INVALID_BASE", "Select a captured repository base.");
      selection = gitBaseChoices.get(baseId);
      if (!selection || selection.workspaceId !== id) fail("BASE_UNKNOWN", "Refresh the repository base choices before selecting one.");
    }
    const captured = await captureGit(id, selection?.oid || baseOid, selection?.ref || null, selection);
    if (captured.state !== "ready") return { state: "unavailable", reason: captured.reason };
    const snapshotId = randomUUID();
    snapshots.set(snapshotId, { workspaceId: id, ...captured });
    while (snapshots.size > LIMITS.snapshots) snapshots.delete(snapshots.keys().next().value);
    const { fingerprint, diff, ...publicSnapshot } = captured;
    return { ...publicSnapshot, snapshotId };
  }
  async function gitDiff(id, snapshotId) {
    rootFor(id);
    const captured = snapshots.get(snapshotId);
    if (!captured || captured.workspaceId !== id) fail("SNAPSHOT_UNKNOWN", "Refresh Git status before opening a diff.");
    const current = await captureGit(id, captured.baseOid, captured.baseRef);
    const state = current.state !== "ready" ? current.staleBase ? "stale" : "unavailable"
      : current.fingerprint !== captured.fingerprint || current.truncated || current.statusTruncated ? "stale" : "current";
    return { state, snapshotId, headOid: captured.headOid, headRef: captured.headRef,
      baseOid: captured.baseOid, baseRef: captured.baseRef,
      text: captured.diff, truncated: captured.truncated, binary: captured.binary,
      ...(current.state !== "ready" ? { reason: current.reason } : {}) };
  }

  return Object.freeze({ pickRoot, openManagedRoot,
    hasManagedRootGrant(sourceRootId, worktreeId) {
      if (typeof sourceRootId !== "string" || !/^[a-f0-9-]{36}$/.test(sourceRootId)
          || typeof worktreeId !== "string" || !/^[a-f0-9-]{36}$/.test(worktreeId)) {
        fail("INVALID_MANAGED_WORKTREE", "Use exact source and worktree identifiers.");
      }
      return managedOpenings.has(`${sourceRootId}:${worktreeId}`) || [...roots.values()].some((root) => (root.managedWorktrees || [])
        .some((binding) => binding.sourceRootId === sourceRootId && binding.worktreeId === worktreeId));
    },
    // Main-only capability for other workspace owners. Never expose this through preload.
    resolveGrant(id) { const root = rootFor(id); return Object.freeze({ id: root.id, path: root.path }); },
    prepareAgentWorkspaceGrant(id, selectedPaths, binding) {
      if (!agentGrants) fail("GRANT_STORAGE_UNAVAILABLE", "Agent workspace grants are not configured.");
      const root = rootFor(id);
      return agentGrants.prepare({ id: root.id, path: root.path }, selectedPaths, binding);
    },
    listAgentWorkspaceGrants(id) { return agentGrants ? agentGrants.list(id) : []; },
    revokeAgentWorkspaceGrant(grantId) {
      if (!agentGrants) fail("GRANT_STORAGE_UNAVAILABLE", "Agent workspace grants are not configured.");
      return agentGrants.revoke(grantId);
    },
    listRoots: () => [...roots.values()].map(publicRoot),
    forgetRoot(id) {
      if (!roots.has(id)) return false;
      if ([...managedOpenings.keys()].some((key) => key.startsWith(`${id}:`))) {
        fail("MANAGED_OPEN_BUSY", "Wait for the owned worktree opening to finish before removing its source folder.");
      }
      if ([...roots.values()].some((root) => (root.managedWorktrees || []).some((binding) => binding.sourceRootId === id))) {
        fail("MANAGED_ROOTS_RETAINED", "Remove the derived worktree workspace grants before removing their source folder.");
      }
      if (agentGrants?.list(id).some((grant) => grant.state === "active")) fail("AGENT_GRANT_ACTIVE", "Explicitly revoke this folder's active task snapshot grants before removing it.");
      if ([...drafts.values()].some((draft) => draft.workspaceId === id)) fail("DRAFTS_RETAINED", "Resolve or discard this workspace's drafts before removing its grant.");
      const previous = roots.get(id); roots.delete(id);
      try { persist(); } catch (error) { roots.set(id, previous); throw error; }
      for (const [key, value] of snapshots) if (value.workspaceId === id) snapshots.delete(key);
      for (const [key, value] of gitBaseChoices) if (value.workspaceId === id) gitBaseChoices.delete(key);
      return true;
    },
    list, preview: readFile, save, retainDraft,
    captureBinary, publishBinary, confirmBinaryPublication,
    tree(id, relative = "", depth = 2) {
      if (!Number.isInteger(depth) || depth < 1 || depth > LIMITS.depth) fail("INVALID_DEPTH", "Use a tree depth from 1 to 4.");
      const entries = []; let truncated = false;
      const visit = (directory, remaining) => {
        const children = list(id, directory); truncated ||= children.truncated;
        for (const entry of children.entries) {
          if (entries.length >= LIMITS.treeEntries) { truncated = true; return; }
          entries.push(entry);
          if (entry.kind === "directory" && remaining > 1) visit(entry.path, remaining - 1);
        }
      };
      visit(relative, depth); return { path: relative, entries, truncated };
    },
    listDrafts(id) {
      if (!roots.has(id)) fail("WORKSPACE_UNKNOWN", "Select a workspace first.");
      return [...drafts.values()].filter((draft) => draft.workspaceId === id).map((draft) => ({ ...draft }));
    },
    discardDraft(id, draftId) {
      const draft = drafts.get(draftId);
      if (!draft || draft.workspaceId !== id) return false;
      drafts.delete(draftId);
      try { persist(); } catch (error) { drafts.set(draftId, draft); throw error; }
      return true;
    },
    gitBases, gitStatus, gitDiff,
  });
}

module.exports = { createLocalWorkspaceService, LIMITS };
