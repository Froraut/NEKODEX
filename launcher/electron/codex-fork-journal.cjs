const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 4 * 1024 * 1024;
const journalError = () => Object.assign(new Error('Native fork receipts are unavailable; no new fork was sent'), { code: 'fork_journal_unavailable' });

// Single main-process writer. No prompts, turns or authentication enter this file.
function createCodexForkJournal({ journalPath, codexHome, executable, controlSocket = null }) {
  if (!journalPath) return null;
  const directory = path.dirname(journalPath);
  function privateStat(filename, isDirectory) {
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink() || (isDirectory ? !stat.isDirectory() : !stat.isFile())
      || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid())))) throw journalError();
    return stat;
  }
  let saved = null, state = { version: 1, codexHome, records: [] };
  function read() {
    try {
      privateStat(directory, true);
      if (privateStat(journalPath, false).size > MAX_BYTES) throw journalError();
      return fs.readFileSync(journalPath, 'utf8');
    } catch (reason) { if (reason.code === 'ENOENT') return null; throw journalError(); }
  }
  function valid(value) {
    if (!value || value.version !== 1 || value.codexHome !== codexHome || !Array.isArray(value.records)) throw journalError();
    const ids = new Set();
    for (const row of value.records) {
      if (!UUID.test(row.actionId) || ids.has(row.actionId) || !UUID.test(row.threadId)
        || !['pending', 'unknown', 'completed', 'failed', 'acknowledgedUnknown'].includes(row.state)
        || typeof row.requestedAt !== 'string' || !Number.isFinite(Date.parse(row.requestedAt))
        || (row.lastTurnId !== null && typeof row.lastTurnId !== 'string')
        || (row.forkId !== null && !UUID.test(row.forkId))
        || !row.source || row.source.codexHome !== codexHome || typeof row.source.executable !== 'string'
        || (row.source.controlSocket !== null && typeof row.source.controlSocket !== 'string')) throw journalError();
      ids.add(row.actionId);
    }
    return value;
  }
  saved = read();
  if (saved !== null) {
    try { state = valid(JSON.parse(saved)); } catch { throw journalError(); }
  }
  function save(next) {
    try {
      valid(next);
      const bytes = `${JSON.stringify(next)}\n`;
      if (Buffer.byteLength(bytes) > MAX_BYTES || read() !== saved) throw journalError();
      if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      privateStat(directory, true);
      const receipt = writePrivateFileAtomic(journalPath, bytes, { durable: true, protectDirectory: false });
      saved = bytes; state = next;
      if (receipt.durability === 'uncertain') throw journalError();
    } catch { throw journalError(); }
  }
  // An earlier owner left no terminal receipt. Retain uncertainty, never replay.
  if (state.records.some(row => row.state === 'pending')) save({ ...state, records: state.records.map(row =>
    row.state === 'pending' ? { ...row, state: 'unknown', reasonCode: 'process_restarted' } : row) });
  function begin(threadId, lastTurnId) {
    if (state.records.some(row => row.threadId === threadId && ['pending', 'unknown'].includes(row.state))) {
      throw Object.assign(new Error('Inspect and acknowledge the earlier fork before creating another'), { code: 'fork_reconciliation_required' });
    }
    const row = { actionId: randomUUID(), threadId, lastTurnId: lastTurnId ?? null,
      requestedAt: new Date().toISOString(), state: 'pending', forkId: null, reasonCode: null,
      source: { codexHome, executable, controlSocket } };
    save({ ...state, records: [...state.records, row] });
    return row.actionId;
  }
  function finish(actionId, patch) {
    const next = { ...state, records: state.records.map(row => row.actionId === actionId ? { ...row, ...patch } : row) };
    save(next);
  }
  function uncertain(actionId, reasonCode, forkId = null) {
    try { finish(actionId, { state: 'unknown', reasonCode, forkId }); }
    catch {
      // The durable pending record survives a write failure. Keep any actually
      // observed provider receipt in memory as well, without erasing disk bytes.
      state = { ...state, records: state.records.map(row => row.actionId === actionId
        ? { ...row, state: 'unknown', reasonCode, forkId } : row) };
    }
  }
  function acknowledge(actionId, threadId) {
    const row = state.records.find(row => row.actionId === actionId && row.threadId === threadId);
    if (!row || row.state !== 'unknown') throw Object.assign(new Error('No matching unknown fork action'), { code: 'invalid_parameters' });
    finish(actionId, { state: 'acknowledgedUnknown', acknowledgedAt: new Date().toISOString() });
  }
  function snapshot() {
    return state.records.filter(row => ['unknown', 'pending'].includes(row.state)).map(row => ({
      actionId: row.actionId, threadId: row.threadId, lastTurnId: row.lastTurnId,
      requestedAt: row.requestedAt, state: row.state, reasonCode: row.reasonCode,
      observedForkId: row.forkId,
    }));
  }
  return { begin, finish, uncertain, acknowledge, snapshot };
}
module.exports = { createCodexForkJournal };
