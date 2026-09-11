const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Readable } = require("node:stream");
const {
  buildJob,
  compareVersions,
  createUpdateController,
  downloadFile,
  downloadText,
  expectedChecksum,
  macApplicationPath,
  releaseAssetName,
  releaseApiUrl,
  selectRelease,
  validateReleaseAssetUrl,
  validateRepository,
} = require("../electron/update.cjs");

function updateController(dependencies) {
  return createUpdateController({
    currentVersion: "1.1.4",
    platform: "linux",
    arch: "x64",
    packaged: true,
    executablePath: "/tmp/launcher",
    runtimeExecutable: "/tmp/bun",
    logsDirectory: "/tmp/logs",
    dependencies,
  });
}

test("fork update checks stay on their packaged repository, including before the first release", async () => {
  assert.equal(releaseApiUrl(), "https://api.github.com/repos/Froraut/codex-chatgpt-web/releases?per_page=20");
  assert.equal(validateRepository("another-owner/a-fork"), "another-owner/a-fork");
  for (const invalid of [undefined, "../upstream", "owner/repo/extra", "https://github.com/owner/repo", "owner/repo?x=1"]) {
    assert.throws(() => validateRepository(invalid), /owner\/repository/);
  }
  const requests = [];
  const controller = updateController({
    fetchRelease: async (url) => {
      requests.push(url);
      throw Object.assign(new Error("Not Found"), { statusCode: 404 });
    },
  });
  assert.deepEqual(await controller.checkOnce(), { status: "up-to-date" });
  assert.deepEqual(requests, [releaseApiUrl()]);
  await assert.rejects(controller.beginInstall(), /No launcher update/);
  const rateLimited = updateController({
    fetchRelease: async () => { throw Object.assign(new Error("Rate limited"), { statusCode: 403 }); },
  });
  assert.deepEqual(await rateLimited.checkOnce(), { status: "error", message: "Rate limited" });
});

test("fork updates reject upstream assets, credentials and altered download URLs", () => {
  const asset = "launcher.zip";
  const allowed = "https://github.com/Froraut/codex-chatgpt-web/releases/download/v1.2.0/launcher.zip";
  for (const url of [
    allowed.replace("Froraut", "miuuyy"),
    allowed.replace("github.com", "username:password@github.com"),
    allowed.replace("github.com", "github.com:8443"),
    `${allowed}?download=1`,
    `${allowed}#fragment`,
  ]) {
    assert.throws(() => validateReleaseAssetUrl(url, "1.2.0", asset), /unexpected release asset URL/);
  }
});

test("fork prerelease updates are discoverable without opting stable users into another release channel", () => {
  const releases = [
    { tag_name: "v9.0.0", draft: true },
    { tag_name: "v6.0.0-beta.1", prerelease: true },
    { tag_name: "v5.2.0-froraut.2", prerelease: true },
    { tag_name: "v5.2.0-froraut.1", prerelease: true },
    { tag_name: "v5.1.0", prerelease: false },
    { tag_name: "malformed" },
  ];
  assert.equal(selectRelease(releases, "5.0.7-froraut.1").tag_name, "v5.2.0-froraut.2");
  assert.equal(selectRelease(releases, "5.0.7").tag_name, "v5.1.0");
  assert.equal(selectRelease([], "5.0.7-froraut.1"), undefined);
});

function scopedRelease(version, platforms = ["darwin", "win32", "linux"]) {
  return { tag_name: `v${version}`, prerelease: true, assets: [
    ...platforms.map(platform => releaseAssetName(version, platform, "x64")), "checksums.txt", "release-metadata.json",
  ].map(name => ({ name, size: 10,
    browser_download_url: `https://github.com/Froraut/codex-chatgpt-web/releases/download/v${version}/${name}` })) };
}

test("Apple-only prereleases are skipped only for platforms whose archive is absent", async () => {
  const newest = scopedRelease("5.2.0-froraut.1", ["darwin"]);
  const previous = scopedRelease("5.1.0-froraut.1");
  const releases = [newest, previous];
  assert.equal(selectRelease(releases, "5.0.7-froraut.1", { platform: "darwin", arch: "x64" }), newest);
  for (const platform of ["win32", "linux"]) {
    assert.equal(selectRelease(releases, "5.0.7-froraut.1", { platform, arch: "x64" }), previous);
    const controller = createUpdateController({ currentVersion: "5.0.7-froraut.1", platform, arch: "x64", packaged: true,
      dependencies: { fetchRelease: async () => [newest] } });
    assert.deepEqual(await controller.checkOnce(), { status: "up-to-date" });
  }
});

test("present platform archives with missing or malformed metadata fail closed instead of selecting older releases", async () => {
  for (const defect of ["missing-checksums", "missing-metadata", "wrong-metadata-origin", "missing-asset-url", "malformed-assets-list"]) {
    const newest = scopedRelease("5.2.0-froraut.1", ["win32"]);
    if (defect === "missing-checksums") newest.assets = newest.assets.filter(asset => asset.name !== "checksums.txt");
    if (defect === "missing-metadata") newest.assets = newest.assets.filter(asset => asset.name !== "release-metadata.json");
    if (defect === "wrong-metadata-origin") newest.assets.find(asset => asset.name === "release-metadata.json").browser_download_url = "https://example.invalid/release-metadata.json";
    if (defect === "missing-asset-url") delete newest.assets[0].browser_download_url;
    if (defect === "malformed-assets-list") delete newest.assets;
    const releases = [newest, scopedRelease("5.1.0-froraut.1")];
    assert.equal(selectRelease(releases, "5.0.7-froraut.1", { platform: "win32", arch: "x64" }), newest);
    const controller = createUpdateController({ currentVersion: "5.0.7-froraut.1", platform: "win32", arch: "x64", packaged: true,
      dependencies: { fetchRelease: async () => releases } });
    assert.equal((await controller.checkOnce()).status, "error", defect);
    await assert.rejects(controller.beginInstall(), /No launcher update/);
  }
});

test("a selected platform release with an invalid signature never falls back to an older signed-looking release", async () => {
  const newest = scopedRelease("5.2.0-froraut.1", ["win32"]);
  const requests = [];
  const controller = createUpdateController({ currentVersion: "5.0.7-froraut.1", platform: "win32", arch: "x64", packaged: true,
    dependencies: {
      fetchRelease: async () => [newest, scopedRelease("5.1.0-froraut.1")],
      downloadText: async url => { requests.push(url); return "invalid signature envelope"; },
      verifyReleaseMetadata() { throw new Error("untrusted signature"); },
      downloadFile() { throw new Error("must not download an unauthenticated archive"); },
    } });
  assert.deepEqual(await controller.checkOnce(), { status: "available", version: "5.2.0-froraut.1" });
  await assert.rejects(controller.beginInstall(), /untrusted signature/);
  assert.deepEqual(requests, [newest.assets.find(asset => asset.name === "release-metadata.json").browser_download_url]);
  assert.deepEqual(controller.getState(), { status: "available", version: "5.2.0-froraut.1" });
});

test("updates reject invalid or excessive asset sizes before offering installation", async () => {
  for (const size of [undefined, -1, 0, 1.5, 1024 * 1024 * 1024 + 1]) {
    const controller = updateController({
      fetchRelease: async () => ({
        tag_name: "v1.2.0",
        assets: [
          {
            name: "codex-web-gpt-1.2.0-linux-x64.AppImage",
            size,
            browser_download_url: "https://github.com/Froraut/codex-chatgpt-web/releases/download/v1.2.0/codex-web-gpt-1.2.0-linux-x64.AppImage",
          },
          {
            name: "checksums.txt",
            browser_download_url: "https://github.com/Froraut/codex-chatgpt-web/releases/download/v1.2.0/checksums.txt",
            },
            { name: "release-metadata.json",
              browser_download_url: "https://github.com/Froraut/codex-chatgpt-web/releases/download/v1.2.0/release-metadata.json",
          },
        ],
      }),
    });
    const state = await controller.checkOnce();
    assert.equal(state.status, "error");
    assert.match(state.message, /invalid or excessive download size/);
    await assert.rejects(controller.beginInstall(), /No launcher update/);
  }
});

test("downloads enforce stream size and release size, and remove partial files", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-download-test-"));
  const target = path.join(root, "asset.zip");
  const requestDownload = async () => Readable.from([Buffer.from("abcd"), Buffer.from("efgh")]);
  try {
    await assert.rejects(downloadFile("https://example.invalid/asset.zip", target, {
      requestDownload, maxBytes: 6,
    }), /exceeded its size limit/);
    assert.equal(fs.existsSync(target), false);
    await assert.rejects(downloadFile("https://example.invalid/asset.zip", target, {
      requestDownload, expectedBytes: 9,
    }), /does not match the release metadata/);
    assert.equal(fs.existsSync(target), false);
    await assert.rejects(downloadFile("https://example.invalid/asset.zip", target, {
      requestDownload, expectedBytes: 7,
    }), /exceeded its size limit/);
    assert.equal(fs.existsSync(target), false);
    await downloadFile("https://example.invalid/asset.zip", target, {
      requestDownload, expectedBytes: 8,
    });
    assert.equal(fs.readFileSync(target, "utf8"), "abcdefgh");
    await assert.rejects(downloadFile("https://example.invalid/asset.zip", target, { requestDownload }), /EEXIST/);
    assert.equal(fs.readFileSync(target, "utf8"), "abcdefgh");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a stalled update download has a total deadline and removes its partial file", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-download-deadline-"));
  const target = path.join(root, "asset.zip");
  const stream = new Readable({ read() {} });
  try {
    await assert.rejects(downloadFile("https://example.invalid/asset.zip", target, {
      requestDownload: async () => stream,
      timeoutMs: 20,
    }), /exceeded its time limit/);
    assert.equal(stream.destroyed, true);
    assert.equal(fs.existsSync(target), false);
  } finally {
    stream.destroy();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("release metadata and checksums enforce size limits and total deadlines", async () => {
  assert.equal(await downloadText("https://example.invalid/metadata", 8, {
    requestDownload: async () => Readable.from([Buffer.from("metadata")]),
  }), "metadata");
  await assert.rejects(downloadText("https://example.invalid/metadata", 7, {
    requestDownload: async () => Readable.from([Buffer.from("metadata")]),
  }), /metadata exceeded its size limit/);
  const stream = new Readable({ read() {} });
  try {
    await assert.rejects(downloadText("https://example.invalid/metadata", 1024, {
      requestDownload: async () => stream,
      timeoutMs: 20,
    }), /metadata exceeded its time limit/);
    assert.equal(stream.destroyed, true);
  } finally {
    stream.destroy();
  }
});

test("Linux auto-update fails closed without the stable installer wrapper", () => {
  const previousAppImage = process.env.CODEX_WEB_GPT_APPIMAGE;
  const previousWrapper = process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
  process.env.CODEX_WEB_GPT_APPIMAGE = "/opt/codex/Codex Web GPT.AppImage";
  delete process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
  try {
    assert.throws(() => buildJob({
      version: "1.2.0",
      platform: "linux",
      executablePath: "/tmp/transient",
      assetPath: "/tmp/update.AppImage",
      stagingRoot: "/tmp/stage",
      tempRoot: "/tmp/update",
      logPath: "/tmp/update.log",
    }), /requires the stable install-launcher\.sh wrapper/);
  } finally {
    if (previousAppImage === undefined) delete process.env.CODEX_WEB_GPT_APPIMAGE;
    else process.env.CODEX_WEB_GPT_APPIMAGE = previousAppImage;
    if (previousWrapper === undefined) delete process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
    else process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = previousWrapper;
  }
});

test("release comparison and platform assets are strict", () => {
  assert.equal(compareVersions("1.1.5", "1.1.4"), 1);
  assert.equal(compareVersions("1.1.4", "1.1.4"), 0);
  assert.equal(compareVersions("1.1.3", "1.1.4"), -1);
  assert.equal(compareVersions("1.2.0", "1.1.99"), 1);
  assert.equal(releaseAssetName("1.2.0", "darwin", "arm64"), "codex-web-gpt-1.2.0-mac-arm64.zip");
  assert.equal(releaseAssetName("1.2.0", "darwin", "x64"), "codex-web-gpt-1.2.0-mac-x64.zip");
  assert.equal(releaseAssetName("1.2.0", "win32", "x64"), "codex-web-gpt-1.2.0-win-x64.zip");
  assert.equal(releaseAssetName("1.2.0", "linux", "x64"), "codex-web-gpt-1.2.0-linux-x64.AppImage");
  assert.equal(releaseAssetName("1.2.0", "linux", "arm64"), null);
});

test("checksums and release URLs bind the exact expected asset", () => {
  const hash = "a".repeat(64);
  assert.equal(expectedChecksum(`${hash}  launcher.zip\n`, "launcher.zip"), hash);
  assert.throws(() => expectedChecksum(`${hash}  other.zip\n`, "launcher.zip"), /no entry/);
  assert.equal(
    validateReleaseAssetUrl(
      "https://github.com/Froraut/codex-chatgpt-web/releases/download/v1.2.0/launcher.zip",
      "1.2.0",
      "launcher.zip",
    ),
    "https://github.com/Froraut/codex-chatgpt-web/releases/download/v1.2.0/launcher.zip",
  );
  assert.throws(
    () => validateReleaseAssetUrl("https://example.com/launcher.zip", "1.2.0", "launcher.zip"),
    /unexpected release asset URL/,
  );
});

test("macOS bundle resolution never guesses outside Contents/MacOS", () => {
  assert.equal(
    macApplicationPath("/Applications/Codex Web GPT.app/Contents/MacOS/Codex Web GPT"),
    "/Applications/Codex Web GPT.app",
  );
  assert.throws(() => macApplicationPath("/tmp/Codex Web GPT"), /Could not resolve/);
});

test("startup check runs once and exposes only a newer complete release", async () => {
  let calls = 0;
  const published = [];
  const controller = createUpdateController({
    currentVersion: "1.1.4",
    platform: "linux",
    arch: "x64",
    packaged: true,
    executablePath: "/tmp/launcher",
    runtimeExecutable: "/tmp/bun",
    logsDirectory: "/tmp/logs",
    publish: (state) => published.push(state),
    dependencies: {
      fetchRelease: async () => {
        calls += 1;
        return {
          tag_name: "v1.2.0",
          assets: [
            {
              name: "codex-web-gpt-1.2.0-linux-x64.AppImage",
              size: 1024,
              browser_download_url: "https://github.com/Froraut/codex-chatgpt-web/releases/download/v1.2.0/codex-web-gpt-1.2.0-linux-x64.AppImage",
            },
            {
              name: "checksums.txt",
              browser_download_url: "https://github.com/Froraut/codex-chatgpt-web/releases/download/v1.2.0/checksums.txt",
            },
            { name: "release-metadata.json",
              browser_download_url: "https://github.com/Froraut/codex-chatgpt-web/releases/download/v1.2.0/release-metadata.json",
            },
          ],
        };
      },
    },
  });
  assert.deepEqual(await controller.checkOnce(), { status: "available", version: "1.2.0" });
  assert.deepEqual(await controller.checkOnce(), { status: "available", version: "1.2.0" });
  assert.equal(calls, 1);
  assert.deepEqual(published.map((state) => state.status), ["checking", "available"]);
});

test("verified update is handed to one detached worker", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-update-test-"));
  const oldAppImage = path.join(root, "versions", "1.1.4", "Codex Web GPT.AppImage");
  const wrapper = path.join(root, "bin", "codex-web-gpt");
  fs.mkdirSync(path.dirname(oldAppImage), { recursive: true });
  fs.mkdirSync(path.dirname(wrapper), { recursive: true });
  fs.writeFileSync(oldAppImage, "old");
  fs.writeFileSync(wrapper, "old wrapper");
  const assetBody = Buffer.from("new appimage");
  const hash = require("node:crypto").createHash("sha256").update(assetBody).digest("hex");
  let spawned = null;
  const previousAppImage = process.env.CODEX_WEB_GPT_APPIMAGE;
  const previousWrapper = process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
  process.env.CODEX_WEB_GPT_APPIMAGE = oldAppImage;
  process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = wrapper;
  try {
    const controller = createUpdateController({
      currentVersion: "1.1.4",
      platform: "linux",
      arch: "x64",
      packaged: true,
      executablePath: "/tmp/launcher",
      runtimeExecutable: "/durable/bun",
      logsDirectory: path.join(root, "logs"),
      dependencies: {
        fetchRelease: async () => ({
          tag_name: "v1.2.0",
          assets: [
            {
              name: "codex-web-gpt-1.2.0-linux-x64.AppImage",
              size: assetBody.length,
              browser_download_url: "https://github.com/Froraut/codex-chatgpt-web/releases/download/v1.2.0/codex-web-gpt-1.2.0-linux-x64.AppImage",
            },
            {
              name: "checksums.txt",
              browser_download_url: "https://github.com/Froraut/codex-chatgpt-web/releases/download/v1.2.0/checksums.txt",
            },
            { name: "release-metadata.json",
              browser_download_url: "https://github.com/Froraut/codex-chatgpt-web/releases/download/v1.2.0/release-metadata.json",
            },
          ],
        }),
        downloadText: async () => `${hash}  codex-web-gpt-1.2.0-linux-x64.AppImage\n`,
        downloadFile: async (_url, destination, options) => {
          assert.equal(options.expectedBytes, assetBody.length);
          fs.writeFileSync(destination, assetBody);
        },
        verifyReleaseMetadata: () => ({ assets: [{ name: "codex-web-gpt-1.2.0-linux-x64.AppImage", size: assetBody.length, sha256: hash }] }),
        extractLinux() {},
        validateStagedApplication() {},
        sha256: (filePath) => require("node:crypto").createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
        spawnWorker: (runtime, worker, job) => {
          spawned = { runtime, worker, job, data: JSON.parse(fs.readFileSync(job, "utf8")) };
          return { pid: 123, unref() {}, kill() {} };
        },
      },
    });
    await controller.checkOnce();
    const launch = await controller.beginInstall();
    assert.equal(spawned.runtime, "/durable/bun");
    assert.equal(spawned.data.version, "1.2.0");
    assert.equal(spawned.data.target, oldAppImage);
    assert.equal(spawned.data.wrapper, wrapper);
    assert.equal(path.basename(spawned.data.runnerSource), "linux-appimage-runner.sh");
    assert.equal(fs.existsSync(spawned.data.runnerSource), true);
    assert.equal(controller.getState().status, "installing");
    controller.cancelInstall(launch);
    assert.equal(fs.existsSync(launch.tempRoot), false);
    assert.deepEqual(controller.getState(), { status: "available", version: "1.2.0" });
  } finally {
    if (previousAppImage === undefined) delete process.env.CODEX_WEB_GPT_APPIMAGE;
    else process.env.CODEX_WEB_GPT_APPIMAGE = previousAppImage;
    if (previousWrapper === undefined) delete process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
    else process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = previousWrapper;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("every authentication, staging and worker-start failure preserves the existing app and cleans downloads", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "update-failure-order-"));
  const assetName = "codex-web-gpt-1.2.0-linux-x64.AppImage";
  const body = Buffer.from("signed new image");
  const digest = require("node:crypto").createHash("sha256").update(body).digest("hex");
  const target = path.join(root, "versions", "1.0.0", "old.AppImage");
  const wrapper = path.join(root, "wrapper");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "exact previous image");
  fs.writeFileSync(wrapper, "exact previous wrapper");
  const previous = { image: process.env.CODEX_WEB_GPT_APPIMAGE, wrapper: process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE };
  process.env.CODEX_WEB_GPT_APPIMAGE = target;
  process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = wrapper;
  try {
    for (const failure of ["signature", "signed-size", "signed-hash", "stage", "worker"]) {
      const calls = [];
      let downloaded;
      const controller = createUpdateController({ currentVersion: "1.0.0", platform: "linux", arch: "x64", packaged: true,
        executablePath: "/tmp/launcher", runtimeExecutable: process.execPath, logsDirectory: path.join(root, "logs"),
        dependencies: {
          fetchRelease: async () => ({ tag_name: "v1.2.0", assets: [assetName, "checksums.txt", "release-metadata.json"].map(name => ({
            name, size: body.length, browser_download_url: `https://github.com/Froraut/codex-chatgpt-web/releases/download/v1.2.0/${name}`,
          })) }),
          downloadText: async url => { calls.push(url.endsWith("release-metadata.json") ? "metadata" : "checksums"); return `${digest}  ${assetName}\n`; },
          verifyReleaseMetadata() {
            calls.push("verify");
            if (failure === "signature") throw new Error("untrusted signature");
            return { assets: [{ name: assetName, size: body.length + (failure === "signed-size" ? 1 : 0), sha256: failure === "signed-hash" ? "0".repeat(64) : digest }] };
          },
          downloadFile: async (_url, destination) => { calls.push("download"); downloaded = destination; fs.writeFileSync(destination, body); },
          extractLinux() { calls.push("extract"); },
          validateStagedApplication() { calls.push("validate"); if (failure === "stage") throw new Error("invalid staged identity"); },
          spawnWorker() { calls.push("worker"); throw new Error("worker could not start"); },
        },
      });
      await controller.checkOnce();
      await assert.rejects(controller.beginInstall());
      assert.equal(fs.readFileSync(target, "utf8"), "exact previous image");
      assert.equal(fs.readFileSync(wrapper, "utf8"), "exact previous wrapper");
      assert.deepEqual(calls.slice(0, 2), ["metadata", "verify"]);
      if (["signature", "signed-size", "signed-hash"].includes(failure)) assert.equal(calls.includes("extract"), false);
      if (failure !== "worker") assert.equal(calls.includes("worker"), false);
      if (downloaded) assert.equal(fs.existsSync(path.dirname(downloaded)), false);
      assert.equal(controller.getState().status, "available");
    }
  } finally {
    if (previous.image === undefined) delete process.env.CODEX_WEB_GPT_APPIMAGE; else process.env.CODEX_WEB_GPT_APPIMAGE = previous.image;
    if (previous.wrapper === undefined) delete process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE; else process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = previous.wrapper;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
