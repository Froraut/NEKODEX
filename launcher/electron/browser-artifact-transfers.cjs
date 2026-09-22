const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const MAX_TASK_ARTIFACT_LEASES = 10;
const MAX_ACCOUNT_ARTIFACT_LEASES = 64;

/** Exact turn/surface leases; the download guard owns network interception and writes. */
class BrowserArtifactTransfers {
  constructor({ tabs, leases, downloads, coreHome, logger }) {
    this.tabs = tabs;
    this.leases = leases;
    this.downloads = downloads;
    this.coreHome = coreHome;
    this.logger = logger;
  }

  artifactOwner(traceId, helperPid, surfaceId) {
    const tab = [...this.tabs.values()].find(candidate => candidate.traceId === traceId);
    if (!tab || tab.interactionMode !== 'automatic' || tab.status !== 'running'
      || tab.helperPid !== helperPid || tab.surfaceId !== surfaceId
      || tab.view.webContents.isDestroyed()) {
      throw new Error('Artifact download owner does not match an active browser turn surface');
    }
    return tab;
  }

  registerArtifactDownload(traceId, helperPid, surfaceId, assistantTurnId, expectedFilename, maxBytes, deadlineMs) {
    const tab = this.artifactOwner(traceId, helperPid, surfaceId);
    if (typeof assistantTurnId !== 'string' || assistantTurnId.length < 1 || assistantTurnId.length > 256
      || /[\u0000-\u001f\u007f]/.test(assistantTurnId)
      || typeof expectedFilename !== 'string' || expectedFilename.length < 1 || expectedFilename.length > 160
      || path.basename(expectedFilename) !== expectedFilename || /[\u0000-\u001f\u007f]/.test(expectedFilename)
      || !Number.isFinite(maxBytes) || maxBytes <= 0 || maxBytes > 50_000_000
      || !Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > 60_000) {
      throw new Error('Artifact download registration is invalid');
    }
    const ownerLeaseCount = [...this.leases.values()].filter(
      lease => lease.traceId === traceId && lease.helperPid === helperPid,
    ).length;
    if (ownerLeaseCount >= MAX_TASK_ARTIFACT_LEASES
      || this.leases.size >= MAX_ACCOUNT_ARTIFACT_LEASES) {
      throw new Error('Artifact download lease capacity is full');
    }
    const artifactRoot = path.join(this.coreHome, 'artifacts');
    fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
    const rootInfo = fs.lstatSync(artifactRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Artifact root is not a real directory');
    const taskDirectory = path.join(artifactRoot, traceId);
    fs.mkdirSync(taskDirectory, { recursive: true, mode: 0o700 });
    const taskInfo = fs.lstatSync(taskDirectory);
    if (!taskInfo.isDirectory() || taskInfo.isSymbolicLink()) throw new Error('Artifact task directory is not a real directory');
    const partialPath = path.join(taskDirectory, `.network-${randomUUID()}.partial`);
    const registered = this.downloads.register({
      webContentsId: tab.view.webContents.id,
      traceId,
      assistantTurnId,
      expectedFilename,
      taskDirectory,
      partialPath,
      maxBytes,
      deadlineMs,
    });
    const lease = {
      leaseId: registered.leaseId,
      traceId,
      helperPid,
      surfaceId,
      assistantTurnId,
      expectedFilename,
      partialPath,
      released: false,
      settled: false,
      outcome: null,
    };
    lease.outcome = registered.completion.then(receipt => {
      lease.settled = true;
      if (lease.released) this.cleanupArtifactPartial(lease);
      return { receipt };
    }, error => {
      lease.settled = true;
      return { error: error instanceof Error ? error : new Error(String(error)) };
    });
    this.leases.set(lease.leaseId, lease);
    this.logger.info('browser.artifact_lease_registered', { traceId, leaseId: lease.leaseId });
    return { leaseId: lease.leaseId };
  }

  artifactLease(traceId, helperPid, surfaceId, leaseId) {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.traceId !== traceId || lease.helperPid !== helperPid || lease.surfaceId !== surfaceId) {
      throw new Error('Artifact download lease ownership mismatch');
    }
    return lease;
  }

  async waitArtifactDownload(traceId, helperPid, surfaceId, leaseId) {
    const owner = this.artifactOwner(traceId, helperPid, surfaceId);
    const lease = this.artifactLease(traceId, helperPid, surfaceId, leaseId);
    const outcome = await lease.outcome;
    if (outcome.error) throw outcome.error;
    // Completion can race turn release or a surface replacement. A receipt is valid
    // only while the exact registration and tab still belong to this caller.
    if (lease.released || this.leases.get(leaseId) !== lease
      || this.artifactOwner(traceId, helperPid, surfaceId) !== owner) {
      throw new Error('Artifact download lease was released before delivery');
    }
    this.logger.info('browser.artifact_lease_completed', {
      traceId,
      leaseId,
      receivedBytes: outcome.receipt.receivedBytes,
      downloadAuthority: outcome.receipt.downloadAuthority,
    });
    return { ...outcome.receipt, helperPid, surfaceId };
  }

  cleanupArtifactPartial(lease) {
    // This is the host-created path, never a helper-provided receipt or promoted artifact.
    try { fs.rmSync(lease.partialPath, { force: true }); }
    catch { this.logger.warn('browser.artifact_partial_cleanup_failed', { leaseId: lease.leaseId }); }
  }

  cancelArtifactDownload(traceId, helperPid, surfaceId, leaseId, reason) {
    const lease = this.artifactLease(traceId, helperPid, surfaceId, leaseId);
    lease.released = true;
    const cancelled = this.downloads.cancel(leaseId, new Error(reason || 'Artifact download cancelled'));
    if (!cancelled) this.cleanupArtifactPartial(lease);
    this.leases.delete(leaseId);
    return { cancelled };
  }

  releaseArtifactDownloads(traceId, helperPid, reason) {
    for (const [leaseId, lease] of this.leases) {
      if (lease.traceId !== traceId || lease.helperPid !== helperPid) continue;
      lease.released = true;
      if (!this.downloads.cancel(leaseId, reason)) this.cleanupArtifactPartial(lease);
      this.leases.delete(leaseId);
    }
  }

  dispose() {
    this.downloads.dispose();
    this.leases.clear();
  }
}

module.exports = { BrowserArtifactTransfers };
