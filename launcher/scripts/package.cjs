const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { signingConfiguration, verifyMacPublisher, verifyWindowsTree, validatePackagedRuntimeAssets, validateOwnedNativePackagedAssets } = require("./release-signing.cjs");
const { validateRuntimeBundle } = require("../electron/runtime-install.cjs");

const root = path.resolve(__dirname, "..");
const launcherManifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const executable = "node";
const electronBuilderCli = require.resolve("electron-builder/out/cli/cli.js", { paths: [root] });
const requested = process.argv[2];
const target = requested || (process.platform === "darwin" ? "--mac"
  : process.platform === "win32" ? "--win"
    : process.platform === "linux" ? "--linux"
      : null);
if (!["--mac", "--win", "--linux"].includes(target)) {
  throw new Error(`Unsupported packaging target: ${requested || process.platform}`);
}
const nativeTarget = process.platform === "darwin" ? "--mac"
  : process.platform === "win32" ? "--win"
    : process.platform === "linux" ? "--linux"
      : null;
if (target !== nativeTarget) {
  throw new Error(
    `Cross-packaging ${target} from ${process.platform}/${process.arch} is disabled because the launcher embeds a native Bun runtime. `
    + "Build each target on its matching operating system.",
  );
}

// Refuse incomplete input before electron-builder starts a signing/archive
// transaction. Verify the extracted final app again because packaging must
// preserve the pre-signed bytes recorded by the runtime's file manifest.
const preparedRuntime = path.join(root, "build", "runtime");
validateRuntimeBundle(preparedRuntime, { version: launcherManifest.version, platform: process.platform, arch: process.arch });
validatePackagedRuntimeAssets(preparedRuntime, { platform: process.platform, arch: process.arch });
validateOwnedNativePackagedAssets(preparedRuntime, { platform: process.platform, arch: process.arch });

const env = { ...process.env };
const signing = signingConfiguration(process.platform, env);
if (signing.release && process.platform === "darwin") {
  env.CSC_KEYCHAIN = env.CODEX_WEB_GPT_SIGNING_KEYCHAIN;
  if (env.APPLE_KEYCHAIN_PROFILE) {
    // Select existing notarytool credentials without exporting their secrets.
    for (const name of ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]) delete env[name];
  }
} else if (process.platform === "darwin" && env.NEKODEX_LOCAL_APP_SIGNING_IDENTITY) {
  // Use the same publisher as the pre-signed runtime helpers. An ad-hoc app
  // enclosing publisher-signed helpers cannot authorize installed Native/VM.
  env.CSC_NAME = env.NEKODEX_LOCAL_APP_SIGNING_IDENTITY;
  if (env.NEKODEX_LOCAL_APP_SIGNING_KEYCHAIN) env.CSC_KEYCHAIN = env.NEKODEX_LOCAL_APP_SIGNING_KEYCHAIN;
}
if (target === "--mac" && process.arch === "arm64" && !/^Developer ID Application: .+ \(CNMWGJF2CG\)$/.test(env.CSC_NAME || "")) {
  throw new Error("The packaged macOS Native/VM runtime requires the NEKODEX Developer ID application identity");
}
if (!env.CSC_LINK && !env.CSC_NAME) env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
const builderArgs = [
  electronBuilderCli,
  target,
  "--publish",
  "never",
];
// Developer builds can reuse the exact Electron package already installed by
// the lockfile instead of requiring a second network download during packaging.
// Publisher builds retain the release pipeline's normal artifact acquisition.
const installedElectronDist = path.join(root, "node_modules", "electron", "dist");
const installedElectronVersion = path.join(installedElectronDist, "version");
if (!signing.release && fs.existsSync(installedElectronVersion)
  && fs.readFileSync(installedElectronVersion, "utf8").trim() === launcherManifest.devDependencies.electron) {
  builderArgs.push(`--config.electronDist=${installedElectronDist}`);
}
if (signing.release && process.platform !== "linux") {
  builderArgs.push("--config.forceCodeSigning=true");
  if (target === "--mac") builderArgs.push("--config.mac.notarize=true", `--config.mac.identity=${env.CSC_NAME.replace(/^Developer ID Application:\s*/, "")}`);
  if (target === "--win") builderArgs.push(`--config.win.signtoolOptions.certificateSha1=${env.CODEX_WEB_GPT_WINDOWS_CERT_SHA1}`);
}
if (target === "--mac" && !signing.release && env.CSC_NAME) {
  builderArgs.push("--config.forceCodeSigning=true", "--config.mac.notarize=false", `--config.mac.identity=${env.CSC_NAME.replace(/^Developer ID Application:\s*/, "")}`);
}
if (target === "--mac" && !signing.release && !env.CSC_LINK && !env.CSC_NAME) {
  builderArgs.push("--config.mac.identity=-");
}

const staging = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-gpt-package-"));
const artifactsDirectory = path.join(root, "artifacts");
const artifactExtension = /\.(?:AppImage|dmg|exe|zip|blockmap)$/i;
const requiredExtensions = {
  "--mac": [".dmg", ".zip"],
  "--win": [".exe", ".zip"],
  "--linux": [".AppImage"],
};

function restoreInterruptedArtifacts() {
  if (fs.existsSync(artifactsDirectory)) return;
  const backups = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith(".artifacts-swap-"))
    .map(entry => path.join(root, entry.name, "previous"))
    .filter(candidate => fs.existsSync(candidate));
  if (backups.length > 1) {
    throw new Error(`Cannot choose a previous artifact set to restore: ${backups.join(", ")}`);
  }
  if (backups.length === 1) fs.renameSync(backups[0], artifactsDirectory);
}

function runChecked(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status ?? "unknown"}`);
  }
}

function verifySignedMacArchive() {
  const archives = fs.readdirSync(staging)
    .filter(name => /-mac-(?:arm64|x64)\.zip$/.test(name));
  if (archives.length !== 1) {
    throw new Error(`Expected exactly one macOS ZIP for verification; found ${archives.join(", ") || "none"}`);
  }
  const verificationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-gpt-mac-verify-"));
  try {
    runChecked("ditto", ["-x", "-k", path.join(staging, archives[0]), verificationRoot]);
    const appBundle = path.join(verificationRoot, `${launcherManifest.build.productName}.app`);
    runChecked("codesign", ["--verify", "--deep", "--strict", appBundle]);
    const publisherEnv = { ...env, APPLE_TEAM_ID: "CNMWGJF2CG" };
    const publisherRequired = signing.release || process.arch === "arm64";
    if (publisherRequired) {
      verifyMacPublisher(appBundle, publisherEnv, { notarized: signing.release });
      verifyMacPublisher(path.join(appBundle, "Contents", "Resources", "runtime", "runtime", "bun"), publisherEnv);
    }
    validateRuntimeBundle(path.join(appBundle, "Contents", "Resources", "runtime"), {
      version: launcherManifest.version,
      platform: "darwin",
      arch: process.arch,
    });
    const runtime = path.join(appBundle, "Contents", "Resources", "runtime");
    validatePackagedRuntimeAssets(runtime, { platform: "darwin", arch: process.arch });
    validateOwnedNativePackagedAssets(runtime, { platform: "darwin", arch: process.arch });
    if (publisherRequired) {
      if (process.arch === "arm64") verifyMacPublisher(path.join(runtime, "app", "owned-native", "build", "aarch64-apple-darwin", "nekodex-owned-native-worker"), publisherEnv);
      for (const [directory, executable] of [["credential-helper", "nekodex-credential-helper"], ["oauth-vault-helper", "nekodex-oauth-vault-helper"],
        ["desktop-helper", "nekodex-desktop-helper"], ["skill-pdf-helper", "nekodex-skill-pdf-helper"],
        ...(process.arch === "arm64" ? [["execution-vm", "nekodex-execution-vm-helper"]] : [])]) {
        verifyMacPublisher(path.join(runtime, "app", directory, `darwin-${process.arch}`, executable), publisherEnv);
      }
    }
  } finally {
    fs.rmSync(verificationRoot, { recursive: true, force: true });
  }
}


// Sign and notarize the final disk image separately from its already-notarized app.
// This runs before checksum generation and upload, so authenticated metadata binds stapled bytes.
function signAndNotarizeMacDmg() {
  const images = fs.readdirSync(staging).filter(name => name.endsWith(".dmg"));
  if (images.length !== 1) throw new Error("Expected exactly one release DMG");
  const image = path.join(staging, images[0]);
  runChecked("codesign", ["--force", "--timestamp", "--keychain", env.CODEX_WEB_GPT_SIGNING_KEYCHAIN,
    "--sign", env.CSC_NAME, image]);
  const credentials = env.APPLE_KEYCHAIN_PROFILE
    ? ["--keychain-profile", env.APPLE_KEYCHAIN_PROFILE, ...(env.APPLE_KEYCHAIN ? ["--keychain", env.APPLE_KEYCHAIN] : [])]
    : ["--key", env.APPLE_API_KEY, "--key-id", env.APPLE_API_KEY_ID, "--issuer", env.APPLE_API_ISSUER];
  const submission = spawnSync("xcrun", ["notarytool", "submit", image, ...credentials,
    "--wait", "--output-format", "json"], {
    env, encoding: "utf8", timeout: 20 * 60 * 1000, maxBuffer: 1024 * 1024, shell: false,
  });
  if (submission.error || submission.status !== 0) throw new Error("DMG notarization submission failed");
  const receipt = JSON.parse(submission.stdout);
  if (receipt.status !== "Accepted") throw new Error(`DMG notarization was not accepted (${receipt.status})`);
  console.log(`DMG notarization accepted: ${receipt.id}`);
  runChecked("xcrun", ["stapler", "staple", image]);
  runChecked("xcrun", ["stapler", "validate", image]);
  verifyMacPublisher(image, env);
  runChecked("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", image]);
}

function publishStagedArtifacts() {
  const artifacts = fs.readdirSync(staging, { withFileTypes: true })
    .filter(entry => entry.isFile() && artifactExtension.test(entry.name));
  for (const extension of requiredExtensions[target]) {
    const matches = artifacts.filter(entry => entry.name.toLowerCase().endsWith(extension.toLowerCase()));
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one ${extension} distributable artifact in ${staging}; found ${matches.length}`);
    }
  }

  const names = new Set();
  for (const artifact of artifacts) {
    const publicName = artifact.name.replace(/-linux-x86_64(?=\.)/, "-linux-x64");
    const collisionKey = process.platform === "win32" ? publicName.toLowerCase() : publicName;
    if (names.has(collisionKey)) throw new Error(`Duplicate output artifact: ${publicName}`);
    names.add(collisionKey);
    if (fs.statSync(path.join(staging, artifact.name)).size === 0) {
      throw new Error(`Empty output artifact: ${artifact.name}`);
    }
  }

  // Prepare the complete replacement on the same filesystem as artifacts.
  // Keep unrelated entries in that directory and leave the original untouched
  // through all staged file copies.
  const swapRoot = fs.mkdtempSync(path.join(root, ".artifacts-swap-"));
  const prepared = path.join(swapRoot, "prepared");
  const previous = path.join(swapRoot, "previous");
  let retainPrevious = false;
  try {
    if (fs.existsSync(artifactsDirectory)) {
      if (!fs.lstatSync(artifactsDirectory).isDirectory()) {
        throw new Error(`Artifact output must be a real directory: ${artifactsDirectory}`);
      }
      fs.cpSync(artifactsDirectory, prepared, { recursive: true });
    } else {
      fs.mkdirSync(prepared);
    }
    for (const entry of fs.readdirSync(prepared, { withFileTypes: true })) {
      if ((entry.isFile() || entry.isSymbolicLink()) && artifactExtension.test(entry.name)) {
        fs.rmSync(path.join(prepared, entry.name));
      }
    }
    for (const artifact of artifacts) {
      const publicName = artifact.name.replace(/-linux-x86_64(?=\.)/, "-linux-x64");
      fs.copyFileSync(path.join(staging, artifact.name), path.join(prepared, publicName));
    }

    const hadPrevious = fs.existsSync(artifactsDirectory);
    if (hadPrevious) fs.renameSync(artifactsDirectory, previous);
    try {
      fs.renameSync(prepared, artifactsDirectory);
    } catch (error) {
      if (hadPrevious) {
        try {
          fs.renameSync(previous, artifactsDirectory);
        } catch (restoreError) {
          retainPrevious = true;
          throw new AggregateError([error, restoreError], `Cannot restore artifacts; previous output is at ${previous}`);
        }
      }
      throw error;
    }
  } finally {
    if (!retainPrevious) {
      try {
        fs.rmSync(swapRoot, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Could not remove packaging backup ${swapRoot}: ${error.message}`);
      }
    }
  }
}

try {
  restoreInterruptedArtifacts();
  const result = spawnSync(executable, [
    ...builderArgs,
    `--config.directories.output=${staging}`,
  ], {
    cwd: root,
    env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (target === "--mac") {
    verifySignedMacArchive();
    if (signing.release) signAndNotarizeMacDmg();
  }
  if (target === "--win" && signing.release) verifyWindowsTree(staging, env);

  publishStagedArtifacts();
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
