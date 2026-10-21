import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { VERSION } from "../src/version";
import { createRequire } from "node:module";
const { beginDirectoryBuild } = createRequire(import.meta.url)("./build-output.cjs");
const { compileCredentialHelper } = createRequire(import.meta.url)("./build-credential-helper.cjs");
const { compileOAuthVaultHelper } = createRequire(import.meta.url)("./build-oauth-vault-helper.cjs");
const { compileDesktopHelper, DESKTOP_HELPER_BUNDLE } = createRequire(import.meta.url)("./build-desktop-helper.cjs");
const { compileSkillPdfHelper } = createRequire(import.meta.url)("./build-skill-pdf-helper.cjs");
const { prepareExecutionVmRuntime, prepareOwnedNativeRuntime } = createRequire(import.meta.url)("../launcher/scripts/prepare-runtime.cjs");
const { signingConfiguration, signEmbeddedRuntime, signDesktopHelper, signSkillPdfHelper } = createRequire(import.meta.url)("../launcher/scripts/release-signing.cjs");

const root = resolve(import.meta.dir, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  version?: string;
  packageManager?: string;
};
if (packageJson.version !== VERSION) throw new Error("package.json and runtime version are out of sync");
const packageManagerMatch = /^bun@(\d+\.\d+\.\d+)$/.exec(packageJson.packageManager ?? "");
if (!packageManagerMatch) throw new Error("package.json must pin an exact Bun packageManager version");
const expectedBunVersion = packageManagerMatch[1];
if (Bun.version !== expectedBunVersion) {
  throw new Error(`Runtime bundle requires Bun ${expectedBunVersion}, received ${Bun.version}`);
}

function embeddedBunExecutable(): string {
  const configured = process.env.CODEX_CHATGPT_WEB_EMBEDDED_BUN;
  if (!configured) return realpathSync(process.execPath);
  if (!isAbsolute(configured)) throw new Error("CODEX_CHATGPT_WEB_EMBEDDED_BUN must be an absolute path");
  const executable = realpathSync(configured);
  const version = Bun.spawnSync([executable, "--version"], { stdout: "pipe", stderr: "pipe" });
  if (version.exitCode !== 0) {
    throw new Error(`Embedded Bun validation failed: ${version.stderr.toString() || version.stdout.toString()}`);
  }
  const reported = version.stdout.toString().trim();
  if (reported !== expectedBunVersion) {
    throw new Error(`Embedded Bun must be ${expectedBunVersion}, received ${reported || "no version"}`);
  }
  return executable;
}
const destination = resolve(process.argv[2] ?? join(root, "dist", "runtime"));
const transaction = beginDirectoryBuild(destination, { repositoryRoot: root, kind: "runtime" });
const output: string = transaction.staging;
try {
const appDir = join(output, "app");
const runtimeDir = join(output, "runtime");
const binDir = join(output, "bin");

mkdirSync(appDir, { recursive: true });
mkdirSync(runtimeDir, { recursive: true });
mkdirSync(binDir, { recursive: true });

const build = await Bun.build({
  entrypoints: [join(root, "src", "cli.ts")],
  target: "bun",
  minify: true,
  external: ["playwright-core"],
  packages: "external",
  outdir: appDir,
  naming: "cli.js",
});
if (!build.success) {
  throw new Error(`Runtime bundle failed: ${build.logs.map(log => log.message).join("; ")}`);
}

const browserHelperBuild = await Bun.build({
  entrypoints: [join(root, "src", "adapters", "chatgpt-web", "browser-helper-main.ts")],
  target: "node",
  format: "cjs",
  minify: true,
  external: ["playwright-core"],
  packages: "external",
  outdir: appDir,
  naming: "browser-helper.cjs",
});
if (!browserHelperBuild.success) {
  throw new Error(`Browser helper bundle failed: ${browserHelperBuild.logs.map(log => log.message).join("; ")}`);
}

// Keep the reviewed MV3 artifact adjacent to cli.js, where the bundled runtime resolves it.
// Copy only its shipped resources; session pairing data never belongs to this source tree.
const companionDir = join(appDir, "browser-companion");
mkdirSync(companionDir, { recursive: true });
const companionResources = ["popup.html", "popup.css", "popup.js", "page.js", "chatgpt.js", "dispatch.js", "transport.js", "session.html", "session.js",
  "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png"];
mkdirSync(join(companionDir, "icons"), { recursive: true });
for (const name of ["manifest.json", "manifest.firefox.json", ...companionResources, "README.md", "PRIVACY.md"]) {
  copyFileSync(join(root, "browser-companion", name), join(companionDir, name));
}
// Firefox requires its manifest as manifest.json. Keep Chrome's existing loader path intact.
const firefoxCompanionDir = join(companionDir, "firefox");
mkdirSync(firefoxCompanionDir, { recursive: true });
copyFileSync(join(root, "browser-companion", "manifest.firefox.json"), join(firefoxCompanionDir, "manifest.json"));
mkdirSync(join(firefoxCompanionDir, "icons"), { recursive: true });
for (const name of companionResources) copyFileSync(join(root, "browser-companion", name), join(firefoxCompanionDir, name));

copyFileSync(join(root, "package.json"), join(appDir, "package.json"));
copyFileSync(join(root, "bun.lock"), join(appDir, "bun.lock"));
const install = Bun.spawnSync([process.execPath, "install", "--production", "--frozen-lockfile", "--ignore-scripts"], {
  cwd: appDir,
  stdout: "pipe",
  stderr: "pipe",
});
if (install.exitCode !== 0) {
  throw new Error(`Runtime dependencies failed to install: ${install.stderr.toString() || install.stdout.toString()}`);
}
const bunName = process.platform === "win32" ? "bun.exe" : "bun";
cpSync(embeddedBunExecutable(), join(runtimeDir, bunName));
if (process.platform !== "win32") chmodSync(join(runtimeDir, bunName), 0o755);
// Sign before recording manifest hashes; packaging preserves this exact Bun signature.
signEmbeddedRuntime(join(runtimeDir, bunName));

// Build/sign the fixed helper before copying it into the immutable manifest tree.
// Release/local identities take precedence over the source-build development exception.
const credentialHelper = compileCredentialHelper({ repositoryRoot: root, development: true });
if (credentialHelper.supported) {
  const helperDirectory = join(appDir, "credential-helper", `${process.platform}-${process.arch}`);
  mkdirSync(helperDirectory, { recursive: true });
  copyFileSync(credentialHelper.executable, join(helperDirectory, "nekodex-credential-helper"));
  chmodSync(join(helperDirectory, "nekodex-credential-helper"), 0o755);
}
const oauthVaultHelper = compileOAuthVaultHelper({ repositoryRoot: root, development: true });
if (oauthVaultHelper.supported) {
  const helperDirectory = join(appDir, "oauth-vault-helper", `${process.platform}-${process.arch}`);
  mkdirSync(helperDirectory, { recursive: true });
  copyFileSync(oauthVaultHelper.executable, join(helperDirectory, "nekodex-oauth-vault-helper"));
  chmodSync(join(helperDirectory, "nekodex-oauth-vault-helper"), 0o755);
}
const desktopHelper = compileDesktopHelper({ repositoryRoot: root, development: true,
  sign: (candidate: string) => signDesktopHelper(candidate, process.platform, process.env, { development: true }) });
if (desktopHelper.supported) {
  // The whole signed bundle: its seal covers Info.plist, which carries the stable TCC identity.
  const helperDirectory = join(appDir, "desktop-helper", `${process.platform}-${process.arch}`);
  mkdirSync(helperDirectory, { recursive: true });
  cpSync(desktopHelper.bundle, join(helperDirectory, DESKTOP_HELPER_BUNDLE), { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
}
const pdfPublisher = process.platform === "darwin" && (signingConfiguration(process.platform).release || Boolean(process.env.NEKODEX_LOCAL_APP_SIGNING_IDENTITY));
const pdfHelper = compileSkillPdfHelper({ repositoryRoot: root, development: !pdfPublisher,
  ...(pdfPublisher ? { sign: (candidate: string) => signSkillPdfHelper(candidate, process.platform, process.env, { development: false }) } : {}) });
if (pdfHelper.supported) {
  const helperDirectory = join(appDir, "skill-pdf-helper", `${process.platform}-${process.arch}`);
  mkdirSync(helperDirectory, { recursive: true });
  copyFileSync(pdfHelper.executable, join(helperDirectory, "nekodex-skill-pdf-helper"));
  copyFileSync(join(dirname(pdfHelper.executable), "manifest.json"), join(helperDirectory, "manifest.json"));
  chmodSync(join(helperDirectory, "nekodex-skill-pdf-helper"), 0o755);
}

// Production VM assets stay under the signed app runtime with their fixed
// publisher identity. Add them before hashing; never fall back to checkout paths.
prepareExecutionVmRuntime(appDir, { root });
prepareOwnedNativeRuntime(appDir, { root });

const launcherName = process.platform === "win32" ? "codex-chatgpt-web.cmd" : "codex-chatgpt-web";
const launcher = process.platform === "win32" ? `@echo off
setlocal
chcp 65001 >nul
set "ROOT=%~dp0.."
set "CODEX_CHATGPT_WEB_LAUNCHER=%~f0"
"%ROOT%\\runtime\\bun.exe" "%ROOT%\\app\\cli.js" %*
` : `#!/bin/sh
set -eu
invoked="$0"
case "$invoked" in
  /*) ;;
  *) invoked="$(command -v -- "$invoked")" ;;
esac
script="$invoked"
while [ -L "$script" ]; do
  target="$(readlink "$script")"
  case "$target" in
    /*) script="$target" ;;
    *) script="$(dirname "$script")/$target" ;;
  esac
done
bin_dir="$(CDPATH= cd -- "$(dirname "$script")" && pwd -P)"
root="$(CDPATH= cd -- "$bin_dir/.." && pwd -P)"
export CODEX_CHATGPT_WEB_LAUNCHER="$invoked"
exec "$root/runtime/bun" "$root/app/cli.js" "$@"
`;
writeFileSync(join(binDir, launcherName), launcher, process.platform === "win32" ? undefined : { mode: 0o755 });
if (process.platform !== "win32") chmodSync(join(binDir, launcherName), 0o755);

const notices = Bun.spawnSync([
  process.execPath,
  "run",
  join(root, "scripts", "generate-third-party-notices.ts"),
  join(output, "THIRD_PARTY_NOTICES.txt"),
  "--include-launcher",
], {
  cwd: root,
  stdout: "pipe",
  stderr: "pipe",
});
if (notices.exitCode !== 0) {
  throw new Error(`Third-party notices failed: ${notices.stderr.toString() || notices.stdout.toString()}`);
}
copyFileSync(join(root, "LICENSE"), join(output, "LICENSE"));
cpSync(join(root, "LICENSES"), join(output, "LICENSES"), { recursive: true });

interface RuntimeManifestFile {
  path: string;
  size: number;
  sha256: string;
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function runtimeManifestFiles(): RuntimeManifestFile[] {
  const canonicalRoot = realpathSync(output);
  const files: RuntimeManifestFile[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => comparePaths(left.name, right.name))) {
      const absolutePath = join(directory, entry.name);
      const relativePath = relative(output, absolutePath).split(sep).join("/");
      if (relativePath === "manifest.json") continue;
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      const metadata = statSync(absolutePath);
      if (!metadata.isFile()) throw new Error(`Unsupported runtime bundle entry: ${relativePath}`);
      if (lstatSync(absolutePath).isSymbolicLink()) {
        const target = realpathSync(absolutePath);
        if (target !== canonicalRoot && !target.startsWith(`${canonicalRoot}${sep}`)) {
          throw new Error(`Runtime bundle symlink escapes the bundle: ${relativePath}`);
        }
      }
      files.push({
        path: relativePath,
        size: metadata.size,
        sha256: createHash("sha256").update(readFileSync(absolutePath)).digest("hex"),
      });
    }
  };
  visit(output);
  return files.sort((left, right) => comparePaths(left.path, right.path));
}

function bundleIdFor(files: RuntimeManifestFile[]): string {
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

const playwrightPackage = join(appDir, "node_modules", "playwright-core", "package.json");
const files = runtimeManifestFiles();
let commit: string | undefined;
let dirty: boolean | undefined;
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 5000 }).trim();
  dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
    cwd: root, encoding: "utf8", timeout: 5000,
  }).trim().length > 0;
} catch { /* Source archives may have no Git metadata; do not invent a clean commit. */ }
writeFileSync(join(output, "manifest.json"), `${JSON.stringify({
  schemaVersion: 2,
  appVersion: VERSION,
  build: { ...(commit ? { commit } : {}), ...(dirty !== undefined ? { dirty } : {}), builtAt: new Date().toISOString() },
  bundleId: bundleIdFor(files),
  bunVersion: Bun.version,
  platform: process.platform,
  arch: process.arch,
  launcher: `bin/${launcherName}`,
  entrypoint: "app/cli.js",
  playwright: JSON.parse(readFileSync(playwrightPackage, "utf8")).version,
  files,
}, null, 2)}\n`);

transaction.commit();
process.stdout.write(`${destination}\n`);
} finally { transaction.dispose(); }
