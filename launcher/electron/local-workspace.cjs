"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");
const { createAgentWorkspaceGrantAuthority } = require("./agent-workspace-grant.cjs");

const LIMITS = Object.freeze({ roots: 32, entries: 300, treeEntries: 600, depth: 4,
  previewBytes: 256 * 1024, gitBytes: 512 * 1024, drafts: 40, snapshots: 24 });
const digest = (value) => createHash("sha256").update(value).digest("hex");
const sameNode = (a, b) => String(a.dev) === String(b.dev) && String(a.ino) === String(b.ino);
const identity = (stat) => ({ dev: String(stat.dev), ino: String(stat.ino) });
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
  const managedOpenings = new Map();
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
      { env: environment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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
  async function captureGit(id, baseOid) {
    const root = rootFor(id);
    if (baseOid !== undefined && (typeof baseOid !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseOid))) fail("INVALID_BASE", "Use a captured full commit OID.");
    const head = await git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
    if (!head.ok) return { state: "unavailable", reason: "No readable committed Git HEAD." };
    const headOid = head.output.trim();
    const base = baseOid || headOid;
    const resolved = await git(root, ["rev-parse", "--verify", `${base}^{commit}`]);
    if (!resolved.ok || resolved.output.trim() !== base) return { state: "unavailable", reason: "The captured base commit is unavailable." };
    const status = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--ignore-submodules=all"]);
    const diff = await git(root, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--ignore-submodules=all", base, "--"]);
    const after = await git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
    const statusAfter = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--ignore-submodules=all"]);
    rootFor(id);
    if (!after.ok || head.output !== after.output || status.output !== statusAfter.output) {
      return { state: "unavailable", reason: "Git changed while reading. Refresh the snapshot." };
    }
    if ((!status.ok && !status.truncated) || (!diff.ok && !diff.truncated)) {
      return { state: "unavailable", reason: "Git inspection failed or exceeded its read deadline." };
    }
    return { state: "ready", headOid, baseOid: base, status: status.output.split("\0").filter(Boolean),
      statusTruncated: status.truncated, diff: diff.output, truncated: diff.truncated,
      binary: /(?:^|\n)Binary files .* differ(?:\n|$)/.test(diff.output),
      fingerprint: digest(`${headOid}\0${base}\0${status.output}\0${diff.output}`) };
  }
  async function gitStatus(id, { baseOid } = {}) {
    const captured = await captureGit(id, baseOid);
    if (captured.state !== "ready") return captured;
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
    const current = await captureGit(id, captured.baseOid);
    const state = current.state !== "ready" ? "unavailable"
      : current.fingerprint !== captured.fingerprint || current.truncated || current.statusTruncated ? "stale" : "current";
    return { state, snapshotId, headOid: captured.headOid, baseOid: captured.baseOid,
      text: captured.diff, truncated: captured.truncated, binary: captured.binary,
      ...(state === "unavailable" ? { reason: current.reason } : {}) };
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
      return true;
    },
    list, preview: readFile, save, retainDraft,
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
    gitStatus, gitDiff,
  });
}

module.exports = { createLocalWorkspaceService, LIMITS };
