const fs = require('node:fs');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// The cache key comes from authenticated release metadata, never a redirected URL.
async function downloadAuthenticatedAsset(url, destination, {
  expectedBytes, expectedSha256, requestDownload, onProgress,
  maxBytes = 1024 ** 3, idleTimeoutMs = 60_000, totalTimeoutMs = 60 * 60_000,
  signal, createReadStream = fs.createReadStream,
}) {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > 1024 ** 3
    || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 1024 ** 3
    || expectedBytes > maxBytes || !Number.isSafeInteger(totalTimeoutMs) || totalTimeoutMs <= 0
    || !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('Invalid authenticated download identity');
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Update download was cancelled');
  const partial = `${destination}.part`;
  const identityFile = `${destination}.identity.json`;
  const identity = JSON.stringify({ url, expectedBytes, expectedSha256 });
  for (const file of [destination, partial, identityFile]) {
    if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())) {
      throw new Error('Unsafe update cache entry');
    }
  }
  if (fs.existsSync(identityFile) && fs.readFileSync(identityFile, 'utf8') !== identity) {
    throw new Error('Update partial belongs to another signed asset');
  }
  if (!fs.existsSync(identityFile)) {
    if (fs.existsSync(partial)) throw new Error('Update partial has no authenticated identity');
    fs.writeFileSync(identityFile, identity, { mode: 0o600, flag: 'wx' });
  }
  let bytes = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
  if (bytes > expectedBytes) throw new Error('Update partial exceeds signed size');
  let speedBaseBytes = bytes;
  let speedStartedAt = Date.now();
  const controller = new AbortController();
  const cancel = () => controller.abort(
    signal.reason instanceof Error ? signal.reason : new Error('Update download was cancelled'),
  );
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const total = setTimeout(() => controller.abort(new Error('Update download exceeded its overall time limit; partial retained')), totalTimeoutMs);
  let idle, response, invalid = false, lastPublishedAt = 0;
  const progress = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(new Error('Update download made no progress; partial retained for retry')), idleTimeoutMs);
    const speed = Math.max(0, bytes - speedBaseBytes) / Math.max(0.001, (Date.now() - speedStartedAt) / 1000);
    if (Date.now() - lastPublishedAt >= 100 || bytes === expectedBytes) {
      lastPublishedAt = Date.now();
      onProgress?.({ downloadedBytes: bytes, totalBytes: expectedBytes, bytesPerSecond: speed,
        remainingSeconds: speed > 0 ? Math.ceil((expectedBytes - bytes) / speed) : null });
    }
  };
  try {
    progress();
    if (bytes < expectedBytes) {
      response = await requestDownload(url, 0, { signal: controller.signal,
        headers: bytes ? { Range: `bytes=${bytes}-`, 'Accept-Encoding': 'identity' } : { 'Accept-Encoding': 'identity' },
        allowPartial: true });
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        invalid = true; throw new Error('Compressed update range is unsupported');
      }
      if (response.statusCode === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers['content-range'] || '');
        if (!range || Number(range[1]) !== bytes || Number(range[2]) !== expectedBytes - 1
          || Number(range[3]) !== expectedBytes) {
          invalid = true; throw new Error('Update Content-Range does not match signed asset');
        }
      } else if (response.statusCode === 200) {
        // The server ignored Range: replace the partial, never append a full body.
        const restarted = bytes > 0;
        bytes = 0;
        speedBaseBytes = 0;
        speedStartedAt = Date.now();
        if (restarted) {
          lastPublishedAt = 0;
          progress();
        }
      } else throw new Error(`Update download failed with HTTP ${response.statusCode}`);
      const fd = fs.openSync(partial, bytes ? 'a' : 'w', 0o600);
      const limit = new Transform({ transform(chunk, _encoding, callback) {
        if (bytes + chunk.length > maxBytes || bytes + chunk.length > expectedBytes) {
          invalid = true; callback(new Error('Update exceeds signed size')); return;
        }
        bytes += chunk.length; progress(); callback(null, chunk);
      } });
      await pipeline(response, limit, fs.createWriteStream(partial, { fd }), { signal: controller.signal });
    }
    // The idle deadline only describes network progress. A complete download may
    // legitimately take longer than that to hash on a slow disk; the overall
    // deadline and caller cancellation continue to cover verification.
    clearTimeout(idle);
    idle = undefined;
    if (bytes !== expectedBytes) throw new Error('Incomplete update download; partial retained');
    const hash = crypto.createHash('sha256');
    await pipeline(createReadStream(partial), hash, { signal: controller.signal });
    if (controller.signal.aborted) throw controller.signal.reason;
    if (hash.digest('hex') !== expectedSha256) {
      invalid = true; throw new Error('Update SHA-256 does not match signed metadata');
    }
    fs.renameSync(partial, destination);
    fs.rmSync(identityFile);
    progress();
    return destination;
  } catch (error) {
    response?.destroy();
    if (invalid) {
      fs.rmSync(partial, { force: true }); fs.rmSync(identityFile, { force: true });
    }
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally {
    clearTimeout(idle);
    clearTimeout(total);
    signal?.removeEventListener('abort', cancel);
  }
}
module.exports = { downloadAuthenticatedAsset };
