const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { downloadAuthenticatedAsset } = require('../electron/resumable-download.cjs');
const { setupIdentity, preserveSetup, SETUP_CONTRACT } = require('../electron/upgrade-readiness.cjs');

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
