import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const require = createRequire(import.meta.url);
const { stageAuthenticatedUpdate, updateCacheRoot } = require("../launcher/electron/update-staging.cjs");
const { DOMAIN, keyIdFor, verifyReleaseMetadata } = require("../launcher/electron/release-trust.cjs");
const { createUpdateController, downloadFile } = require("../launcher/electron/update.cjs");
const { sha256 } = require("../launcher/electron/update-asset-hash.cjs");
const { validateStagedApplication } = require("../launcher/electron/update-validation.cjs");

// Inert extraction fixture: structurally valid native headers and application
// manifests reach the real staged-application validator; nothing is executed.
function writeApplication(root: string, version: string, repository: string) {
  const native = Buffer.alloc(120);
  native.writeUInt32BE(0x7f454c46, 0);
  native[4] = 2; native[5] = 1; native[6] = 1;
  native.writeUInt16LE(2, 16); native.writeUInt16LE(62, 18);
  native.writeBigUInt64LE(64n, 32);
  native.writeUInt16LE(64, 52); native.writeUInt16LE(56, 54); native.writeUInt16LE(1, 56);
  native.writeUInt32LE(1, 64);
  native.writeBigUInt64LE(120n, 96); native.writeBigUInt64LE(120n, 104);
  const write = (name: string, bytes: string | Buffer, mode = 0o600) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes, { mode });
  };
  write("codex-web-gpt-launcher", native, 0o700);
  write("resources/app/package.json", JSON.stringify({ name: "codex-web-gpt-launcher", version,
    updateRepository: repository, main: "electron/main.cjs" }));
  write("resources/app/electron/main.cjs", "// inert fixture\n");
  write("resources/app/dist/index.html", "<!doctype html>");
  write("resources/runtime/manifest.json", JSON.stringify({ schemaVersion: 2, appVersion: version,
    platform: "linux", arch: "x64", entrypoint: "app/cli.js", launcher: "bin/codex-chatgpt-web" }));
  for (const file of ["app/cli.js", "app/browser-helper.cjs", "bin/codex-chatgpt-web"]) {
    write(`resources/runtime/${file}`, "// inert fixture\n");
  }
  write("resources/runtime/runtime/bun", native, 0o700);
}

function fixture({ badSignature = false, corruption = "" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-signed-stage-"));
  const repository = "Froraut/NEKODEX", version = "6.1.33-nekodex.1";
  const bytes = Buffer.from("authenticated package fixture");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const now = Date.now();
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  const keyId = keyIdFor(publicPem);
  const trust = { schemaVersion: 1, repository, threshold: 1, keys: [{ keyId, publicKey: publicPem,
    notBefore: new Date(now - 60_000).toISOString(), notAfter: new Date(now + 3_600_000).toISOString() }] };
  const available = { version, assetName: `codex-web-gpt-${version}-linux-x64.AppImage`, assetBytes: bytes.length,
    metadataUrl: "https://fixture.invalid/release-metadata.json", checksumsUrl: "https://fixture.invalid/checksums.txt",
    assetUrl: "https://fixture.invalid/package.AppImage" };
  const payload = Buffer.from(JSON.stringify({ schemaVersion: 1, repository, version, tag: `v${version}`,
    issuedAt: new Date(now - 1_000).toISOString(), expiresAt: new Date(now + 60_000).toISOString(),
    source: { commit: "a".repeat(40), runId: "0", workflow: ".github/workflows/release.yml", buildType: "local" },
    assets: [{ name: available.assetName, size: bytes.length, sha256: digest }] }));
  const signature = sign(null, Buffer.concat([DOMAIN, payload]), privateKey);
  if (badSignature) signature[0] ^= 1;
  const metadataText = JSON.stringify({ schemaVersion: 1, payload: payload.toString("base64"),
    signatures: [{ keyId, signature: signature.toString("base64") }] });
  const logsDirectory = path.join(root, "logs");
  fs.mkdirSync(logsDirectory);
  const runner = path.join(root, "runner.sh");
  fs.writeFileSync(runner, "#!/bin/sh\nexit 1\n");
  const cached = path.join(updateCacheRoot(logsDirectory), `${digest}-${available.assetName}`);
  if (corruption === "cache") {
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached, Buffer.alloc(bytes.length));
  }
  const observed = { textUrls: [] as string[], packageDownloads: 0, extractions: 0, validations: 0 };
  let stagedRoot: string | undefined;
  return {
    observed,
    async stage() {
      const staged = await stageAuthenticatedUpdate({ available, repository, platform: "linux", arch: "x64",
        executablePath: "/fixture/NEKODEX", runtimeExecutable: "/fixture/bun", logsDirectory,
        signal: new AbortController().signal, onProgress: () => {},
        // Retained caller API compatibility: this unsigned input must not be consulted.
        expectedChecksum: () => { throw new Error("unsigned checksums unavailable"); },
        buildJob: ({ stagingRoot, ...job }: any) => ({ ...job, stagedApplication: stagingRoot,
          identity: "dev.nekodex.fixture", productName: "NEKODEX" }),
        deps: {
          downloadText: async (url: string) => {
            observed.textUrls.push(url);
            if (url !== available.metadataUrl) throw new Error("unsigned checksums unavailable");
            return metadataText;
          },
          verifyReleaseMetadata: (raw: string, identity: object) => verifyReleaseMetadata(raw, { ...identity, trust, now }),
          downloadFile: (url: string, destination: string, options: object) => downloadFile(url, destination, {
            ...options, requestDownload: async () => {
              observed.packageDownloads += 1;
              return Object.assign(Readable.from([corruption === "stream" ? Buffer.alloc(bytes.length) : bytes]),
                { statusCode: 200, headers: {} });
            },
          }),
          sha256: async (file: string, options: object) => {
            if (corruption === "staged" && file !== cached) fs.writeFileSync(file, Buffer.alloc(bytes.length));
            return sha256(file, options);
          },
          extractLinux: async (_archive: string, destination: string) => {
            observed.extractions += 1;
            writeApplication(destination, version, repository);
          },
          linuxRunnerSource: () => runner,
          validateStagedApplication: (application: string, job: object) => {
            const result = validateStagedApplication(application, job);
            observed.validations += 1;
            return result;
          },
        },
      });
      stagedRoot = staged.tempRoot;
      return { staged, job: JSON.parse(fs.readFileSync(staged.jobPath, "utf8")) };
    },
    cleanup() {
      if (stagedRoot) fs.rmSync(stagedRoot, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("signed asset stages and validates without an available unsigned checksum endpoint", async () => {
  const run = fixture();
  try {
    const { staged, job } = await run.stage();
    expect(run.observed).toEqual({ textUrls: ["https://fixture.invalid/release-metadata.json"],
      packageDownloads: 1, extractions: 1, validations: 1 });
    expect(fs.existsSync(staged.workerPath)).toBe(true);
    expect(fs.statSync(job.stagedApplication).isDirectory()).toBe(true);
  } finally { run.cleanup(); }
}, 5_000);

test("controller discovers a release listing with package and signed metadata but no checksums file", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-signed-discovery-"));
  const version = "6.1.33-nekodex.1";
  const assetName = `codex-web-gpt-${version}-linux-x64.AppImage`;
  const base = `https://github.com/Froraut/NEKODEX/releases/download/v${version}/`;
  const controller = createUpdateController({ currentVersion: "6.1.32-nekodex.7", platform: "linux", arch: "x64",
    packaged: true, repository: "Froraut/NEKODEX", executablePath: "/fixture/NEKODEX",
    runtimeExecutable: "/fixture/bun", logsDirectory: path.join(root, "logs"),
    dependencies: {
      fetchRelease: async () => [{ tag_name: `v${version}`, assets: [
        { name: assetName, size: 100, browser_download_url: `${base}${assetName}` },
        { name: "release-metadata.json", browser_download_url: `${base}release-metadata.json` },
      ] }],
      downloadText: async () => { throw new Error("Discovery must not download an unsigned checksum file"); },
    },
  });
  try {
    // Discovery is a candidate hint; the staging tests exercise real signature
    // verification before any package bytes are requested.
    expect(await controller.recheck()).toEqual({ status: "available", version });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 5_000);

test("rejected publisher signature cannot download or extract the package", async () => {
  const run = fixture({ badSignature: true });
  try {
    await expect(run.stage()).rejects.toThrow("signature does not meet");
    expect(run.observed.packageDownloads).toBe(0);
    expect(run.observed.extractions).toBe(0);
    expect(run.observed.validations).toBe(0);
  } finally { run.cleanup(); }
}, 5_000);

for (const [corruption, failure] of [["stream", "SHA-256 does not match signed metadata"],
  ["cache", "Cached update checksum mismatch"], ["staged", "SHA-256 verification failed"]]) {
  test(`authenticated staging rejects corrupted ${corruption} bytes`, async () => {
    const run = fixture({ corruption });
    try {
      await expect(run.stage()).rejects.toThrow(failure);
      expect(run.observed.packageDownloads).toBe(corruption === "cache" ? 0 : 1);
      expect(run.observed.extractions).toBe(0);
      expect(run.observed.validations).toBe(0);
    } finally { run.cleanup(); }
  }, 5_000);
}
