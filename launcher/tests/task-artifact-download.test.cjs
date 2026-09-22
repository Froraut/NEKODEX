'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createTaskArtifactDownloadGuard } = require('../electron/task-artifact-download.cjs');

class FakeDownload extends EventEmitter {
  constructor(filename, url, totalBytes) {
    super();
    this.filename = filename;
    this.url = url;
    this.totalBytes = totalBytes;
    this.receivedBytes = 0;
    this.cancelled = false;
  }
  getFilename() { return this.filename; }
  getURL() { return this.url; }
  getTotalBytes() { return this.totalBytes; }
  getReceivedBytes() { return this.receivedBytes; }
  setSavePath(value) { this.savePath = value; }
  cancel() { this.cancelled = true; }
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-artifact-guard-'));
  const taskDirectory = path.join(root, 'task');
  fs.mkdirSync(taskDirectory, { mode: 0o700 });
  return { root, taskDirectory, partialPath: path.join(taskDirectory, '.result.csv.partial') };
}

for (const scenario of [
  { name: 'advertised bytes exceed the limit', url: 'https://chatgpt.com/result.csv', bytes: 11, error: /byte limit/ },
  { name: 'URL is untrusted', url: 'https://example.com/result.csv', bytes: 1, error: /not trusted/ },
  { name: 'save path setup fails', url: 'https://chatgpt.com/result.csv', bytes: 1, error: /save path failed/, failSave: true },
]) {
  test(`early artifact rejection settles and releases ownership when ${scenario.name}`, { timeout: 1000 }, async () => {
    const session = new EventEmitter();
    const paths = fixture();
    const guard = createTaskArtifactDownloadGuard(session);
    try {
      const lease = guard.register({
        webContentsId: 42, traceId: 'trace_early_reject', assistantTurnId: 'assistant-turn',
        expectedFilename: 'result.csv', taskDirectory: paths.taskDirectory, partialPath: paths.partialPath,
        maxBytes: 10,
      });
      const observed = lease.completion.then(() => assert.fail('rejected artifact resolved'), error => error);
      const item = new FakeDownload('result.csv', scenario.url, scenario.bytes);
      if (scenario.failSave) item.setSavePath = () => { throw new Error('save path failed'); };
      assert.doesNotThrow(() => session.emit('will-download', {}, item, { id: 42 }));
      assert.equal(item.cancelled, true);
      assert.equal(guard.has(lease.leaseId), false);
      assert.match((await observed).message, scenario.error);
      assert.equal(guard.cancel(lease.leaseId), false);
      fs.writeFileSync(paths.partialPath, 'late partial data');
      item.emit('done', {}, 'cancelled');
      assert.equal(fs.existsSync(paths.partialPath), false);
    } finally {
      guard.dispose();
      fs.rmSync(paths.root, { recursive: true, force: true });
    }
  });
}

test('task artifact guard bounds matching DownloadItem bytes and leaves unrelated downloads untouched', async () => {
  const session = new EventEmitter();
  const paths = fixture();
  const guard = createTaskArtifactDownloadGuard(session);
  try {
    const lease = guard.register({
      webContentsId: 42,
      traceId: 'trace_guard_123',
      assistantTurnId: 'assistant-turn-1',
      expectedFilename: 'result.csv',
      taskDirectory: paths.taskDirectory,
      partialPath: paths.partialPath,
      maxBytes: 10,
    });
    const unrelated = new FakeDownload('other.csv', 'https://example.com/other.csv', 1000);
    session.emit('will-download', {}, unrelated, { id: 42 });
    assert.equal(unrelated.cancelled, false);
    assert.equal(unrelated.savePath, undefined);

    const item = new FakeDownload('result.csv', 'https://chatgpt.com/backend-api/files/result.csv', 8);
    session.emit('will-download', {}, item, { id: 42 });
    assert.equal(item.savePath, paths.partialPath);
    item.receivedBytes = 8;
    item.emit('updated', {}, 'progressing');
    item.emit('done', {}, 'completed');
    assert.deepEqual(await lease.completion, {
      leaseId: lease.leaseId,
      traceId: 'trace_guard_123',
      assistantTurnId: 'assistant-turn-1',
      filename: 'result.csv',
      partialPath: paths.partialPath,
      receivedBytes: 8,
      downloadAuthority: 'chatgpt.com',
    });
  } finally {
    guard.dispose();
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});

test('task artifact guard cancels an owned transfer as soon as received bytes exceed its lease', async () => {
  const session = new EventEmitter();
  const paths = fixture();
  const guard = createTaskArtifactDownloadGuard(session);
  try {
    const lease = guard.register({
      webContentsId: 7,
      traceId: 'trace_guard_456',
      assistantTurnId: 'assistant-turn-2',
      expectedFilename: 'result.csv',
      taskDirectory: paths.taskDirectory,
      partialPath: paths.partialPath,
      maxBytes: 4,
    });
    const observed = lease.completion.then(() => undefined, error => error);
    const item = new FakeDownload('result.csv', 'https://files.oaiusercontent.com/result.csv', 0);
    session.emit('will-download', {}, item, { id: 7 });
    item.receivedBytes = 5;
    item.emit('updated', {}, 'progressing');
    assert.equal(item.cancelled, true);
    assert.match((await observed).message, /network transfer exceeds/);
  } finally {
    guard.dispose();
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});

test('task artifact guard deadline cancels an owned transfer that stops making progress', async () => {
  const session = new EventEmitter();
  const paths = fixture();
  const guard = createTaskArtifactDownloadGuard(session);
  try {
    const lease = guard.register({
      webContentsId: 9,
      traceId: 'trace_guard_789',
      assistantTurnId: 'assistant-turn-3',
      expectedFilename: 'result.csv',
      taskDirectory: paths.taskDirectory,
      partialPath: paths.partialPath,
      deadlineMs: 10,
    });
    const observed = lease.completion.then(() => undefined, error => error);
    const item = new FakeDownload('result.csv', 'blob:https://chatgpt.com/owned-download', 0);
    session.emit('will-download', {}, item, { id: 9 });
    assert.match((await observed).message, /exceeded its deadline/);
    assert.equal(item.cancelled, true);
  } finally {
    guard.dispose();
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});

test('terminal artifact failures remove partial bytes without waiting for another done event', async () => {
  const session = new EventEmitter();
  const paths = fixture();
  const guard = createTaskArtifactDownloadGuard(session);
  try {
    for (const [state, received] of [['interrupted', 3], ['completed', 0], ['completed', NaN]]) {
      const lease = guard.register({
        webContentsId: 42, traceId: 'trace_terminal_failure', assistantTurnId: 'assistant-turn',
        expectedFilename: 'result.csv', taskDirectory: paths.taskDirectory, partialPath: paths.partialPath,
      });
      const observed = lease.completion.then(() => null, error => error);
      const item = new FakeDownload('result.csv', 'https://chatgpt.com/result.csv', 0);
      session.emit('will-download', {}, item, { id: 42 });
      fs.writeFileSync(paths.partialPath, 'partial bytes');
      item.receivedBytes = received;
      item.emit('done', {}, state);
      assert.ok(await observed instanceof Error);
      assert.equal(fs.existsSync(paths.partialPath), false);
      assert.equal(guard.has(lease.leaseId), false);
      assert.equal(item.cancelled, false, 'terminal downloads must not be cancelled again');
      assert.equal(item.listenerCount('done'), 0);
      assert.equal(item.listenerCount('updated'), 0);
    }
  } finally {
    guard.dispose();
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});

test('artifact cancellation settles before a synchronous terminal notification', async () => {
  const session = new EventEmitter();
  const paths = fixture();
  const guard = createTaskArtifactDownloadGuard(session);
  try {
    const lease = guard.register({
      webContentsId: 42, traceId: 'trace_sync_cancel', assistantTurnId: 'assistant-turn',
      expectedFilename: 'result.csv', taskDirectory: paths.taskDirectory, partialPath: paths.partialPath,
    });
    const observed = lease.completion.then(() => null, error => error);
    const item = new FakeDownload('result.csv', 'https://chatgpt.com/result.csv', 0);
    let cancellations = 0;
    item.cancel = () => {
      cancellations += 1;
      assert.equal(guard.has(lease.leaseId), false);
      fs.writeFileSync(paths.partialPath, 'late partial bytes');
      item.emit('done', {}, 'cancelled');
    };
    session.emit('will-download', {}, item, { id: 42 });
    const reason = new Error('owner cancelled');
    assert.equal(guard.cancel(lease.leaseId, reason), true);
    assert.equal(await observed, reason);
    assert.equal(cancellations, 1);
    assert.equal(fs.existsSync(paths.partialPath), false);
    assert.equal(item.listenerCount('done'), 0);
  } finally {
    guard.dispose();
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});

test('canonical filenames claim only the matching owner and complete with the canonical receipt', { timeout: 1000 }, async () => {
  const session = new EventEmitter();
  const paths = fixture();
  const guard = createTaskArtifactDownloadGuard(session);
  try {
    const lease = guard.register({
      webContentsId: 42, traceId: 'trace_canonical', assistantTurnId: 'assistant-turn',
      expectedFilename: '1.csv', taskDirectory: paths.taskDirectory, partialPath: paths.partialPath,
    });
    // Observe rejection even if a preceding assertion fails and finally disposes the lease.
    lease.completion.catch(() => {});
    for (const [name, owner] of [['①.csv', 43], ['other.csv', 42], ['../1.csv', 42], ['／1.csv', 42], ['a\\1.csv', 42], ['1\u0000.csv', 42]]) {
      const unrelated = new FakeDownload(name, 'https://chatgpt.com/file', 4);
      session.emit('will-download', {}, unrelated, { id: owner });
      assert.equal(unrelated.savePath, undefined, `${name} on ${owner} must not acquire ownership`);
      assert.equal(unrelated.cancelled, false);
    }
    const item = new FakeDownload(' ①.csv ', 'https://chatgpt.com/file', 4);
    session.emit('will-download', {}, item, { id: 42 });
    assert.equal(item.savePath, paths.partialPath);
    fs.writeFileSync(item.savePath, 'a,b\n');
    item.receivedBytes = 4;
    item.emit('done', {}, 'completed');
    const receipt = await lease.completion;
    assert.equal(receipt.filename, '1.csv');
    assert.equal(receipt.partialPath, paths.partialPath);
    assert.equal(receipt.receivedBytes, 4);
    assert.equal(fs.readFileSync(receipt.partialPath, 'utf8'), 'a,b\n');
    assert.equal(guard.has(lease.leaseId), false);
  } finally {
    guard.dispose();
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});

test('canonical filename collisions are rejected within one owner while separate owners stay isolated', { timeout: 1000 }, async () => {
  const session = new EventEmitter();
  const paths = fixture();
  const guard = createTaskArtifactDownloadGuard(session);
  try {
    const input = {
      webContentsId: 42, traceId: 'trace_collision', assistantTurnId: 'assistant-turn',
      expectedFilename: '①.csv', taskDirectory: paths.taskDirectory, partialPath: paths.partialPath,
    };
    const first = guard.register(input);
    first.completion.catch(() => {});
    assert.throws(() => guard.register({ ...input, expectedFilename: '1.csv',
      partialPath: path.join(paths.taskDirectory, '.duplicate.partial') }), /already owns/);
    const secondPath = path.join(paths.taskDirectory, '.second.partial');
    const second = guard.register({ ...input, webContentsId: 43, expectedFilename: '1.csv', partialPath: secondPath });
    second.completion.catch(() => {});
    const item = new FakeDownload('①.csv', 'https://chatgpt.com/file', 4);
    session.emit('will-download', {}, item, { id: 43 });
    assert.equal(item.savePath, secondPath);
    assert.equal(guard.has(first.leaseId), true);
    item.receivedBytes = 4;
    item.emit('done', {}, 'completed');
    assert.equal((await second.completion).filename, '1.csv');
    const firstItem = new FakeDownload('1.csv', 'https://chatgpt.com/file', 4);
    session.emit('will-download', {}, firstItem, { id: 42 });
    assert.equal(firstItem.savePath, paths.partialPath);
    firstItem.receivedBytes = 4;
    firstItem.emit('done', {}, 'completed');
    assert.equal((await first.completion).filename, '1.csv');
  } finally {
    guard.dispose();
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});

test('canonical lease names reject unsafe paths and invalid normalized filenames', { timeout: 1000 }, () => {
  const session = new EventEmitter();
  const paths = fixture();
  const guard = createTaskArtifactDownloadGuard(session);
  try {
    for (const expectedFilename of ['../1.csv', '／1.csv', 'a\\1.csv', '1\u0000.csv', '  ', '．．', 'x'.repeat(161)]) {
      assert.throws(() => guard.register({
        webContentsId: 42, traceId: 'trace_invalid', assistantTurnId: 'assistant-turn',
        expectedFilename, taskDirectory: paths.taskDirectory, partialPath: paths.partialPath,
      }), /filename/);
    }
  } finally {
    guard.dispose();
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});
