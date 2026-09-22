const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, PassThrough } = require('node:stream');
const { downloadAuthenticatedAsset } = require('../electron/resumable-download.cjs');
const { setupIdentity, preserveSetup, SETUP_CONTRACT } = require('../electron/upgrade-readiness.cjs');

async function waitForPartial(dest, expected) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const size = await fs.promises.stat(dest + '.part').then(stat => stat.size, () => -1);
    if (size === expected) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(`download did not write ${expected} bytes to the partial`);
}

test('download telemetry expires without extending the actual idle deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgw-freshness-idle-'));
  const dest = path.join(dir, 'asset.zip');
  const payload = Buffer.from('authenticated payload');
  const response = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
  const progress = [];
  let requested = false;
  const download = downloadAuthenticatedAsset('https://github.com/a/b', dest, {
    expectedBytes: payload.length, expectedSha256: crypto.createHash('sha256').update(payload).digest('hex'),
    onProgress: value => progress.push(value),
    requestDownload: async () => { requested = true; return response; },
  });
  const rejected = assert.rejects(download, /made no progress; partial retained for retry/);
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requested, true);
    t.mock.timers.tick(200);
    response.write(payload.subarray(0, 8));
    await waitForPartial(dest, 8); // Real response, transform and disk write reached before stalling.
    assert.equal(progress.at(-1).downloadedBytes, 8);
    assert.ok(progress.at(-1).bytesPerSecond > 0);
    t.mock.timers.tick(2_999);
    assert.ok(progress.at(-1).bytesPerSecond > 0);
    t.mock.timers.tick(1);
    assert.deepEqual(progress.at(-1), { downloadedBytes: 8, totalBytes: payload.length,
      bytesPerSecond: 0, remainingSeconds: null });
    t.mock.timers.tick(56_999);
    assert.equal(response.destroyed, false);
    t.mock.timers.tick(1); // Exactly 60 seconds since the chunk, not since freshness publication.
    await rejected;
    assert.equal(fs.statSync(dest + '.part').size, 8);
    const count = progress.length;
    t.mock.timers.tick(60_000);
    assert.equal(progress.length, count);
  } finally {
    response.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('download telemetry resumes after inactivity and stays quiet through hashing and completion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgw-freshness-resume-'));
  const dest = path.join(dir, 'asset.zip');
  const payload = Buffer.from('authenticated payload');
  const response = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
  const hashRead = new PassThrough();
  const progress = [];
  let hashEntered;
  const hashing = new Promise(resolve => { hashEntered = resolve; });
  const download = downloadAuthenticatedAsset('https://github.com/a/b', dest, {
    expectedBytes: payload.length, expectedSha256: crypto.createHash('sha256').update(payload).digest('hex'),
    onProgress: value => progress.push(value), requestDownload: async () => response,
    createReadStream: file => { assert.deepEqual(fs.readFileSync(file), payload); hashEntered(); return hashRead; },
  });
  try {
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(200);
    response.write(payload.subarray(0, 8));
    await waitForPartial(dest, 8);
    t.mock.timers.tick(3_000);
    assert.equal(progress.at(-1).bytesPerSecond, 0);
    response.write(payload.subarray(8, 12));
    await waitForPartial(dest, 12);
    assert.equal(progress.at(-1).downloadedBytes, 12);
    assert.ok(progress.at(-1).bytesPerSecond > 0);
    assert.ok(progress.at(-1).remainingSeconds > 0);
    response.end(payload.subarray(12));
    await hashing;
    const duringHash = progress.length;
    t.mock.timers.tick(60_001);
    assert.equal(progress.length, duringHash);
    hashRead.end(payload);
    await download;
    assert.deepEqual(fs.readFileSync(dest), payload);
    const completed = progress.length;
    t.mock.timers.tick(60_001);
    assert.equal(progress.length, completed);
  } finally {
    response.destroy(); hashRead.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('download telemetry timer is cleared on cancellation and stream error', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  for (const mode of ['cancel', 'error']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgw-freshness-stop-'));
    const dest = path.join(dir, 'asset.zip');
    const response = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
    const controller = new AbortController();
    const progress = [];
    const download = downloadAuthenticatedAsset('https://github.com/a/b', dest, {
      expectedBytes: 20, expectedSha256: 'a'.repeat(64), signal: controller.signal,
      onProgress: value => progress.push(value), requestDownload: async () => response,
    });
    const rejected = assert.rejects(download, /fixture stop/);
    try {
      await new Promise(resolve => setImmediate(resolve));
      t.mock.timers.tick(200);
      response.write(Buffer.from('partial'));
      await waitForPartial(dest, 7);
      assert.ok(progress.at(-1).bytesPerSecond > 0);
      if (mode === 'cancel') controller.abort(new Error('fixture stop'));
      else response.destroy(new Error('fixture stop'));
      await rejected;
      const count = progress.length;
      t.mock.timers.tick(60_001);
      assert.equal(progress.length, count);
      assert.equal(fs.statSync(dest + '.part').size, 7);
    } finally { response.destroy(); fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('signed partial resumes exact range and publishes progress', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgw-range-'));
  const dest = path.join(dir, 'asset.zip');
  const payload = Buffer.from('authenticated release bytes');
  const expectedSha256 = crypto.createHash('sha256').update(payload).digest('hex');
  const url = 'https://github.com/Froraut/NEKODEX/releases/download/v1/a.zip';
  const expectedBytes = payload.length;
  fs.writeFileSync(dest + '.part', payload.subarray(0, 7));
  fs.writeFileSync(dest + '.identity.json', JSON.stringify({ url, expectedBytes, expectedSha256 }));
  const progress = [];
  try {
    await downloadAuthenticatedAsset(url, dest, { expectedBytes, expectedSha256,
      onProgress: value => progress.push(value), requestDownload: async (_url, _redirects, options) => {
        assert.equal(options.headers.Range, 'bytes=7-');
        return Object.assign(Readable.from([payload.subarray(7)]), { statusCode: 206,
          headers: { 'content-range': `bytes 7-${expectedBytes - 1}/${expectedBytes}` } });
      } });
    assert.deepEqual(fs.readFileSync(dest), payload);
    assert.equal(progress.at(-1).downloadedBytes, expectedBytes);
    assert.equal(fs.existsSync(dest + '.part'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('wrong signed download bytes never become an installable asset', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgw-range-reject-'));
  const dest = path.join(dir, 'asset.zip');
  try {
    await assert.rejects(downloadAuthenticatedAsset('https://github.com/a/b', dest, {
      expectedBytes: 3, expectedSha256: crypto.createHash('sha256').update('abc').digest('hex'),
      requestDownload: async () => Object.assign(Readable.from(['bad']), { statusCode: 200, headers: {} }),
    }), /SHA-256/);
    assert.equal(fs.existsSync(dest), false);
    assert.equal(fs.existsSync(dest + '.part'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('compatible upgrade keeps evidence only for matching account contract and route', () => {
  const before = { mode: 'full', port: 17841, appName: 'Codex Native4', releaseVersion: 'old' };
  const id = setupIdentity(before, 'account');
  const state = { setupContract: SETUP_CONTRACT, coreSetupComplete: true };
  assert.equal(preserveSetup(id, setupIdentity({ ...before, releaseVersion: 'new' }, 'account'), state, false), true);
  assert.equal(preserveSetup(id, setupIdentity(before, 'other'), state, false), false);
  assert.equal(preserveSetup(id, setupIdentity({ ...before, port: 1234 }, 'account'), state, false), false);
  assert.equal(preserveSetup(id, id, {}, false), false);
  assert.equal(preserveSetup(id, id, state, true), false);
});

test('interrupted update retains partial and a retry resumes it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgw-resume-'));
  const dest = path.join(dir, 'asset.zip'), bytes = Buffer.from('resume this signed payload');
  const opts = { expectedBytes: bytes.length, expectedSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  try {
    await assert.rejects(downloadAuthenticatedAsset('https://github.com/a/b', dest, { ...opts,
      requestDownload: async () => Object.assign(Readable.from((async function* () {
        yield bytes.subarray(0, 6);
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('connection interrupted');
      })()), { statusCode: 200, headers: {} }),
    }), /interrupted/);
    const offset = fs.statSync(dest + '.part').size;
    assert.equal(offset, 6);
    await downloadAuthenticatedAsset('https://github.com/a/b', dest, { ...opts,
      requestDownload: async (_url, _redirects, options) => {
        assert.equal(options.headers.Range, `bytes=${offset}-`);
        return Object.assign(Readable.from([bytes.subarray(offset)]), { statusCode: 206,
          headers: { 'content-range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}` } });
      } });
    assert.deepEqual(fs.readFileSync(dest), bytes);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ignored range replaces partial instead of appending full response', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgw-range-full-'));
  const dest = path.join(dir, 'asset.zip'), payload = Buffer.from('complete payload');
  const expectedBytes = payload.length, expectedSha256 = crypto.createHash('sha256').update(payload).digest('hex');
  const url = 'https://github.com/a/b';
  fs.writeFileSync(dest + '.part', payload.subarray(0, 4));
  fs.writeFileSync(dest + '.identity.json', JSON.stringify({ url, expectedBytes, expectedSha256 }));
  try {
    await downloadAuthenticatedAsset(url, dest, { expectedBytes, expectedSha256,
      requestDownload: async () => Object.assign(Readable.from([payload]), { statusCode: 200, headers: {} }) });
    assert.deepEqual(fs.readFileSync(dest), payload);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('network idle deadline stops after download while cancellation still covers hashing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgw-hash-deadline-'));
  const dest = path.join(dir, 'asset.zip'), payload = Buffer.from('already downloaded authenticated payload');
  const expectedBytes = payload.length, expectedSha256 = crypto.createHash('sha256').update(payload).digest('hex');
  const url = 'https://github.com/a/b';
  const slowRead = () => Readable.from((async function* () {
    await new Promise(resolve => setTimeout(resolve, 25));
    yield payload;
  })());
  try {
    fs.writeFileSync(dest + '.part', payload);
    fs.writeFileSync(dest + '.identity.json', JSON.stringify({ url, expectedBytes, expectedSha256 }));
    await downloadAuthenticatedAsset(url, dest, { expectedBytes, expectedSha256,
      idleTimeoutMs: 5, totalTimeoutMs: 200, createReadStream: slowRead,
      requestDownload: async () => { throw new Error('complete partial must not download'); } });
    assert.deepEqual(fs.readFileSync(dest), payload);

    fs.renameSync(dest, dest + '.part');
    fs.writeFileSync(dest + '.identity.json', JSON.stringify({ url, expectedBytes, expectedSha256 }));
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('cancel hash')), 5);
    await assert.rejects(downloadAuthenticatedAsset(url, dest, { expectedBytes, expectedSha256,
      idleTimeoutMs: 100, totalTimeoutMs: 200, createReadStream: slowRead, signal: controller.signal,
      requestDownload: async () => { throw new Error('complete partial must not download'); } }), /cancel hash/);
    assert.equal(fs.existsSync(dest + '.part'), true);

    const stalledRead = () => new Readable({ read() {} });
    await assert.rejects(downloadAuthenticatedAsset(url, dest, { expectedBytes, expectedSha256,
      idleTimeoutMs: 100, totalTimeoutMs: 5, createReadStream: stalledRead,
      requestDownload: async () => { throw new Error('complete partial must not download'); } }), /overall time limit/);
    assert.equal(fs.existsSync(dest + '.part'), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
