const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { sha256 } = require('../electron/update-asset-hash.cjs');
const { createUpdateController, releaseAssetName } = require('../electron/update.cjs');

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-focused-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const body = Buffer.from('authenticated fixture bytes');
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  const name = releaseAssetName('1.2.0', 'win32', 'x64');
  const cache = path.join(root, 'update-downloads', `${digest}-${name}`);
  fs.mkdirSync(path.dirname(cache));
  fs.writeFileSync(cache, body);
  const owned = [];
  const mkdtemp = fs.mkdtempSync;
  t.mock.method(fs, 'mkdtempSync', (...args) => {
    const result = mkdtemp(...args);
    if (args[0].includes('codex-web-gpt-update-')) owned.push(result);
    return result;
  });
  t.after(() => owned.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
  let extracts = 0, handoffs = 0, validations = 0;
  const controller = createUpdateController({ currentVersion: '1.1.0', platform: 'win32', arch: 'x64',
    packaged: true, executablePath: path.join(root, 'app.exe'), runtimeExecutable: '/fixture/runtime',
    logsDirectory: path.join(root, 'logs'), dependencies: {
      fetchRelease: async () => ({ tag_name: 'v1.2.0', assets: [name, 'checksums.txt', 'release-metadata.json'].map(asset => ({
        name: asset, size: body.length, browser_download_url: `https://github.com/Froraut/NEKODEX/releases/download/v1.2.0/${asset}`,
      })) }),
      downloadText: async () => `${digest}  ${name}\n`,
      verifyReleaseMetadata: () => ({ assets: [{ name, size: body.length, sha256: digest }] }),
      downloadFile: () => assert.fail('valid cache must be retained'),
      extractWindows: async (_asset, stage, options) => {
        extracts++;
        fs.mkdirSync(stage);
        if (overrides.extract) await overrides.extract(stage, options);
      },
      validateStagedApplication: (stage, job) => {
        validations++;
        assert.equal(fs.existsSync(stage), true);
        assert.equal(job.version, '1.2.0');
      },
      spawnWorker: async (_runtime, worker, jobPath) => {
        handoffs++;
        assert.equal(validations, 1);
        assert.equal(fs.existsSync(worker), true);
        assert.equal(JSON.parse(fs.readFileSync(jobPath)).version, '1.2.0');
        return { pid: 123, unref() {} };
      },
      ...(overrides.sha256 ? { sha256: overrides.sha256 } : {}),
    } });
  return { controller, cache, owned, body, counts: () => ({ extracts, handoffs }) };
}

test('matching cache and copied digests reach validated worker handoff exactly once', { timeout: 5000 }, async t => {
  const hashed = [];
  const f = fixture(t, { sha256: async (file, options) => { hashed.push(file); return sha256(file, options); } });
  await f.controller.checkOnce();
  const launch = await f.controller.beginInstall();
  assert.deepEqual(f.counts(), { extracts: 1, handoffs: 1 });
  assert.equal(hashed.length, 2);
  assert.equal(hashed[0], f.cache);
  assert.equal(path.dirname(hashed[1]), launch.tempRoot);
  assert.equal(fs.existsSync(launch.tempRoot), true);
  assert.deepEqual(fs.readFileSync(f.cache), f.body);
});

for (const boundary of ['cache', 'copy']) {
  test(`cancel during ${boundary} hashing yields, disposes stream and cleans owned staging`, { timeout: 5000 }, async t => {
    let started;
    const reached = new Promise(resolve => { started = resolve; });
    let stream, calls = 0;
    const f = fixture(t, { sha256: (file, options) => {
      calls++;
      if (calls !== (boundary === 'cache' ? 1 : 2)) return sha256(file, options);
      stream = new Readable({ read() {
        if (this.supplied) return;
        this.supplied = true;
        this.push(Buffer.from('first chunk'));
        started(); // Remaining bytes and EOF are deliberately never supplied.
      } });
      return sha256(file, { ...options, createReadStream: () => stream });
    } });
    await f.controller.checkOnce();
    const installing = f.controller.beginInstall();
    const rejected = assert.rejects(installing, { code: 'UPDATE_PREPARATION_CANCELLED' });
    await reached;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await f.controller.cancelPreparation()).status, 'cancelled');
    await rejected;
    assert.equal(stream.destroyed, true);
    assert.equal(f.owned.length, 1);
    assert.equal(fs.existsSync(f.owned[0]), false);
    assert.deepEqual(f.counts(), { extracts: 0, handoffs: 0 });
    assert.deepEqual(fs.readFileSync(f.cache), f.body);
  });
}

for (const boundary of ['cache', 'copy']) {
  test(`mismatching ${boundary} digest fails before extraction`, { timeout: 5000 }, async t => {
    let calls = 0;
    const f = fixture(t, { sha256: async (file, options) => {
      calls++;
      if (boundary === 'copy' && calls === 2) fs.writeFileSync(file, 'damaged copy');
      return sha256(file, options);
    } });
    if (boundary === 'cache') fs.writeFileSync(f.cache, 'damaged cache');
    await f.controller.checkOnce();
    await assert.rejects(f.controller.beginInstall(), boundary === 'cache' ? /Cached update checksum mismatch/ : /SHA-256 verification failed/);
    assert.equal(calls, boundary === 'cache' ? 1 : 2);
    assert.deepEqual(f.counts(), { extracts: 0, handoffs: 0 });
    assert.equal(fs.existsSync(f.owned[0]), false);
    assert.equal(fs.existsSync(f.cache), boundary === 'copy');
  });
}

test('unproven extractor exit preserves staging and reports failed cancellation', { timeout: 5000 }, async t => {
  let started;
  const reached = new Promise(resolve => { started = resolve; });
  const f = fixture(t, { extract: async (_stage, { signal }) => {
    started();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(
      new Error('fixture extractor exit unproven'), { code: 'UPDATE_EXTRACTION_EXIT_UNPROVEN', preserveStaging: true },
    )), { once: true }));
  } });
  await f.controller.checkOnce();
  const rejected = assert.rejects(f.controller.beginInstall(), error => {
    assert.equal(error.code, 'UPDATE_PREPARATION_CLEANUP_FAILED');
    assert.equal(error.cause.code, 'UPDATE_EXTRACTION_EXIT_UNPROVEN');
    return true;
  });
  await reached;
  assert.equal((await f.controller.cancelPreparation()).status, 'failed');
  await rejected;
  assert.deepEqual(f.counts(), { extracts: 1, handoffs: 0 });
  assert.equal(fs.existsSync(path.join(f.owned[0], 'stage')), true);
  assert.deepEqual(fs.readFileSync(f.cache), f.body);
  assert.equal(f.controller.getState().status, 'error');
});

test('cleanup failure after hashing cancellation cannot report successful cancellation', { timeout: 5000 }, async t => {
  let started;
  const reached = new Promise(resolve => { started = resolve; });
  const f = fixture(t, { sha256: (file, options) => sha256(file, { ...options,
    createReadStream: () => new Readable({ read() { started(); } }),
  }) });
  await f.controller.checkOnce();
  const rejected = assert.rejects(f.controller.beginInstall(), error => {
    assert.equal(error.code, 'UPDATE_PREPARATION_CLEANUP_FAILED');
    assert.equal(error.cause.code, 'EACCES');
    return true;
  });
  await reached;
  const remove = fs.rmSync;
  let attempts = 0;
  const mock = t.mock.method(fs, 'rmSync', (target, options) => {
    if (target === f.owned[0]) {
      attempts++;
      throw Object.assign(new Error('fixture cleanup denied'), { code: 'EACCES' });
    }
    return remove(target, options);
  });
  try {
    assert.equal((await f.controller.cancelPreparation()).status, 'failed');
    await rejected;
    assert.equal(attempts, 1);
    assert.equal(fs.existsSync(f.owned[0]), true);
    assert.deepEqual(f.counts(), { extracts: 0, handoffs: 0 });
  } finally { mock.mock.restore(); }
});
