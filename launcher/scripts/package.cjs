const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { signingConfiguration, verifyMacPublisher, verifyWindowsTree } = require("./release-signing.cjs");
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

const env = { ...process.env };
const signing = signingConfiguration(process.platform, env);
if (signing.release && process.platform === "darwin") {
  env.CSC_KEYCHAIN = env.CODEX_WEB_GPT_SIGNING_KEYCHAIN;
  if (env.APPLE_KEYCHAIN_PROFILE) {
    // Select existing notarytool credentials without exporting their secrets.
    for (const name of ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]) delete env[name];
  }
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
if (target === "--mac" && !signing.release && !env.CSC_LINK && !env.CSC_NAME) {
  builderArgs.push("--config.mac.identity=-");
}

const staging = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-gpt-package-"));
const artifactsDirectory = path.join(root, "artifacts");

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
    if (signing.release) {
      verifyMacPublisher(appBundle, env, { notarized: true });
      verifyMacPublisher(path.join(appBundle, "Contents", "Resources", "runtime", "runtime", "bun"), env);
    }
    validateRuntimeBundle(path.join(appBundle, "Contents", "Resources", "runtime"), {
      version: launcherManifest.version,
      platform: "darwin",
      arch: process.arch,
    });
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

try {
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

  fs.mkdirSync(artifactsDirectory, { recursive: true });
  for (const entry of fs.readdirSync(artifactsDirectory, { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:AppImage|dmg|exe|zip|blockmap)$/i.test(entry.name)) {
      fs.rmSync(path.join(artifactsDirectory, entry.name), { force: true });
    }
  }
  const artifacts = fs.readdirSync(staging, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:AppImage|dmg|exe|zip|blockmap)$/i.test(entry.name));
  if (!artifacts.some((entry) => /\.(?:AppImage|dmg|exe|zip)$/i.test(entry.name))) {
    throw new Error(`electron-builder produced no distributable artifact in ${staging}`);
  }
  for (const artifact of artifacts) {
    const publicName = artifact.name.replace(/-linux-x86_64(?=\.)/, "-linux-x64");
    fs.copyFileSync(path.join(staging, artifact.name), path.join(artifactsDirectory, publicName));
  }
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
