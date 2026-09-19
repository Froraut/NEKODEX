const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { renameAtomicFile } = require('./atomic-file.cjs');

const dayOf = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const digest = value => createHash('sha256').update(value).digest('hex');
const outcomes = ['completed', 'failed', 'aborted'];
const fields = ['accepted', ...outcomes];
const groupKey = row => `${row.effort}|${row.modelVersion}|${row.mode}`;
const emptyGroup = row => ({ effort: row.effort, modelVersion: row.modelVersion, mode: row.mode, accepted: 0, completed: 0, failed: 0, aborted: 0 });
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCounter = value => Number.isSafeInteger(value) && value >= 0;
const validClassification = row => ['luna', 'low', 'medium', 'high', 'xhigh', 'max', 'unknown'].includes(row.effort)
  && ['5.5', '5.6', '6', 'unknown'].includes(row.modelVersion) && ['automatic', 'manual'].includes(row.mode);
const validCounters = row => fields.every(field => isCounter(row[field]))
  && outcomes.reduce((sum, field) => sum + row[field], 0) <= row.accepted;
const MAX_BYTES = 20_000_000;

// The usage file is the sole recorder. Flush both file contents and the rename so
// an acknowledged write survives process exit (and, where supported, power loss).
function writeDurable(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(path.dirname(file), 0o700); } catch {}
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    renameAtomicFile(temporary, file);
    if (process.platform !== 'win32') {
      const directory = fs.openSync(path.dirname(file), 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
  } finally { fs.rmSync(temporary, { force: true }); }
}

function readState(file) {
  if (fs.statSync(file).size > MAX_BYTES) throw new Error('Usage history exceeds its storage limit');
  const text = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(text);
  if (isRecord(data) && data.version !== 1 && data.version !== 2) {
    const error = new Error('Usage history has an unsupported version');
    error.code = 'USAGE_VERSION'; throw error;
  }
  if (!isRecord(data) || !isRecord(data.rows) || !isRecord(data.receipts) || !isCounter(data.lifetime)
    || typeof data.startedAt !== 'string' || !Number.isFinite(Date.parse(data.startedAt))) throw new Error('Invalid usage history');
  const retained = {};
  for (const [key, row] of Object.entries(data.rows)) {
    if (!isRecord(row) || key !== `${row.day}|${groupKey(row)}` || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)
      || !validClassification(row) || !validCounters(row)) throw new Error('Invalid usage group');
    const name = groupKey(row), group = retained[name] ?? emptyGroup(row);
    for (const field of fields) group[field] += row[field];
    if (!validCounters(group)) throw new Error('Usage counters exceed capacity');
    retained[name] = group;
  }
  for (const [id, receipt] of Object.entries(data.receipts)) {
    if (!isRecord(receipt) || !/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(receipt.owner)
      || !Object.hasOwn(data.rows, receipt.key) || !Number.isFinite(receipt.at)
      || receipt.outcome !== null && !outcomes.includes(receipt.outcome)) throw new Error('Invalid usage receipt');
  }
  if (data.version === 1) {
    const known = Object.values(retained).reduce((sum, row) => sum + row.accepted, 0);
    if (!isCounter(known) || known > data.lifetime) throw new Error('Usage history exceeds lifetime total');
    // Older daily rows have already been pruned; never guess their model or outcome.
    return { state: { ...data, version: 2, lifetimeGroups: retained, lifetimeUnclassified: data.lifetime - known }, legacyText: text };
  }
  if (!isRecord(data.lifetimeGroups) || !isCounter(data.lifetimeUnclassified)) throw new Error('Invalid lifetime history');
  let total = data.lifetimeUnclassified;
  for (const [key, row] of Object.entries(data.lifetimeGroups)) {
    if (!isRecord(row) || key !== groupKey(row) || !validClassification(row) || !validCounters(row)) throw new Error('Invalid lifetime group');
    total += row.accepted;
  }
  if (!isCounter(total) || total !== data.lifetime) throw new Error('Invalid lifetime total');
  for (const [key, row] of Object.entries(retained)) {
    const group = data.lifetimeGroups[key];
    if (!group || fields.some(field => row[field] > group[field])) throw new Error('Lifetime history is missing retained usage');
  }
  return { state: data };
}

class UsageStore {
  constructor(coreHome, clock = Date.now) {
    this.path = path.join(coreHome, 'local-usage.json'); this.backupPath = `${this.path}.backup`; this.clock = clock;
    this.state = { version: 2, startedAt: new Date(clock()).toISOString(), rows: {}, receipts: {}, lifetime: 0,
      lifetimeGroups: {}, lifetimeUnclassified: 0 };
    this.error = null; this.recovered = false; this.backupAvailable = false;
    let primaryError, loaded;
    try { loaded = readState(this.path); this.state = loaded.state; }
    catch (error) { primaryError = error; }
    if (primaryError) {
      // Never silently downgrade a file written by a newer app, or replace files
      // we cannot read due to permissions/I/O errors.
      if (primaryError.code && primaryError.code !== 'ENOENT') {
        this.error = 'Usage history is unreadable; existing data was preserved.'; return;
      }
      try { loaded = readState(this.backupPath); this.state = loaded.state; }
      catch (backupError) {
        if (primaryError.code !== 'ENOENT' || backupError.code !== 'ENOENT') {
          this.error = 'Usage history is unreadable; existing data was preserved.';
        }
        return;
      }
      try {
        if (loaded.legacyText) writeDurable(`${this.path}.v1-${randomUUID()}.backup`, loaded.legacyText);
        if (primaryError.code !== 'ENOENT') {
          fs.renameSync(this.path, `${this.path}.corrupt-${Date.now()}-${randomUUID()}`);
        }
        writeDurable(this.path, JSON.stringify(this.state) + '\n');
        this.recovered = true;
      } catch {
        this.error = 'Usage history could not be restored; the backup was preserved.'; return;
      }
    }
    // Save the migration and establish a backup even when no new turns arrive.
    try {
      if (!this.recovered && loaded.legacyText) writeDurable(`${this.path}.v1-${randomUUID()}.backup`, loaded.legacyText);
      this.persist(this.state);
    }
    catch { this.error = 'Usage history could not be saved; existing data was preserved.'; }
  }
  persist(next) {
    const text = JSON.stringify(next) + '\n';
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Usage history exceeds its storage limit');
    // Seed recovery before replacing an existing primary (including a v1 file).
    if (!this.backupAvailable) {
      writeDurable(this.backupPath, JSON.stringify(this.state) + '\n');
      this.backupAvailable = true;
    }
    try { writeDurable(this.path, text); }
    catch (error) {
      // A rename may have succeeded before a directory flush failed. Stop this
      // instance instead of subsequently overwriting a committed receipt.
      this.error = 'Usage history could not be saved; restart to reload the preserved history.';
      throw error;
    }
    this.state = next;
    // Primary is committed. A backup failure must not invite duplicate recording.
    try { writeDurable(this.backupPath, text); this.backupAvailable = true; }
    catch { this.backupAvailable = false; }
  }
  accept(trace, pid, receipt, effort, modelVersion, mode = 'automatic') {
    if (this.error) return;
    const id = digest(`${trace}:${pid}:${receipt}`);
    if (this.state.receipts[id]) return;
    if (!validClassification({ effort, modelVersion, mode })) throw new Error('Invalid usage classification');
    const now = this.clock(), day = dayOf(new Date(now)), key = `${day}|${effort}|${modelVersion}|${mode}`;
    const next = structuredClone(this.state);
    // Daily history and receipts remain bounded; lifetime groups are never pruned.
    const cutoff = dayOf(new Date(now - 90 * 86400_000));
    for (const [name, row] of Object.entries(next.rows)) if (row.day < cutoff) delete next.rows[name];
    for (const [name, r] of Object.entries(next.receipts)) if (!next.rows[r.key]) delete next.receipts[name];
    if (Object.keys(next.receipts).length >= 100_000 || next.lifetime >= Number.MAX_SAFE_INTEGER) throw new Error('Usage receipt capacity reached; history was preserved');
    const row = next.rows[key] ?? { day, ...emptyGroup({ effort, modelVersion, mode }) };
    row.accepted++; next.rows[key] = row; next.lifetime++;
    const name = groupKey(row), group = next.lifetimeGroups[name] ?? emptyGroup(row);
    group.accepted++; next.lifetimeGroups[name] = group;
    next.receipts[id] = { owner: digest(`${trace}:${pid}`), key, at: now, outcome: null };
    this.persist(next);
  }
  finish(trace, pid, outcome, receipt) {
    if (this.error || !outcomes.includes(outcome)) return;
    const owner = digest(`${trace}:${pid}`), wanted = receipt && digest(`${trace}:${pid}:${receipt}`);
    const next = structuredClone(this.state); let changed = false;
    for (const [id, r] of Object.entries(next.receipts)) {
      if (r.owner !== owner || r.outcome !== null || wanted && id !== wanted) continue;
      const row = next.rows[r.key];
      r.outcome = outcome; row[outcome]++; next.lifetimeGroups[groupKey(row)][outcome]++; changed = true;
    }
    if (changed) this.persist(next);
  }
  snapshot(days = 7) {
    if (![7, 30, 90].includes(days)) throw new Error('Usage range must be 7, 30 or 90 days');
    if (this.error) return { available: false, error: this.error, rows: [] };
    const first = new Date(this.clock()); first.setDate(first.getDate() - days + 1);
    return { available: true, startedAt: this.state.startedAt, lifetime: this.state.lifetime,
      lifetimeGroups: structuredClone(Object.values(this.state.lifetimeGroups)), lifetimeUnclassified: this.state.lifetimeUnclassified,
      recovered: this.recovered, backupAvailable: this.backupAvailable,
      rows: structuredClone(Object.values(this.state.rows).filter(row => row.day >= dayOf(first)).sort((a, b) => a.day.localeCompare(b.day))) };
  }
}
module.exports = { UsageStore };
