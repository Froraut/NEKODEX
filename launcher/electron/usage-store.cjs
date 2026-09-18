const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');

const dayOf = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const digest = value => createHash('sha256').update(value).digest('hex');
const outcomes = ['completed', 'failed', 'aborted'];
class UsageStore {
  constructor(coreHome, clock = Date.now) {
    this.path = path.join(coreHome, 'local-usage.json'); this.clock = clock;
    this.state = { version: 1, startedAt: new Date(clock()).toISOString(), rows: {}, receipts: {}, lifetime: 0 };
    this.error = null;
    try {
      const text = fs.readFileSync(this.path, 'utf8');
      if (text.length > 20_000_000) throw new Error('Usage history exceeds its storage limit');
      const data = JSON.parse(text);
      if (data.version !== 1 || !data.rows || !data.receipts || !Number.isSafeInteger(data.lifetime) || data.lifetime < 0
        || typeof data.startedAt !== 'string' || !Number.isFinite(Date.parse(data.startedAt))) throw new Error('Usage history has an unsupported format');
      for (const [key, row] of Object.entries(data.rows)) {
        if (key !== `${row.day}|${row.effort}|${row.modelVersion}|${row.mode}` || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)
          || !['luna', 'low', 'medium', 'high', 'xhigh', 'max', 'unknown'].includes(row.effort)
          || !['5.5', '5.6', '6', 'unknown'].includes(row.modelVersion) || !['automatic', 'manual'].includes(row.mode)) throw new Error('Invalid usage group');
        for (const field of ['accepted', ...outcomes]) if (!Number.isSafeInteger(row[field]) || row[field] < 0) throw new Error('Invalid usage counter');
        if (outcomes.reduce((sum, field) => sum + row[field], 0) > row.accepted) throw new Error('Usage outcomes exceed accepted submissions');
      }
      for (const [id, receipt] of Object.entries(data.receipts)) {
        if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(receipt.owner)
          || !data.rows[receipt.key] || !Number.isFinite(receipt.at)
          || receipt.outcome !== null && !outcomes.includes(receipt.outcome)) throw new Error('Invalid usage receipt');
      }
      this.state = data;
    } catch (error) {
      if (error.code !== 'ENOENT') this.error = 'Usage history is unreadable; existing data was preserved.';
    }
  }
  persist(next) {
    writePrivateFileAtomic(this.path, JSON.stringify(next) + '\n'); this.state = next;
  }
  accept(trace, pid, receipt, effort, modelVersion, mode = 'automatic') {
    if (this.error) return;
    const id = digest(`${trace}:${pid}:${receipt}`);
    if (this.state.receipts[id]) return;
    if (!['luna', 'low', 'medium', 'high', 'xhigh', 'max', 'unknown'].includes(effort)
      || !['5.5', '5.6', '6', 'unknown'].includes(modelVersion) || !['automatic', 'manual'].includes(mode)) throw new Error('Invalid usage classification');
    const now = this.clock(), day = dayOf(new Date(now)), key = `${day}|${effort}|${modelVersion}|${mode}`;
    const next = structuredClone(this.state);
    // Keep daily history and deduplication receipts for 90 days; lifetime is never reset.
    const cutoff = dayOf(new Date(now - 90 * 86400_000));
    for (const [name, row] of Object.entries(next.rows)) if (row.day < cutoff) delete next.rows[name];
    for (const [name, r] of Object.entries(next.receipts)) if (!next.rows[r.key]) delete next.receipts[name];
    if (Object.keys(next.receipts).length >= 100_000) throw new Error('Usage receipt capacity reached; history was preserved');
    const row = next.rows[key] ?? { day, effort, modelVersion, mode, accepted: 0, completed: 0, failed: 0, aborted: 0 };
    row.accepted++; next.rows[key] = row; next.lifetime++;
    next.receipts[id] = { owner: digest(`${trace}:${pid}`), key, at: now, outcome: null };
    this.persist(next);
  }
  finish(trace, pid, outcome, receipt) {
    if (this.error || !outcomes.includes(outcome)) return;
    const owner = digest(`${trace}:${pid}`), wanted = receipt && digest(`${trace}:${pid}:${receipt}`);
    const next = structuredClone(this.state); let changed = false;
    for (const [id, r] of Object.entries(next.receipts)) {
      if (r.owner !== owner || r.outcome !== null || wanted && id !== wanted) continue;
      r.outcome = outcome; next.rows[r.key][outcome]++; changed = true;
    }
    if (changed) this.persist(next);
  }
  snapshot(days = 7) {
    if (![7, 30, 90].includes(days)) throw new Error('Usage range must be 7, 30 or 90 days');
    if (this.error) return { available: false, error: this.error, rows: [] };
    const first = new Date(this.clock()); first.setDate(first.getDate() - days + 1);
    return { available: true, startedAt: this.state.startedAt, lifetime: this.state.lifetime,
      rows: Object.values(this.state.rows).filter(row => row.day >= dayOf(first)).sort((a, b) => a.day.localeCompare(b.day)) };
  }
}
module.exports = { UsageStore };
