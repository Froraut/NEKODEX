const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");

const launcherRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(launcherRoot, "..");
const output = path.join(launcherRoot, "build", "runtime");
const bun = process.env.CODEX_WEB_GPT_BUN || process.execPath;

// Called by the runtime builder BEFORE its file manifest is sealed. Never append
// assets to build/runtime after that transaction has committed.
function prepareExecutionVmRuntime(appDirectory, { root = repositoryRoot, platform = process.platform,
  arch = process.arch, env = process.env } = {}) {
  if (platform !== "darwin" || arch !== "arm64") return { supported: false };
  root = fs.realpathSync(root);
  require(path.join(root, "scripts/sign-execution-vm-helper.cjs")).executionVmSigningConfiguration(env);
  const { compileExecutionVmHelper, createProductionVmRuntimeManifest } = require(path.join(root, "scripts/build-execution-vm-helper.cjs"));
  const guestDirectory = path.join(root, "launcher/native/execution-guest/.build/bundle");
  const read = file => {
    const metadata = fs.lstatSync(file, { bigint: true });
    if (!metadata.isFile() || metadata.isSymbolicLink() || fs.realpathSync(file) !== file || metadata.nlink !== 1n) {
      throw new Error(`Execution VM packaging requires a canonical regular artifact: ${file}`);
    }
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      if (opened.ino !== metadata.ino || opened.dev !== metadata.dev) throw new Error("Execution VM build artifact changed before capture");
      const bytes = fs.readFileSync(descriptor), after = fs.lstatSync(file, { bigint: true });
      if (["dev", "ino", "size", "mtimeNs", "ctimeNs", "mode"].some(key => metadata[key] !== after[key])) throw new Error("Execution VM build artifact changed during capture");
      return bytes;
    } finally { fs.closeSync(descriptor); }
  };
  // Consume the accepted guest image; packaging must not rebuild or boot it.
  const guestManifestBytes = read(path.join(guestDirectory, "manifest.json"));
  const guest = JSON.parse(guestManifestBytes.toString("utf8"));
  const image = read(path.join(guestDirectory, "Image"));
  const initrd = read(path.join(guestDirectory, "initrd.gz"));
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  if (hash(image) !== guest.kernel?.sha256 || hash(initrd) !== guest.initrd?.sha256) {
    throw new Error("Execution VM guest bytes differ from their accepted manifest");
  }
  const helper = compileExecutionVmHelper({ repositoryRoot: root, platform, arch, development: false, env });
  const helperManifestBytes = read(path.join(path.dirname(helper.executable), "manifest.json"));
  const helperBytes = read(helper.executable);
  const runtimeManifest = createProductionVmRuntimeManifest(helperManifestBytes, guestManifestBytes);
  if (hash(helperBytes) !== runtimeManifest.helper.sha256) throw new Error("Execution VM signed helper changed before packaging");
  const directory = path.join(appDirectory, "execution-vm", "darwin-arm64");
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, bytes, mode] of [
    ["nekodex-execution-vm-helper", helperBytes, 0o755],
    ["helper-manifest.json", helperManifestBytes, 0o644],
    ["guest-manifest.json", guestManifestBytes, 0o644],
    ["Image", image, 0o644],
    ["initrd.gz", initrd, 0o644],
    ["runtime-manifest.json", Buffer.from(`${JSON.stringify(runtimeManifest, null, 2)}\n`), 0o644],
  ]) fs.writeFileSync(path.join(directory, name), bytes, { mode, flag: "wx" });
  return { supported: true, directory };
}

// Distribution authority is separate from the accepted build's truthful static
// DEV/proof fields. Copy first, sign only the copy, then bind both in a new
// production manifest; the original helper and receipt are never rewritten.
function prepareOwnedNativeRuntime(appDirectory, { root = repositoryRoot, platform = process.platform,
  arch = process.arch, env = process.env } = {}) {
  if (platform !== "darwin" || arch !== "arm64") return { supported: false };
  root = fs.realpathSync(root);
  const { reviewedOwnedNativeDevPin } = require(path.join(root, "launcher/electron/owned-native-dev-pin.cjs"));
  const { createOwnedNativeProductionManifest } = require(path.join(root, "launcher/electron/owned-native-production-pin.cjs"));
  const { fileDigest } = require(path.join(root, "launcher/electron/owned-native-admission.cjs"));
  const { signOwnedNativeWorker } = require("./release-signing.cjs");
  const accepted = reviewedOwnedNativeDevPin(root);
  if (accepted.target !== "aarch64-apple-darwin") throw new Error("No reviewed Owned Native artifact for the requested package target");
  const directory = path.join(appDirectory, "owned-native");
  const sourceRoot = accepted.wrapperBuildPin.sourceRoot;
  const files = ["source-pin.json", "Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "src/main.rs"];
  const copy = (source, destination) => {
    const metadata = fs.lstatSync(source);
    if (!metadata.isFile() || metadata.isSymbolicLink() || fs.realpathSync(source) !== source) throw new Error("Owned Native package input must be a canonical regular file");
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, 0o644);
  };
  for (const file of files) copy(path.join(sourceRoot, file), path.join(directory, file));
  const outputDirectory = path.join(directory, "build", accepted.target);
  const executable = path.join(outputDirectory, "nekodex-owned-native-worker");
  copy(accepted.executable, executable);
  if (fileDigest(executable) !== accepted.executableSha256) throw new Error("Owned Native artifact changed before its production copy was signed");
  fs.chmodSync(executable, 0o755);
  copy(accepted.wrapperBuildPin.metadataPath, path.join(outputDirectory, "build-info.json"));
  if (fileDigest(path.join(outputDirectory, "build-info.json")) !== accepted.wrapperBuildPin.metadataSha256
    || fileDigest(path.join(directory, "source-pin.json")) !== accepted.wrapperBuildPin.sourcePinSha256) {
    throw new Error("Owned Native copied provenance changed from the accepted build pins");
  }
  const catalog = path.join(path.dirname(accepted.executable), "official-bootstrap-models.json");
  if (accepted.officialBootstrapCatalog?.path !== catalog) throw new Error("Owned Native catalog must use its fixed accepted build layout");
  copy(catalog, path.join(outputDirectory, "official-bootstrap-models.json"));
  signOwnedNativeWorker(executable, platform, env);
  const manifest = createOwnedNativeProductionManifest({ sourceRoot: directory, executable, target: accepted.target });
  fs.writeFileSync(path.join(outputDirectory, "production-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644, flag: "wx" });
  return { supported: true, directory, executable, target: accepted.target };
}

if (require.main === module) {
  const result = spawnSync(bun, ["run", "scripts/build-runtime-bundle.ts", output], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The bundler already seals notices and licenses into its manifest. Do not mutate the sealed bundle.
module.exports = { prepareExecutionVmRuntime, prepareOwnedNativeRuntime };
