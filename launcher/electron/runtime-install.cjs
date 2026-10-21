const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { renameAtomicFile } = require("./atomic-file.cjs");
const { runtimeBundlePaths } = require("./runtime-command.cjs");

const DEFAULT_SOURCE_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_SOURCE_WAIT_INTERVAL_MS = 50;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function bundleIdFor(files) {
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file.path);
    digest.update("\0");
    digest.update(String(file.size));
    digest.update("\0");
    digest.update(file.sha256);
    digest.update("\0");
  }
  return digest.digest("hex");
}

function validateManifestPath(relativePath) {
  if (typeof relativePath !== "string"
    || relativePath.length === 0
    || relativePath === "manifest.json"
    || relativePath.includes("\\")
    || path.posix.isAbsolute(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.split("/").some(segment => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`Runtime manifest contains an unsafe file path: ${JSON.stringify(relativePath)}`);
  }
  return relativePath;
}

function readRuntimeManifest(runtimeRoot, { version, platform, arch, bundleId }) {
  const manifestPath = path.join(runtimeRoot, "manifest.json");
  const manifestMetadata = fs.lstatSync(manifestPath, { throwIfNoEntry: false });
  if (!manifestMetadata) throw new Error(`Runtime manifest is missing: ${manifestPath}`);
  if (!manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()
    || manifestMetadata.size < 1 || manifestMetadata.size > MAX_MANIFEST_BYTES) {
    throw new Error(`Runtime manifest must be a bounded regular file owned by the bundle: ${manifestPath}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Runtime manifest is invalid: ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const expectedLauncher = `bin/${platform === "win32" ? "codex-chatgpt-web.cmd" : "codex-chatgpt-web"}`;
  if (manifest?.schemaVersion !== 2
    || manifest.appVersion !== version
    || manifest.platform !== platform
    || manifest.arch !== arch
    || manifest.launcher !== expectedLauncher
    || manifest.entrypoint !== "app/cli.js"
    || typeof manifest.bunVersion !== "string"
    || typeof manifest.playwright !== "string"
    || !SHA256_PATTERN.test(manifest.bundleId)
    || (bundleId && manifest.bundleId !== bundleId)
    || !Array.isArray(manifest.files)
    || manifest.files.length === 0) {
    const received = manifest && typeof manifest === "object" ? {
      schemaVersion: manifest.schemaVersion,
      appVersion: manifest.appVersion,
      bundleId: manifest.bundleId,
      bunVersion: manifest.bunVersion,
      platform: manifest.platform,
      arch: manifest.arch,
      launcher: manifest.launcher,
      entrypoint: manifest.entrypoint,
      playwright: manifest.playwright,
      fileCount: Array.isArray(manifest.files) ? manifest.files.length : null,
    } : manifest;
    throw new Error(
      `Runtime bundle identity mismatch: expected ${version} ${platform}/${arch}, received ${JSON.stringify(received)}`,
    );
  }

  let previousPath = null;
  const files = manifest.files.map((file, index) => {
    if (!file || typeof file !== "object"
      || !Number.isSafeInteger(file.size)
      || file.size < 0
      || !SHA256_PATTERN.test(file.sha256)) {
      throw new Error(`Runtime manifest contains an invalid file record at index ${index}`);
    }
    const relativePath = validateManifestPath(file.path);
    if (previousPath !== null && comparePaths(previousPath, relativePath) >= 0) {
      throw new Error(`Runtime manifest file paths are not unique and sorted: ${relativePath}`);
    }
    previousPath = relativePath;
    return { path: relativePath, size: file.size, sha256: file.sha256 };
  });
  if (bundleIdFor(files) !== manifest.bundleId) {
    throw new Error(`Runtime manifest bundleId does not match its file records: ${manifestPath}`);
  }
  return { ...manifest, files };
}

// Finder writes `.DS_Store` into any folder a user opens (for example when the desktop helper is
// revealed to grant a permission). It is never loaded or executed, so it must not make a verified
// runtime unusable: a committed release that fails verification cannot start, which rolled back
// an otherwise valid app update. Every other unmanifested file still fails closed.
const IGNORED_RUNTIME_METADATA_FILES = new Set([".DS_Store"]);

function runtimeFilePaths(runtimeRoot) {
  const paths = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => comparePaths(left.name, right.name))) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(runtimeRoot, absolutePath).split(path.sep).join("/");
      if (relativePath === "manifest.json") continue;
      if (entry.isFile() && IGNORED_RUNTIME_METADATA_FILES.has(entry.name)) continue;
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      paths.push(relativePath);
    }
  };
  visit(runtimeRoot);
  return paths.sort(comparePaths);
}

function validateRuntimeFile(runtimeRoot, canonicalRoot, file) {
  const absolutePath = path.join(runtimeRoot, ...file.path.split("/"));
  let metadata;
  try {
    metadata = fs.statSync(absolutePath);
  } catch {
    throw new Error(`Runtime bundle file is missing: ${absolutePath}`);
  }
  if (!metadata.isFile()) throw new Error(`Runtime bundle entry is not a file: ${absolutePath}`);
  if (fs.lstatSync(absolutePath).isSymbolicLink()) {
    const target = fs.realpathSync(absolutePath);
    if (target !== canonicalRoot && !target.startsWith(`${canonicalRoot}${path.sep}`)) {
      throw new Error(`Runtime bundle symlink escapes the bundle: ${absolutePath}`);
    }
  }
  if (metadata.size !== file.size) {
    throw new Error(`Runtime bundle file size mismatch: ${absolutePath}`);
  }
  const sha256 = createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex");
  if (sha256 !== file.sha256) {
    throw new Error(`Runtime bundle file checksum mismatch: ${absolutePath}`);
  }
}

function inspectRuntimeBundle(runtimeRoot, identity) {
  const rootMetadata = fs.lstatSync(runtimeRoot, { throwIfNoEntry: false });
  if (!rootMetadata) throw new Error(`Runtime bundle root is missing: ${runtimeRoot}`);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`Runtime bundle root must be a real directory: ${runtimeRoot}`);
  }
  const manifest = readRuntimeManifest(runtimeRoot, identity);
  const expectedPaths = manifest.files.map(file => file.path);
  const expectedSet = new Set(expectedPaths);
  const paths = runtimeBundlePaths(runtimeRoot, identity.platform);
  for (const required of [
    paths.executable,
    paths.entrypoint,
    path.join(runtimeRoot, "app", "browser-helper.cjs"),
    path.join(runtimeRoot, ...manifest.launcher.split("/")),
  ]) {
    const relativePath = path.relative(runtimeRoot, required).split(path.sep).join("/");
    if (!expectedSet.has(relativePath)) {
      throw new Error(`Runtime manifest does not declare required file: ${required}`);
    }
  }

  const actualPaths = runtimeFilePaths(runtimeRoot);
  const actualSet = new Set(actualPaths);
  const missing = expectedPaths.find(relativePath => !actualSet.has(relativePath));
  if (missing) throw new Error(`Runtime bundle file is missing: ${path.join(runtimeRoot, ...missing.split("/"))}`);
  const unexpected = actualPaths.find(relativePath => !expectedSet.has(relativePath));
  if (unexpected) {
    throw new Error(`Runtime bundle contains an unmanifested file: ${path.join(runtimeRoot, ...unexpected.split("/"))}`);
  }
  if (actualPaths.length !== expectedPaths.length) {
    throw new Error(`Runtime bundle file count mismatch: expected ${expectedPaths.length}, received ${actualPaths.length}`);
  }

  const canonicalRoot = fs.realpathSync(runtimeRoot);
  for (const file of manifest.files) validateRuntimeFile(runtimeRoot, canonicalRoot, file);
  if (identity.platform !== "win32" && (fs.statSync(paths.executable).mode & 0o111) === 0) {
    throw new Error(`Bundled Bun runtime is not executable: ${paths.executable}`);
  }
  return { manifest, runtimeRoot: paths.runtimeRoot };
}

// The packaged source lives inside the signed, read-only application bundle. Hash it
// once per launch: startup waits for it to materialize, then installs from it.
const verifiedPackagedSources = new Map();
const sourceKey = (runtimeRoot, identity) => [runtimeRoot, identity.version, identity.platform, identity.arch].join("\0");

function validateRuntimeBundle(runtimeRoot, identity) {
  return inspectRuntimeBundle(runtimeRoot, identity).runtimeRoot;
}

function runtimeManifestBytes(runtimeRoot) {
  return fs.readFileSync(path.join(runtimeRoot, "manifest.json"));
}

async function waitForPackagedRuntimeSource({
  app,
  resourcesPath,
  timeoutMs = DEFAULT_SOURCE_WAIT_TIMEOUT_MS,
  intervalMs = DEFAULT_SOURCE_WAIT_INTERVAL_MS,
}) {
  if (!app.isPackaged) return null;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("Packaged runtime source wait requires non-negative timeoutMs and positive intervalMs");
  }
  const source = path.join(resourcesPath, "runtime");
  const identity = {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  };
  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (;;) {
    try {
      const inspected = inspectRuntimeBundle(source, identity);
      verifiedPackagedSources.set(sourceKey(source, identity), inspected);
      return inspected.runtimeRoot;
    } catch (error) {
      lastError = error;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Packaged runtime did not fully materialize within ${timeoutMs}ms: ${detail}`);
}

function ensurePackagedRuntime({ app, coreHome, resourcesPath }) {
  if (!app.isPackaged) return null;
  const identity = {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  };
  const source = path.join(resourcesPath, "runtime");
  const sourceBundle = verifiedPackagedSources.get(sourceKey(source, identity)) ?? inspectRuntimeBundle(source, identity);
  const expectedIdentity = { ...identity, bundleId: sourceBundle.manifest.bundleId };
  const versionsRoot = path.join(coreHome, "versions");
  const destination = path.join(
    versionsRoot,
    `${identity.version}-${identity.platform}-${identity.arch}`,
  );
  if (fs.existsSync(destination)) {
    try {
      const installed = validateRuntimeBundle(destination, expectedIdentity);
      // The daemon admits the durable copy only when its manifest is byte-identical to the
      // signed one, build metadata included. A same-version rebuild with unchanged files keeps
      // its bundleId, so a differing manifest still reinstalls the copy.
      if (runtimeManifestBytes(destination).equals(runtimeManifestBytes(source))) return installed;
    } catch {
      // A terminated installer or external cleanup can leave a version directory present but
      // incomplete. Rebuild the launcher-owned bundle transactionally from the signed package.
    }
  }

  fs.mkdirSync(versionsRoot, { recursive: true, mode: 0o700 });
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  const previous = `${destination}.previous-${process.pid}-${Date.now()}`;
  let previousMoved = false;
  try {
    fs.cpSync(source, temporary, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    validateRuntimeBundle(temporary, expectedIdentity);
    if (fs.existsSync(destination)) {
      renameAtomicFile(destination, previous);
      previousMoved = true;
    }
    try {
      renameAtomicFile(temporary, destination);
      validateRuntimeBundle(destination, expectedIdentity);
    } catch (error) {
      fs.rmSync(destination, { recursive: true, force: true });
      if (previousMoved) {
        try {
          renameAtomicFile(previous, destination);
          previousMoved = false;
        } catch (restoreError) {
          throw new Error(
            `Runtime replacement failed: ${error instanceof Error ? error.message : String(error)}`
            + `; previous runtime restoration failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
          );
        }
      }
      throw error;
    }
    if (previousMoved) {
      fs.rmSync(previous, { recursive: true, force: true });
      previousMoved = false;
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
    if (previousMoved && fs.existsSync(previous) && !fs.existsSync(destination)) {
      renameAtomicFile(previous, destination);
      previousMoved = false;
    }
  }
  try { fs.chmodSync(destination, 0o700); } catch {}
  return validateRuntimeBundle(destination, expectedIdentity);
}

function installedRuntimeRoot({ coreHome, version, platform = process.platform, arch = process.arch }) {
  if (typeof version !== "string" || !version.trim() || /[\\/\0]/.test(version)) {
    throw new Error("Installed runtime version is invalid");
  }
  const runtimeRoot = path.join(coreHome, "versions", `${version}-${platform}-${arch}`);
  return validateRuntimeBundle(runtimeRoot, { version, platform, arch });
}

// Semantic-version order: numeric core first; a release ranks above its prereleases;
// prerelease identifiers compare numerically when both are numbers.
function compareReleaseVersions(left, right) {
  const split = value => {
    const dash = value.indexOf("-");
    return dash < 0 ? [value, null] : [value.slice(0, dash), value.slice(dash + 1)];
  };
  const [leftCore, leftPre] = split(left);
  const [rightCore, rightPre] = split(right);
  const leftParts = leftCore.split(".").map(Number);
  const rightParts = rightCore.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference) return difference;
  }
  if (leftPre === rightPre) return 0;
  if (leftPre === null) return 1;
  if (rightPre === null) return -1;
  const a = leftPre.split(".");
  const b = rightPre.split(".");
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    if (a[index] === b[index]) continue;
    const numeric = /^\d+$/.test(a[index]) && /^\d+$/.test(b[index]);
    if (numeric) return Number(a[index]) - Number(b[index]);
    if (/^\d+$/.test(a[index])) return -1;
    if (/^\d+$/.test(b[index])) return 1;
    return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

const MAX_SERVICE_DEFINITION_BYTES = 256 * 1024;

// Service definitions outside NEKODEX (a launchd agent or systemd user unit for a local
// gateway, say) may run a runtime's bundled Bun by its versioned path. Removing that
// version makes the service fail at its next start, typically the next login, so any
// version such a definition names is kept.
function externallyReferencedRuntimeVersions({
  coreHome, home = os.homedir(), platform = process.platform, arch = process.arch,
  directories = platform === "darwin" ? [path.join(home, "Library", "LaunchAgents")]
    : platform === "linux" ? [path.join(home, ".config", "systemd", "user")] : [],
}) {
  const prefix = `${path.join(coreHome, "versions")}${path.sep}`;
  const suffix = `-${platform}-${arch}`;
  const versions = new Set();
  for (const directory of directories) {
    let names;
    try { names = fs.readdirSync(directory); } catch { continue; }
    for (const name of names) {
      let text;
      try {
        const file = path.join(directory, name);
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > MAX_SERVICE_DEFINITION_BYTES) continue;
        text = fs.readFileSync(file, "utf8");
      } catch { continue; }
      for (let index = text.indexOf(prefix); index >= 0; index = text.indexOf(prefix, index + 1)) {
        const entry = text.slice(index + prefix.length).split(/[/\\<"'\s]/, 1)[0];
        if (entry.endsWith(suffix)) versions.add(entry.slice(0, -suffix.length));
      }
    }
  }
  return [...versions];
}

// Every release leaves a ~150 MB runtime under versions/. Keep the versions that
// something may still execute (the app's own, the configured one, a pending
// generation's endpoints) plus the newest older release for a manual rollback,
// and remove the rest. Abandoned install temporaries are removed after an hour.
function pruneRuntimeVersions({
  coreHome, keepVersions = [], platform = process.platform, arch = process.arch,
  retainPrevious = 1, now = Date.now(), logger = null,
}) {
  const versionsRoot = path.join(coreHome, "versions");
  let entries;
  try {
    entries = fs.readdirSync(versionsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { removed: [], kept: [] };
    throw error;
  }
  const suffix = `-${platform}-${arch}`;
  const keep = new Set(keepVersions.filter(version => typeof version === "string" && version));
  const releases = [];
  const removed = [];
  const remove = name => {
    try {
      fs.rmSync(path.join(versionsRoot, name), { recursive: true, force: true });
      removed.push(name);
    } catch (error) {
      logger?.warn?.("runtime.version_prune_failed", { name, message: error instanceof Error ? error.message : String(error) });
    }
  };
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transient = entry.name.match(/\.(tmp|previous)-\d+-(\d+)$/);
    if (transient) {
      if (now - Number(transient[2]) > 60 * 60 * 1000) remove(entry.name);
      continue;
    }
    if (!entry.name.endsWith(suffix)) continue;
    const version = entry.name.slice(0, -suffix.length);
    if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) releases.push({ name: entry.name, version });
  }
  const newestKept = [...keep].sort(compareReleaseVersions).at(-1);
  const candidates = releases
    .filter(release => !keep.has(release.version))
    .sort((left, right) => compareReleaseVersions(right.version, left.version));
  let previousRetained = 0;
  const kept = releases.filter(release => keep.has(release.version)).map(release => release.version);
  for (const release of candidates) {
    const older = newestKept === undefined || compareReleaseVersions(release.version, newestKept) < 0;
    if (older && previousRetained < retainPrevious) {
      previousRetained += 1;
      kept.push(release.version);
      continue;
    }
    // A newer, unknown release may belong to a concurrent install; never remove it.
    if (!older) {
      kept.push(release.version);
      continue;
    }
    remove(release.name);
  }
  if (removed.length) logger?.info?.("runtime.versions_pruned", { removed, kept });
  return { removed, kept };
}

module.exports = {
  compareReleaseVersions,
  ensurePackagedRuntime,
  externallyReferencedRuntimeVersions,
  installedRuntimeRoot,
  pruneRuntimeVersions,
  validateRuntimeBundle,
  waitForPackagedRuntimeSource,
};
