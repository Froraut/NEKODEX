const fs = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const { processRunning } = require('./process-tree.cjs');

const { isTaskModel } = require('./browser-task-ledger.cjs');
const { READINESS_CODES, admissionFailureMessage } = require('./admission-failure-copy.cjs');

const MAX_WAITING = 64;
// A queued task whose account stays unready this long fails with an explicit cause.
// Codex otherwise sees only heartbeats while a missing tunnel or sign-in never resolves.
const ACCOUNT_NOT_READY_GRACE_MS = 45_000;
// Holds decided before the account is examined say nothing about its readiness, so they
// neither start nor reset the readiness deadline. A global pause is the user's choice and
// gives a fresh grace afterwards.
const TIMER_NEUTRAL_HOLDS = new Set(['capacity', 'runtime-transition', 'previous-submission-needs-review']);
const terminal = new Set(['cancelled', 'failed', 'interrupted', 'admitted', 'running', 'finished']);
const known = new Set(['waiting', 'paused', ...terminal]);
const idPattern = /^[a-f0-9-]{36}$/;
const tracePattern = /^[A-Za-z0-9_-]{6,128}$/;
const accountPattern = /^(default|[a-f0-9-]{36})$/;
// Persist only audited terminal outcomes, never arbitrary exception text or data.
// Account-readiness causes are kept in the separate admissionBlocker field: launchers that
// predate it ignore an unknown row field but reject an unknown terminalFailure code.
const terminalFailureMessages = new Map([
  ['retained_conversation_unavailable', 'The retained ChatGPT conversation is no longer available'],
]);
function terminalFailure(error) {
  if (!terminalFailureMessages.has(error?.code)) return undefined;
  return { code: error.code, ...(error.workStarted === false ? { workStarted: false } : {}) };
}
function validTerminalFailure(failure) {
  return failure && typeof failure === 'object' && !Array.isArray(failure)
    && terminalFailureMessages.has(failure.code)
    && Object.keys(failure).every(key => key === 'code' || key === 'workStarted')
    && (!Object.hasOwn(failure, 'workStarted') || failure.workStarted === false);
}

function validateRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || typeof input.traceId !== 'string' || !tracePattern.test(input.traceId) || !Number.isSafeInteger(input.helperPid) || input.helperPid < 1
    || typeof input.reveal !== 'boolean' || typeof input.retained !== 'boolean' || input.taskProgressVersion !== 1
    || ![input.key, input.routingKey].every(key => key === null || typeof key === 'string' && /^[a-f0-9]{64}$/.test(key))
    || !(input.connector === null || typeof input.connector === 'string' && input.connector.length <= 80)
    || !(input.requestedModel === undefined || input.requestedModel === null || isTaskModel(input.requestedModel))
    || !(input.effort === null || ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'luna'].includes(input.effort))
    || !(input.requestedAccountId === null || accountPattern.test(input.requestedAccountId))) throw new Error('Invalid queued task owner');
  const allowed = ['traceId', 'helperPid', 'reveal', 'key', 'connector', 'retained', 'effort', 'routingKey', 'taskProgressVersion', 'requestedAccountId'];
  if (Object.hasOwn(input, 'requestedModel')) allowed.push('requestedModel');
  if (Object.keys(input).length !== allowed.length || allowed.some(key => !Object.hasOwn(input, key))) throw new Error('Invalid queued task fields');
}
function fingerprint(input) {
  // The canonical execution trace owns the prompt; retain scheduling requirements only.
  const { helperPid, requestedModel, ...requirements } = input;
  return createHash('sha256').update(JSON.stringify({ ...requirements, requestedModel: requestedModel ?? null })).digest('hex');
}

class BrowserAdmissionQueue {
  constructor({ file, inspect, dispatch, releaseUnsent, leaseCurrent = () => false, changed = () => {}, clock = Date.now, alive = processRunning, autoPump = true,
    language = () => 'en', accountLabel = () => undefined }) {
    Object.assign(this, { file, inspect, dispatch, releaseUnsent, leaseCurrent, changed, clock, alive, language, accountLabel });
    this.entries = []; this.paused = false; this.pausedAccounts = new Set(); this.closed = false;
    this.cancelledOwners = new Set();
    this.pumping = false; this.storageIssue = null;
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error('Invalid admission journal');
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved.version !== 1 || typeof saved.paused !== 'boolean' || !Array.isArray(saved.pausedAccounts)
        || saved.pausedAccounts.length > 1000 || saved.pausedAccounts.some(id => !accountPattern.test(id))
        || !Array.isArray(saved.entries) || saved.entries.length > 2048) throw new Error('Invalid admission journal');
      this.paused = saved.paused; this.pausedAccounts = new Set(saved.pausedAccounts);
      if (saved.cancelledOwners !== undefined && (!Array.isArray(saved.cancelledOwners) || saved.cancelledOwners.length > 4096
        || saved.cancelledOwners.some(key => typeof key !== 'string' || !/^[1-9][0-9]*:[A-Za-z0-9_-]{6,128}$/.test(key)))) throw new Error('Invalid queue cancellation journal');
      this.cancelledOwners = new Set(saved.cancelledOwners ?? []);
      this.entries = saved.entries.map(row => {
        validateRequest(row.request);
        if (!idPattern.test(row.id) || !known.has(row.status) || !Number.isSafeInteger(row.priority)
          || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0 || row.createdAt > 8_640_000_000_000_000) throw new Error('Invalid admission record');
        // 6.1.18 journaled readiness causes as terminalFailure codes; read them back as blockers.
        const admissionBlocker = row.status !== 'failed' ? undefined
          : READINESS_CODES.has(row.admissionBlocker) ? row.admissionBlocker
            : READINESS_CODES.has(row.terminalFailure?.code) ? row.terminalFailure.code : undefined;
        // An unknown terminal code (for example from a newer launcher) only loses its explanation;
        // it never makes the whole journal unavailable.
        const audited = row.status === 'failed' && !admissionBlocker && validTerminalFailure(row.terminalFailure);
        return { id: row.id, request: row.request, priority: row.priority, createdAt: row.createdAt,
          ...(audited ? { terminalFailure: terminalFailure(row.terminalFailure) } : {}),
          ...(admissionBlocker ? { admissionBlocker, blockerReported: true,
            ...(typeof row.blockerAccountId === 'string' && accountPattern.test(row.blockerAccountId) ? { blockerAccountId: row.blockerAccountId } : {}) } : {}),
          status: ['waiting', 'paused'].includes(row.status) ? 'paused' : ['admitted', 'running'].includes(row.status) ? 'interrupted' : row.status,
          reason: ['waiting', 'paused'].includes(row.status) ? 'owner-reconnect-required'
            : row.status === 'interrupted' && row.reason === 'lease-ended' ? 'lease-ended' : 'previous-run',
          lastSeen: 0, needsOwner: true, fingerprint: fingerprint(row.request) };
      });
      if (new Set(this.entries.map(row => row.id)).size !== this.entries.length) throw new Error('Duplicate admission record');
      // Rewrite 6.1.18 readiness rows at once, so a rollback to an older launcher can read the journal.
      if (saved.entries.some(row => row.status === 'failed' && READINESS_CODES.has(row.terminalFailure?.code))) {
        try { this.save(); } catch { /* save() records the storage issue */ }
      }
    } catch (error) { if (error.code !== 'ENOENT') this.storageIssue = 'queue-storage-unavailable'; }
    if (autoPump) { this.timer = setInterval(() => void this.pump(), 1000); this.timer.unref?.(); }
  }
  save() {
    if (this.storageIssue) throw new Error('Admission history is unavailable; repair its storage before starting new tasks');
    try { writePrivateFileAtomic(this.file, JSON.stringify({ version: 1, paused: this.paused,
      cancelledOwners: [...this.cancelledOwners],
      pausedAccounts: [...this.pausedAccounts], entries: this.entries.map(row => ({
        id: row.id, request: row.request, createdAt: row.createdAt, priority: row.priority,
        status: row.status === 'admitting' ? 'waiting' : row.status,
        ...(row.status === 'failed' && row.terminalFailure ? { terminalFailure: row.terminalFailure } : {}),
        ...(row.status === 'failed' && row.admissionBlocker ? { admissionBlocker: row.admissionBlocker,
          ...(row.blockerAccountId ? { blockerAccountId: row.blockerAccountId } : {}) } : {}),
        ...(row.status === 'interrupted' && row.reason === 'lease-ended' ? { reason: 'lease-ended' } : {}),
      })) }) + '\n', { durable: true }); }
    catch (error) { this.storageIssue = 'queue-storage-unavailable'; throw error; }
  }
  publish() { this.changed(); }
  accountPaused(id) { return this.pausedAccounts.has(id); }
  ordered() { return this.entries.filter(row => ['waiting', 'paused', 'admitting'].includes(row.status))
    .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt); }
  snapshot() {
    const ordered = this.ordered();
    return { paused: this.paused, pausedAccounts: [...this.pausedAccounts], storageIssue: this.storageIssue,
      entries: this.entries.filter(row => !['running', 'finished'].includes(row.status)).map(row => {
        const unready = row.status === 'waiting' && row.notReadySince !== undefined
          && (row.reason === 'account-not-ready' || TIMER_NEUTRAL_HOLDS.has(row.reason));
        return {
        id: row.id, traceId: row.request.traceId, accountId: row.request.requestedAccountId,
        status: row.cancelRequested && row.status === 'admitting' ? 'cancelling' : row.status === 'admitted' ? 'admitting' : row.status,
        reason: row.reason ?? null, createdAt: row.createdAt,
        position: ordered.indexOf(row) + 1, retryAt: row.retryAt ?? null,
        // A neutral hold (capacity, runtime transition, previous submission) keeps the readiness
        // clock running, so its cause and deadline stay visible beside the hold's own reason.
        cause: row.status === 'failed' ? row.admissionBlocker ?? null : unready ? row.blocker ?? null : null,
        causeAccountId: row.status === 'failed' || unready ? row.blockerAccountId ?? null : null,
        failsAt: unready ? row.notReadySince + ACCOUNT_NOT_READY_GRACE_MS : null,
        failure: row.status === 'failed' && !row.admissionBlocker ? row.terminalFailure?.code ?? null : null,
        ownerConnected: !row.needsOwner && this.clock() - row.lastSeen < 10_000 && this.alive(row.request.helperPid),
        canCancel: !row.cancelRequested && ['waiting', 'paused', 'admitting', 'admitted'].includes(row.status), canPrioritize: row.status === 'waiting',
        canResume: row.status === 'paused' && !row.needsOwner && this.clock() - row.lastSeen < 10_000 && this.alive(row.request.helperPid), canDismiss: ['cancelled', 'failed', 'interrupted'].includes(row.status),
        };
      }) };
  }
  request(input) {
    validateRequest(input);
    if (this.closed) throw new Error('Browser admission is closed');
    if (this.storageIssue) throw new Error('Admission history is unavailable');
    if (this.cancelledOwners.has(`${input.helperPid}:${input.traceId}`)) throw Object.assign(new Error('Queued task was cancelled before admission'), { code: 'turn_cancelled' });
    const hash = fingerprint(input);
    let row = this.entries.find(item => item.request.traceId === input.traceId);
    if (row) {
      if (row.fingerprint !== hash) throw new Error('Queued task requirements changed for the same execution');
      const readinessFailed = row.status === 'failed' && Boolean(row.admissionBlocker);
      if (!readinessFailed && row.request.helperPid !== input.helperPid && (!row.needsOwner || this.alive(row.request.helperPid))) throw new Error('Queued task belongs to another live helper');
      if (readinessFailed && row.blockerReported) {
        // The failed attempt already returned its cause. A later attempt for the same never-sent
        // execution, typically a retry after the user fixed the account, gets a fresh check.
        Object.assign(row, { status: 'waiting', reason: 'checking', admissionBlocker: undefined, blockerAccountId: undefined,
          blockerReported: false, blocker: undefined, notReadySince: undefined, retryAt: undefined, needsOwner: false, lastSeen: this.clock() });
        row.request.helperPid = input.helperPid; this.save(); this.publish();
      } else if (row.needsOwner && ['waiting', 'paused'].includes(row.status)) {
        // A live owner that only missed polls (for example while the Mac slept) continues. Work
        // restored after a restart, or owned by a process that died, still waits for Resume.
        const sameLiveOwner = row.pausedLive === true && row.request.helperPid === input.helperPid;
        row.request.helperPid = input.helperPid; row.needsOwner = false; row.lastSeen = this.clock(); row.pausedLive = false;
        if (sameLiveOwner && row.status === 'paused' && row.reason === 'owner-reconnect-required') {
          row.status = 'waiting'; row.reason = 'checking'; row.notReadySince = undefined; row.blocker = undefined;
        }
        this.save(); this.publish();
      }
    } else {
      if (this.ordered().length >= MAX_WAITING) throw new Error('Browser admission queue is full (64 waiting tasks)');
      if (this.entries.length >= 2048) {
        const old = this.entries.find(item => ['cancelled', 'failed', 'finished'].includes(item.status));
        if (!old) throw new Error('Review and dismiss old queue records before submitting more work');
        this.entries = this.entries.filter(item => item !== old);
      }
      row = { id: randomUUID(), request: input, fingerprint: hash, createdAt: this.clock(),
        priority: 0, status: 'waiting', reason: 'checking', lastSeen: this.clock(), needsOwner: false };
      this.entries.push(row); this.save(); this.publish();
    }
    row.lastSeen = this.clock();
    if (row.status === 'admitted') {
      if (!this.leaseCurrent(row.request, row.result)) {
        row.status = 'interrupted'; row.reason = 'lease-ended'; this.save(); this.publish();
      } else return { queued: false, queueId: row.id, ...row.result };
    }
    if (row.status === 'failed' && row.admissionBlocker) {
      row.blockerReported = true;
      const label = row.blockerAccountId ? this.accountLabel(row.blockerAccountId) : undefined;
      throw Object.assign(new Error(admissionFailureMessage(row.admissionBlocker, this.language(), label)),
        { code: row.admissionBlocker, workStarted: false });
    }
    if (row.status === 'failed' && row.terminalFailure) {
      throw Object.assign(new Error(terminalFailureMessages.get(row.terminalFailure.code)), row.terminalFailure);
    }
    if (terminal.has(row.status)) throw Object.assign(new Error('Queued task ended before a new submission; review its outcome in Task center'), {
      code: row.status === 'cancelled' ? 'turn_cancelled' : 'queue_task_ended',
    });
    void this.pump();
    return { queued: true, queueId: row.id, notSent: true, position: this.ordered().indexOf(row) + 1 };
  }
  async pump() {
    if (this.pumping || this.closed || this.storageIssue) return;
    this.pumping = true;
    try {
      // The host can reap an issued lease without another owner poll or endTurn.
      // Missing ownership is uncertain completion, never permission to resubmit.
      let reconciled = false;
      for (const row of this.entries) {
        if (['admitted', 'running'].includes(row.status) && !this.leaseCurrent(row.request, row.result)) {
          row.status = 'interrupted'; row.reason = 'lease-ended'; reconciled = true;
        }
      }
      if (reconciled) { this.save(); this.publish(); }
      // Re-read priority after each awaited acquisition. Visit each candidate at
      // most once per pass so held/retryable tasks cannot spin the pump.
      const candidates = new Set(this.ordered());
      while (candidates.size) {
        if (this.closed) break;
        const row = this.ordered().find(item => candidates.has(item));
        if (!row) break;
        candidates.delete(row);
        if (row.status !== 'waiting') continue;
        if (row.needsOwner || this.clock() - row.lastSeen >= 10_000 || !this.alive(row.request.helperPid)) {
          row.pausedLive = !row.needsOwner && this.alive(row.request.helperPid);
          row.status = 'paused'; row.reason = 'owner-reconnect-required'; row.needsOwner = true;
          row.notReadySince = undefined; row.blocker = undefined; this.save(); this.publish(); continue;
        }
        const held = this.paused ? { reason: 'paused-global' }
          : this.accountPaused(row.request.requestedAccountId) ? { reason: 'paused-account' } : this.inspect(row.request);
        if (held?.reason === 'predispatch-failure' && terminalFailureMessages.has(held.failure)) {
          // A proven, permanent predispatch outcome fails at once with its own recoverable code.
          row.status = 'failed'; row.reason = 'admission-failed'; row.retryAt = undefined;
          row.terminalFailure = { code: held.failure, workStarted: false };
          this.save(); this.publish(); continue;
        }
        if (held?.reason === 'account-not-ready') {
          if (this.holdUnready(row, held)) continue;
        } else if (held && !TIMER_NEUTRAL_HOLDS.has(held.reason)) { row.notReadySince = undefined; row.blocker = undefined; }
        // No hold: dispatch decides. A readiness cause found only at dispatch keeps its deadline.
        if (held) {
          if (row.reason !== held.reason || row.retryAt !== held.retryAt) {
            row.reason = held.reason; row.retryAt = held.retryAt; this.publish();
          }
          continue;
        }
        row.status = 'admitting'; row.reason = 'acquiring'; row.controller = new AbortController(); this.publish();
        try {
          row.result = await this.dispatch(row.request, row.controller.signal);
          if (row.cancelRequested) {
            const released = await this.releaseUnsent(row.request);
            row.status = released ? 'cancelled' : 'interrupted';
          } else { row.status = 'admitted'; row.notReadySince = undefined; row.blocker = undefined; }
        } catch (error) {
          if (row.cancelRequested) row.status = await this.releaseUnsent(row.request) ? 'cancelled' : 'interrupted';
          else if (error?.code === 'account_cooldown' || error?.code === 'browser_capacity_full') {
            row.status = 'waiting'; row.reason = 'local-admission'; row.retryAt = error.retryAt;
            row.notReadySince = undefined; row.blocker = undefined;
          } else if (error?.workStarted === false && READINESS_CODES.has(error?.blocker)) {
            // Dispatch rechecks requirements that preview may not see, such as the tunnel of an
            // exact retained page. Such a cause waits out the same grace before failing.
            row.status = 'waiting'; row.reason = 'account-not-ready'; row.retryAt = undefined;
            this.holdUnready(row, { blocker: error.blocker, accountId: error.accountId });
          } else {
            row.status = 'failed'; row.reason = 'admission-failed';
            row.terminalFailure = terminalFailure(error);
          }
        }
        this.save(); this.publish();
      }
    } catch { this.storageIssue = 'queue-storage-unavailable'; this.publish(); }
    finally { this.pumping = false; }
  }
  /** Records an account-readiness hold; returns true when its grace ran out and the row failed. */
  holdUnready(row, held) {
    row.notReadySince ??= this.clock();
    row.blocker = READINESS_CODES.has(held.blocker) ? held.blocker : 'account_not_ready';
    row.blockerAccountId = typeof held.accountId === 'string' && accountPattern.test(held.accountId) ? held.accountId : undefined;
    if (this.clock() - row.notReadySince < ACCOUNT_NOT_READY_GRACE_MS) return false;
    Object.assign(row, { status: 'failed', reason: 'admission-failed', retryAt: undefined, admissionBlocker: row.blocker,
      blockerReported: false, notReadySince: undefined });
    this.save(); this.publish();
    return true;
  }
  async cancelOwner(traceId, helperPid) {
    if (typeof traceId !== 'string' || !tracePattern.test(traceId) || !Number.isSafeInteger(helperPid) || helperPid < 1) throw new Error('Invalid queue cancellation owner');
    const row = this.entries.find(item => item.request.traceId === traceId);
    if (row && row.request.helperPid !== helperPid) throw new Error('Queue cancellation owner mismatch');
    if (this.cancelledOwners.size >= 4096) this.cancelledOwners = new Set([...this.cancelledOwners].filter(key => this.alive(Number(key.split(':')[0]))));
    if (this.cancelledOwners.size >= 4096) throw new Error('Pending cancellation journal is full');
    this.cancelledOwners.add(`${helperPid}:${traceId}`); this.save();
    if (!row) {
      return { cancelled: true, notSent: true };
    }
    // An audited predispatch failure proves that nothing reached ChatGPT.
    if (row.status === 'failed' && (row.admissionBlocker || row.terminalFailure?.workStarted === false)) return { cancelled: true, notSent: true };
    if (['interrupted', 'failed', 'finished'].includes(row.status)) return { cancelled: false, notSent: false };
    if (row.status === 'admitted' || row.status === 'running') {
      const released = await this.releaseUnsent(row.request);
      if (!released) return { cancelled: false, notSent: false };
      row.status = 'cancelled'; this.save(); this.publish(); return { cancelled: true, notSent: true };
    }
    if (row.status === 'admitting') {
      row.cancelRequested = true; row.controller.abort();
      this.publish();
      return { cancelling: true, notSent: true };
    }
    if (['waiting', 'paused'].includes(row.status)) { row.status = 'cancelled'; row.reason = 'cancelled-before-send'; this.save(); this.publish(); }
    return { cancelled: true, notSent: true };
  }
  async action(id, action) {
    const row = this.entries.find(item => item.id === id);
    if (!row) throw new Error('Queued task no longer exists');
    if (action === 'cancel' && ['waiting', 'paused', 'admitting', 'admitted'].includes(row.status)) return this.cancelOwner(row.request.traceId, row.request.helperPid);
    if (action === 'resume' && row.status === 'paused') {
      row.status = 'waiting'; row.reason = row.needsOwner ? 'owner-reconnect-required' : 'checking';
      row.notReadySince = undefined; row.blocker = undefined; row.pausedLive = false;
    }
    else if (action === 'prioritize' && row.status === 'waiting') row.priority = Math.min(1_000_000_000, Math.max(0, ...this.entries.map(item => item.priority)) + 1);
    else if (action === 'dismiss' && ['cancelled', 'failed', 'interrupted', 'finished'].includes(row.status)) this.entries = this.entries.filter(item => item !== row);
    else throw new Error('This action is unavailable for the queued task');
    this.save(); this.publish(); void this.pump();
  }
  pause(accountId, paused) {
    if (typeof paused !== 'boolean' || !(accountId === null || accountPattern.test(accountId))) throw new Error('Invalid queue pause');
    if (accountId === null) this.paused = paused;
    else if (paused) this.pausedAccounts.add(accountId); else this.pausedAccounts.delete(accountId);
    this.save(); this.publish(); if (!paused) void this.pump();
  }
  acknowledge(traceId, helperPid, surfaceId) {
    const row = this.entries.find(item => item.request.traceId === traceId);
    if (!row || row.request.helperPid !== helperPid || !['admitted', 'running'].includes(row.status)
      || row.result?.surfaceId !== surfaceId || !this.leaseCurrent(row.request, row.result)) throw new Error('Browser admission acknowledgement no longer owns a live lease');
    if (row.status === 'admitted') { row.status = 'running'; this.save(); this.publish(); }
    return { acknowledged: true };
  }
  retire(traceId, helperPid) {
    const row = this.entries.find(item => item.request.traceId === traceId && item.request.helperPid === helperPid);
    if (row && ['admitted', 'running'].includes(row.status)) {
      row.status = 'finished';
      // The task result is already authoritative. A queue-history write failure must
      // disable admission and surface storageIssue, not discard a completed answer.
      try { this.save(); } catch { /* save records the storage failure */ }
      this.publish();
    }
  }
  close() {
    this.closed = true; clearInterval(this.timer);
    for (const row of this.entries) {
      if (row.status === 'admitting') row.cancelRequested = true;
      row.controller?.abort();
    }
  }
}
module.exports = { BrowserAdmissionQueue, MAX_WAITING, ACCOUNT_NOT_READY_GRACE_MS };
