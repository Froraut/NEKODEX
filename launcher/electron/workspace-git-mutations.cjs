"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID, createHash } = require("node:crypto");
const { createLocalGitReviewService } = require("./local-git-review.cjs");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");
const { CAPTURE_LIMITS, relative, selectedPaths, chain, assertChain, targetFile, captureFile, captureFiles } = require("./workspace-file-capture.cjs");
const LIMITS = Object.freeze({ ...CAPTURE_LIMITS,
  snapshots: 48, worktrees: 24, gitBytes: 1024 * 1024, previews: 24, storageBytes: 16 * 1024 * 1024, restores: 256 });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const nodeIdentity = (stat) => `${stat.dev}:${stat.ino}`;
const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function identifier(value) {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value)) fail("INVALID_ID", "Invalid workspace resource identifier.");
  return value;
}
function git(directory, args, filters = [], { mutation = false } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_PAGER: "cat", GIT_LFS_SKIP_SMUDGE: "1", GIT_NO_LAZY_FETCH: "1" });
  const options = ["--no-pager", "--no-optional-locks", "-c", "core.hooksPath=", "-c", "core.fsmonitor=false",
    "-c", "core.untrackedCache=false", "-c", "core.sparseCheckout=false", "-c", "submodule.recurse=false",
    "-c", "diff.external=", "-c", "core.askPass=", "-c", "credential.helper=", "-c", "protocol.allow=never", "-c", "core.sshCommand=false"];
  for (const driver of filters) for (const field of ["clean", "smudge", "process", "required"]) {
    options.push("-c", `filter.${driver}.${field}=${field === "required" ? "false" : ""}`);
  }
  return new Promise((resolve) => {
    const child = spawn("git", [...options, "-C", directory, ...args], { shell: false, windowsHide: true,
      env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = []; let bytes = 0; let stderrBytes = 0; let aborted = false;
    // A checkout/move owns its real transaction until process completion; a read deadline is not a mutation deadline.
    const timer = mutation ? null : setTimeout(() => { aborted = true; child.kill(); }, 10000);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > LIMITS.gitBytes) { aborted = true; child.kill(); } else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; if (stderrBytes > LIMITS.gitBytes) { aborted = true; child.kill(); } });
    child.on("error", () => { clearTimeout(timer); resolve({ ok: false, output: "", code: -1 }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0 && !aborted,
      output: Buffer.concat(chunks).toString("utf8"), code }); });
  });
}
async function checkedGit(root, args, filters) {
  // Even status can invoke a clean filter when comparing worktree bytes to the index.
  const result = await git(root, args, filters || await filterNames(root));
  if (!result.ok) fail("GIT_FAILED", "Git could not complete the local operation. Inspect retained operation state before retrying.");
  return result.output;
}
async function filterNames(root) {
  const result = await git(root, ["config", "--null", "--name-only", "--get-regexp", "^filter\\."]);
  if (!result.ok && result.code !== 1) fail("GIT_FAILED", "Cannot inspect Git callback configuration.");
  const names = new Set();
  for (const key of result.output.split("\0").filter(Boolean)) {
    const match = /^filter\.(.+)\.(clean|smudge|process|required)$/i.exec(key);
    if (!match || /[\0\r\n]/.test(match[1])) fail("UNSAFE_CONFIG", "Unsupported Git filter configuration.");
    names.add(match[1]);
  }
  return [...names];
}

/** resolveWorkspace is a main-process picker-grant port, never a renderer-supplied path. */
function createWorkspaceGitService({ resolveWorkspace, storagePath, canArchiveWorktree = () => true, getDraftPaths = () => [] }) {
  if (typeof resolveWorkspace !== "function" || typeof canArchiveWorktree !== "function" || typeof getDraftPaths !== "function" || typeof storagePath !== "string" || !path.isAbsolute(storagePath)) {
    throw new TypeError("Trusted workspace resolver and private storage path are required.");
  }
  // Validate before mkdir so an existing symlink cannot redirect private snapshot storage.
  let ancestor = storagePath;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  chain(ancestor);
  fs.mkdirSync(storagePath, { recursive: true, mode: 0o700 });
  const storageChain = chain(storagePath);
  const storageStat = fs.lstatSync(storagePath);
  if ((typeof process.getuid === "function" && storageStat.uid !== process.getuid())
      || (process.platform !== "win32" && (storageStat.mode & 0o077))) fail("PRIVATE_STORAGE", "Workspace storage must be owner-only.");
  const registryFile = path.join(storagePath, "registry.json");
  let state = { version: 1, worktrees: [], snapshots: [], restores: [] };
  if (fs.existsSync(registryFile)) {
    const stat = fs.lstatSync(registryFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 32 * 1024 * 1024
        || (process.platform !== "win32" && (stat.mode & 0o077))) fail("PRIVATE_STORAGE", "Workspace registry is unsafe.");
    state = JSON.parse(fs.readFileSync(registryFile, "utf8"));
    if (state.version !== 1 || !Array.isArray(state.worktrees) || !Array.isArray(state.snapshots) || !Array.isArray(state.restores)
        || state.worktrees.length > LIMITS.worktrees || state.snapshots.length > LIMITS.snapshots || state.restores.length > LIMITS.restores) fail("REGISTRY_INVALID", "Preserve the invalid workspace registry for recovery.");
    let total = 0;
    for (const snapshot of state.snapshots) {
      identifier(snapshot.id); identifier(snapshot.workspaceId);
      if (!Array.isArray(snapshot.files) || snapshot.files.length > LIMITS.files || typeof snapshot.label !== "string" || snapshot.label.length > 120) {
        fail("REGISTRY_INVALID", "Invalid source snapshot metadata.");
      }
      let size = 0;
      for (const file of snapshot.files) {
        relative(file.path);
        if (file.bytes === null) {
          if (file.mode !== null || file.revision !== null) fail("REGISTRY_INVALID", "Invalid missing-file snapshot.");
        } else {
          if (typeof file.bytes !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.bytes)
              || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777
              || !/^[a-f0-9]{64}$/.test(file.revision) || !/^[a-f0-9]{64}$/.test(file.contentHash)) {
            fail("REGISTRY_INVALID", "Invalid source snapshot content.");
          }
          const bytes = Buffer.from(file.bytes, "base64");
          if (bytes.length > LIMITS.fileBytes || hash(bytes) !== file.contentHash) fail("REGISTRY_INVALID", "Snapshot content integrity failed.");
          size += bytes.length;
        }
      }
      if (size > LIMITS.snapshotBytes || new Set(snapshot.files.map((file) => file.path)).size !== snapshot.files.length) fail("REGISTRY_INVALID", "Invalid snapshot size or paths.");
      total += size;
    }
    if (total > LIMITS.storageBytes) fail("REGISTRY_INVALID", "Snapshot storage exceeds its bound.");
  }
  const previews = new Map(); const active = new Set(); const owners = new Map();
  let admissionOpen = true; let shutdown = null;
  function persist() {
    assertChain(storageChain);
    if (fs.existsSync(registryFile) && !fs.lstatSync(registryFile).isFile()) fail("PRIVATE_STORAGE", "Workspace registry changed.");
    writePrivateFileAtomic(registryFile, JSON.stringify(state), { protectDirectory: false, durable: true });
  }
  function rootFor(id) {
    identifier(id);
    const grant = resolveWorkspace(id);
    if (!grant || grant.id !== id || typeof grant.path !== "string" || !path.isAbsolute(grant.path)
        || fs.realpathSync(grant.path) !== grant.path) fail("WORKSPACE_UNKNOWN", "Select the workspace again.");
    return { id, path: grant.path, chain: chain(grant.path), identity: nodeIdentity(fs.lstatSync(grant.path)) };
  }
  function recheck(root) {
    const current = rootFor(root.id);
    if (current.path !== root.path || current.identity !== root.identity) fail("ROOT_CHANGED", "Selected workspace changed.");
    assertChain(root.chain); assertChain(storageChain);
  }
  function managedParent(name) {
    assertChain(storageChain);
    const directory = path.join(storagePath, name);
    try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    const captured = chain(directory);
    const stat = fs.lstatSync(directory);
    if ((typeof process.getuid === "function" && stat.uid !== process.getuid())
        || (process.platform !== "win32" && (stat.mode & 0o077))) fail("PRIVATE_STORAGE", "Managed checkout storage must be owner-only.");
    assertChain(storageChain); return captured;
  }
  function admit() {
    if (!admissionOpen) fail("SERVICE_CLOSED", "Workspace service is shutting down; new operations are not admitted.");
  }
  function own(id, kind, label, action) {
    admit();
    const ownerId = randomUUID();
    const owner = { id: ownerId, workspaceId: id, kind, label, terminal: null };
    // Register before executing any action so Quit can join even an operation's first asynchronous boundary.
    const terminal = Promise.resolve().then(action).finally(() => {
      owners.delete(ownerId);
      if (kind === "mutation") active.delete(id);
    });
    owner.terminal = terminal; owners.set(ownerId, owner); return terminal;
  }
  function exclusive(id, label, action) {
    admit();
    if (active.has(id)) fail("WORKSPACE_BUSY", "A workspace operation is already active.");
    active.add(id);
    return own(id, "mutation", label, action);
  }
  function currentOperation() {
    const mutations = [...owners.values()].filter((owner) => owner.kind === "mutation");
    return mutations.length ? mutations.map((owner) => `${owner.label} (workspace ${owner.workspaceId}, operation ${owner.id})`).join("; ") : null;
  }
  function destroy() {
    if (!shutdown) {
      admissionOpen = false;
      // Existing owners finish Git and publish their durable terminal/recovery receipts. No shutdown kill/deadline.
      shutdown = Promise.all([Promise.allSettled([...owners.values()].map((owner) => owner.terminal)), localReview.destroy()]).then(() => { previews.clear(); });
    }
    return shutdown;
  }
  async function repo(root) {
    recheck(root);
    const top = (await checkedGit(root.path, ["rev-parse", "--show-toplevel"])).trim();
    if (fs.realpathSync(top) !== root.path) fail("NOT_REPOSITORY_ROOT", "Select the Git repository root before managing worktrees.");
    const headOid = (await checkedGit(root.path, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
    if (!oidPattern.test(headOid)) fail("INVALID_HEAD", "A committed Git HEAD is required.");
    recheck(root); return headOid;
  }
  function remember(preview) {
    if (previews.size >= LIMITS.previews) previews.delete(previews.keys().next().value);
    const previewId = randomUUID(); previews.set(previewId, preview); return previewId;
  }
  function owned(root, worktreeId) {
    identifier(worktreeId);
    const value = state.worktrees.find((entry) => entry.id === worktreeId && entry.workspaceId === root.id);
    if (!value || value.sourcePath !== root.path || value.sourceIdentity !== root.identity
        || value.path !== path.join(storagePath, "worktrees", value.id) || !/^codex\/[a-z0-9][a-z0-9-]{0,47}$/.test(value.branch)) {
      fail("WORKTREE_UNKNOWN", "This worktree has no matching application ownership receipt.");
    }
    return value;
  }
  async function inspectOwned(root, record, directory = record.path) {
    recheck(root); assertChain(chain(directory));
    if (nodeIdentity(fs.lstatSync(directory)) !== record.identity) fail("WORKTREE_CHANGED", "Managed worktree directory changed.");
    const worktrees = (await checkedGit(root.path, ["worktree", "list", "--porcelain", "-z"])).split("\0\0");
    const match = worktrees.some((block) => block.split("\0").includes(`worktree ${directory}`)
      && block.split("\0").includes(`branch refs/heads/${record.branch}`));
    if (!match) fail("WORKTREE_CHANGED", "Git ownership or branch no longer matches this worktree receipt.");
    const headOid = (await checkedGit(directory, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
    const status = await checkedGit(directory, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all"]);
    recheck(root);
    return { headOid, status, revision: hash(`${headOid}\0${status}`) };
  }
  function addSnapshot(root, paths, label, kind = "manual", source = root.path) {
    if (state.snapshots.length >= LIMITS.snapshots) fail("SNAPSHOT_LIMIT", "Snapshot storage is full. Explicitly remove an old snapshot before creating another.");
    const files = captureFiles(source, paths);
    const totalBytes = [...state.snapshots.flatMap((entry) => entry.files), ...files].reduce((sum, file) => sum + (file.bytes ? Buffer.byteLength(file.bytes, "base64") : 0), 0);
    if (totalBytes > LIMITS.storageBytes) fail("SNAPSHOT_LIMIT", "Private snapshots exceed 16 MiB. Explicitly remove an old snapshot first.");
    recheck(root);
    const record = { id: randomUUID(), workspaceId: root.id, rootPath: root.path, rootIdentity: root.identity,
      sourcePath: source, label, kind, createdAt: new Date().toISOString(), files };
    state.snapshots.push(record); persist(); return record;
  }
  const publicSnapshot = (record) => ({ id: record.id, workspaceId: record.workspaceId, label: record.label,
    kind: record.kind, createdAt: record.createdAt, paths: record.files.map((file) => file.path),
    bytes: record.files.reduce((sum, file) => sum + (file.bytes ? Buffer.byteLength(file.bytes, "base64") : 0), 0) });
  function snapshotFor(root, snapshotId) {
    identifier(snapshotId);
    const record = state.snapshots.find((entry) => entry.id === snapshotId && entry.workspaceId === root.id);
    if (!record || record.rootPath !== root.path || record.rootIdentity !== root.identity) {
      fail("SNAPSHOT_UNKNOWN", "Select a source snapshot belonging to this workspace.");
    }
    for (const file of record.files) {
      relative(file.path);
      if (file.bytes !== null && (typeof file.bytes !== "string" || Buffer.byteLength(file.bytes, "base64") > LIMITS.fileBytes
          || hash(Buffer.from(file.bytes, "base64")) !== file.contentHash)) fail("SNAPSHOT_INVALID", "Snapshot content failed its integrity check.");
    }
    return record;
  }
  async function createWorktree(id, input) {
    return exclusive(id, "Creating local worktree", async () => {
      const root = rootFor(id);
      if (!input || typeof input.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(input.name)
          || !oidPattern.test(input.expectedHeadOid)) fail("INVALID_WORKTREE", "Use a short lowercase name and a captured HEAD commit.");
      const headOid = await repo(root);
      if (headOid !== input.expectedHeadOid) fail("HEAD_CHANGED", "Git HEAD changed. Refresh before creating a worktree.");
      const branch = `codex/${input.name}`;
      const existing = state.worktrees.find((entry) => entry.workspaceId === id && entry.branch === branch && entry.state !== "archived");
      if (existing) {
        owned(root, existing.id);
        if (existing.state !== "ready") fail("WORKTREE_PENDING", "An earlier operation requires inspection; it will not be replayed.");
        const current = await inspectOwned(root, existing);
        return { ...existing, reused: true, currentHeadOid: current.headOid };
      }
      if (state.worktrees.length >= LIMITS.worktrees) fail("WORKTREE_LIMIT", "Managed worktree receipt storage is full.");
      const filters = await filterNames(root.path);
      const branchExists = await git(root.path, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], filters);
      if (branchExists.ok) fail("BRANCH_EXISTS", "That branch already exists without an active owned worktree. Choose another name; it will not be reset.");
      if (branchExists.code !== 1) fail("GIT_FAILED", "Cannot establish branch availability.");
      const worktreeId = randomUUID();
      const directory = path.join(storagePath, "worktrees", worktreeId);
      const destinationParents = managedParent("worktrees");
      const record = { id: worktreeId, workspaceId: id, sourcePath: root.path, sourceIdentity: root.identity,
        path: directory, branch, headOid, state: "creating", createdAt: new Date().toISOString() };
      state.worktrees.push(record); persist(); recheck(root); assertChain(destinationParents);
      const result = await git(root.path, ["worktree", "add", "-b", branch, directory, headOid], filters, { mutation: true });
      recheck(root); assertChain(destinationParents);
      if (fs.existsSync(directory) && !fs.lstatSync(directory).isSymbolicLink()) record.identity = nodeIdentity(fs.lstatSync(directory));
      if (result.ok && record.identity) {
        await inspectOwned(root, record); record.state = "ready"; persist(); return { ...record, reused: false, currentHeadOid: headOid };
      }
      record.state = "needs-inspection"; persist();
      fail("WORKTREE_INCOMPLETE", "Worktree creation did not confirm completion. Its ownership receipt is retained; do not recreate or reset it.");
    });
  }
  async function resolveManagedRoot(id, worktreeId) {
    const root = rootFor(id);
    if (active.has(id)) fail("WORKSPACE_BUSY", "A workspace operation is already active.");
    const record = owned(root, worktreeId);
    const expectedState = record.state;
    if (!["ready", "archived"].includes(expectedState)) fail("WORKTREE_PENDING", "Inspect this worktree's retained operation before opening it.");
    const directory = expectedState === "archived" ? record.archivePath : record.path;
    if (expectedState === "archived" && directory !== path.join(storagePath, "archives", record.id)) {
      fail("WORKTREE_CHANGED", "Archived checkout has no matching private recovery location.");
    }
    await inspectOwned(root, record, directory);
    recheck(root);
    if (active.has(id) || record.state !== expectedState) fail("WORKSPACE_BUSY", "Worktree ownership changed while opening it.");
    assertChain(chain(directory));
    if (fs.realpathSync(directory) !== directory || nodeIdentity(fs.lstatSync(directory)) !== record.identity) {
      fail("WORKTREE_CHANGED", "Managed worktree directory changed.");
    }
    // Recovery opens the preserved checkout in place: no reset, branch recreation or restore replay.
    return Object.freeze({ id: record.id, path: directory });
  }
  async function listWorktrees(id) {
    const root = rootFor(id);
    const result = [];
    for (const record of state.worktrees.filter((entry) => entry.workspaceId === id)) {
      owned(root, record.id);
      if (record.state === "ready") {
        try { const current = await inspectOwned(root, record); result.push({ ...record, currentHeadOid: current.headOid, dirty: !!current.status }); }
        catch { result.push({ ...record, state: "needs-inspection" }); }
      } else result.push({ ...record });
    }
    return result;
  }
  function assertArchiveAllowed(root, record) {
    recheck(root);
    if (canArchiveWorktree(root.id, record.id) !== true) {
      fail("WORKTREE_OPEN", "Close or forget the derived workspace folder first. Its active work and retained grant must remain accessible before archiving this checkout.");
    }
  }
  async function previewArchive(id, worktreeId) {
    const root = rootFor(id); const record = owned(root, worktreeId);
    if (record.state !== "ready") fail("WORKTREE_PENDING", "Inspect this worktree's retained operation before archiving.");
    assertArchiveAllowed(root, record);
    const current = await inspectOwned(root, record);
    assertArchiveAllowed(root, record);
    const paths = []; const entries = current.status.split("\0").filter(Boolean);
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]; paths.push(relative(entry.slice(3)));
      if (/^[RC]|^.[RC]/.test(entry)) paths.push(relative(entries[++index]));
    }
    const unique = [...new Set(paths)];
    const files = unique.length ? captureFiles(record.path, selectedPaths(unique)) : [];
    const previewId = remember({ kind: "archive", workspaceId: id, root, worktreeId, current, files });
    return { previewId, worktreeId, branch: record.branch, headOid: current.headOid, dirty: !!current.status,
      paths: unique, recoveryRequired: !!files.length };
  }
  async function archiveWorktree(id, { previewId }) {
    return exclusive(id, "Archiving local worktree", async () => {
      const root = rootFor(id); const preview = previews.get(identifier(previewId));
      if (!preview || preview.kind !== "archive" || preview.workspaceId !== id) fail("PREVIEW_UNKNOWN", "Preview this worktree before explicitly archiving it.");
      const record = owned(root, preview.worktreeId);
      assertArchiveAllowed(root, record);
      const current = await inspectOwned(root, record);
      assertArchiveAllowed(root, record);
      if (current.revision !== preview.current.revision) fail("WORKTREE_CHANGED", "The worktree changed after preview. Review it again.");
      for (const file of preview.files) if (captureFile(record.path, file.path).revision !== file.revision) fail("FILE_CHANGED", "Worktree contents changed after preview.");
      // Retain both uncommitted bytes and the exact committed HEAD before removing a dirty checkout.
      let recoverySnapshotId = null;
      if (preview.files.length) recoverySnapshotId = addSnapshot(root, preview.files.map((file) => file.path), "Before worktree archive", "worktree-recovery", record.path).id;
      const recoveryRef = `refs/nekodex/archive/${record.id}`;
      const archivePath = path.join(storagePath, "archives", record.id);
      const destinationParents = managedParent("archives");
      assertChain(destinationParents);
      record.state = "archiving"; record.recoveryRef = recoveryRef; record.recoverySnapshotId = recoverySnapshotId;
      record.archivedHeadOid = current.headOid; record.archivePath = archivePath; persist();
      recheck(root); await checkedGit(root.path, ["update-ref", recoveryRef, current.headOid]);
      const final = await inspectOwned(root, record);
      if (final.revision !== current.revision) {
        record.state = "ready"; persist(); fail("WORKTREE_CHANGED", "Worktree changed before archive. Preview it again.");
      }
      for (const file of preview.files) if (captureFile(record.path, file.path).revision !== file.revision) {
        record.state = "ready"; persist(); fail("FILE_CHANGED", "Worktree contents changed before archive. Preview it again.");
      }
      // Move rather than force-remove: ignored files, staged-only blobs and local Git state remain recoverable.
      const filters = await filterNames(root.path);
      recheck(root); assertChain(destinationParents);
      try { assertArchiveAllowed(root, record); }
      catch (error) { record.state = "ready"; persist(); throw error; }
      const result = await git(root.path, ["worktree", "move", record.path, archivePath], filters, { mutation: true });
      recheck(root); assertChain(destinationParents);
      record.state = result.ok && !fs.existsSync(record.path) && fs.existsSync(archivePath) ? "archived" : "needs-inspection";
      record.archivedAt = new Date().toISOString(); persist(); previews.delete(previewId);
      if (record.state !== "archived") fail("ARCHIVE_INCOMPLETE", "Archive outcome requires inspection. Recovery state is retained.");
      return { ...record };
    });
  }
  function createSnapshot(id, { paths, label = "Manual snapshot" }) {
    const root = rootFor(id);
    if (typeof label !== "string" || label.length > 120) fail("INVALID_LABEL", "Use a snapshot label up to 120 characters.");
    return publicSnapshot(addSnapshot(root, selectedPaths(paths), label));
  }
  function listSnapshots(id) {
    const root = rootFor(id);
    return state.snapshots.filter((record) => record.workspaceId === id && record.rootPath === root.path
      && record.rootIdentity === root.identity).map(publicSnapshot);
  }
  function deleteSnapshot(id, snapshotId) {
    const root = rootFor(id); identifier(snapshotId);
    const record = state.snapshots.find((entry) => entry.id === snapshotId && entry.workspaceId === id
      && entry.rootPath === root.path && entry.rootIdentity === root.identity);
    if (!record) fail("SNAPSHOT_UNKNOWN", "Snapshot does not belong to this workspace.");
    if (state.worktrees.some((entry) => entry.recoverySnapshotId === snapshotId)
        || state.restores.some((entry) => entry.recoverySnapshotId === snapshotId && entry.state !== "complete")) {
      fail("RECOVERY_RETAINED", "This snapshot is retained by a worktree or incomplete restore.");
    }
    state.snapshots = state.snapshots.filter((entry) => entry !== record); persist(); return true;
  }
  function previewRestore(id, { snapshotId, paths }) {
    const root = rootFor(id); const snapshot = snapshotFor(root, snapshotId);
    const selected = selectedPaths(paths).map((name) => {
      const file = snapshot.files.find((entry) => entry.path === name);
      if (!file) fail("INVALID_PATH", "Select a path present in this snapshot.");
      return { target: file, current: captureFile(root.path, name) };
    });
    const previewId = remember({ kind: "restore", workspaceId: id, root, snapshotId, selected });
    const text = (bytes) => {
      if (bytes === null) return null;
      const buffer = Buffer.from(bytes, "base64"); if (buffer.includes(0)) return null;
      try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch { return null; }
    };
    return { previewId, snapshotId, files: selected.map(({ target, current }) => ({ path: target.path,
      expectedRevision: current.revision, currentHash: current.contentHash || null, targetHash: target.contentHash || null,
      currentText: text(current.bytes), targetText: text(target.bytes), targetMissing: target.bytes === null,
      changed: current.bytes !== target.bytes || current.mode !== target.mode })) };
  }
  function restoreSnapshot(id, { previewId }) {
    if (active.has(id)) fail("WORKSPACE_BUSY", "A workspace operation is already active.");
    const root = rootFor(id); const preview = previews.get(identifier(previewId));
    if (!preview || preview.kind !== "restore" || preview.workspaceId !== id) fail("PREVIEW_UNKNOWN", "Preview the selected restore first.");
    snapshotFor(root, preview.snapshotId); recheck(preview.root);
    for (const { target, current } of preview.selected) if (captureFile(root.path, target.path).revision !== current.revision) {
      fail("FILE_CHANGED", "A selected file changed after preview. Preview the restore again; no files were overwritten.");
    }
    if (state.restores.length >= LIMITS.restores) fail("RESTORE_LIMIT", "Restore receipt storage is full; preserve it for recovery.");
    const recovery = addSnapshot(root, preview.selected.map(({ target }) => target.path), "Before selected restore", "restore-recovery");
    const receipt = { id: randomUUID(), workspaceId: id, snapshotId: preview.snapshotId,
      recoverySnapshotId: recovery.id, state: "restoring", restoredPaths: [], createdAt: new Date().toISOString() };
    state.restores.push(receipt); persist();
    try {
      for (const { target, current } of preview.selected) {
        recheck(root);
        if (captureFile(root.path, target.path).revision !== current.revision) fail("FILE_CHANGED", "A selected file changed during restore; remaining files were preserved.");
        const found = targetFile(root.path, target.path); assertChain(found.parents);
        if (target.bytes === null) { if (found.stat) fs.unlinkSync(found.target); }
        else {
          const temporary = `${found.target}.nekodex-${randomUUID()}`;
          try {
            fs.writeFileSync(temporary, Buffer.from(target.bytes, "base64"), { flag: "wx", mode: target.mode ?? 0o600 });
            fs.chmodSync(temporary, target.mode ?? 0o600);
            const fd = fs.openSync(temporary, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
            recheck(root); assertChain(found.parents);
            if (captureFile(root.path, target.path).revision !== current.revision) fail("FILE_CHANGED", "A selected file changed before replacement.");
            fs.renameSync(temporary, found.target);
          } finally { try { assertChain(found.parents); fs.rmSync(temporary, { force: true }); } catch {} }
        }
        receipt.restoredPaths.push(target.path); persist();
      }
      receipt.state = "complete"; persist(); previews.delete(previewId); return { ...receipt };
    } catch (error) {
      receipt.state = "needs-inspection"; receipt.errorCode = error.code || "RESTORE_FAILED"; persist();
      const failure = new Error(`Restore stopped after ${receipt.restoredPaths.length} selected files. Receipt: ${receipt.id}. Recovery snapshot: ${receipt.recoverySnapshotId}. Refresh snapshots and inspect current files before preparing another restore.`);
      Object.assign(failure, { code: receipt.errorCode, receiptId: receipt.id, recoverySnapshotId: receipt.recoverySnapshotId, cause: error });
      throw failure;
    }
  }
  const localReview = createLocalGitReviewService({ storagePath, rootFor, recheck, own, exclusive, getDraftPaths });
  return Object.freeze({
    reviewBases: localReview.bases, reviewCapture: localReview.capture, reviewDiff: localReview.diff,
    reviewPrepare: localReview.prepare, reviewApply: localReview.apply, reviewInspectAction: localReview.inspectAction,
    reviewListActions: localReview.listActions, reviewPruneActions: localReview.pruneActions,
    hasRetainedState(id) {
    identifier(id);
    return active.has(id) || localReview.hasRetainedState(id) || state.worktrees.some((entry) => entry.workspaceId === id)
      || state.snapshots.some((entry) => entry.workspaceId === id)
      || state.restores.some((entry) => entry.workspaceId === id && entry.state !== "complete");
  }, currentOperation: () => currentOperation() || localReview.currentOperation(), destroy,
    resolveManagedRoot: async (id, worktreeId) => own(id, "read", "Opening managed worktree", () => resolveManagedRoot(id, worktreeId)),
    listWorktrees: async (id) => own(id, "read", "Inspecting managed worktrees", () => listWorktrees(id)),
    createWorktree,
    previewArchive: async (id, worktreeId) => own(id, "read", "Previewing worktree archive", () => previewArchive(id, worktreeId)),
    archiveWorktree,
    createSnapshot: (...args) => { admit(); return createSnapshot(...args); },
    listSnapshots: (...args) => { admit(); return listSnapshots(...args); },
    deleteSnapshot: (...args) => { admit(); return deleteSnapshot(...args); },
    previewRestore: (...args) => { admit(); return previewRestore(...args); },
    restoreSnapshot: (...args) => { admit(); return restoreSnapshot(...args); },
  });
}
module.exports = { createWorkspaceGitService, LIMITS };
