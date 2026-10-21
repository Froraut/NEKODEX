const { createCodexAppServerConnection, absolute, record, error } = require('./codex-app-server-connection.cjs');
const { createCodexHandoffJournal } = require('./codex-handoff-journal.cjs');
const { readRecordedServiceTier } = require('./codex-rollout-settings.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TURN_ID = /^[^\u0000-\u001f]{1,128}$/;
const MAX_TEXT_BYTES = 32 * 1024;
const MAX_REPLY_BYTES = 128 * 1024;
const TERMINAL = ['completed', 'interrupted', 'failed'];
// Codex reports an explicit `null` tier as its standard `default` tier.
const standardTier = tier => tier === null || tier === 'default';
const sameServiceTier = (requested, reported) => requested === reported || (standardTier(requested) && standardTier(reported));

function text(value) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > MAX_TEXT_BYTES || value.includes('\0')) {
    throw error('invalid_parameters', 'Provide nonempty message text of at most 32 KiB');
  }
  return value;
}
function bounded(value) {
  if (Buffer.byteLength(value) <= MAX_REPLY_BYTES) return { text: value, truncated: false };
  // Truncate on a code-point boundary and say so; never present it as the complete reply.
  let end = Math.min(value.length, MAX_REPLY_BYTES);
  while (end > 0 && Buffer.byteLength(value.slice(0, end)) > MAX_REPLY_BYTES) end--;
  if (end > 0 && /[\ud800-\udbff]/.test(value[end - 1])) end--;
  return { text: value.slice(0, end), truncated: true };
}

/** Main-only exclusive cooperative handoff for an external Codex client's thread.
 *
 * Exclusivity is Codex's own: every local thread writer holds a per-thread
 * cross-process lock in `$CODEX_HOME/thread-writer-locks`, and `thread/resume`
 * from another process is refused with `-32600 thread <id> already has an active
 * writer` until the current owner unloads the thread or exits. This service owns a
 * dedicated `codex app-server --stdio` child per explicit action: acquire (resume),
 * send exactly one turn, await its terminal state, then close the child, which
 * releases the writer for the external client. The resume carries the thread's own
 * recorded service tier, so the profile's global default is never applied. It never
 * retries, never steers an active turn, declines that thread's approval requests and
 * refuses every other server request (approvals fail closed). */
function createCodexThreadHandoff({ executable, codexHome, journalPath, cwd, environment = process.env,
  spawnProcess, terminateProcess, requestTimeoutMs = 30_000, turnTimeoutMs = 30 * 60_000,
  interruptGraceMs = 30_000, stopGraceMs = 10_000 } = {}) {
  executable = absolute(executable, 'Codex executable');
  codexHome = absolute(codexHome, 'Codex home');
  if (journalPath !== undefined) journalPath = absolute(journalPath, 'Handoff journal');
  if (!Number.isInteger(turnTimeoutMs) || turnTimeoutMs < 1000 || turnTimeoutMs > 4 * 3600_000
    || !Number.isInteger(interruptGraceMs) || interruptGraceMs < 100 || interruptGraceMs > 120_000) {
    throw error('invalid_configuration', 'Invalid native handoff bounds');
  }
  const journal = createCodexHandoffJournal({ journalPath, codexHome, executable });
  let current = null, destroyed = false, lastError = null;

  function snapshot() {
    return {
      available: Boolean(journal) && !destroyed,
      transport: 'owned-stdio-server',
      exclusivity: 'codex-thread-writer-lock',
      approvals: 'declined',
      active: current ? { actionId: current.actionId, threadId: current.threadId, phase: current.phase } : null,
      uncertainHandoffs: journal?.snapshot() || [],
      errorCode: lastError,
    };
  }
  const currentOperation = () => current ? 'Continuing a native Codex thread' : null;

  async function continueThread({ threadId, text: input, userInitiated } = {}) {
    if (userInitiated !== true) throw error('user_action_required', 'Handoff requires an explicit user action');
    if (typeof threadId !== 'string' || !UUID.test(threadId)) throw error('invalid_thread_id', 'Invalid Codex thread ID');
    input = text(input);
    if (destroyed) throw error('client_closed', 'Native handoff is closed');
    if (!journal) throw error('handoff_journal_unavailable', 'A private durable handoff journal is required');
    if (current) throw error('handoff_busy', 'Another native handoff is running');
    const actionId = journal.begin(threadId);
    const turns = new Map(), replies = new Map();
    let turnId = null, approvalsRefused = 0, wake = null, sent = false;
    const signal = () => { const resolve = wake; wake = null; resolve?.(); };
    const connection = createCodexAppServerConnection({ executable, codexHome, cwd, environment,
      requestTimeoutMs, stopGraceMs, clientName: 'nekodex-thread-handoff', declineApprovalsFor: threadId,
      ...(spawnProcess ? { spawnProcess } : {}), ...(terminateProcess ? { terminateProcess } : {}),
      // Counts every request that was not granted: declined approvals and refused other requests.
      onServerRequest: () => { approvalsRefused++; },
      onNotification: (method, params) => {
        if (!params || params.threadId !== threadId) return;
        if (method === 'item/completed' && record(params.item) && params.item.type === 'agentMessage'
          && typeof params.item.text === 'string' && typeof params.turnId === 'string' && turns.size + replies.size < 64) {
          replies.set(params.turnId, params.item.text);
        } else if (method === 'turn/completed' && record(params.turn) && typeof params.turn.id === 'string'
          && TERMINAL.includes(params.turn.status) && turns.size < 64) {
          turns.set(params.turn.id, params.turn.status);
        } else return;
        signal();
      } });
    current = { actionId, threadId, phase: 'acquiring', connection };
    lastError = null;
    const phase = (next, patch = {}) => { journal.update(actionId, { phase: next, ...patch }); current.phase = next; };
    const settle = (state, reasonCode, patch = {}) => {
      try { journal.update(actionId, { state, reasonCode, approvalsRefused, ...patch }); }
      catch { journal.uncertain(actionId, 'receipt_not_saved', { approvalsRefused, ...patch }); }
    };
    const waitTurn = async ms => {
      const deadline = Date.now() + ms;
      for (;;) {
        if (turns.has(turnId)) return turns.get(turnId);
        if (connection.isClosed() || connection.failureCode()) throw error('handoff_owner_lost', 'The handoff process closed during the turn');
        const remaining = deadline - Date.now();
        if (remaining <= 0) return null;
        let timer;
        await new Promise(resolve => {
          wake = resolve;
          timer = setTimeout(resolve, Math.min(remaining, 250));
        });
        clearTimeout(timer);
      }
    };
    try {
      try { await connection.connect(); }
      catch (reason) { settle('failed', 'connect_failed'); throw reason; }
      let read;
      try { read = await connection.request('thread/read', { threadId, includeTurns: false }); }
      catch (reason) { settle('failed', reason.code === 'rpc_error' ? 'read_rejected' : 'read_failed'); throw reason; }
      if (!record(read?.thread) || read.thread.id !== threadId) {
        settle('failed', 'invalid_metadata'); throw error('invalid_response', 'Codex returned a different thread');
      }
      // Subagent threads are owned by their parent conversation, never by a handoff.
      if (typeof read.thread.parentThreadId === 'string' || read.thread.ephemeral === true) {
        settle('refused', 'not_a_root_thread'); throw error('handoff_subagent_thread', 'Only a persisted root thread can be handed off');
      }
      // Codex restores the persisted model, approval policy and sandbox by itself, but resumes with
      // the profile's configured service tier. Pass the tier this thread last recorded instead; one
      // that never recorded a tier gets Codex's standard tier, never the global default.
      let serviceTier;
      try { ({ serviceTier } = await readRecordedServiceTier({ codexHome, rolloutPath: read.thread.path, threadId })); }
      catch {
        settle('failed', 'settings_unreadable');
        throw error('handoff_settings_unconfirmed', 'Codex did not report the thread settings; nothing was sent');
      }
      let resumed;
      try {
        resumed = await connection.request('thread/resume', { threadId, excludeTurns: true, serviceTier });
      } catch (reason) {
        if (reason.writerOwned) {
          settle('refused', 'owner_active');
          throw error('handoff_owner_active', 'Another Codex client still owns this thread', { rpcCode: reason.rpcCode });
        }
        if (reason.code === 'rpc_error') {
          settle('failed', 'resume_rejected');
          throw error('handoff_resume_rejected', 'Codex rejected the handoff', { rpcCode: reason.rpcCode });
        }
        // Nothing was sent; closing this owned process releases any writer it acquired.
        settle('failed', 'resume_not_confirmed');
        throw error('handoff_resume_unconfirmed', 'Codex did not confirm the handoff; nothing was sent');
      }
      if (!record(resumed?.thread) || resumed.thread.id !== threadId || !record(resumed.thread.status)) {
        settle('failed', 'invalid_resume_receipt'); throw error('invalid_response', 'Codex returned an invalid handoff receipt');
      }
      if (resumed.thread.status.type !== 'idle') {
        // turn/start on an active thread would steer someone else's turn.
        settle('refused', 'thread_not_idle'); throw error('handoff_thread_not_idle', 'The thread is not idle in the exclusive owner');
      }
      if (!sameServiceTier(serviceTier, resumed.serviceTier)) {
        // Codex ignored or could not apply the thread's own tier; never send under another one.
        settle('refused', 'service_tier_changed');
        throw error('handoff_settings_unconfirmed', 'Codex would not keep the thread service tier; nothing was sent');
      }
      phase('held');
      phase('dispatching'); // Durable before the only mutation; a lost reply is never replayed.
      let started;
      try {
        sent = true;
        started = await connection.request('turn/start', { threadId,
          input: [{ type: 'text', text: input, text_elements: [] }] }, { lostCode: 'handoff_outcome_unknown' });
      } catch (reason) {
        if (reason.cause?.code === 'rpc_error' && reason.cause.authoritative) {
          settle('failed', 'turn_rejected');
          throw error('handoff_turn_rejected', 'Codex rejected the message', { rpcCode: reason.cause.rpcCode });
        }
        journal.uncertain(actionId, 'turn_outcome_unknown', { approvalsRefused });
        throw error('handoff_outcome_unknown', 'The message outcome is unknown; inspect the thread before sending again');
      }
      if (!record(started?.turn) || typeof started.turn.id !== 'string' || !TURN_ID.test(started.turn.id)) {
        journal.uncertain(actionId, 'invalid_turn_receipt', { approvalsRefused });
        throw error('handoff_outcome_unknown', 'Codex returned an invalid turn receipt; inspect the thread');
      }
      turnId = started.turn.id;
      phase('running', { turnId });
      let status;
      try {
        status = await waitTurn(turnTimeoutMs);
        if (status === null) {
          // Our own turn only: the exclusive owner may interrupt what it started.
          try { await connection.request('turn/interrupt', { threadId, turnId }); } catch { /* Settled below. */ }
          status = await waitTurn(interruptGraceMs);
          if (status === null) throw error('handoff_turn_unsettled', 'The turn did not settle after interruption');
        }
      } catch (reason) {
        journal.uncertain(actionId, reason.code === 'handoff_turn_unsettled' ? 'turn_unsettled' : 'owner_lost', { approvalsRefused, turnId });
        throw error('handoff_outcome_unknown', 'The turn did not report a final state; inspect the thread');
      }
      phase('releasing', { turnStatus: status });
      try { await connection.destroy(); }
      catch {
        journal.uncertain(actionId, 'release_unconfirmed', { approvalsRefused, turnId, turnStatus: status });
        throw error('handoff_release_unconfirmed', 'The handoff process did not close; the thread may remain owned');
      }
      const reply = replies.has(turnId) ? bounded(replies.get(turnId)) : null;
      settle('completed', null, { phase: 'released', turnId, turnStatus: status, completedAt: new Date().toISOString() });
      return { actionId, threadId, turnId, turnStatus: status, approvalsRefused, released: true,
        executionOwner: 'released', assistantText: reply?.text ?? null, assistantTextTruncated: reply?.truncated === true };
    } catch (reason) {
      lastError = reason?.code || 'handoff_failed';
      if (journal.find(actionId)?.state === 'pending') {
        // A receipt write failed between phases. Before the send nothing ran; after it, inspect.
        if (sent) journal.uncertain(actionId, 'receipt_not_saved', { approvalsRefused, turnId });
        else settle('failed', 'handoff_failed');
      }
      throw reason;
    } finally {
      try { await connection.destroy(); } catch { /* Recorded above when the outcome depended on it. */ }
      current = null;
    }
  }
  function acknowledge({ actionId, threadId, confirmedInspection } = {}) {
    if (confirmedInspection !== true || typeof actionId !== 'string' || !UUID.test(actionId)
      || typeof threadId !== 'string' || !UUID.test(threadId)) {
      throw error('invalid_parameters', 'Explicit handoff inspection acknowledgement is required');
    }
    if (!journal) throw error('handoff_journal_unavailable', 'Native handoff receipts are unavailable');
    journal.acknowledge(actionId, threadId);
    return snapshot();
  }
  /** Closing an active handoff ends its owned process; Codex then stops the turn and releases the writer. */
  async function destroy() {
    destroyed = true;
    await current?.connection.destroy();
  }
  return Object.freeze({ continueThread, acknowledge, snapshot, currentOperation, destroy });
}

module.exports = { createCodexThreadHandoff };
