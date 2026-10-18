const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGES = {
  codex_not_found: 'The official Codex executable could not be found.',
  invalid_configuration: 'Native Codex client control is not configured.',
  invalid_parameters: 'The native thread request is invalid.',
  invalid_thread_id: 'The native thread identifier is invalid.',
  spawn_failed: 'The configured Codex executable could not start.',
  home_mismatch: 'Codex did not confirm the configured profile. No thread action was sent.',
  client_closed: 'The native Codex connection is closed.',
  transport_error: 'The native Codex connection failed.',
  rpc_timeout: 'Codex did not return metadata in time. Reload to try the read again.',
  rpc_error: 'The installed Codex server rejected this action.',
  invalid_response: 'The installed Codex server returned unsupported metadata.',
  response_too_large: 'Codex returned more metadata than this view can safely display.',
  request_too_large: 'The native thread request is too large.',
  too_many_requests: 'A native thread request is already pending. Wait for it to finish.',
  user_action_required: 'Fork requires an explicit user action.',
  fork_outcome_unknown: 'The fork outcome is unknown. Reload native threads and inspect them before trying again.',
  fork_journal_unavailable: 'Private native fork receipts are unavailable. No new fork can be sent until receipt storage is restored.',
  fork_reconciliation_required: 'Inspect and acknowledge the earlier uncertain fork before creating another fork of this thread.',
  process_not_settled: 'The owned native Codex connection has not closed.',
  cancelled: 'The metadata read was cancelled.',
};
function invalid() { throw Object.assign(new Error(MESSAGES.invalid_parameters), { code: 'invalid_parameters' }); }
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function input(value, allowed) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) invalid();
  return value;
}
function id(value) { if (typeof value !== 'string' || !UUID.test(value)) invalid(); return value; }
function noArgs(args) { if (args.length) invalid(); }
function failure(reason) {
  const code = Object.hasOwn(MESSAGES, reason?.code) ? reason.code : 'native_control_unavailable';
  const result = { code, message: MESSAGES[code] || 'Native Codex client control is unavailable.' };
  if (typeof reason?.rpcCode === 'number') {
    result.rpcCode = reason.rpcCode;
    if (reason.rpcCode === -32601) result.message = 'This installed Codex version does not support this action.';
  }
  return { ok: false, error: result };
}

// `handle` MUST be main's sender-authorized handler wrapper. getClient is a lazy,
// main-owned, cached service; renderer input can never select its executable/home/socket.
function registerCodexClientControlIpc({ handle, getClient }) {
  const register = (channel, action) => handle(channel, async (_event, ...args) => {
    try { return { ok: true, value: await action(args) }; }
    catch (reason) { return failure(reason); }
  });
  register('launcher:native-threads-snapshot', args => { noArgs(args); return getClient().snapshot(); });
  register('launcher:native-threads-list', args => {
    if (args.length > 1) invalid();
    const params = args[0] === undefined ? {} : input(args[0], ['cursor', 'limit', 'cwd', 'archived']);
    return getClient().listThreads(params);
  });
  register('launcher:native-thread-read', args => {
    if (args.length !== 1) invalid();
    return getClient().readThread(id(args[0]));
  });
  register('launcher:native-thread-fork', args => {
    if (args.length !== 1) invalid();
    const params = input(args[0], ['threadId', 'lastTurnId']);
    const validated = { threadId: id(params.threadId), userInitiated: true };
    if (params.lastTurnId !== undefined) {
      if (typeof params.lastTurnId !== 'string' || !params.lastTurnId || params.lastTurnId.length > 128
        || /[\u0000-\u001f]/.test(params.lastTurnId)) invalid();
      validated.lastTurnId = params.lastTurnId;
    }
    return getClient().forkThread(validated);
  });
  register('launcher:native-thread-acknowledge-fork', args => {
    if (args.length !== 1) invalid();
    const params = input(args[0], ['actionId', 'threadId', 'confirmedInspection']);
    if (params.confirmedInspection !== true) invalid();
    return getClient().acknowledgeFork({ actionId: id(params.actionId), threadId: id(params.threadId), confirmedInspection: true });
  });
}

module.exports = { registerCodexClientControlIpc };
