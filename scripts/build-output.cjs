const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function canonicalProspectivePath(value) {
  const absolute = path.resolve(value);
  let ancestor = absolute;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error("Build output has no existing parent");
    ancestor = parent;
  }
  return path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, absolute));
}

function isOwnedOutput(directory, kind) {
  if (fs.readdirSync(directory).length === 0) return true;
  try {
    if (kind === "runtime") {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
      return manifest.schemaVersion === 2 && typeof manifest.appVersion === "string"
        && manifest.entrypoint === "app/cli.js" && Array.isArray(manifest.files)
        && /^bin\/codex-chatgpt-web(?:\.cmd)?$/.test(manifest.launcher);
    }
    const marker = JSON.parse(fs.readFileSync(path.join(directory, ".nekodex-build-owner.json"), "utf8"));
    return marker.schemaVersion === 1 && marker.kind === kind;
  } catch { return false; }
}

/** Stage beside an owned output; a failed build must never destroy the previous usable bundle. */
function assertGeneratedDestination(destination, repositoryRoot) {
  const target = path.resolve(destination);
  const root = fs.realpathSync(repositoryRoot);
  const canonical = canonicalProspectivePath(target);
  if (canonical === root || root.startsWith(canonical + path.sep) || path.dirname(canonical) === canonical) {
    throw new Error("Build output cannot replace the repository or one of its parent directories");
  }
  const relative = path.relative(root, canonical).split(path.sep).join("/");
  if (relative && !relative.startsWith("../") && !path.isAbsolute(relative)
    && !/^(?:dist|\.launcher-runtime|launcher\/build)(?:\/|$)/.test(relative)) {
    throw new Error("Build output inside the repository must use a generated-output directory");
  }
  return target;
}

function beginDirectoryBuild(destination, { repositoryRoot, kind }) {
  if (!["runtime", "appimage-tools"].includes(kind)) throw new Error("Unknown build output kind");
  const target = assertGeneratedDestination(destination, repositoryRoot);
  const original = fs.lstatSync(target, { throwIfNoEntry: false });
  if (original && (original.isSymbolicLink() || !original.isDirectory() || !isOwnedOutput(target, kind))) {
    throw new Error("Build output contains unowned data; choose an empty directory or a previous owned build");
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(target), `.${path.basename(target)}.build-`));
  let finished = false;
  return {
    staging,
    commit() {
      if (finished) throw new Error("Build output transaction is already complete");
      if (kind === "appimage-tools") {
        fs.writeFileSync(path.join(staging, ".nekodex-build-owner.json"), JSON.stringify({ schemaVersion: 1, kind }));
      }
      if (!isOwnedOutput(staging, kind) || fs.readdirSync(staging).length === 0) {
        throw new Error("Build output did not produce its ownership manifest");
      }
      const current = fs.lstatSync(target, { throwIfNoEntry: false });
      if (Boolean(current) !== Boolean(original)
        || current && original && (current.ino !== original.ino || current.dev !== original.dev || current.isSymbolicLink())) {
        throw new Error("Build output changed during compilation; refusing to replace another build");
      }
      const backup = `${target}.previous-${randomUUID()}`;
      if (original) fs.renameSync(target, backup);
      try { fs.renameSync(staging, target); }
      catch (error) {
        if (original) {
          try { fs.renameSync(backup, target); }
          catch (restoreError) { throw new AggregateError([error, restoreError], `Previous build is preserved at ${backup}`); }
        }
        throw error;
      }
      finished = true;
      if (original) {
        try { fs.rmSync(backup, { recursive: true, force: true }); }
        catch { console.warn(`New build is ready; previous generated output remains at ${backup}`); }
      }
      return target;
    },
    dispose() { fs.rmSync(staging, { recursive: true, force: true }); },
  };
}

module.exports = { beginDirectoryBuild, assertGeneratedDestination };
