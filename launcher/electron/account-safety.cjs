const fs = require('node:fs');
const path = require('node:path');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const { validateAccountId } = require('./account-registry.cjs');

const SESSION_ID_PATTERN = /^[a-f0-9]{64}$/;
const NEW_SESSION_WINDOW_LIMIT_RANGE = Object.freeze([1, 10_000]);
const NEW_SESSION_WINDOW_MINUTES_RANGE = Object.freeze([1, 525_600]);
const DEFAULT_POLICY = Object.freeze({ enabled: false, minIntervalSec: 10, maxConcurrent: 1,
  breakAfterMinutes: 30, breakMinutes: 5, maxSessionMinutes: 240, cooldownMinutes: 3,
  newSessionWindow: null });
function validateNewSessionWindow(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid new Web session window');
  }
  const { limit, minutes } = value;
  if (!Number.isInteger(limit) || limit < NEW_SESSION_WINDOW_LIMIT_RANGE[0]
    || limit > NEW_SESSION_WINDOW_LIMIT_RANGE[1]) {
    throw new Error('Invalid new Web session window limit');
  }
  if (!Number.isInteger(minutes) || minutes < NEW_SESSION_WINDOW_MINUTES_RANGE[0]
    || minutes > NEW_SESSION_WINDOW_MINUTES_RANGE[1]) {
    throw new Error('Invalid new Web session window minutes');
  }
  return { limit, minutes };
}
function validatePolicy(value) {
  if (!value || typeof value !== 'object' || typeof value.enabled !== 'boolean') throw new Error('Invalid pacing policy');
  const ranges = { minIntervalSec: [0, 600], maxConcurrent: [1, 1000], breakAfterMinutes: [1, 240],
    breakMinutes: [1, 60], maxSessionMinutes: [1, 1440], cooldownMinutes: [1, 120] };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) throw new Error(`Invalid pacing ${key}`);
  }
  return { ...Object.fromEntries(['enabled', ...Object.keys(ranges)].map(key => [key, value[key]])),
    newSessionWindow: validateNewSessionWindow(value.newSessionWindow) };
}
function validateNewSessionUsages(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > NEW_SESSION_WINDOW_LIMIT_RANGE[1]) {
    throw new Error('Invalid new Web session usage state');
  }
  const ids = new Set();
  return value.map(usage => {
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)
      || typeof usage.id !== 'string' || !SESSION_ID_PATTERN.test(usage.id)
      || !Number.isSafeInteger(usage.usedAt) || usage.usedAt < 0 || ids.has(usage.id)) {
      throw new Error('Invalid new Web session usage state');
    }
    ids.add(usage.id);
    return { id: usage.id, usedAt: usage.usedAt };
  });
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
      const accounts = {};
      for (const [id, item] of Object.entries(data.accounts)) {
        validateAccountId(id);
        const policy = validatePolicy(item.policy);
        for (const key of ['lastStart', 'sessionStart', 'breakStart', 'cooldownUntil']) {
          if (!Number.isFinite(item[key]) || item[key] < 0) throw new Error('Invalid account safety timestamp');
        }
        if (typeof item.stopped !== 'boolean') throw new Error('Invalid account safety stop');
        const newSessionUsages = validateNewSessionUsages(item.newSessionUsages);
        accounts[id] = { ...item, policy,
          ...(newSessionUsages.length ? { newSessionUsages } : {}) };
      }
      this.state = accounts;
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
    const now = this.clock();
    const synced = this.syncNewSessionWindow(this.entry(id), now);
    const item = synced.item;
    const window = item.policy.newSessionWindow;
    const usages = item.newSessionUsages ?? [];
    const oldestUsageAt = usages.reduce((oldest, usage) => Math.min(oldest, usage.usedAt), Infinity);
    return { policy: { ...item.policy,
      newSessionWindow: window ? { ...window } : null }, cooldownUntil: item.cooldownUntil, stopped: item.stopped,
      newSessionWindow: window ? {
        used: usages.length,
        remaining: Math.max(0, window.limit - usages.length),
        limit: window.limit,
        windowMinutes: window.minutes,
        resetsAt: usages.length ? oldestUsageAt + window.minutes * 60_000 : null,
      } : null };
  }
  setPolicy(id, value) {
    const previous = this.entry(id), policy = validatePolicy(value);
    this.save(id, { ...previous, policy,
      ...(policy.newSessionWindow ? {} : { newSessionUsages: undefined }),
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
  admit(id, activeCount, session = undefined) {
    const now = this.clock();
    const synced = this.syncNewSessionWindow(this.entry(id), now);
    let item = synced.item;
    const p = item.policy;
    const createsNewSession = session?.createsNewSession === true;
    const sessionId = session?.sessionId;
    if (session !== undefined && (!session || typeof session !== 'object'
      || typeof session.createsNewSession !== 'boolean'
      || (sessionId !== undefined && (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)))
      || (createsNewSession && sessionId === undefined))) {
      throw new Error('Invalid new Web session admission');
    }
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
    let newSessionRecorded = false;
    if (createsNewSession && p.newSessionWindow) {
      const usages = item.newSessionUsages ?? [];
      if (!usages.some(usage => usage.id === sessionId)) {
        if (usages.length >= p.newSessionWindow.limit) {
          const oldestUsageAt = usages.reduce((oldest, usage) => Math.min(oldest, usage.usedAt), Infinity);
          const retryAt = oldestUsageAt + p.newSessionWindow.minutes * 60_000;
          reject(
            `New Web session window reached its configured limit. Existing sessions may continue; wait until ${new Date(retryAt).toISOString()} before starting another.`,
            retryAt,
          );
        }
        item = { ...item, newSessionUsages: [...usages, { id: sessionId, usedAt: now }] };
        newSessionRecorded = true;
      }
    }
    this.save(id, { ...item, lastStart: now, sessionStart: item.sessionStart || now, breakStart: item.breakStart || now });
    return { newSessionRecorded };
  }
  rollbackNewSession(id, sessionId) {
    if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
      throw new Error('Invalid new Web session rollback');
    }
    const synced = this.syncNewSessionWindow(this.entry(id), this.clock());
    const usages = synced.item.newSessionUsages ?? [];
    const retained = usages.filter(usage => usage.id !== sessionId);
    if (!synced.changed && retained.length === usages.length) return false;
    this.save(id, { ...synced.item,
      ...(retained.length ? { newSessionUsages: retained } : { newSessionUsages: undefined }) });
    return retained.length !== usages.length;
  }
  syncNewSessionWindow(item, now) {
    const window = item.policy.newSessionWindow;
    const usages = item.newSessionUsages ?? [];
    const retained = window
      ? usages.filter(usage => usage.usedAt > now - window.minutes * 60_000)
      : [];
    if (retained.length === usages.length && (window || item.newSessionUsages === undefined)) {
      return { item, changed: false };
    }
    return { item: { ...item,
      ...(retained.length ? { newSessionUsages: retained } : { newSessionUsages: undefined }) }, changed: true };
  }
}
module.exports = { AccountSafety, DEFAULT_POLICY, NEW_SESSION_WINDOW_LIMIT_RANGE,
  NEW_SESSION_WINDOW_MINUTES_RANGE, validatePolicy };
