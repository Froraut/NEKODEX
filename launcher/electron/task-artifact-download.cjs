'use strict';

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_BYTES = 50_000_000;
const DEFAULT_DEADLINE_MS = 60_000;

function downloadAuthority(raw) {
  if (typeof raw !== 'string' || !raw) throw new Error('Artifact download has no authoritative URL');
  if (raw.startsWith('sandbox:/')) return 'chatgpt-sandbox';
  if (raw.startsWith('blob:https://chatgpt.com/')) return 'chatgpt-blob';
  let url;
  try { url = new URL(raw); } catch { throw new Error('Artifact download URL is invalid'); }
  if (url.protocol !== 'https:') throw new Error(`Artifact download scheme ${JSON.stringify(url.protocol)} is unsupported`);
  if (url.hostname === 'chatgpt.com') return 'chatgpt.com';
  if (url.hostname === 'oaiusercontent.com' || url.hostname.endsWith('.oaiusercontent.com')) return 'oaiusercontent.com';
  throw new Error(`Artifact download origin ${JSON.stringify(url.origin)} is not trusted`);
}

function createTaskArtifactDownloadGuard(session, options = {}) {
  if (!session || typeof session.on !== 'function' || typeof session.removeListener !== 'function') {
    throw new Error('Artifact download guard requires one Electron Session');
  }
  const defaultMaxBytes = Math.min(DEFAULT_MAX_BYTES, options.maxBytes ?? DEFAULT_MAX_BYTES);
  const defaultDeadlineMs = Math.min(DEFAULT_DEADLINE_MS, options.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const report = (event, detail) => {
    try { options.onEvent?.(event, detail); } catch { /* diagnostics cannot affect ownership */ }
  };
  const leases = new Map();
  let disposed = false;

  const settle = (lease, error, receipt) => {
    if (lease.settled) return;
    lease.settled = true;
    clearTimeout(lease.timer);
    lease.item?.removeListener('updated', lease.onUpdated);
    lease.item?.removeListener('done', lease.onDone);
    leases.delete(lease.id);
    if (error) lease.reject(error);
    else lease.resolve(receipt);
  };

  const removePartial = lease => {
    try { fs.rmSync(lease.partialPath, { force: true }); } catch { /* task cleanup is best effort */ }
  };

  const cancel = (lease, error) => {
    if (lease.settled) return;
    if (lease.item) {
      lease.item.once('done', () => removePartial(lease));
      try { lease.item.cancel(); } catch { removePartial(lease); }
    } else removePartial(lease);
    const message = error instanceof Error ? error.message : String(error);
    const code = /byte limit/.test(message) ? 'size-limit'
      : /deadline/.test(message) ? 'deadline'
      : /interrupted/.test(message) ? 'interrupted'
      : /origin|scheme|URL/.test(message) ? 'authority'
      : 'cancelled';
    report('cancelled', { leaseId: lease.id, traceId: lease.traceId, code });
    settle(lease, error);
  };

  const onWillDownload = (_event, item, webContents) => {
    if (disposed || !item || !webContents) return;
    const filename = item.getFilename?.();
    const candidates = [...leases.values()].filter(lease => !lease.claimed
      && lease.webContentsId === webContents.id && lease.expectedFilename === filename);
    if (candidates.length === 0) return; // unrelated user/workspace download remains untouched
    if (candidates.length !== 1) {
      for (const lease of candidates) cancel(lease, new Error('Artifact download lease is ambiguous'));
      try { item.cancel(); } catch { /* no matching task can own it */ }
      return;
    }
    const lease = candidates[0];
    let authority;
    try {
      authority = downloadAuthority(item.getURL?.());
      const total = item.getTotalBytes?.() ?? 0;
      if (Number.isFinite(total) && total > lease.maxBytes) {
        throw new Error('Artifact network transfer exceeds its task-owned byte limit');
      }
      item.setSavePath(lease.partialPath);
    } catch (error) {
      lease.item = item;
      cancel(lease, error instanceof Error ? error : new Error(String(error)));
      return;
    }
    lease.claimed = true;
    lease.item = item;
    lease.authority = authority;
    report('claimed', { leaseId: lease.id, traceId: lease.traceId, authority });
    lease.onUpdated = (_updatedEvent, state) => {
      const received = item.getReceivedBytes?.() ?? 0;
      const total = item.getTotalBytes?.() ?? 0;
      if (received > lease.maxBytes || (Number.isFinite(total) && total > lease.maxBytes)) {
        cancel(lease, new Error('Artifact network transfer exceeds its task-owned byte limit'));
      } else if (state === 'interrupted') {
        cancel(lease, new Error('Artifact network transfer was interrupted'));
      }
    };
    lease.onDone = (_doneEvent, state) => {
      if (state !== 'completed') {
        cancel(lease, new Error(`Artifact network transfer ended with state ${JSON.stringify(state)}`));
        return;
      }
      const receivedBytes = item.getReceivedBytes?.() ?? 0;
      if (receivedBytes <= 0 || receivedBytes > lease.maxBytes) {
        cancel(lease, new Error('Artifact network transfer completed with an invalid byte count'));
        return;
      }
      settle(lease, undefined, {
        leaseId: lease.id,
        traceId: lease.traceId,
        assistantTurnId: lease.assistantTurnId,
        filename: lease.expectedFilename,
        partialPath: lease.partialPath,
        receivedBytes,
        downloadAuthority: lease.authority,
      });
      report('completed', { leaseId: lease.id, traceId: lease.traceId, receivedBytes });
    };
    item.on('updated', lease.onUpdated);
    item.once('done', lease.onDone);
  };

  session.on('will-download', onWillDownload);

  return {
    register(input) {
      if (disposed) throw new Error('Artifact download guard is disposed');
      if (!input || !Number.isInteger(input.webContentsId) || input.webContentsId <= 0
        || typeof input.traceId !== 'string' || !/^[A-Za-z0-9_-]{6,80}$/.test(input.traceId)
        || typeof input.assistantTurnId !== 'string' || !input.assistantTurnId
        || typeof input.expectedFilename !== 'string' || !input.expectedFilename
        || typeof input.taskDirectory !== 'string' || !path.isAbsolute(input.taskDirectory)
        || typeof input.partialPath !== 'string' || !path.isAbsolute(input.partialPath)
        || path.dirname(path.resolve(input.partialPath)) !== path.resolve(input.taskDirectory)
        || !path.basename(input.partialPath).endsWith('.partial')) {
        throw new Error('Artifact download lease is invalid');
      }
      const taskInfo = fs.lstatSync(input.taskDirectory);
      if (!taskInfo.isDirectory() || taskInfo.isSymbolicLink()
        || fs.realpathSync(path.dirname(input.partialPath)) !== fs.realpathSync(input.taskDirectory)
        || fs.existsSync(input.partialPath)) {
        throw new Error('Artifact download lease requires a real task-owned directory and a new partial path');
      }
      if ([...leases.values()].some(lease => lease.webContentsId === input.webContentsId
        && lease.expectedFilename === input.expectedFilename)) {
        throw new Error('Artifact download lease already owns this webContents and filename');
      }
      const maxBytes = Math.min(defaultMaxBytes, input.maxBytes ?? defaultMaxBytes);
      const deadlineMs = Math.min(defaultDeadlineMs, input.deadlineMs ?? defaultDeadlineMs);
      if (!Number.isFinite(maxBytes) || maxBytes <= 0 || !Number.isFinite(deadlineMs) || deadlineMs <= 0) {
        throw new Error('Artifact download lease limits are invalid');
      }
      let resolve;
      let reject;
      const completion = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      const lease = {
        id: `artifact_${randomUUID().replaceAll('-', '')}`,
        ...input,
        maxBytes,
        deadlineMs,
        completion,
        resolve,
        reject,
        claimed: false,
        settled: false,
      };
      lease.timer = setTimeout(() => cancel(lease, new Error('Artifact network transfer exceeded its deadline')), deadlineMs);
      leases.set(lease.id, lease);
      return { leaseId: lease.id, completion };
    },
    cancel(leaseId, reason = new Error('Artifact download lease was cancelled')) {
      const lease = leases.get(leaseId);
      if (!lease) return false;
      cancel(lease, reason instanceof Error ? reason : new Error(String(reason)));
      return true;
    },
    has(leaseId) { return leases.has(leaseId); },
    dispose() {
      if (disposed) return;
      disposed = true;
      session.removeListener('will-download', onWillDownload);
      for (const lease of [...leases.values()]) cancel(lease, new Error('Artifact download guard was disposed'));
    },
  };
}

module.exports = { createTaskArtifactDownloadGuard, downloadAuthority };
