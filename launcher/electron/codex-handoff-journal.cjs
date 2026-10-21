const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 256;
const STATES = ['pending', 'completed', 'failed', 'refused', 'unknown', 'acknowledgedUnknown'];
const PHASES = ['acquiring', 'held', 'dispatching', 'running', 'releasing', 'released'];
// No send can precede `dispatching`; a lost owner before it cannot have started a turn.
const BEFORE_SEND = ['acquiring', 'held'];
const TURN_ID = /^[^\u0000-\u001f]{1,128}$/;
const journalError = () => Object.assign(new Error('Native handoff receipts are unavailable; nothing was sent'), { code: 'handoff_journal_unavailable' });

/** Single main-process writer for exclusive external-thread handoffs.
 * Stores identities, phases and outcomes only: never prompts, replies, tokens or paths of rollouts. */
function createCodexHandoffJournal({ journalPath, codexHome, executable }) {
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
    if (!value || value.version !== 1 || value.codexHome !== codexHome || !Array.isArray(value.records)
      || value.records.length > MAX_RECORDS) throw journalError();
    const ids = new Set();
    for (const row of value.records) {
      if (!UUID.test(row.actionId) || ids.has(row.actionId) || !UUID.test(row.threadId)
        || !STATES.includes(row.state) || !PHASES.includes(row.phase)
        || typeof row.requestedAt !== 'string' || !Number.isFinite(Date.parse(row.requestedAt))
        || (row.turnId !== null && !(typeof row.turnId === 'string' && TURN_ID.test(row.turnId)))
        || (row.turnStatus !== null && !['completed', 'interrupted', 'failed'].includes(row.turnStatus))
        || (row.reasonCode !== null && !(typeof row.reasonCode === 'string' && /^[a-z_]{1,64}$/.test(row.reasonCode)))
        || !Number.isSafeInteger(row.approvalsRefused) || row.approvalsRefused < 0
        || !row.source || row.source.codexHome !== codexHome || typeof row.source.executable !== 'string') throw journalError();
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
  // An earlier owner left no terminal receipt. Never replay. Before dispatch nothing
  // could have been sent; from dispatch on the turn outcome needs human inspection.
  if (state.records.some(row => row.state === 'pending')) save({ ...state, records: state.records.map(row =>
    row.state !== 'pending' ? row : BEFORE_SEND.includes(row.phase)
      ? { ...row, state: 'failed', reasonCode: 'process_restarted_before_send' }
      : { ...row, state: 'unknown', reasonCode: 'process_restarted' }) });
  const blocking = row => ['pending', 'unknown'].includes(row.state);
  function begin(threadId) {
    if (state.records.some(blocking)) {
      const sameThread = state.records.some(row => blocking(row) && row.threadId === threadId);
      throw Object.assign(new Error(sameThread ? 'Inspect and acknowledge the earlier handoff of this thread first'
        : 'Another native handoff is pending or needs inspection'), { code: sameThread ? 'handoff_reconciliation_required' : 'handoff_busy' });
    }
    const row = { actionId: randomUUID(), threadId, requestedAt: new Date().toISOString(), state: 'pending',
      phase: 'acquiring', turnId: null, turnStatus: null, reasonCode: null, approvalsRefused: 0,
      source: { codexHome, executable } };
    // Bound retained history by pruning the oldest settled receipts only.
    let records = [...state.records, row];
    while (records.length > MAX_RECORDS) {
      const index = records.findIndex(entry => !blocking(entry));
      if (index < 0) throw journalError();
      records = records.filter((_, position) => position !== index);
    }
    save({ ...state, records });
    return row.actionId;
  }
  function update(actionId, patch) {
    save({ ...state, records: state.records.map(row => row.actionId === actionId ? { ...row, ...patch } : row) });
  }
  function uncertain(actionId, reasonCode, patch = {}) {
    try { update(actionId, { ...patch, state: 'unknown', reasonCode }); }
    catch {
      // The durable pending record survives a write failure; keep the observation in memory too.
      state = { ...state, records: state.records.map(row => row.actionId === actionId
        ? { ...row, ...patch, state: 'unknown', reasonCode } : row) };
    }
  }
  function acknowledge(actionId, threadId) {
    const row = state.records.find(row => row.actionId === actionId && row.threadId === threadId);
    if (!row || row.state !== 'unknown') throw Object.assign(new Error('No matching unknown handoff action'), { code: 'invalid_parameters' });
    update(actionId, { state: 'acknowledgedUnknown', acknowledgedAt: new Date().toISOString() });
  }
  const project = row => ({ actionId: row.actionId, threadId: row.threadId, requestedAt: row.requestedAt,
    state: row.state, phase: row.phase, turnId: row.turnId, turnStatus: row.turnStatus,
    reasonCode: row.reasonCode, approvalsRefused: row.approvalsRefused });
  function snapshot() { return state.records.filter(blocking).map(project); }
  function find(actionId) { const row = state.records.find(entry => entry.actionId === actionId); return row ? project(row) : null; }
  return { begin, update, uncertain, acknowledge, snapshot, find };
}
module.exports = { createCodexHandoffJournal };
