import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { assertReadmeDownloads } from "../scripts/readme-downloads";

const require = createRequire(import.meta.url);
const repository = path.resolve(import.meta.dir, "..");
const { releasePlan } = require("../scripts/release-plan.cjs");

test("every release tag builds only the macOS Apple Silicon leg", () => {
  for (const version of ["6.1.33-nekodex.5", "7.0.0"]) {
    expect(releasePlan({ refType: "tag", tag: `v${version}`, version })).toEqual({
      include: [{ runner: "macos-15", runtime_asset: "codex-chatgpt-web-darwin-arm64.tar.gz" }],
    });
  }
  expect(() => releasePlan({ refType: "branch", tag: "main", version: "7.0.0" })).toThrow(/existing tag/);
  expect(() => releasePlan({ refType: "tag", tag: "v7.0.1", version: "7.0.0" })).toThrow(/existing tag/);
});

test("publication waits for the arm64 build alone", () => {
  const source = fs.readFileSync(path.join(repository, ".github/workflows/release.yml"), "utf8");
  const { jobs } = Bun.YAML.parse(source) as { jobs: Record<string, { needs?: string | string[]; "runs-on": string; strategy?: { matrix: string } }> };
  const needs = (job: string) => [jobs[job]!.needs ?? []].flat();
  const gating = new Set<string>();
  const visit = (job: string) => needs(job).forEach(need => { if (!gating.has(need)) { gating.add(need); visit(need); } });
  visit("publish");
  expect([...gating].sort()).toEqual(["build", "plan"]);
  // The build matrix is exactly the release plan tested above.
  expect(jobs.build!.strategy?.matrix).toBe("${{ fromJSON(needs.plan.outputs.matrix) }}");
  expect(jobs.build!["runs-on"]).toBe("${{ matrix.runner }}");
  expect(Object.keys(jobs).filter(job => needs(job).includes("windows-preview"))).toEqual([]);
  expect(source).not.toMatch(/macos-15-intel|darwin-amd64|platform_scope/);
});

const readmeOptions = { version: "7.0.1", intelVersion: "6.1.33-nekodex.4", linuxVersion: "6.1.12-nekodex.1",
  repository: "Froraut/NEKODEX", dmgName: "NEKODEX-${version}-mac-${arch}.${ext}", archiveName: "codex-web-gpt-${version}-${os}-${arch}.${ext}" };
const download = (release: string, asset: string) => `https://github.com/Froraut/NEKODEX/releases/download/v${release}/${asset}`;

test("README downloads offer arm64 for the current release and Intel only from its last build", () => {
  const arm64 = download("7.0.1", "NEKODEX-7.0.1-mac-arm64.dmg");
  const lastIntel = download("6.1.33-nekodex.4", "NEKODEX-6.1.33-nekodex.4-mac-x64.dmg");
  const check = (readme: string, options: Partial<typeof readmeOptions> = {}) =>
    () => assertReadmeDownloads("README.md", readme, { ...readmeOptions, ...options });
  expect(check(`${arm64}\n${lastIntel}\nhttps://github.com/Froraut/NEKODEX/releases/tag/v6.1.33-nekodex.4`)).not.toThrow();
  expect(check(arm64)).not.toThrow();
  expect(check(lastIntel)).toThrow(/missing the current macOS download/);
  // An arm64-only release has no Intel or Windows package, so such links would be broken.
  for (const asset of ["NEKODEX-7.0.1-mac-x64.dmg", "codex-web-gpt-7.0.1-mac-x64.zip", "codex-web-gpt-7.0.1-win-x64.exe"]) {
    expect(check(`${arm64}\n${download("7.0.1", asset)}`)).toThrow(/outdated or unsupported/);
  }
  expect(check(`${arm64}\n${lastIntel}`, { intelVersion: undefined })).toThrow(/outdated or unsupported/);
  expect(check(`${arm64}\n${download("6.1.12-nekodex.1", "codex-web-gpt-6.1.12-nekodex.1-linux-x64.AppImage")}`, { linuxVersion: undefined }))
    .toThrow(/outdated or unsupported/);
});

// Offline shims: uname reports a Mac, sysctl the hardware, and curl serves fixtures until the
// first package download, which it fails so that nothing is installed.
function macShims(machine: string, appleSilicon: boolean, releases: unknown[] = []) {
  const shim = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "release-arm64-only-test-")));
  const log = path.join(shim, "requests.log");
  const envelope = JSON.stringify({ schemaVersion: 1, signatures: [],
    payload: Buffer.from(JSON.stringify({ source: { buildType: "github-actions" } })).toString("base64") }, null, 2);
  fs.writeFileSync(path.join(shim, "releases.json"), JSON.stringify(releases));
  fs.writeFileSync(path.join(shim, "release-metadata.json"), envelope);
  fs.writeFileSync(path.join(shim, "uname"), `#!/bin/sh\ncase "$1" in -s) echo Darwin ;; -m) echo ${machine} ;; esac\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(shim, "sysctl"), appleSilicon
    ? "#!/bin/sh\n[ \"$2\" = hw.optional.arm64 ] && echo 1\n"
    : "#!/bin/sh\necho \"sysctl: unknown oid '$2'\" >&2\nexit 1\n", { mode: 0o755 });
  fs.writeFileSync(path.join(shim, "curl"), `#!/bin/sh
out=""; url=""
while [ "$#" -gt 0 ]; do case "$1" in -o) out="$2"; shift ;; https://*) url="$1" ;; esac; shift; done
echo "$url" >> "${log}"
case "$url" in
  *releases\\?per_page=10) cat "${shim}/releases.json" ;;
  */release-metadata.json) if [ -n "$out" ]; then cp "${shim}/release-metadata.json" "$out"; else cat "${shim}/release-metadata.json"; fi ;;
  *) exit 22 ;;
esac
`, { mode: 0o755 });
  const run = (script: string, env: Record<string, string>) => spawnSync("sh", [path.join(repository, script)], {
    encoding: "utf8", env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, HOME: shim, TMPDIR: shim, ...env } });
  const requests = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [];
  return { run, requests };
}

test("the terminal installer takes arm64 even from a Rosetta shell and refuses an Intel Mac before any download", () => {
  const env = { CODEX_CHATGPT_WEB_VERSION: "9.0.0-nekodex.1" };
  for (const [machine, appleSilicon] of [["arm64", true], ["x86_64", true]] as const) {
    const { run, requests } = macShims(machine, appleSilicon);
    const result = run("scripts/install.sh", env);
    expect(result.status).toBe(22);
    expect(requests().at(-1)).toBe("https://github.com/Froraut/NEKODEX/releases/download/v9.0.0-nekodex.1/codex-chatgpt-web-darwin-arm64.tar.gz");
  }
  const intel = macShims("x86_64", false);
  const refused = intel.run("scripts/install.sh", env);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("built for Apple Silicon Macs only");
  expect(intel.requests()).toEqual([]);
});

test("the launcher installer gives Rosetta the current arm64 app and an Intel Mac its last Intel build", () => {
  const release = (tag: string, arches: string[]) => ({ tag_name: `v${tag}`, assets: arches.map(arch => ({ name: `codex-web-gpt-${tag}-mac-${arch}.zip` })) });
  const releases = [release("9.0.0-nekodex.1", ["arm64"]), release("8.0.0-nekodex.1", ["arm64", "x64"])];
  const rosetta = macShims("x86_64", true, releases);
  expect(rosetta.run("scripts/install-launcher.sh", { CODEX_WEB_GPT_VERSION: "" }).status).toBe(22);
  expect(rosetta.requests().at(-1)).toBe("https://github.com/Froraut/NEKODEX/releases/download/v9.0.0-nekodex.1/codex-web-gpt-9.0.0-nekodex.1-mac-arm64.zip");
  const intel = macShims("x86_64", false, releases);
  expect(intel.run("scripts/install-launcher.sh", { CODEX_WEB_GPT_VERSION: "" }).status).toBe(22);
  expect(intel.requests().at(-1)).toBe("https://github.com/Froraut/NEKODEX/releases/download/v8.0.0-nekodex.1/codex-web-gpt-8.0.0-nekodex.1-mac-x64.zip");
  const noIntel = macShims("x86_64", false, releases.slice(0, 1));
  const result = noIntel.run("scripts/install-launcher.sh", { CODEX_WEB_GPT_VERSION: "" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("None of the newest 10 still has an Intel build");
});
