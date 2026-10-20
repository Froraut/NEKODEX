"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHmac, randomBytes, randomUUID, timingSafeEqual } = require("node:crypto");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");
const SCOPE = "pre-turn-snapshot-only";
const MAX_GRANTS = 256;
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function identifier(value) {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value)) fail("INVALID_GRANT", "Invalid workspace grant identity.");
  return value;
}
function paths(values) {
  if (!Array.isArray(values) || !values.length || values.length > 64) fail("INVALID_GRANT", "Select from 1 to 64 workspace files.");
  const result = values.map((value) => {
    if (typeof value !== "string" || !value || value.length > 4096 || path.isAbsolute(value)
        || /^[A-Za-z]:/.test(value) || value.includes("\\") || value.includes("\0")
        || value.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) {
      fail("INVALID_GRANT", "Select exact workspace-relative file paths.");
    }
    return value;
  });
  if (new Set(result).size !== result.length) fail("INVALID_GRANT", "Select each workspace file only once.");
  return result;
}
function ancestry(directory) {
  const result = [];
  for (let current = directory; ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("GRANT_ROOT_CHANGED", "Workspace directory ancestry changed.");
    result.push({ path: current, dev: String(stat.dev), ino: String(stat.ino) });
    if (path.dirname(current) === current) return result;
  }
}
function validateGrant(grant) {
  if (!grant || typeof grant !== "object" || Array.isArray(grant)
      || Object.keys(grant).sort().join(",") !== "ancestry,createdAt,familyId,generation,id,paths,rootPath,scope,signature,taskId,version,workspaceId"
      || grant.version !== 1 || grant.scope !== SCOPE || typeof grant.rootPath !== "string" || !path.isAbsolute(grant.rootPath)
      || typeof grant.createdAt !== "string" || !Number.isSafeInteger(grant.generation) || grant.generation < 1
      || !Array.isArray(grant.ancestry) || !grant.ancestry.length || grant.ancestry.length > 256
      || grant.ancestry[0]?.path !== grant.rootPath || typeof grant.signature !== "string" || !/^[a-f0-9]{64}$/.test(grant.signature)) {
    fail("INVALID_GRANT", "Invalid snapshot-only workspace grant.");
  }
  for (const key of ["id", "workspaceId", "taskId", "familyId"]) identifier(grant[key]);
  paths(grant.paths);
  for (let index = 0; index < grant.ancestry.length; index++) {
    const node = grant.ancestry[index];
    if (!node || typeof node.path !== "string" || !path.isAbsolute(node.path)
        || typeof node.dev !== "string" || !/^\d+$/.test(node.dev) || typeof node.ino !== "string" || !/^\d+$/.test(node.ino)
        || (index > 0 && node.path !== path.dirname(grant.ancestry[index - 1].path))) fail("INVALID_GRANT", "Invalid granted directory ancestry.");
  }
  if (path.dirname(grant.ancestry.at(-1).path) !== grant.ancestry.at(-1).path) fail("INVALID_GRANT", "Incomplete granted directory ancestry.");
  return grant;
}
function assertGrantRoot(grant) {
  validateGrant(grant);
  const actual = ancestry(grant.rootPath);
  if (fs.realpathSync(grant.rootPath) !== grant.rootPath || JSON.stringify(actual) !== JSON.stringify(grant.ancestry)) {
    fail("GRANT_ROOT_CHANGED", "The selected workspace or its ancestry changed.");
  }
}
function assertPrivate(file, directory = false) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())
      || (typeof process.getuid === "function" && stat.uid !== process.getuid())
      || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
    fail("GRANT_STORAGE_UNSAFE", "Workspace grant storage must be private and owned by this user.");
  }
  return stat;
}
function openKey(keyPath, create) {
  if (typeof keyPath !== "string" || !path.isAbsolute(keyPath)) fail("GRANT_STORAGE_UNAVAILABLE", "A trusted workspace grant key path is required.");
  const directory = path.dirname(keyPath);
  if (create) {
    // Check the nearest existing ancestor before creating private storage.
    let existing = directory;
    while (!fs.existsSync(existing)) existing = path.dirname(existing);
    ancestry(existing);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  ancestry(directory); assertPrivate(directory, true);
  if (create && !fs.existsSync(keyPath)) {
    if (fs.existsSync(`${keyPath}.grants.json`)) fail("GRANT_KEY_MISSING", "Preserve the grant registry; its signing key is unavailable.");
    const fd = fs.openSync(keyPath, "wx", 0o600);
    try { fs.writeFileSync(fd, randomBytes(32)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  const stat = assertPrivate(keyPath);
  if (stat.size !== 32) fail("GRANT_KEY_INVALID", "Workspace grant key is invalid.");
  return fs.readFileSync(keyPath);
}
const mac = (key, value) => createHmac("sha256", key).update(JSON.stringify(value)).digest("hex");
function unsigned(grant) { const { signature, ...payload } = grant; return payload; }
function equalMac(actual, expected) {
  return typeof actual === "string" && /^[a-f0-9]{64}$/.test(actual)
    && timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
function readRegistry(keyPath, key, allowMissing = false) {
  const registryPath = `${keyPath}.grants.json`;
  if (allowMissing && !fs.existsSync(registryPath)) return { version: 1, revision: 0, grants: [] };
  const stat = assertPrivate(registryPath);
  if (stat.size > 4 * 1024 * 1024) fail("GRANT_REGISTRY_INVALID", "Workspace grant registry exceeds its bound.");
  const saved = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const { signature, ...payload } = saved;
  if (payload.version !== 1 || !Number.isSafeInteger(payload.revision) || payload.revision < 0
      || !Array.isArray(payload.grants) || payload.grants.length > MAX_GRANTS || !equalMac(signature, mac(key, payload))) {
    fail("GRANT_REGISTRY_INVALID", "Workspace grant registry integrity failed; preserve it for recovery.");
  }
  for (const entry of payload.grants) {
    validateGrant(entry.grant);
    if (!["active", "revoked"].includes(entry.state) || !equalMac(entry.grant.signature, mac(key, unsigned(entry.grant)))) {
      fail("GRANT_REGISTRY_INVALID", "Workspace grant entry integrity failed.");
    }
  }
  return payload;
}
function saveRegistry(keyPath, key, registry) {
  const next = { ...registry, revision: registry.revision + 1 };
  const bytes = JSON.stringify({ ...next, signature: mac(key, next) });
  if (Buffer.byteLength(bytes) > 4 * 1024 * 1024) fail("GRANT_QUOTA", "Workspace grant registry is full; existing grants were preserved.");
  writePrivateFileAtomic(`${keyPath}.grants.json`, bytes,
    { durable: true, protectDirectory: false });
}

/** One Electron/main writer; Bun only reads/verifies the signed registry. */
function createAgentWorkspaceGrantAuthority({ keyPath }) {
  const key = openKey(keyPath, true);
  // A new authority does not authorize any directory until prepare receives a picker-owned root.
  readRegistry(keyPath, key, true);
  return Object.freeze({
    prepare(root, selectedPaths, binding) {
      identifier(root.id); identifier(binding?.taskId); identifier(binding?.familyId);
      if (!Number.isSafeInteger(binding?.generation) || binding.generation < 1) fail("INVALID_GRANT", "Bind the grant to the exact task generation.");
      const captured = ancestry(root.path);
      if (fs.realpathSync(root.path) !== root.path) fail("GRANT_ROOT_CHANGED", "Select the canonical workspace again.");
      const selected = paths(selectedPaths);
      const registry = readRegistry(keyPath, key, true);
      const existing = registry.grants.find((entry) => entry.state === "active" && entry.grant.taskId === binding.taskId
        && entry.grant.familyId === binding.familyId && entry.grant.generation === binding.generation);
      if (existing) {
        if (existing.grant.workspaceId !== root.id || existing.grant.rootPath !== root.path
            || JSON.stringify(existing.grant.ancestry) !== JSON.stringify(captured)
            || JSON.stringify(existing.grant.paths) !== JSON.stringify(selected)) {
          fail("GRANT_SCOPE_CONFLICT", "This task generation already has a different active workspace scope. Explicitly revoke it before choosing another.");
        }
        return structuredClone(existing.grant);
      }
      const payload = { version: 1, id: randomUUID(), scope: SCOPE, workspaceId: root.id,
        taskId: binding.taskId, familyId: binding.familyId, generation: binding.generation,
        rootPath: root.path, ancestry: captured, paths: selected, createdAt: new Date().toISOString() };
      const grant = { ...payload, signature: mac(key, payload) };
      if (Buffer.byteLength(JSON.stringify(grant)) > 32 * 1024) fail("INVALID_GRANT", "The selected workspace snapshot grant exceeds 32 KiB.");
      if (registry.grants.length >= MAX_GRANTS) fail("GRANT_QUOTA", "Workspace grant history is full; preserve and review it before continuing.");
      registry.grants.push({ grant, state: "active" }); saveRegistry(keyPath, key, registry);
      return structuredClone(grant);
    },
    list(workspaceId) {
      return readRegistry(keyPath, key, true).grants.filter((entry) => workspaceId === undefined || entry.grant.workspaceId === workspaceId)
        .map((entry) => ({ id: entry.grant.id, workspaceId: entry.grant.workspaceId, taskId: entry.grant.taskId,
          familyId: entry.grant.familyId, generation: entry.grant.generation, paths: [...entry.grant.paths], state: entry.state }));
    },
    revoke(grantId) {
      identifier(grantId); const registry = readRegistry(keyPath, key, true);
      const entry = registry.grants.find((row) => row.grant.id === grantId);
      if (!entry) fail("GRANT_UNKNOWN", "Unknown workspace grant.");
      if (entry.state !== "revoked") { entry.state = "revoked"; saveRegistry(keyPath, key, registry); }
      return { grantId, state: "revoked" };
    },
  });
}
function verifyAgentWorkspaceGrant({ keyPath, grant, taskId, familyId, generation }) {
  validateGrant(grant);
  const key = openKey(keyPath, false);
  if (!equalMac(grant.signature, mac(key, unsigned(grant))) || grant.taskId !== taskId
      || grant.familyId !== familyId || grant.generation !== generation) {
    fail("GRANT_BINDING_INVALID", "Workspace snapshot grant does not match this task and generation.");
  }
  const registry = readRegistry(keyPath, key);
  const active = registry.grants.find((entry) => entry.grant.id === grant.id);
  if (!active || active.state !== "active" || active.grant.signature !== grant.signature) fail("GRANT_REVOKED", "Workspace snapshot grant is revoked or unavailable.");
  assertGrantRoot(grant);
  return structuredClone(grant);
}

module.exports = { createAgentWorkspaceGrantAuthority, verifyAgentWorkspaceGrant, assertGrantRoot };
