const fs = require('node:fs');
const path = require('node:path');

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID = new RegExp(`^${UUID_SOURCE}$`, 'i');
const TIER = /^[A-Za-z0-9._-]{1,64}$/;
const MARKER = Buffer.from('"thread_settings_applied"');
const ROLLOUT_DIRECTORIES = ['sessions', 'archived_sessions'];
const CHUNK_BYTES = 1024 * 1024;
// A settings snapshot is a few KiB. Longer lines (large tool outputs) are skipped unparsed.
const MAX_SNAPSHOT_LINE_BYTES = 16 * 1024 * 1024;
const EMPTY = Buffer.alloc(0);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const unreadable = () => Object.assign(new Error('The thread rollout settings could not be read'), { code: 'settings_unreadable' });

/** The rollout Codex reported must be a regular file of this thread inside the profile's session store. */
function rolloutFile(codexHome, candidate, threadId) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || candidate.includes('\0')) throw unreadable();
  const name = new RegExp(`^rollout-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-${threadId}(?:_${UUID_SOURCE})?\\.jsonl$`, 'i');
  try {
    if (fs.lstatSync(candidate).isSymbolicLink()) throw unreadable();
    const filename = fs.realpathSync(candidate);
    if (!fs.lstatSync(filename).isFile() || !name.test(path.basename(filename))) throw unreadable();
    const inside = ROLLOUT_DIRECTORIES.some(directory => {
      let root;
      try { root = fs.realpathSync(path.join(codexHome, directory)); } catch { return false; }
      const relative = path.relative(root, filename);
      return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    });
    if (!inside) throw unreadable();
    return filename;
  } catch { throw unreadable(); }
}

/** One rollout line, if it is a settings snapshot this thread recorded itself. Copied
 * snapshots keep their original owner's `thread_id`, so only owned ones count (as in Codex). */
function ownedSnapshot(line, threadId, maxLineBytes) {
  if (!line.length || line.length > maxLineBytes || line.indexOf(MARKER) < 0) return null;
  let value;
  try { value = JSON.parse(line.toString('utf8')); } catch { return null; } // A cut final write is not a snapshot.
  const payload = record(value) && value.type === 'event_msg' && record(value.payload) ? value.payload : null;
  if (!payload || payload.type !== 'thread_settings_applied' || payload.thread_id !== threadId
    || !record(payload.thread_settings)) return null;
  // Codex omits `service_tier` when the thread has none.
  const tier = payload.thread_settings.service_tier;
  if (tier === undefined || tier === null) return { recorded: true, serviceTier: null };
  if (typeof tier !== 'string' || !TIER.test(tier)) throw unreadable();
  return { recorded: true, serviceTier: tier };
}

/** Main-only, read-only. Codex 0.163 resumes a thread with the profile's configured service
 * tier and does not restore the tier the thread itself last used; that tier exists only in
 * the thread's latest owned `thread_settings_applied` rollout snapshot. The rollout is read
 * backwards in bounded chunks, so the usual nearby snapshot costs one or two reads.
 * Returns `{ recorded: false, serviceTier: null }` when the thread never recorded one. */
async function readRecordedServiceTier({ codexHome, rolloutPath, threadId, chunkBytes = CHUNK_BYTES,
  maxLineBytes = MAX_SNAPSHOT_LINE_BYTES } = {}) {
  if (typeof codexHome !== 'string' || !path.isAbsolute(codexHome) || typeof threadId !== 'string' || !UUID.test(threadId)
    || !Number.isInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 16 * CHUNK_BYTES
    || !Number.isInteger(maxLineBytes) || maxLineBytes < 1 || maxLineBytes > MAX_SNAPSHOT_LINE_BYTES) throw unreadable();
  const filename = rolloutFile(codexHome, rolloutPath, threadId);
  let handle;
  try { handle = await fs.promises.open(filename, 'r'); } catch { throw unreadable(); }
  try {
    const { size } = await handle.stat();
    // `carry` is the end of a line that starts in an earlier chunk. A line longer than the
    // snapshot bound is skipped up to its start without being kept in memory.
    let position = size, carry = EMPTY, skipping = false;
    while (position > 0) {
      const length = Math.min(chunkBytes, position);
      position -= length;
      const chunk = Buffer.allocUnsafe(length);
      for (let offset = 0; offset < length;) {
        const { bytesRead } = await handle.read(chunk, offset, length - offset, position + offset);
        if (!bytesRead) throw unreadable();
        offset += bytesRead;
      }
      const data = skipping ? chunk : Buffer.concat([chunk, carry]);
      let end = data.length;
      while (end > 0) {
        const newline = data.lastIndexOf(0x0a, end - 1);
        if (newline < 0) break;
        if (skipping) skipping = false;
        else {
          const found = ownedSnapshot(data.subarray(newline + 1, end), threadId, maxLineBytes);
          if (found) return found;
        }
        end = newline;
      }
      carry = skipping ? EMPTY : data.subarray(0, end);
      if (carry.length > maxLineBytes) { skipping = true; carry = EMPTY; }
    }
    return (!skipping && ownedSnapshot(carry, threadId, maxLineBytes)) || { recorded: false, serviceTier: null };
  } catch (reason) {
    throw reason?.code === 'settings_unreadable' ? reason : unreadable();
  } finally {
    await handle.close().catch(() => {});
  }
}

module.exports = { readRecordedServiceTier };
