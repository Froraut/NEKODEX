'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { BrowserHost } = require('../electron/browser-host.cjs');

test('browser host computes artifact paths and enforces exact active turn ownership', async () => {
  const coreHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-artifact-host-'));
  const surfaceId = 'T'.repeat(32);
  const tab = {
    traceId: 'trace_host_123',
    helperPid: 4321,
    surfaceId,
    status: 'running',
    interactionMode: 'automatic',
    view: { webContents: { id: 77, isDestroyed: () => false } },
  };
  let registered;
  let cancelled;
  const host = {
    coreHome,
    logger: { info() {}, warn() {} },
    turnTabs: new Map([['tab-1', tab]]),
    artifactLeases: new Map(),
    artifactDownloads: {
      register(input) {
        registered = input;
        return {
          leaseId: 'artifact_' + 'b'.repeat(32),
          completion: Promise.resolve({
            leaseId: 'artifact_' + 'b'.repeat(32),
            traceId: input.traceId,
            assistantTurnId: input.assistantTurnId,
            filename: input.expectedFilename,
            partialPath: input.partialPath,
            receivedBytes: 12,
            downloadAuthority: 'chatgpt.com',
          }),
        };
      },
      cancel(id, error) { cancelled = { id, error }; return true; },
    },
  };
  for (const name of [
    'artifactOwner', 'registerArtifactDownload', 'artifactLease', 'waitArtifactDownload',
    'cancelArtifactDownload', 'releaseArtifactDownloads',
  ]) host[name] = BrowserHost.prototype[name];

  try {
    const lease = host.registerArtifactDownload(
      tab.traceId, tab.helperPid, tab.surfaceId, 'assistant-turn-1', 'result.csv', 50_000_000, 60_000,
    );
    const taskDirectory = path.join(coreHome, 'artifacts', tab.traceId);
    assert.equal(registered.webContentsId, 77);
    assert.equal(registered.taskDirectory, taskDirectory);
    assert.equal(path.dirname(registered.partialPath), taskDirectory);
    assert.match(path.basename(registered.partialPath), /^\.network-[0-9a-f-]{36}\.partial$/);

    const receipt = await host.waitArtifactDownload(tab.traceId, tab.helperPid, tab.surfaceId, lease.leaseId);
    assert.equal(receipt.partialPath, registered.partialPath);
    assert.equal(receipt.helperPid, tab.helperPid);
    assert.equal(receipt.surfaceId, tab.surfaceId);

    assert.throws(() => host.registerArtifactDownload(
      tab.traceId, tab.helperPid, 'W'.repeat(32), 'assistant-turn-1', 'result.csv', 10, 10,
    ), /owner/);

    const second = host.registerArtifactDownload(
      tab.traceId, tab.helperPid, tab.surfaceId, 'assistant-turn-2', 'second.csv', 10, 10,
    );
    const result = host.cancelArtifactDownload(
      tab.traceId, tab.helperPid, tab.surfaceId, second.leaseId, 'bounded test cleanup',
    );
    assert.equal(result.cancelled, true);
    assert.equal(cancelled.id, second.leaseId);
    assert.match(cancelled.error.message, /bounded test cleanup/);
  } finally {
    fs.rmSync(coreHome, { recursive: true, force: true });
  }
});
