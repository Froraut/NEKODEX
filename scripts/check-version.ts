import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { assertReadmeDownloads } from "./readme-downloads";

const root = resolve(import.meta.dir, "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  version?: string;
  packageManager?: string;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  repository?: { url?: string };
};
const packageVersion = packageJson.version;
if (!packageVersion) throw new Error("package.json has no version");
const packageManagerMatch = /^bun@(\d+\.\d+\.\d+)$/.exec(packageJson.packageManager ?? "");
if (!packageManagerMatch) throw new Error("package.json must pin an exact Bun packageManager version");
const bunVersion = packageManagerMatch[1];
if (Bun.version !== bunVersion) throw new Error(`Expected Bun ${bunVersion}, received ${Bun.version}`);
if (packageJson.devDependencies?.["@types/bun"] !== bunVersion) {
  throw new Error(`@types/bun is not synchronized to ${bunVersion}`);
}
if (packageJson.engines?.bun !== bunVersion) throw new Error(`engines.bun is not synchronized to ${bunVersion}`);
const expected = [
  ["src/version.ts", `export const VERSION = ${JSON.stringify(packageVersion)};`],
  ["src/adapters/chatgpt-web/mcp-server.ts", "version: VERSION"],
  ["README.md", `requires Bun ${bunVersion}.`],
  ["README.zh-CN.md", `Bun ${bunVersion}`],
  ["scripts/generate-third-party-notices.ts", `Bun ${bunVersion}`],
  ["scripts/prepare-windows-baseline-bun.ps1", `bun-v$Version`],
  [".github/workflows/ci.yml", `bun-version: ${bunVersion}`],
  [".github/workflows/ci.yml", `-Version ${bunVersion}`],
  [".github/workflows/release.yml", `Bun-${bunVersion}.md`],
  [".github/workflows/release.yml", `-Version ${bunVersion}`],
] as const;
for (const [path, needle] of expected) {
  if (!readFileSync(resolve(root, path), "utf8").includes(needle)) throw new Error(`${path} is not synchronized to ${packageVersion}`);
}
const launcherPackage = JSON.parse(readFileSync(resolve(root, "launcher/package.json"), "utf8")) as {
  version?: string;
  build: { appId: string; productName: string; artifactName: string; dmg: { artifactName: string } };
  forkIdentity: { profileCompatibility: string; displayName: string };
};
if (launcherPackage.forkIdentity.profileCompatibility !== launcherPackage.build.appId
  || launcherPackage.forkIdentity.displayName !== launcherPackage.build.productName) {
  throw new Error("The persisted updater identity must match the packaged application identity");
}
const repository = packageJson.repository?.url?.match(/^git\+https:\/\/github\.com\/(.+)\.git$/)?.[1];
if (!repository) throw new Error("package.json must identify the GitHub release repository");
for (const name of readdirSync(root).filter(name => /^README(?:\.[\w-]+)?\.md$/.test(name))) {
  assertReadmeDownloads(name, readFileSync(resolve(root, name), "utf8"), {
    version: packageVersion,
    repository,
    dmgName: launcherPackage.build.dmg.artifactName,
    archiveName: launcherPackage.build.artifactName,
  });
}
const releaseWorkflow = readFileSync(resolve(root, ".github/workflows/release.yml"), "utf8");
const bunSetupCount = [...releaseWorkflow.matchAll(/uses:\s*oven-sh\/setup-bun@/g)].length;
const releaseBunPins = [...releaseWorkflow.matchAll(/^\s+bun-version:\s*(\S+)\s*$/gm)].map(match => match[1]);
// The dependency-free publication job uses Node and must not install a runtime or dependencies
// beside the signing key. Validate every actual Bun setup instead of assuming two Bun jobs.
if (bunSetupCount < 1 || releaseBunPins.length !== bunSetupCount || releaseBunPins.some(version => version !== bunVersion)) {
  throw new Error(`release.yml must pin Bun ${bunVersion} in every Bun setup step`);
}
const launcherVersion = launcherPackage.version;
if (launcherVersion !== packageVersion) throw new Error(`launcher/package.json is not synchronized to ${packageVersion}`);
process.stdout.write(`VERSION_SYNC_OK ${packageVersion} bun@${bunVersion}\n`);
