const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { validateStagedApplication } = require("./update-validation.cjs");
const { verifyReleaseMetadata } = require("./release-trust.cjs");
const { downloadAuthenticatedAsset } = require("./resumable-download.cjs");
const BUILD = require("../package.json");

// Update origin belongs to this packaged build, never to an ambient environment
// variable. A fork must not silently replace itself with an upstream release.
const REPOSITORY = validateRepository(require("../package.json").updateRepository);
const USER_AGENT = "codex-web-gpt-launcher-updater";
const MAX_REDIRECTS = 5;
const MAX_ASSET_BYTES = 1024 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
const RECHECK_COOLDOWN_MS = 60_000;

function validateRepository(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(value)) {
    throw new Error("The packaged update repository must be a GitHub owner/repository");
  }
  return value;
}

function releaseApiUrl(repository = REPOSITORY) {
  // Fork versions use an explicit prerelease suffix. GitHub's /latest silently
  // excludes them, so resolve the newest compatible channel from published releases.
  return `https://api.github.com/repos/${validateRepository(repository)}/releases?per_page=20`;
}

function selectRelease(releases, currentVersion, { platform, arch } = {}) {
  const current = parseVersion(currentVersion);
  const channel = current?.prerelease?.split(".")[0];
  return (Array.isArray(releases) ? releases : releases ? [releases] : [])
    .filter(release => {
      if (release?.draft) return false;
      const version = parseVersion(String(release?.tag_name || "").replace(/^v/, ""));
      if (!version) return false;
      if (platform && Array.isArray(release.assets)) {
        const assetName = releaseAssetName(releaseVersion(release.tag_name), platform, arch);
        // A platform-scoped release can intentionally omit other platforms. Once
        // this archive is present, keep the candidate: missing/bad trust metadata,
        // URLs, sizes or signatures must fail closed instead of falling back.
        if (assetName && !release.assets.some(asset => asset?.name === assetName)) return false;
      }
      return !version.prerelease || (channel && version.prerelease.split(".")[0] === channel);
    })
    .sort((a, b) => compareVersions(releaseVersion(b.tag_name), releaseVersion(a.tag_name)))[0];
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value || "").trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || null,
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`Invalid release version comparison: ${left} / ${right}`);
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease, "en", { numeric: true });
}

function releaseVersion(tagName) {
  const version = String(tagName || "").replace(/^v/, "");
  if (!parseVersion(version)) throw new Error(`GitHub returned an invalid release tag: ${tagName}`);
  return version;
}

function releaseAssetName(version, platform = process.platform, arch = process.arch) {
  if (platform === "darwin" && ["arm64", "x64"].includes(arch)) {
    return `codex-web-gpt-${version}-mac-${arch}.zip`;
  }
  if (platform === "win32" && arch === "x64") {
    return `codex-web-gpt-${version}-win-x64.zip`;
  }
  if (platform === "linux" && arch === "x64") {
    return `codex-web-gpt-${version}-linux-x64.AppImage`;
  }
  return null;
}

function expectedChecksum(contents, assetName) {
  for (const line of String(contents || "").split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+(.+)$/.exec(line.trim());
    if (match && match[2] === assetName) return match[1].toLowerCase();
  }
  throw new Error(`checksums.txt has no entry for ${assetName}`);
}

function validateReleaseAssetUrl(raw, version, assetName, repository = REPOSITORY) {
  const url = new URL(raw);
  const expectedPath = `/${validateRepository(repository)}/releases/download/v${version}/${assetName}`;
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.pathname !== expectedPath
    || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error(`GitHub returned an unexpected release asset URL for ${assetName}`);
  }
  return url.toString();
}

function request(url, redirects = 0, { signal, headers = {}, allowPartial = false } = {}) {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) {
      reject(new Error(`Too many redirects while downloading ${url}`));
      return;
    }
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      reject(new Error(`Refusing non-HTTPS update URL: ${parsed.protocol}`));
      return;
    }
    const req = https.get(parsed, {
      signal,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT,
        ...headers,
      },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, parsed).toString();
        request(next, redirects + 1, { signal, headers, allowPartial }).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200 && !(allowPartial && response.statusCode === 206)) {
        response.resume();
        const error = new Error(`Update download failed with HTTP ${response.statusCode}`);
        error.statusCode = response.statusCode;
        reject(error);
        return;
      }
      resolve(response);
    });
    req.setTimeout(60_000, () => req.destroy(new Error("Update request timed out")));
    req.once("error", reject);
  });
}

async function downloadText(url, maxBytes = 2 * 1024 * 1024, {
  timeoutMs = 60_000,
  requestDownload = request,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Update metadata exceeded its time limit")), timeoutMs);
  let response;
  const abortResponse = () => response?.destroy(controller.signal.reason);
  try {
    response = await requestDownload(url, 0, { signal: controller.signal });
    controller.signal.addEventListener("abort", abortResponse, { once: true });
    if (controller.signal.aborted) abortResponse();
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error("Update metadata exceeded its size limit");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (error) {
    response?.destroy();
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", abortResponse);
  }
}

async function downloadFile(url, destination, {
  expectedBytes,
  expectedSha256,
  onProgress,
  maxBytes = MAX_ASSET_BYTES,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
  requestDownload = request,
} = {}) {
  if (expectedSha256) return downloadAuthenticatedAsset(url, destination, {
    expectedBytes, expectedSha256, onProgress, requestDownload,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Update download exceeded its time limit")), timeoutMs);
  let response;
  let created = false;
  try {
    response = await requestDownload(url, 0, { signal: controller.signal });
    let bytes = 0;
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes || (expectedBytes !== undefined && bytes > expectedBytes)) {
          callback(new Error("Update download exceeded its size limit"));
          return;
        }
        callback(null, chunk);
      },
    });
    const fd = fs.openSync(destination, "wx", 0o600);
    created = true;
    await pipeline(response, limit, fs.createWriteStream(destination, { fd }), { signal: controller.signal });
    if (expectedBytes !== undefined && bytes !== expectedBytes) {
      throw new Error("Update download size does not match the release metadata");
    }
  } catch (error) {
    response?.destroy();
    if (created) fs.rmSync(destination, { force: true });
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function macApplicationPath(executablePath) {
  const match = /^(.*\.app)[\\/]Contents[\\/]MacOS[\\/][^\\/]+$/.exec(executablePath);
  if (!match?.[1]) throw new Error(`Could not resolve the macOS application bundle from ${executablePath}`);
  return match[1];
}

function findMacApplication(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const appEntry = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
  if (!appEntry) throw new Error("The macOS update archive does not contain an application bundle");
  const application = path.join(root, appEntry.name);
  const executable = path.join(application, "Contents", "MacOS", BUILD.build.productName);
  if (!fs.existsSync(executable) || !fs.statSync(executable).isFile()) {
    throw new Error("The macOS update archive is incomplete");
  }
  return application;
}

function buildJob({ version, platform, arch = process.arch, executablePath, assetPath, stagingRoot, tempRoot, logPath,
  runtimeExecutable, repository = REPOSITORY }) {
  const common = { version, platform, arch, parentPid: process.pid, tempRoot, logPath, runtimeExecutable,
    identity: BUILD.build.appId, productName: BUILD.build.productName, packageName: BUILD.name, repository };
  if (platform === "darwin") {
    const target = macApplicationPath(executablePath);
    return {
      ...common,
      source: findMacApplication(stagingRoot),
      stagedApplication: findMacApplication(stagingRoot),
      target,
      transactionRoot: `${target}.update-recovery`,
    };
  }
  if (platform === "win32") {
    return {
      ...common,
      source: assetPath,
      stagedApplication: stagingRoot,
      target: path.dirname(executablePath),
      transactionRoot: `${path.dirname(executablePath)}.update-recovery`,
    };
  }
  if (platform === "linux") {
    const target = process.env.CODEX_WEB_GPT_APPIMAGE?.trim()
      || process.env.APPIMAGE?.trim();
    if (!target || !path.isAbsolute(target)) {
      throw new Error("The running Linux AppImage path is unavailable; reinstall with install-launcher.sh");
    }
    const wrapper = process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE?.trim();
    if (!wrapper || !path.isAbsolute(wrapper)) {
      throw new Error("Linux auto-update requires the stable install-launcher.sh wrapper; reinstall once");
    }
    return {
      ...common,
      source: assetPath,
      stagedApplication: path.join(stagingRoot, "squashfs-root"),
      target,
      wrapper,
      transactionRoot: `${wrapper}.update-recovery`,
      runnerSource: path.join(tempRoot, "linux-appimage-runner.sh"),
    };
  }
  throw new Error(`Updates are not supported on ${platform}`);
}

function defaultDependencies() {
  return {
    fetchRelease: async (url) => JSON.parse(await downloadText(url)),
    downloadText,
    downloadFile,
    sha256,
    verifyReleaseMetadata,
    validateStagedApplication,
    extractMac(archive, destination) {
      fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
      const result = spawnSync("/usr/bin/ditto", ["-x", "-k", archive, destination], {
        encoding: "utf8",
        timeout: 120_000,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Could not extract the macOS update: ${result.stderr.trim()}`);
    },
    extractWindows(archive, destination) {
      fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
      const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
        "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:CODEX_UPDATE_ARCHIVE -DestinationPath $env:CODEX_UPDATE_STAGE"], {
        env: { ...process.env, CODEX_UPDATE_ARCHIVE: archive, CODEX_UPDATE_STAGE: destination },
        encoding: "utf8", timeout: 180_000, windowsHide: true,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Could not extract the Windows update: ${result.stderr.trim()}`);
    },
    extractLinux(archive, destination) {
      fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
      // Execute only after independently authenticated release metadata and hash verification.
      const result = spawnSync(archive, ["--appimage-extract"], { cwd: destination, encoding: "utf8", timeout: 180_000,
        maxBuffer: 1024 * 1024, stdio: ["ignore", "ignore", "pipe"] });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Could not extract the Linux update: ${result.stderr?.trim()}`);
    },
    linuxRunnerSource() {
      if (typeof process.resourcesPath === "string" && process.resourcesPath) {
        const unpacked = path.join(
          process.resourcesPath,
          "app.asar.unpacked",
          "assets",
          "linux-appimage-runner.sh",
        );
        if (fs.statSync(unpacked, { throwIfNoEntry: false })?.isFile()) return unpacked;
      }
      const source = path.resolve(__dirname, "..", "assets", "linux-appimage-runner.sh");
      if (fs.statSync(source, { throwIfNoEntry: false })?.isFile()) return source;
      throw new Error("Packaged Linux AppImage runner is missing");
    },
    async spawnWorker(runtimeExecutable, workerPath, jobPath) {
      const child = spawn(runtimeExecutable, [workerPath, jobPath], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
      return child;
    },
  };
}

function createUpdateController({
  currentVersion,
  platform,
  arch,
  packaged,
  executablePath,
  runtimeExecutable,
  logsDirectory,
  publish,
  logger,
  repository = REPOSITORY,
  dependencies = {},
}) {
  const apiUrl = releaseApiUrl(repository);
  const deps = { ...defaultDependencies(), ...dependencies };
  const supportedAsset = releaseAssetName(currentVersion, platform, arch);
  let state = packaged && supportedAsset ? { status: "idle" } : { status: "disabled" };
  let checked = false;
  let pending = null;
  let candidate = null;
  let checkPromise = null;
  let lastCheckFinishedAt = 0;

  const transition = (next) => {
    state = next;
    publish?.(state);
    return state;
  };

  function startCheck() {
    transition({ status: "checking" });
    checkPromise = (async () => {
      try {
        let release;
        try {
          release = selectRelease(await deps.fetchRelease(apiUrl), currentVersion, { platform, arch });
        } catch (error) {
          // A new public fork has no latest release until its first stable build.
          // Never fall back to a different repository in that case.
          if (error?.statusCode !== 404) throw error;
        }
        if (!release) {
          candidate = null;
          return transition({ status: "up-to-date" });
        }
        const version = releaseVersion(release?.tag_name);
        if (compareVersions(version, currentVersion) <= 0) {
          candidate = null;
          return transition({ status: "up-to-date" });
        }
        const assetName = releaseAssetName(version, platform, arch);
        if (!assetName) return transition({ status: "disabled" });
        const assets = Array.isArray(release?.assets) ? release.assets : [];
        const asset = assets.find((item) => item?.name === assetName);
        const checksums = assets.find((item) => item?.name === "checksums.txt");
        const metadata = assets.find((item) => item?.name === "release-metadata.json");
        if (!asset?.browser_download_url || !checksums?.browser_download_url || !metadata?.browser_download_url) {
          throw new Error(`Release v${version} is missing ${assetName}, checksums.txt or signed release-metadata.json`);
        }
        if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ASSET_BYTES) {
          throw new Error(`Release v${version} has an invalid or excessive download size`);
        }
        candidate = {
          version,
          assetName,
          assetBytes: asset.size,
          assetUrl: validateReleaseAssetUrl(asset.browser_download_url, version, assetName, repository),
          checksumsUrl: validateReleaseAssetUrl(checksums.browser_download_url, version, "checksums.txt", repository),
          metadataUrl: validateReleaseAssetUrl(metadata.browser_download_url, version, "release-metadata.json", repository),
        };
        logger?.info("launcher.update_available", { currentVersion, version, platform, arch });
        return transition({ status: "available", version });
      } catch (error) {
        candidate = null;
        const message = error instanceof Error ? error.message : String(error);
        logger?.warn("launcher.update_check_failed", { message });
        return transition({ status: "error", message });
      } finally {
        lastCheckFinishedAt = Date.now();
      }
    })();
    void checkPromise.then(
      () => { checkPromise = null; },
      () => { checkPromise = null; },
    );
    return checkPromise;
  }

  function checkOnce() {
    if (checkPromise) return checkPromise;
    if (state.status === "disabled" || checked) return Promise.resolve(state);
    checked = true;
    return startCheck();
  }

  function recheck() {
    if (checkPromise) return checkPromise;
    if (state.status === "disabled" || pending || ["available", "downloading", "installing"].includes(state.status)) {
      return Promise.resolve(state);
    }
    if (lastCheckFinishedAt && Date.now() - lastCheckFinishedAt < RECHECK_COOLDOWN_MS) {
      return Promise.resolve(state);
    }
    checked = true;
    return startCheck();
  }

  async function beginInstall() {
    if (pending) throw new Error("An update is already being prepared");
    if (state.status !== "available" || !candidate) throw new Error("No launcher update is available");
    const available = candidate;
    pending = (async () => {
      transition({ status: "downloading", version: available.version });
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-gpt-update-"));
      try {
        const metadataText = await deps.downloadText(available.metadataUrl, 512 * 1024);
        const metadata = deps.verifyReleaseMetadata(metadataText, { repository, tag: `v${available.version}`, version: available.version });
        const authenticatedAsset = metadata.assets.find(asset => asset.name === available.assetName);
        if (!authenticatedAsset || authenticatedAsset.size !== available.assetBytes) {
          throw new Error("Signed release metadata does not match the selected asset size");
        }
        const checksums = await deps.downloadText(available.checksumsUrl);
        const expected = expectedChecksum(checksums, available.assetName);
        if (expected !== authenticatedAsset.sha256) throw new Error("Checksums do not match independently authenticated release metadata");
        const assetPath = path.join(tempRoot, available.assetName);
        const cacheRoot = path.join(logsDirectory, "..", "update-downloads");
        fs.mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
        const cachedAsset = path.join(cacheRoot, `${expected}-${available.assetName}`);
        if (fs.existsSync(cachedAsset) && (fs.lstatSync(cachedAsset).isSymbolicLink()
          || !fs.lstatSync(cachedAsset).isFile())) throw new Error("Unsafe cached update asset");
        if (fs.existsSync(cachedAsset) && deps.sha256(cachedAsset) !== expected) {
          fs.rmSync(cachedAsset);
          throw new Error("Cached update checksum mismatch; removed damaged cache, retry download");
        }
        if (!fs.existsSync(cachedAsset)) await deps.downloadFile(available.assetUrl, cachedAsset, {
          expectedBytes: available.assetBytes, expectedSha256: expected,
          onProgress: progress => transition({ status: "downloading", version: available.version, ...progress }),
        });
        fs.copyFileSync(cachedAsset, assetPath);
        const actual = deps.sha256(assetPath);
        if (actual !== expected) throw new Error(`SHA-256 verification failed for ${available.assetName}`);

        const stagingRoot = path.join(tempRoot, "stage");
        if (platform === "darwin") deps.extractMac(assetPath, stagingRoot);
        if (platform === "win32") deps.extractWindows(assetPath, stagingRoot);
        if (platform === "linux") {
          fs.chmodSync(assetPath, 0o755);
          deps.extractLinux(assetPath, stagingRoot);
          const runnerSource = deps.linuxRunnerSource();
          fs.copyFileSync(runnerSource, path.join(tempRoot, "linux-appimage-runner.sh"));
          fs.chmodSync(path.join(tempRoot, "linux-appimage-runner.sh"), 0o755);
        }

        const workerPath = path.join(tempRoot, "update-worker.cjs");
        for (const filename of ["update-worker.cjs", "update-validation.cjs", "update-recovery.cjs", "update-launcher.cjs"]) {
          fs.copyFileSync(path.join(__dirname, filename), path.join(tempRoot, filename));
        }
        const job = buildJob({
          version: available.version,
          platform,
          arch,
          executablePath,
          assetPath,
          stagingRoot,
          tempRoot,
          runtimeExecutable,
          repository,
          logPath: path.join(logsDirectory, "update-worker.log"),
        });
        deps.validateStagedApplication(job.stagedApplication, job);
        const jobPath = path.join(tempRoot, "job.json");
        fs.writeFileSync(jobPath, `${JSON.stringify(job)}\n`, { mode: 0o600 });
        const child = await deps.spawnWorker(runtimeExecutable, workerPath, jobPath);
        if (!Number.isInteger(child?.pid) || child.pid <= 0) throw new Error("The update worker did not start");
        child.unref?.();
        logger?.info("launcher.update_worker_started", { pid: child.pid, version: available.version });
        transition({ status: "installing", version: available.version });
        return { child, tempRoot, version: available.version };
      } catch (error) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
        transition({ status: "available", version: available.version });
        throw error;
      }
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  }

  function cancelInstall(launch) {
    try { launch?.child?.kill(); } catch {}
    if (launch?.tempRoot) fs.rmSync(launch.tempRoot, { recursive: true, force: true });
    if (candidate) transition({ status: "available", version: candidate.version });
  }

  return {
    getState: () => state,
    checkOnce,
    recheck,
    beginInstall,
    cancelInstall,
  };
}

module.exports = {
  buildJob,
  compareVersions,
  createUpdateController,
  downloadFile,
  downloadText,
  expectedChecksum,
  macApplicationPath,
  parseVersion,
  releaseAssetName,
  releaseApiUrl,
  selectRelease,
  releaseVersion,
  validateReleaseAssetUrl,
  validateRepository,
};
