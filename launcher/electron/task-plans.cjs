const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { assertTaskPlanObservation } = require('./task-plan-observation.cjs');

// The Electron main process is the single writer. Content never enters the
// metadata-only task ledger. Disabling capture retains explicitly recorded data.
function createTaskPlanStore({ coreHome, maxBytes = 16 * 1024 * 1024 }) {
  const root = path.join(coreHome, 'task-plans');
  const policyPath = path.join(root, 'policy.json');
  const records = path.join(root, 'records');
  let storageIssue = null;
  let policyIssue = false;
  const privateStat = (file, directory) => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())
      || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid())))) {
      throw new Error('Plan storage is not private');
    }
    return stat;
  };
  const ensure = () => {
    for (const dir of [root, records]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 });
      privateStat(dir, true);
    }
  };
  const read = (file, limit) => {
    const stat = privateStat(file, false);
    if (stat.size > limit) throw new Error('Plan storage exceeds its bounded record limit');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };
  const policy = () => {
    policyIssue = false;
    try {
      if (!fs.existsSync(policyPath)) return { version: 1, enabled: false, revision: 0 };
      privateStat(root, true);
      const value = read(policyPath, 1024);
      if (value.version !== 1 || typeof value.enabled !== 'boolean'
        || !Number.isSafeInteger(value.revision) || value.revision < 1
        || Object.keys(value).some(key => !['version', 'enabled', 'revision'].includes(key))) throw new Error('Invalid capture policy');
      return value;
    } catch {
      policyIssue = true;
      storageIssue = 'Plan capture policy is unavailable; recording is disabled';
      return { version: 1, enabled: false, revision: 0 };
    }
  };
  const atomic = (file, value) => {
    ensure();
    const temp = path.join(path.dirname(file), `.plan-${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      const fd = fs.openSync(temp, 'r');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, file);
    } finally { try { fs.unlinkSync(temp); } catch {} }
  };
  const identity = (accountId, taskId) => {
    if (![accountId, taskId].every(value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value))) throw new Error('Invalid plan identity');
    return path.join(records, `${crypto.createHash('sha256').update(JSON.stringify([accountId, taskId])).digest('hex')}.json`);
  };
  const get = ({ accountId, taskId }) => {
    const file = identity(accountId, taskId);
    if (!fs.existsSync(file)) return null;
    privateStat(root, true); privateStat(records, true);
    const row = read(file, 10_000);
    if (row.version !== 1 || row.accountId !== accountId || row.taskId !== taskId
      || Object.keys(row).some(key => !['version', 'accountId', 'taskId', 'observation'].includes(key))) throw new Error('Invalid stored plan identity');
    assertTaskPlanObservation(row.observation);
    return row.observation;
  };
  const status = () => ({ ...policy(), storageIssue });
  return {
    enabled: () => policy().enabled,
    status,
    setEnabled(enabled, expectedRevision) {
      if (typeof enabled !== 'boolean' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Invalid plan capture preference');
      const current = policy();
      if (policyIssue || current.revision !== expectedRevision) throw new Error('Capture policy changed or is unavailable; refresh before changing it');
      atomic(policyPath, { version: 1, enabled, revision: current.revision + 1 });
      return status();
    },
    get,
    capture({ accountId, taskId, observation }) {
      if (!policy().enabled) return { recorded: false, reason: 'disabled' };
      assertTaskPlanObservation(observation);
      if (observation.state !== 'observed') return { recorded: false, reason: observation.state };
      ensure();
      const file = identity(accountId, taskId);
      const previous = get({ accountId, taskId });
      if (previous && (previous.native.threadId !== observation.native.threadId || previous.native.turnId !== observation.native.turnId)) throw new Error('Stored plan owner cannot change');
      if (previous && (observation.observedAt < previous.observedAt
        || observation.revisions.at(-1).revision < previous.revisions.at(-1).revision)) return { recorded: false, reason: 'stale' };
      if (previous) {
        for (const row of observation.revisions) {
          const old = previous.revisions.find(item => item.revision === row.revision);
          if (old && JSON.stringify(old) !== JSON.stringify(row)) throw new Error('An observed native plan revision cannot be rewritten');
        }
      }
      const value = { version: 1, accountId, taskId, observation };
      const bytes = Buffer.byteLength(JSON.stringify(value));
      let total = 0;
      let retainedStaging = false;
      for (const name of fs.readdirSync(records)) {
        const entry = path.join(records, name);
        if (/^\.plan-[a-f0-9-]{36}\.tmp$/.test(name)) {
          // A previous process may have stopped before rename. Preserve these
          // uncommitted bytes and account for them without blocking other plans.
          const pending = privateStat(entry, false);
          if (pending.size > 10_000) throw new Error('Unexpected plan staging size');
          total += pending.size; retainedStaging = true; continue;
        }
        if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error('Unexpected plan storage entry');
        if (entry !== file) total += privateStat(entry, false).size;
      }
      if (total + bytes > maxBytes) { storageIssue = 'Plan storage quota reached; remove selected records to resume'; return { recorded: false, reason: 'quota' }; }
      atomic(file, value);
      storageIssue = retainedStaging ? 'Uncommitted plan staging bytes were retained after an interrupted write' : null;
      return { recorded: true };
    },
    delete({ accountId, taskId }) {
      const file = identity(accountId, taskId);
      if (fs.existsSync(file)) { get({ accountId, taskId }); fs.unlinkSync(file); }
      storageIssue = null;
      return { deleted: true };
    },
  };
}
module.exports = { createTaskPlanStore };
