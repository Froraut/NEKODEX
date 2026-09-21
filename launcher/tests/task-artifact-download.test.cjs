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
