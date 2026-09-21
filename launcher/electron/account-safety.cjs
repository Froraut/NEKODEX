const fs = require('node:fs');
const path = require('node:path');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const { validateAccountId } = require('./account-registry.cjs');

const DEFAULT_POLICY = Object.freeze({ enabled: false, minIntervalSec: 10, maxConcurrent: 1,
  breakAfterMinutes: 30, breakMinutes: 5, maxSessionMinutes: 240, cooldownMinutes: 3 });
function validatePolicy(value) {
  if (!value || typeof value !== 'object' || typeof value.enabled !== 'boolean') throw new Error('Invalid pacing policy');
  const ranges = { minIntervalSec: [0, 600], maxConcurrent: [1, 1000], breakAfterMinutes: [1, 240],
    breakMinutes: [1, 60], maxSessionMinutes: [1, 1440], cooldownMinutes: [1, 120] };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) throw new Error(`Invalid pacing ${key}`);
  }
  return Object.fromEntries(['enabled', ...Object.keys(ranges)].map(key => [key, value[key]]));
}

/** Single launcher writer; no text, cookies, task IDs, credentials or prompts are saved. */
class AccountSafety {
  constructor(coreHome, clock = Date.now) {
    this.clock = clock;
    this.path = path.join(coreHome, 'account-safety.json');
    this.state = {};
    try {
      const data = JSON.parse(fs.readFileSync(this.path, 'utf8'));
      if (data.version !== 1 || !data.accounts || typeof data.accounts !== 'object' || Array.isArray(data.accounts)) throw new Error('Invalid account safety state');
      for (const [id, item] of Object.entries(data.accounts)) {
        validateAccountId(id);
        validatePolicy(item.policy);
        for (const key of ['lastStart', 'sessionStart', 'breakStart', 'cooldownUntil']) {
          if (!Number.isFinite(item[key]) || item[key] < 0) throw new Error('Invalid account safety timestamp');
        }
        if (typeof item.stopped !== 'boolean') throw new Error('Invalid account safety stop');
      }
      this.state = data.accounts;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  entry(id) {
    validateAccountId(id);
    return this.state[id] ?? { policy: { ...DEFAULT_POLICY }, lastStart: 0, sessionStart: 0,
      breakStart: 0, cooldownUntil: 0, stopped: false };
  }
  save(id, item) {
    const next = { ...this.state, [id]: item };
    writePrivateFileAtomic(this.path, JSON.stringify({ version: 1, accounts: next }) + '\n', { durable: true });
    this.state = next;
  }
  snapshot(id) {
    const item = this.entry(id);
    return { policy: { ...item.policy }, cooldownUntil: item.cooldownUntil, stopped: item.stopped };
  }
  setPolicy(id, value) {
    const previous = this.entry(id), policy = validatePolicy(value);
    this.save(id, { ...previous, policy,
      ...(!previous.policy.enabled && policy.enabled ? { sessionStart: 0, breakStart: 0 } : {}) });
  }
  resume(id) {
    // Explicit resume clears a session hard-stop, never a provider-imposed cooldown.
    this.save(id, { ...this.entry(id), stopped: false, sessionStart: 0, breakStart: 0 });
  }
  fail(id, code) {
    const item = this.entry(id);
    if (code === 'rate_limit_exceeded') this.save(id, { ...item,
      cooldownUntil: Math.max(item.cooldownUntil, this.clock() + item.policy.cooldownMinutes * 60_000) });
    else if (code === 'account_safety_stop') this.save(id, { ...item, stopped: true });
  }
  admit(id, activeCount) {
    const item = this.entry(id), now = this.clock(), p = item.policy;
    const reject = (message, until) => {
      const error = new Error(message);
      error.code = 'account_cooldown';
      error.retryAt = until;
      throw error;
    };
    if (item.stopped) reject('This account is paused. Review it in Accounts and explicitly resume.');
    if (now < item.cooldownUntil) reject(`This account is cooling down until ${new Date(item.cooldownUntil).toISOString()}. No request was sent.`, item.cooldownUntil);
    if (p.enabled) {
      if (activeCount >= p.maxConcurrent) reject('Account pacing concurrency limit reached. Wait for its active tasks.');
      if (item.sessionStart && now - item.sessionStart >= p.maxSessionMinutes * 60_000) {
        this.save(id, { ...item, stopped: true });
        reject('Account session time limit reached. Review the account and explicitly resume.');
      }
      if (item.lastStart && now < item.lastStart + p.minIntervalSec * 1000) reject('Account pacing interval has not elapsed. No request was sent.', item.lastStart + p.minIntervalSec * 1000);
      if (item.breakStart && now - item.breakStart >= p.breakAfterMinutes * 60_000) {
        const until = now + p.breakMinutes * 60_000;
        this.save(id, { ...item, cooldownUntil: until, breakStart: until });
        reject(`Scheduled account break until ${new Date(until).toISOString()}. No request was sent.`, until);
      }
    }
    this.save(id, { ...item, lastStart: now, sessionStart: item.sessionStart || now, breakStart: item.breakStart || now });
  }
}
module.exports = { AccountSafety, DEFAULT_POLICY, validatePolicy };
