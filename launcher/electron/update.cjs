const { REPOSITORY, validateRepository, releaseApiUrl, releaseFeedEntries, selectRelease, parseVersion, compareVersions, releaseVersion, releaseAssetName, expectedChecksum, validateReleaseAssetUrl } = require("./update-release-policy.cjs");
const { sha256 } = require("./update-asset-hash.cjs");
const { stageAuthenticatedUpdate } = require("./update-staging.cjs");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { validateStagedApplication } = require("./update-validation.cjs");
const { verifyReleaseMetadata } = require("./release-trust.cjs");
const { downloadAuthenticatedAsset } = require("./resumable-download.cjs");
const { processIdentity } = require("./update-recovery.cjs");
const { runOwnedCommand } = require("./update-preparation.cjs");
const BUILD = require("../package.json");
const APPLICATION = applicationIdentity(BUILD);

function applicationIdentity(manifest) {
  // electron-builder removes `build` from the shipped package.json. These
  // persisted fork fields are also checked against build configuration before release.
  const identity = manifest.forkIdentity?.profileCompatibility;
  const productName = manifest.forkIdentity?.displayName;
  if (typeof identity !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(identity)
    || typeof productName !== "string" || !productName.trim() || productName.length > 128
    || /[\\/\x00-\x1f]/.test(productName) || [".", ".."].includes(productName)) {
    throw new Error("The packaged application identity is missing or invalid");
  }
  return { identity, productName };
}

// Update origin belongs to this packaged build, never to an ambient environment
// variable. A fork must not silently replace itself with an upstream release.
const USER_AGENT = "codex-web-gpt-launcher-updater";
const MAX_REDIRECTS = 5;
const MAX_ASSET_BYTES = 1024 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
const RECHECK_COOLDOWN_MS = 60_000;

function preparationCancelledError() {
  return Object.assign(new Error("Update preparation was cancelled; the authenticated partial download was kept for retry"), {
    code: "UPDATE_PREPARATION_CANCELLED",
  });
}

function abortReason(signal, fallback = "Update preparation was cancelled") {
  return signal?.reason instanceof Error ? signal.reason : new Error(fallback);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

function request(url, redirects = 0, { signal, headers = {}, allowPartial = false } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal, "Update request was cancelled"));
      return;
    }
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
        error.rateLimited = response.statusCode === 429
          || (response.statusCode === 403 && response.headers["x-ratelimit-remaining"] === "0");
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
  signal,
} = {}) {
  throwIfAborted(signal);
  const controller = new AbortController();
  const cancel = () => controller.abort(abortReason(signal, "Update metadata download was cancelled"));
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
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
    signal?.removeEventListener("abort", cancel);
  }
}

async function downloadFile(url, destination, {
  expectedBytes,
  expectedSha256,
  onProgress,
  maxBytes = MAX_ASSET_BYTES,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
  requestDownload = request,
  signal,
} = {}) {
  if (expectedSha256) return downloadAuthenticatedAsset(url, destination, {
    expectedBytes, expectedSha256, onProgress, requestDownload,
    maxBytes, totalTimeoutMs: timeoutMs, signal,
  });
  throwIfAborted(signal);
  const controller = new AbortController();
  const cancel = () => controller.abort(abortReason(signal, "Update download was cancelled"));
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
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
    signal?.removeEventListener("abort", cancel);
  }
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
  const executable = path.join(application, "Contents", "MacOS", APPLICATION.productName);
  if (!fs.existsSync(executable) || !fs.statSync(executable).isFile()) {
    throw new Error("The macOS update archive is incomplete");
  }
  return application;
}

function buildJob({ version, platform, arch = process.arch, executablePath, assetPath, stagingRoot, tempRoot, logPath,
  runtimeExecutable, repository = REPOSITORY }) {
  const parentIdentity = processIdentity(process.pid);
  if (!parentIdentity) throw new Error("Could not establish the running launcher's process identity");
  const common = { version, platform, arch, readinessSchema: 2, parentPid: process.pid, parentIdentity, tempRoot, logPath, runtimeExecutable,
    identity: APPLICATION.identity, productName: APPLICATION.productName, packageName: BUILD.name, repository };
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
    async extractMac(archive, destination, { signal } = {}) {
      fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
      await runOwnedCommand("/usr/bin/ditto", ["-x", "-k", archive, destination], {
        signal,
        timeoutMs: 120_000,
        failureMessage: "Could not extract the macOS update",
      });
    },
    async extractWindows(archive, destination, { signal } = {}) {
      fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
      await runOwnedCommand("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
        "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:CODEX_UPDATE_ARCHIVE -DestinationPath $env:CODEX_UPDATE_STAGE"], {
        signal,
        env: { ...process.env, CODEX_UPDATE_ARCHIVE: archive, CODEX_UPDATE_STAGE: destination },
        timeoutMs: 180_000,
        failureMessage: "Could not extract the Windows update",
      });
    },
    async extractLinux(archive, destination, { signal } = {}) {
      fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
      // Execute only after independently authenticated release metadata and hash verification.
      await runOwnedCommand(archive, ["--appimage-extract"], {
        cwd: destination,
        signal,
        timeoutMs: 180_000,
        failureMessage: "Could not extract the Linux update",
      });
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
  let preparation = null;
  let candidate = null;
  let checkPromise = null;
  let lastCheckFinishedAt = 0;

  const transition = (next) => {
    state = next;
    publish?.(state);
    return state;
  };

  async function checkSignedFeed() {
    // Public Atom discovery is not subject to the anonymous REST quota. The feed
    // is only a discovery hint: pinned signatures still authenticate every asset.
    const feed = await deps.downloadText(`https://github.com/${repository}/releases.atom`, 512 * 1024, { timeoutMs: 10_000 });
    let entries = releaseFeedEntries(feed, repository);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const release = selectRelease(entries, currentVersion);
      if (!release || compareVersions(releaseVersion(release.tag_name), currentVersion) <= 0) return release;
      const version = releaseVersion(release.tag_name);
      const base = `https://github.com/${repository}/releases/download/v${version}/`;
      const raw = await deps.downloadText(`${base}release-metadata.json`, 512 * 1024, { timeoutMs: 10_000 });
      const metadata = deps.verifyReleaseMetadata(raw, { repository, tag: release.tag_name, version });
      const name = releaseAssetName(version, platform, arch);
      if (metadata.assets.some(asset => asset.name === name)) {
        return { ...release, assets: [
          ...metadata.assets.map(asset => ({ name: asset.name, size: asset.size, browser_download_url: `${base}${asset.name}` })),
          { name: "release-metadata.json", browser_download_url: `${base}release-metadata.json` },
        ] };
      }
      entries = entries.filter(entry => entry.tag_name !== release.tag_name);
    }
    throw new Error("No compatible update found in the newest signed releases. Try again later.");
  }

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
          if (error?.rateLimited) {
            release = await checkSignedFeed();
          } else if (error?.statusCode !== 404) throw error;
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
    if (state.status === "disabled" || pending || ["downloading", "verifying", "installing"].includes(state.status)) {
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
    let settlePreparation;
    const active = {
      controller: new AbortController(),
      version: available.version,
      handoffCommitted: false,
      cancelRequested: false,
      outcome: null,
      settled: new Promise(resolve => { settlePreparation = resolve; }),
    };
    preparation = active;
    pending = (async () => {
      transition({ status: "downloading", version: available.version });
      let tempRoot;
      try {
        const staged = await stageAuthenticatedUpdate({
          available, repository, platform, arch, executablePath, runtimeExecutable,
          logsDirectory, deps, signal: active.controller.signal, onProgress: transition,
          expectedChecksum, buildJob, logger,
        });
        // Successful return transfers ownership from staging to this controller.
        tempRoot = staged.tempRoot;
        const { workerPath, jobPath } = staged;
        // Give cancellation IPC one final turn after synchronous validation. Once
        // handoff starts, only the existing quit-failure rollback may stop the worker.
        await new Promise(resolve => setImmediate(resolve));
        throwIfAborted(active.controller.signal);
        active.handoffCommitted = true;
        transition({ status: "installing", version: available.version });
        const child = await deps.spawnWorker(runtimeExecutable, workerPath, jobPath);
        if (!Number.isInteger(child?.pid) || child.pid <= 0) throw new Error("The update worker did not start");
        child.unref?.();
        logger?.info("launcher.update_worker_started", { pid: child.pid, version: available.version });
        return { child, tempRoot, version: available.version };
      } catch (error) {
        const cancelled = active.controller.signal.aborted && !active.handoffCommitted;
        let cleanupError = error?.stagingCleanupError || (error?.preserveStaging === true ? error : null);
        if (tempRoot) {
          if (error?.preserveStaging === true) {
            cleanupError = error;
            logger?.warn("launcher.update_cleanup_preserved", { message: String(error) });
          } else {
            try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
            catch (failure) {
              cleanupError = failure;
              logger?.warn("launcher.update_cleanup_failed", { message: String(failure) });
            }
          }
        }
        if (cancelled) {
          if (cleanupError) {
            const failure = Object.assign(new Error("Update preparation was cancelled, but temporary staging cleanup did not complete"), {
              code: "UPDATE_PREPARATION_CLEANUP_FAILED",
              cause: cleanupError,
            });
            active.outcome = { status: "failed", version: available.version, message: failure.message };
            transition({ status: "error", message: failure.message });
            throw failure;
          }
          active.outcome = { status: "cancelled", version: available.version };
          transition({ status: "available", version: available.version });
          throw abortReason(active.controller.signal);
        }
        if (error?.preserveStaging === true) {
          transition({ status: "error", message: error.message });
          throw error;
        }
        transition({ status: "available", version: available.version });
        throw error;
      }
    })();
    try {
      return await pending;
    } finally {
      pending = null;
      if (preparation === active) preparation = null;
      settlePreparation();
    }
  }

  async function cancelPreparation() {
    const active = preparation;
    if (!active) {
      return state.status === "installing"
        ? { status: "too-late", reason: "worker-handoff", version: state.version }
        : { status: "not-active" };
    }
    if (active.handoffCommitted) {
      return { status: "too-late", reason: "worker-handoff", version: active.version };
    }
    if (!active.cancelRequested) {
      active.cancelRequested = true;
      active.controller.abort(preparationCancelledError());
      transition({ status: "cancelling", version: active.version });
    }
    await active.settled;
    return active.outcome || { status: "cancelled", version: active.version };
  }

  async function cancelInstall(launch) {
    const child = launch?.child;
    let settled = !child || child.exitCode !== null || child.signalCode !== null;
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        child.once?.("close", finish);
        child.once?.("exit", finish);
        setTimeout(finish, 5_000);
      });
      try { child.kill(); } catch (error) {
        if (error?.code !== "ESRCH") logger?.warn("launcher.update_cancel_failed", { message: String(error) });
      }
      await exited;
      settled = child.exitCode !== null || child.signalCode !== null;
    }
    if (launch?.tempRoot && settled) {
      try { fs.rmSync(launch.tempRoot, { recursive: true, force: true }); }
      catch (error) { logger?.warn("launcher.update_cleanup_failed", { message: String(error) }); }
    } else if (launch?.tempRoot) {
      logger?.warn("launcher.update_cancel_unsettled", { tempRoot: launch.tempRoot, pid: child?.pid });
    }
    if (candidate) transition({ status: "available", version: candidate.version });
  }

  return {
    getState: () => state,
    checkOnce,
    recheck,
    beginInstall,
    cancelPreparation,
    cancelInstall,
  };
}

module.exports = {
  applicationIdentity,
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
  releaseFeedEntries,
  selectRelease,
  releaseVersion,
  validateReleaseAssetUrl,
  validateRepository,
};
