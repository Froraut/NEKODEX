const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Update preparation was cancelled");
}

// Owns temporary staging until successful return. The controller then owns
// cleanup/handoff; the authenticated cache is never owned by this transaction.
// Callbacks retain the controller's existing injected dependency API. No worker
// launch, status lifetime or mutable cancellation state belongs here.
/**
 * @returns {Promise<{tempRoot: string, workerPath: string, jobPath: string}>}
 * Only a validated, serialized job crosses the ownership boundary.
 */
async function stageAuthenticatedUpdate({ available, repository, platform, arch,
  executablePath, runtimeExecutable, logsDirectory, deps: { downloadText, verifyReleaseMetadata, sha256, downloadFile,
    extractMac, extractWindows, extractLinux, linuxRunnerSource, validateStagedApplication },
  signal, onProgress,
  expectedChecksum, buildJob, logger }) {
  let tempRoot;
  try {
    throwIfAborted(signal);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-gpt-update-"));
    const metadataText = await downloadText(available.metadataUrl, 512 * 1024, {
      signal,
    });
    throwIfAborted(signal);
    const metadata = verifyReleaseMetadata(metadataText, { repository, tag: `v${available.version}`, version: available.version });
    const authenticatedAsset = metadata.assets.find(asset => asset.name === available.assetName);
    if (!authenticatedAsset || authenticatedAsset.size !== available.assetBytes) {
      throw new Error("Signed release metadata does not match the selected asset size");
    }
    const checksums = await downloadText(available.checksumsUrl, 2 * 1024 * 1024, {
      signal,
    });
    throwIfAborted(signal);
    const expected = expectedChecksum(checksums, available.assetName);
    if (expected !== authenticatedAsset.sha256) throw new Error("Checksums do not match independently authenticated release metadata");
    const assetPath = path.join(tempRoot, available.assetName);
    const cacheRoot = path.join(logsDirectory, "..", "update-downloads");
    fs.mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
    const cachedAsset = path.join(cacheRoot, `${expected}-${available.assetName}`);
    if (fs.existsSync(cachedAsset) && (fs.lstatSync(cachedAsset).isSymbolicLink()
      || !fs.lstatSync(cachedAsset).isFile())) throw new Error("Unsafe cached update asset");
    if (fs.existsSync(cachedAsset)) {
      const cachedDigest = await sha256(cachedAsset, { signal });
      throwIfAborted(signal);
      if (cachedDigest !== expected) {
        fs.rmSync(cachedAsset);
        throw new Error("Cached update checksum mismatch; removed damaged cache, retry download");
      }
    }
    if (!fs.existsSync(cachedAsset)) await downloadFile(available.assetUrl, cachedAsset, {
      expectedBytes: available.assetBytes, expectedSha256: expected,
      onProgress: progress => {
        if (!signal.aborted) {
          onProgress({ status: "downloading", version: available.version, ...progress });
        }
      },
      signal,
    });
    throwIfAborted(signal);
    onProgress({ status: "verifying", version: available.version });
    await fs.promises.copyFile(cachedAsset, assetPath);
    throwIfAborted(signal);
    const actual = await sha256(assetPath, { signal });
    throwIfAborted(signal);
    if (actual !== expected) throw new Error(`SHA-256 verification failed for ${available.assetName}`);
    throwIfAborted(signal);

    const stagingRoot = path.join(tempRoot, "stage");
    if (platform === "darwin") await extractMac(assetPath, stagingRoot, { signal });
    if (platform === "win32") await extractWindows(assetPath, stagingRoot, { signal });
    if (platform === "linux") {
      fs.chmodSync(assetPath, 0o755);
      await extractLinux(assetPath, stagingRoot, { signal });
      throwIfAborted(signal);
      const runnerSource = linuxRunnerSource();
      fs.copyFileSync(runnerSource, path.join(tempRoot, "linux-appimage-runner.sh"));
      fs.chmodSync(path.join(tempRoot, "linux-appimage-runner.sh"), 0o755);
    }
    throwIfAborted(signal);

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
    validateStagedApplication(job.stagedApplication, job);
    throwIfAborted(signal);
    const jobPath = path.join(tempRoot, "job.json");
    fs.writeFileSync(jobPath, `${JSON.stringify(job)}\n`, { mode: 0o600 });
    return { tempRoot, workerPath, jobPath };
  } catch (error) {
    if (tempRoot) {
      if (error?.preserveStaging === true) {
        logger?.warn("launcher.update_cleanup_preserved", { message: String(error) });
      } else {
        try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
        catch (failure) {
          // Preserve the primary failure while reporting incomplete cleanup to
          // cancellation settlement. Never retry cleanup from two owners.
          error.stagingCleanupError = failure;
          logger?.warn("launcher.update_cleanup_failed", { message: String(failure) });
        }
      }
    }
    throw error;
  }
}

module.exports = { stageAuthenticatedUpdate };
