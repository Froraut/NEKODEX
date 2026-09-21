import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";

const { downloadAuthenticatedAsset } = require("../launcher/electron/resumable-download.cjs");
const { validateRuntimeBundle } = require("../launcher/electron/runtime-install.cjs");
const { acknowledgeUpdateReady } = require("../launcher/electron/update-readiness.cjs");
const { recoveryRegistration } = require("../launcher/electron/update-recovery.cjs");
const { createUpdateController } = require("../launcher/electron/update.cjs");
const { runOwnedCommand } = require("../launcher/electron/update-preparation.cjs");

const temporaryRoots: string[] = [];

function temporaryRoot(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  while (temporaryRoots.length) rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
});

test("runtime validation rejects a symlinked bundle root and manifest", () => {
  if (process.platform === "win32") return;
  const root = temporaryRoot("nekodex-runtime-boundary-");
  const external = join(root, "external");
  const linkedRoot = join(root, "runtime-link");
  writeFileSync(external, "{}");
  symlinkSync(root, linkedRoot);
  expect(() => validateRuntimeBundle(linkedRoot, {
    version: "1.0.0", platform: process.platform, arch: process.arch,
  })).toThrow("root must be a real directory");

  symlinkSync(external, join(root, "manifest.json"));
  expect(() => validateRuntimeBundle(root, {
    version: "1.0.0", platform: process.platform, arch: process.arch,
  })).toThrow("manifest must be a bounded regular file");
});

test("a full response after an ignored range restarts progress speed from zero bytes", async () => {
  const root = temporaryRoot("nekodex-update-progress-");
  const destination = join(root, "asset.zip");
  const payload = Buffer.from("complete authenticated update payload");
  const partialBytes = payload.length - 2;
  const expectedSha256 = createHash("sha256").update(payload).digest("hex");
  const url = "https://github.com/Froraut/NEKODEX/releases/download/v1.0.0/asset.zip";
  writeFileSync(`${destination}.part`, payload.subarray(0, partialBytes));
  writeFileSync(`${destination}.identity.json`, JSON.stringify({ url, expectedBytes: payload.length, expectedSha256 }));

  let now = 1_000;
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  const published: Array<{ downloadedBytes: number; bytesPerSecond: number }> = [];
  try {
    await downloadAuthenticatedAsset(url, destination, {
      expectedBytes: payload.length,
      expectedSha256,
      onProgress: (progress: { downloadedBytes: number; bytesPerSecond: number }) => published.push(progress),
      requestDownload: async () => Object.assign(Readable.from((async function* () {
        now += 100;
        yield payload.subarray(0, 1);
        now += 100;
        yield payload.subarray(1);
      })()), { statusCode: 200, headers: {} }),
    });
  } finally {
    clock.mockRestore();
  }

  expect(readFileSync(destination)).toEqual(payload);
  expect(published.find(progress => progress.downloadedBytes === 1)?.bytesPerSecond).toBeGreaterThan(0);
});

test("readiness lifecycle details cannot replace updater authorization identity", () => {
  const root = temporaryRoot("nekodex-readiness-proof-");
  const filename = join(root, "ready.json");
  const token = "a".repeat(64);
  const packageTarget = join(root, "NEKODEX.AppImage");
  acknowledgeUpdateReady({ filename, token }, {
    version: "1.0.0",
    platform: "linux",
    arch: "x64",
    pid: 42,
    env: { CODEX_WEB_GPT_APPIMAGE: packageTarget },
    token: "untrusted-lifecycle-token",
    packageTarget: "/untrusted/lifecycle/target",
    lifecycleStatus: "not-configured",
  });
  expect(JSON.parse(readFileSync(filename, "utf8"))).toMatchObject({ token, packageTarget, pid: 42 });
});

test("Linux recovery registration rejects line-breaking paths", () => {
  expect(() => recoveryRegistration({
    root: "/tmp/nekodex-update\nInjected=true",
    runtime: "/tmp/bun",
    job: { platform: "linux" },
  }, { home: "/tmp/home", env: {} })).toThrow("Invalid update recovery argument");
});

test("preparation cancellation keeps an authenticated partial for retry", async () => {
  const root = temporaryRoot("nekodex-cancelled-download-");
  const destination = join(root, "asset.zip");
  const payload = Buffer.from("authenticated update bytes");
  const partial = payload.subarray(0, 7);
  const expectedSha256 = createHash("sha256").update(payload).digest("hex");
  const url = "https://github.com/Froraut/NEKODEX/releases/download/v1.0.0/asset.zip";
  const identity = JSON.stringify({ url, expectedBytes: payload.length, expectedSha256 });
  writeFileSync(`${destination}.part`, partial);
  writeFileSync(`${destination}.identity.json`, identity);
  const controller = new AbortController();

  const download = downloadAuthenticatedAsset(url, destination, {
    expectedBytes: payload.length,
    expectedSha256,
    signal: controller.signal,
    requestDownload: async (_url: string, _redirects: number, options: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
    },
  }).then(() => null, (error: Error & { code?: string }) => error);
  await Promise.resolve();
  controller.abort(Object.assign(new Error("fixture cancellation"), { code: "UPDATE_PREPARATION_CANCELLED" }));

  expect((await download)?.code).toBe("UPDATE_PREPARATION_CANCELLED");
  expect(readFileSync(`${destination}.part`)).toEqual(partial);
  expect(readFileSync(`${destination}.identity.json`, "utf8")).toBe(identity);
  expect(existsSync(destination)).toBe(false);
});

function linuxControllerFixture(root: string, overrides: {
  downloadText?: (url: string, maxBytes: number, options: { signal?: AbortSignal }) => Promise<string>;
  downloadFile?: (url: string, destination: string, options: { signal?: AbortSignal }) => Promise<void>;
  extractLinux?: (archive: string, destination: string, options: { signal: AbortSignal }) => Promise<void>;
  spawnWorker?: () => unknown;
} = {}) {
  const assetName = "codex-web-gpt-1.1.0-linux-x64.AppImage";
  const assetBody = Buffer.from("signed AppImage fixture");
  const digest = createHash("sha256").update(assetBody).digest("hex");
  const oldImage = join(root, "versions", "1.0.0", "NEKODEX.AppImage");
  const wrapper = join(root, "bin", "nekodex");
  const runner = join(root, "runner.sh");
  for (const file of [oldImage, wrapper, runner]) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "fixture", { mode: 0o755 });
  }
  let workerCalls = 0;
  const controller = createUpdateController({
    currentVersion: "1.0.0",
    platform: "linux",
    arch: "x64",
    packaged: true,
    executablePath: "/fixture/launcher",
    runtimeExecutable: process.execPath,
    logsDirectory: join(root, "logs"),
    dependencies: {
      fetchRelease: async () => ({
        tag_name: "v1.1.0",
        assets: [assetName, "checksums.txt", "release-metadata.json"].map(name => ({
          name,
          size: assetBody.length,
          browser_download_url: `https://github.com/Froraut/NEKODEX/releases/download/v1.1.0/${name}`,
        })),
      }),
      downloadText: overrides.downloadText || (async (url: string) => url.endsWith("release-metadata.json")
        ? "signed metadata fixture"
        : `${digest}  ${assetName}\n`),
      verifyReleaseMetadata: () => ({ assets: [{ name: assetName, size: assetBody.length, sha256: digest }] }),
      downloadFile: overrides.downloadFile
        || (async (_url: string, destination: string) => { writeFileSync(destination, assetBody); }),
      sha256: (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex"),
      extractLinux: overrides.extractLinux || (async () => {}),
      linuxRunnerSource: () => runner,
      validateStagedApplication() {},
      spawnWorker: () => {
        workerCalls += 1;
        return overrides.spawnWorker?.() || { pid: 123, exitCode: null, signalCode: null, unref() {}, kill() {} };
      },
    },
  });
  return { controller, oldImage, wrapper, workerCalls: () => workerCalls };
}

test("accepted metadata cancellation starts no later request or worker", async () => {
  const root = temporaryRoot("nekodex-cancel-metadata-");
  const previous = {
    image: process.env.CODEX_WEB_GPT_APPIMAGE,
    wrapper: process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE,
  };
  let metadataStarted!: () => void;
  const started = new Promise<void>(resolve => { metadataStarted = resolve; });
  const requests: string[] = [];
  let assetDownloads = 0;
  const fixture = linuxControllerFixture(root, {
    downloadText: async (url, _maxBytes, { signal }) => {
      requests.push(url);
      metadataStarted();
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      throw new Error("unreachable metadata completion");
    },
    downloadFile: async () => { assetDownloads += 1; },
  });
  process.env.CODEX_WEB_GPT_APPIMAGE = fixture.oldImage;
  process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = fixture.wrapper;
  try {
    await fixture.controller.checkOnce();
    const install = fixture.controller.beginInstall().then(
      () => null,
      (error: Error & { code?: string }) => error,
    );
    await started;
    expect(await fixture.controller.cancelPreparation()).toEqual({ status: "cancelled", version: "1.1.0" });
    expect((await install)?.code).toBe("UPDATE_PREPARATION_CANCELLED");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatch(/release-metadata\.json$/);
    expect(assetDownloads).toBe(0);
    expect(fixture.workerCalls()).toBe(0);
  } finally {
    if (previous.image === undefined) delete process.env.CODEX_WEB_GPT_APPIMAGE;
    else process.env.CODEX_WEB_GPT_APPIMAGE = previous.image;
    if (previous.wrapper === undefined) delete process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
    else process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = previous.wrapper;
  }
});

test("cancelPreparation waits for extractor exit and staging cleanup before resolving", async () => {
  const root = temporaryRoot("nekodex-cancel-preparation-");
  const previous = {
    image: process.env.CODEX_WEB_GPT_APPIMAGE,
    wrapper: process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE,
  };
  let extractionStarted!: () => void;
  const started = new Promise<void>(resolve => { extractionStarted = resolve; });
  let tempRoot: string | null = null;
  let extractorStopped = false;
  const fixture = linuxControllerFixture(root, {
    extractLinux: async (_archive, destination, { signal }) => {
      tempRoot = dirname(destination);
      extractionStarted();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => setImmediate(() => {
          extractorStopped = true;
          reject(signal.reason);
        }), { once: true });
      });
    },
  });
  process.env.CODEX_WEB_GPT_APPIMAGE = fixture.oldImage;
  process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = fixture.wrapper;
  try {
    await fixture.controller.checkOnce();
    const install = fixture.controller.beginInstall().then(
      () => null,
      (error: Error & { code?: string }) => error,
    );
    await started;
    const cancelled = await fixture.controller.cancelPreparation();
    expect(cancelled).toEqual({ status: "cancelled", version: "1.1.0" });
    expect((await install)?.code).toBe("UPDATE_PREPARATION_CANCELLED");
    expect(fixture.workerCalls()).toBe(0);
    expect(extractorStopped).toBe(true);
    expect(tempRoot).not.toBeNull();
    expect(existsSync(tempRoot!)).toBe(false);
    expect(fixture.controller.getState()).toEqual({ status: "available", version: "1.1.0" });
  } finally {
    if (previous.image === undefined) delete process.env.CODEX_WEB_GPT_APPIMAGE;
    else process.env.CODEX_WEB_GPT_APPIMAGE = previous.image;
    if (previous.wrapper === undefined) delete process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
    else process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = previous.wrapper;
  }
});

test("unproven extractor exit reports failed cancellation and preserves staging", async () => {
  const root = temporaryRoot("nekodex-cancel-unproven-");
  const previous = {
    image: process.env.CODEX_WEB_GPT_APPIMAGE,
    wrapper: process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE,
  };
  let extractionStarted!: () => void;
  const started = new Promise<void>(resolve => { extractionStarted = resolve; });
  let tempRoot: string | null = null;
  const fixture = linuxControllerFixture(root, {
    extractLinux: async (_archive, destination, { signal }) => {
      tempRoot = dirname(destination);
      extractionStarted();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(
          new Error("synthetic extractor ownership remained unproven"),
          { code: "UPDATE_EXTRACTION_EXIT_UNPROVEN", preserveStaging: true },
        )), { once: true });
      });
    },
  });
  process.env.CODEX_WEB_GPT_APPIMAGE = fixture.oldImage;
  process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = fixture.wrapper;
  try {
    await fixture.controller.checkOnce();
    const install = fixture.controller.beginInstall().then(
      () => null,
      (error: Error & { code?: string }) => error,
    );
    await started;
    const cancelled = await fixture.controller.cancelPreparation();
    expect(cancelled).toMatchObject({ status: "failed", version: "1.1.0" });
    expect((await install)?.code).toBe("UPDATE_PREPARATION_CLEANUP_FAILED");
    expect(fixture.workerCalls()).toBe(0);
    expect(tempRoot).not.toBeNull();
    expect(existsSync(tempRoot!)).toBe(true);
    expect(fixture.controller.getState()).toMatchObject({ status: "error" });
  } finally {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    if (previous.image === undefined) delete process.env.CODEX_WEB_GPT_APPIMAGE;
    else process.env.CODEX_WEB_GPT_APPIMAGE = previous.image;
    if (previous.wrapper === undefined) delete process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
    else process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = previous.wrapper;
  }
});

test("cancelPreparation is explicitly too late after worker handoff", async () => {
  const root = temporaryRoot("nekodex-cancel-too-late-");
  const previous = {
    image: process.env.CODEX_WEB_GPT_APPIMAGE,
    wrapper: process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE,
  };
  const fixture = linuxControllerFixture(root);
  let launch: { tempRoot: string } | null = null;
  process.env.CODEX_WEB_GPT_APPIMAGE = fixture.oldImage;
  process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = fixture.wrapper;
  try {
    await fixture.controller.checkOnce();
    launch = await fixture.controller.beginInstall();
    expect(await fixture.controller.cancelPreparation()).toEqual({
      status: "too-late", reason: "worker-handoff", version: "1.1.0",
    });
    expect(fixture.workerCalls()).toBe(1);
  } finally {
    if (launch?.tempRoot) rmSync(launch.tempRoot, { recursive: true, force: true });
    if (previous.image === undefined) delete process.env.CODEX_WEB_GPT_APPIMAGE;
    else process.env.CODEX_WEB_GPT_APPIMAGE = previous.image;
    if (previous.wrapper === undefined) delete process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
    else process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = previous.wrapper;
  }
});

test("owned preparation child abort waits for exit and prevents a late staging write", async () => {
  const root = temporaryRoot("nekodex-owned-extractor-");
  const ready = join(root, "ready");
  const lateWrite = join(root, "late-write");
  const script = [
    "const fs = require('node:fs');",
    `const ready = ${JSON.stringify(ready)};`,
    `const lateWrite = ${JSON.stringify(lateWrite)};`,
    "let stopping = false;",
    "process.on('SIGTERM', () => {",
    "  if (stopping) return;",
    "  stopping = true;",
    "  setTimeout(() => process.exit(0), 120);",
    "});",
    "fs.writeFileSync(ready, String(process.pid));",
    "setTimeout(() => fs.writeFileSync(lateWrite, 'late'), 350);",
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const controller = new AbortController();
  let settled = false;
  const owned = runOwnedCommand(process.execPath, ["-e", script], {
    cwd: root,
    signal: controller.signal,
    timeoutMs: 2_000,
    failureMessage: "Synthetic owned extractor failed",
  }).then(
    () => null,
    (error: Error & { code?: string }) => error,
  ).finally(() => { settled = true; });

  const readyDeadline = Date.now() + 1_000;
  while (!existsSync(ready)) {
    if (Date.now() >= readyDeadline) throw new Error("Synthetic owned extractor did not become ready");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const pid = Number(readFileSync(ready, "utf8"));
  controller.abort(Object.assign(new Error("synthetic preparation abort"), {
    code: "UPDATE_PREPARATION_CANCELLED",
  }));

  if (process.platform !== "win32") {
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(settled).toBe(false);
  }
  expect((await owned)?.code).toBe("UPDATE_PREPARATION_CANCELLED");
  let childAlive = false;
  try { process.kill(pid, 0); childAlive = true; } catch {}
  expect(childAlive).toBe(false);
  await new Promise(resolve => setTimeout(resolve, 400));
  expect(existsSync(lateWrite)).toBe(false);
});
