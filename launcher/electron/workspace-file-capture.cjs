"use strict";

// Stateless capture leaf shared by the Electron picker service and the execution owner's opt-in checkpoint store.
// Callers retain grant/environment authority and own persistence; no paths or bytes are published here.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const CAPTURE_LIMITS = Object.freeze({ files: 64, fileBytes: 256 * 1024, snapshotBytes: 4 * 1024 * 1024 });
const LIMITS = CAPTURE_LIMITS;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const nodeIdentity = (stat) => `${stat.dev}:${stat.ino}`;
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

function relative(value) {
  if (typeof value !== "string" || !value || value.length > 4096 || path.isAbsolute(value)
      || /^[A-Za-z]:/.test(value) || value.includes("\\") || value.includes("\0")
      || value.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) {
    fail("INVALID_PATH", "Use a file path inside the selected workspace.");
  }
  return value;
}
function selectedPaths(values) {
  if (!Array.isArray(values) || !values.length || values.length > LIMITS.files) fail("FILE_LIMIT", "Select from 1 to 64 files.");
  const result = values.map(relative);
  if (new Set(result).size !== result.length) fail("INVALID_PATH", "Select each path only once.");
  return result;
}
function chain(directory) {
  const result = [];
  for (let current = directory; ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("PATH_CHANGED", "Directory ancestry is unavailable or changed.");
    result.push([current, nodeIdentity(stat)]);
    if (path.dirname(current) === current) return result;
  }
}
function assertChain(captured) {
  for (const [name, identity] of captured) {
    const stat = fs.lstatSync(name);
    if (!stat.isDirectory() || stat.isSymbolicLink() || nodeIdentity(stat) !== identity) fail("PATH_CHANGED", "Directory ancestry changed.");
  }
}
function targetFile(root, name) {
  relative(name);
  const parent = path.dirname(path.join(root, name));
  const parents = chain(parent);
  if (!parents.some(([item]) => item === root)) fail("INVALID_PATH", "File is outside its workspace.");
  const target = path.join(root, name);
  let stat;
  try { stat = fs.lstatSync(target); } catch (error) {
    if (error.code === "ENOENT") return { target, parents, stat: null };
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail("UNSAFE_FILE", "Only regular files without links can be captured or restored.");
  if (stat.size > LIMITS.fileBytes) fail("FILE_LIMIT", "A selected file exceeds 256 KiB.");
  return { target, parents, stat };
}
function captureFile(root, name) {
  const found = targetFile(root, name);
  if (!found.stat) return { path: name, revision: null, bytes: null, mode: null };
  const fd = fs.openSync(found.target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.fstatSync(fd);
    if (nodeIdentity(before) !== nodeIdentity(found.stat)) fail("FILE_CHANGED", "A selected file changed during capture.");
    const bytes = Buffer.alloc(Math.min(before.size, LIMITS.fileBytes) + 1);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    const after = fs.fstatSync(fd);
    assertChain(found.parents);
    const current = fs.lstatSync(found.target);
    if (count !== before.size || count > LIMITS.fileBytes || nodeIdentity(current) !== nodeIdentity(before)
        || current.isSymbolicLink() || current.nlink !== 1 || current.size !== after.size
        || current.mtimeMs !== after.mtimeMs || current.ctimeMs !== after.ctimeMs || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
        || before.size !== after.size) fail("FILE_CHANGED", "A selected file changed during capture.");
    const content = bytes.subarray(0, count);
    return { path: name, revision: hash(Buffer.concat([Buffer.from(`${nodeIdentity(after)}:${after.mtimeMs}:${after.ctimeMs}:${after.mode}:`), content])),
      bytes: content.toString("base64"), mode: before.mode & 0o777, contentHash: hash(content) };
  } finally { fs.closeSync(fd); }
}
function captureFiles(root, paths) {
  const files = selectedPaths(paths).map((name) => captureFile(root, name));
  if (files.reduce((sum, file) => sum + (file.bytes ? Buffer.byteLength(file.bytes, "base64") : 0), 0) > LIMITS.snapshotBytes) {
    fail("SNAPSHOT_LIMIT", "Selected files exceed the 4 MiB snapshot limit.");
  }
  return files;
}
module.exports = { CAPTURE_LIMITS, relative, selectedPaths, chain, assertChain, targetFile, captureFile, captureFiles };
