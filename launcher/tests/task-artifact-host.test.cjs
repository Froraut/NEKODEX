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
    'cancelArtifactDownload', 'releaseArtifactDownloads', 'cleanupArtifactPartial',
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

test('completed guard transfer cleanup covers cancel, release, settlement race and preserves promotion', async t => {
  const { EventEmitter } = require('node:events');
  const { createTaskArtifactDownloadGuard } = require('../electron/task-artifact-download.cjs');
  for (const action of ['cancel', 'release', 'race', 'promoted', 'active']) {
    const coreHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-artifact-completed-'));
    t.after(() => fs.rmSync(coreHome, { recursive: true, force: true }));
    const session = new EventEmitter();
    const guard = createTaskArtifactDownloadGuard(session);
    t.after(() => guard.dispose());
    const tab = { traceId: 'trace_download', helperPid: 123, surfaceId: 'surface', status: 'running',
      interactionMode: 'automatic', view: { webContents: { id: 77, isDestroyed: () => false } } };
    const host = Object.assign(Object.create(BrowserHost.prototype), {
      coreHome, logger: { info() {}, warn() {} }, turnTabs: new Map([['tab', tab]]), artifactLeases: new Map(), artifactDownloads: guard,
    });
    const { leaseId } = host.registerArtifactDownload(tab.traceId, 123, 'surface', 'assistant', 'result.csv', 100, 1000);
    const item = Object.assign(new EventEmitter(), {
      getFilename: () => 'result.csv', getURL: () => 'https://chatgpt.com/file', getTotalBytes: () => 4,
      getReceivedBytes: () => 4, setSavePath(value) { this.savePath = value; },
      cancel() { this.cancelled = true; },
    });
    session.emit('will-download', {}, item, tab.view.webContents);
    assert.ok(item.savePath);
    fs.writeFileSync(item.savePath, 'a,b\n');
    const outcome = host.artifactLeases.get(leaseId).outcome;
    if (action !== 'active') {
      item.emit('done', {}, 'completed');
      assert.equal(guard.has(leaseId), false);
      if (action !== 'race') {
        const receipt = await host.waitArtifactDownload(tab.traceId, 123, 'surface', leaseId);
        assert.equal(receipt.receivedBytes, 4);
      } else assert.equal(host.artifactLeases.get(leaseId).settled, false);
    }
    const promoted = path.join(path.dirname(item.savePath), 'final.csv');
    if (action === 'promoted') fs.renameSync(item.savePath, promoted);
    if (action === 'cancel') host.cancelArtifactDownload(tab.traceId, 123, 'surface', leaseId);
    else host.releaseArtifactDownloads(tab.traceId, 123, new Error('turn ended'));
    if (action === 'active') {
      assert.equal(item.cancelled, true);
      // The real guard retains its async done cleanup after host ownership has gone.
      fs.writeFileSync(item.savePath, 'late');
      item.emit('done', {}, 'cancelled');
    }
    const result = await outcome;
    if (action !== 'active') assert.equal(result.receipt.receivedBytes, 4);
    assert.equal(host.artifactLeases.size, 0);
    assert.equal(fs.existsSync(item.savePath), false);
    if (action === 'promoted') assert.equal(fs.readFileSync(promoted, 'utf8'), 'a,b\n');
  }
});
