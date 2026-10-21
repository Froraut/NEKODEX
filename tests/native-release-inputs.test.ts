import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const repository = path.resolve(import.meta.dir, "..");
const inputs = require("../scripts/native-release-inputs.cjs");
const { REVIEWED_OWNED_NATIVE_DEV_PIN: PIN } = require("../launcher/electron/owned-native-dev-pin.cjs");
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const WORKER = "launcher/native/owned-worker/build/aarch64-apple-darwin/";
const GUEST = "launcher/native/execution-guest/.build/bundle/";

function temporaryRoot() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "native-release-inputs-test-")));
}
// Inert synthetic lock: byte pins of small fixture files, never executed.
function syntheticRoot(contents: Record<string, string>) {
  const root = temporaryRoot();
  const files = Object.entries(contents).map(([file, text]) => ({
    asset: `${file.startsWith(WORKER) ? "owned-worker-" : "execution-guest-"}${path.basename(file)}`,
    path: file, size: Buffer.byteLength(text), sha256: sha256(text), ...(file.endsWith("worker") ? { executable: true } : {}),
  }));
  fs.mkdirSync(path.join(root, "launcher/native"), { recursive: true });
  fs.writeFileSync(path.join(root, inputs.LOCK), JSON.stringify({ schemaVersion: 1, repository: "Froraut/NEKODEX",
    tag: "native-inputs-00000000-11111111", target: "darwin-arm64", files }));
  return root;
}
const fixture = (manifest = "{}") => ({
  [`${WORKER}nekodex-owned-native-worker`]: "worker", [`${WORKER}build-info.json`]: "{}",
  [`${WORKER}official-bootstrap-models.json`]: "[]", [`${GUEST}manifest.json`]: manifest,
  [`${GUEST}Image`]: "kernel", [`${GUEST}initrd.gz`]: "initrd",
});

test("the tracked lock pins the same reviewed worker as the development receipt", () => {
  const lock = inputs.loadReleaseInputs(repository);
  const pinned = (name: string) => lock.files.find((entry: { path: string }) => entry.path === name).sha256;
  expect(pinned(`${WORKER}nekodex-owned-native-worker`)).toBe(PIN.executableSha256);
  expect(pinned(`${WORKER}build-info.json`)).toBe(PIN.metadataSha256);
  expect(pinned(`${WORKER}official-bootstrap-models.json`)).toBe("943ca7fe1d19ed019054158303f0dbbd80b3bef43b3aa425a71aa7cb3fb52c2b");
  expect(lock.tag).toBe(`native-inputs-${PIN.executableSha256.slice(0, 8)}-${pinned(`${GUEST}manifest.json`).slice(0, 8)}`);
});

test("the lock rejects paths outside the fixed layouts and extra executables", () => {
  const root = syntheticRoot(fixture());
  const lock = JSON.parse(fs.readFileSync(path.join(root, inputs.LOCK), "utf8"));
  for (const change of [
    (copy: any) => { copy.files[3].path = `${GUEST}../../../../package.json`; },
    (copy: any) => { copy.files[4].executable = true; },
    (copy: any) => { copy.files[5].asset = copy.files[4].asset; },
    (copy: any) => { copy.files.pop(); },
    (copy: any) => { copy.repository = "someone/else"; },
  ]) {
    const copy = structuredClone(lock); change(copy);
    fs.writeFileSync(path.join(root, inputs.LOCK), JSON.stringify(copy));
    expect(() => inputs.loadReleaseInputs(root)).toThrow();
  }
});

test("fetch materializes only pinned bytes into the fixed layouts", () => {
  const contents = fixture(), root = syntheticRoot(contents);
  const serve = (bytes: (file: string) => string) => (lock: any, directory: string) => {
    for (const entry of lock.files) fs.writeFileSync(path.join(directory, entry.asset), bytes(entry.path));
  };
  expect(() => inputs.fetchReleaseInputs({ root, download: serve(file => `${contents[file]}!`) })).toThrow(/differs from its pinned bytes/);
  expect(fs.existsSync(path.join(root, WORKER))).toBe(false);
  expect(inputs.fetchReleaseInputs({ root, download: serve(file => contents[file]) })).toEqual({ fetched: 6 });
  expect(fs.statSync(path.join(root, `${WORKER}nekodex-owned-native-worker`)).mode & 0o777).toBe(0o755);
  expect(fs.statSync(path.join(root, `${GUEST}initrd.gz`)).mode & 0o777).toBe(0o644);
  expect(inputs.fetchReleaseInputs({ root, download: () => { throw new Error("no download expected"); } })).toEqual({ fetched: 0 });
  fs.writeFileSync(path.join(root, `${GUEST}Image`), "rebuilt kernel");
  expect(() => inputs.fetchReleaseInputs({ root, download: serve(file => contents[file]) })).toThrow(/differs from its pinned bytes/);
});

test("packaging accepts the guest image only with the locked manifest and its reviewed sources", () => {
  const manifest = JSON.stringify({ kernel: { sha256: sha256("kernel") }, initrd: { sha256: sha256("initrd") }, sourceSha256: { "agent.go": sha256("package main\n") } });
  const root = syntheticRoot(fixture(manifest));
  fs.mkdirSync(path.join(root, "launcher/native/execution-guest"), { recursive: true });
  fs.writeFileSync(path.join(root, "launcher/native/execution-guest/agent.go"), "package main\n");
  expect(inputs.assertAcceptedExecutionGuest(root, Buffer.from(manifest)).sourceSha256["agent.go"]).toBe(sha256("package main\n"));
  expect(() => inputs.assertAcceptedExecutionGuest(root, Buffer.from(`${manifest}\n`))).toThrow(/accepted lock/);
  fs.writeFileSync(path.join(root, "launcher/native/execution-guest/agent.go"), "package changed\n");
  expect(() => inputs.assertAcceptedExecutionGuest(root, Buffer.from(manifest))).toThrow(/differs from the accepted image/);
});

test("the accepted worker admission is macOS arm64 only", () => {
  expect(() => inputs.acceptedOwnedNativeInput(repository, { platform: "linux", arch: "x64" })).toThrow(/macOS arm64/);
});

test("standalone installer default selection skips local publisher builds", () => {
  const shim = temporaryRoot(), log = path.join(shim, "requests.log");
  const envelope = (buildType: string) => JSON.stringify({ schemaVersion: 1, payload: Buffer.from(JSON.stringify({ source: { buildType } })).toString("base64"), signatures: [] }, null, 2);
  const release = (tag: string) => ({ tag_name: `v${tag}`, assets: [{ name: `codex-web-gpt-${tag}-linux-x64.AppImage` }] });
  fs.writeFileSync(path.join(shim, "releases.json"), JSON.stringify([release("9.0.0-nekodex.1"), release("8.0.0-nekodex.1")]));
  fs.writeFileSync(path.join(shim, "v9.0.0-nekodex.1.json"), envelope("local"));
  fs.writeFileSync(path.join(shim, "v8.0.0-nekodex.1.json"), envelope("github-actions"));
  fs.writeFileSync(path.join(shim, "uname"), "#!/bin/sh\ncase \"$1\" in -s) echo Linux ;; -m) echo x86_64 ;; esac\n", { mode: 0o755 });
  // Offline curl: serves fixtures and stops the installer at its first asset download.
  fs.writeFileSync(path.join(shim, "curl"), `#!/bin/sh
for arg; do case "$arg" in https://*) url="$arg" ;; esac; done
echo "$url" >> "${log}"
case "$url" in
  *releases\\?per_page=10) cat "${shim}/releases.json" ;;
  */release-metadata.json) tag="\${url%/release-metadata.json}"; cat "${shim}/\${tag##*/}.json" ;;
  *) exit 22 ;;
esac
`, { mode: 0o755 });
  const run = spawnSync("sh", [path.join(repository, "scripts/install-launcher.sh")], { encoding: "utf8",
    env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, CODEX_WEB_GPT_VERSION: "" } });
  expect(run.status).toBe(22);
  expect(run.stderr).toContain("Skipping NEKODEX 9.0.0-nekodex.1: it is a local publisher build");
  expect(fs.readFileSync(log, "utf8").trim().split("\n").at(-1)).toBe(
    "https://github.com/Froraut/NEKODEX/releases/download/v8.0.0-nekodex.1/codex-web-gpt-8.0.0-nekodex.1-linux-x64.AppImage");
});
