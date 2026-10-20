'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const { canonical } = require('./oauth-mcp-contract.cjs');
const fail = () => { throw new Error('OAuth MCP durable receipt unavailable; do not replay'); };
// One trusted main owner. A stale process lock fails closed; receipt reads still never dispatch.
function createOAuthMcpJournal({ directory, pinDigest }) {
  if (!path.isAbsolute(directory || '') || !/^[a-f0-9]{64}$/.test(pinDigest)) fail();
  const file = path.join(directory, 'receipts.json'), lock = path.join(directory, 'owner.lock');
  const owner = JSON.stringify({ pid: process.pid, nonce: randomUUID() }); let owned = false, closed = false;
  function checkDirectory(create = false) {
    if (create) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (fs.realpathSync(directory) !== directory || !stat.isDirectory() || stat.isSymbolicLink()
      || process.platform === 'win32' || stat.uid !== process.getuid() || stat.mode & 0o077) fail();
  }
  function readPrivate(target, limit) {
    const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || stat.mode & 0o077 || stat.size > limit) fail();
      return fs.readFileSync(fd, 'utf8');
    } finally { fs.closeSync(fd); }
  }
  function read() {
    let data;
    try { checkDirectory(); data = JSON.parse(readPrivate(file, 8 * 1024 * 1024)); }
    catch (error) { if (error.code === 'ENOENT') return { version: 1, pinDigest, entries: [] }; throw error; }
    if (data.version !== 1 || data.pinDigest !== pinDigest || !Array.isArray(data.entries) || data.entries.length > 1024) fail();
    for (const row of data.entries) if (!/^[a-f0-9]{64}$/.test(row.invocationHash) || !row.idempotencyKey
      || !row.outcome || !['completed', 'failed', 'outcome_unknown'].includes(row.outcome.state)) fail();
    return data;
  }
  function acquire() {
    if (closed) fail(); checkDirectory(true);
    if (owned) { if (readPrivate(lock, 4096) !== owner) fail(); return; }
    fs.writeFileSync(lock, owner, { flag: 'wx', mode: 0o600 }); owned = true;
    const fd = fs.openSync(lock, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  function save(data) {
    if (Buffer.byteLength(JSON.stringify(data)) > 8 * 1024 * 1024) fail();
    const saved = writePrivateFileAtomic(file, JSON.stringify(data) + '\n', { durable: true, warningSink() {} });
    if (saved.durability !== 'confirmed') fail();
  }
  function existing(request) {
    const data = read(), key = canonical(request.scope);
    const row = data.entries.find(row => row.idempotencyKey === request.idempotencyKey || row.scopeKey === key);
    if (row && row.invocationHash !== request.invocationHash) fail();
    return row ? structuredClone(row.outcome) : undefined;
  }
  return Object.freeze({ existing,
    begin(request) {
      acquire(); const prior = existing(request); if (prior) return { inserted: false, outcome: prior };
      const data = read(); if (data.entries.length >= 1024) fail();
      const outcome = { state: 'outcome_unknown', reason: 'Exact remote invocation admitted; terminal effect not established' };
      data.entries.push({ idempotencyKey: request.idempotencyKey, scopeKey: canonical(request.scope), invocationHash: request.invocationHash,
        tool: request.tool, outcome, held: true, createdAt: Date.now(), updatedAt: Date.now() });
      save(data); return { inserted: true, outcome: structuredClone(outcome) };
    },
    settle(request, outcome) {
      acquire(); const data = read(), row = data.entries.find(row => row.idempotencyKey === request.idempotencyKey);
      if (!row || row.invocationHash !== request.invocationHash || row.outcome.state !== 'outcome_unknown'
        || !['completed', 'failed'].includes(outcome.state) || Buffer.byteLength(JSON.stringify(outcome)) > 240 * 1024) fail();
      row.outcome = structuredClone(outcome); row.held = false; row.updatedAt = Date.now(); save(data); return structuredClone(outcome);
    },
    close() {
      closed = true;
      if (owned) { checkDirectory(); if (readPrivate(lock, 4096) !== owner) fail(); fs.unlinkSync(lock); owned = false; }
    },
    receipts() { return read().entries.map(row => ({ invocationHash: row.invocationHash, tool: row.tool, state: row.outcome.state, createdAt: row.createdAt, updatedAt: row.updatedAt })); },
    status() { const data = read(); return { receiptCount: data.entries.length, heldUnknownCount: data.entries.filter(row => row.held).length, ownerHeld: owned || fs.existsSync(lock), ownerCurrent: owned }; },
  });
}
module.exports = { createOAuthMcpJournal };
