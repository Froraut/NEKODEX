'use strict';
const { createHash, randomUUID } = require('node:crypto');
const posix = require('node:path').posix;
const REMOTE_GIT_REVIEW_LIMITS = Object.freeze({ paths: 32, fileBytes: 256 * 1024, selectedBytes: 384 * 1024, actions: 32, retainedBytes: 8 * 1024 * 1024, captures: 24 });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, HASH = /^[a-f0-9]{64}$/, OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const STATES = new Set(['reviewed', 'prepared', 'completed', 'failed', 'unknown']);
const clone = value => structuredClone(value);
function fail(code, message, recorded = false) { throw Object.assign(new Error(message), { code, actionRecorded: recorded }); }
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
function id(value) { if (typeof value !== 'string' || !UUID.test(value)) fail('invalid_git_request', 'Use the exact remote Git resource identifier.'); return value; }
function object(input, keys) { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) fail('invalid_git_request', 'Unexpected remote Git request fields.'); return input; }
function filePath(value) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 4096 || value.startsWith('/') || /[\\\x00-\x1f\x7f]/u.test(value)
    || value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) fail('unsupported_git_path', 'Choose a supported relative path inside the selected repository.'); return value;
}
function hash(value) { return typeof value === 'string' && HASH.test(value); }
function oid(value) { return value === null || typeof value === 'string' && OID.test(value); }
function target(scope) {
  if (!scope || typeof scope !== 'object' || !UUID.test(scope.hostId || '') || !UUID.test(scope.connectionId || '') || typeof scope.fingerprint !== 'string'
    || ![scope.root, scope.hostname, scope.username].every(value => typeof value === 'string' && value && !/[\x00-\x1f\x7f]/u.test(value))
    || !scope.root.startsWith('/') || !Number.isInteger(scope.port) || scope.port < 1 || scope.port > 65535) fail('remote_git_scope_changed', 'Remote Git requires the exact connected host and root.');
  return { hostId: scope.hostId, fingerprint: scope.fingerprint, connectionId: scope.connectionId, root: scope.root, hostname: scope.hostname, username: scope.username, port: scope.port };
}
function sameScope(a, b, connection = true) { return ['hostId', 'fingerprint', 'root', 'hostname', 'username', 'port', ...(connection ? ['connectionId'] : [])].every(key => a[key] === b[key]); }
function repository(value) {
  if (!value || typeof value !== 'object' || !['rootIdentity', 'gitIdentity', 'commonIdentity'].every(key => typeof value[key] === 'string' && /^\d+:\d+$/.test(value[key]))
    || !['gitDir', 'commonDir'].every(key => typeof value[key] === 'string' && value[key].startsWith('/') && !/[\x00-\x1f\x7f]/u.test(value[key]))
    || !oid(value.headOid) || value.headRef !== null && (typeof value.headRef !== 'string' || !/^refs\/heads\/[^\x00-\x20]+$/u.test(value.headRef))
    || value.indexDigest !== null && !hash(value.indexDigest) || !hash(value.mergeStateDigest) || !['sha1', 'sha256'].includes(value.objectFormat)
    || !Array.isArray(value.mergeHeads) || value.mergeHeads.length > 8 || value.mergeHeads.some(value => !oid(value) || value === null)) fail('invalid_git_response', 'Remote Git repository identity is unavailable.');
  return Object.fromEntries(['rootIdentity', 'gitDir', 'gitIdentity', 'commonDir', 'commonIdentity', 'headOid', 'headRef', 'indexDigest', 'mergeHeads', 'mergeStateDigest', 'objectFormat'].map(key => [key, clone(value[key])]));
}
function entries(values) {
  if (!Array.isArray(values) || values.length > 512) fail('invalid_git_response', 'Remote Git status exceeded its bound.');
  return values.map(row => {
    if (!row || typeof row.path !== 'string' || !row.path || Buffer.byteLength(row.path) > 4096 || typeof row.indexStatus !== 'string' || row.indexStatus.length !== 1 || typeof row.worktreeStatus !== 'string' || row.worktreeStatus.length !== 1 || !['tracked', 'untracked', 'conflict'].includes(row.kind)) fail('invalid_git_response', 'Remote Git status is malformed.');
    const value = { path: row.path, indexStatus: row.indexStatus, worktreeStatus: row.worktreeStatus, kind: row.kind };
    if (row.originalPath !== undefined) { if (typeof row.originalPath !== 'string' || Buffer.byteLength(row.originalPath) > 4096) fail('invalid_git_response', 'Remote rename identity is malformed.'); value.originalPath = row.originalPath; }
    if (row.stages !== undefined) { if (!Array.isArray(row.stages) || row.stages.length > 3 || row.stages.some(stage => ![1, 2, 3].includes(stage.stage) || !/^[0-7]{6}$/.test(stage.mode) || !oid(stage.oid) || stage.oid === null)) fail('invalid_git_response', 'Remote conflict stages are malformed.'); value.stages = clone(row.stages); }
    if (typeof row.binary === 'boolean') value.binary = row.binary;
    if (Number.isSafeInteger(row.bytes) && row.bytes >= 0) value.bytes = row.bytes;
    return value;
  });
}
function repoKey(scope, repo) { return digest(['remote-git-common-v1', scope.hostname.toLowerCase(), scope.port, scope.username, repo.commonDir, repo.commonIdentity]); }
function summary(plan) {
  const repo = repository(plan.repository), files = [];
  if (!Array.isArray(plan.paths) || plan.paths.length > REMOTE_GIT_REVIEW_LIMITS.paths || plan.paths.some(path => { try { filePath(path); return false; } catch { return true; } })
    || !Array.isArray(plan.files) || plan.files.length > REMOTE_GIT_REVIEW_LIMITS.paths || !Array.isArray(plan.parents) || plan.parents.some(value => !oid(value) || value === null)) fail('invalid_git_response', 'Remote mutation plan is malformed.');
  let total = 0;
  for (const file of plan.files) {
    filePath(file.path);
    if (!(file.remove === true && file.mode === null) && !/^[0-7]{6}$/.test(file.mode) || file.revision !== null && !hash(file.revision)) fail('invalid_git_response', 'Remote reviewed file identity is invalid.');
    const data = file.data === undefined ? null : typeof file.data === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data) ? Buffer.from(file.data, 'base64') : undefined;
    if (data === undefined || data && (data.length > REMOTE_GIT_REVIEW_LIMITS.fileBytes || data.toString('base64') !== file.data)) fail('invalid_git_response', 'Remote reviewed bytes are malformed.');
    total += data?.length || 0;
    files.push({ path: file.path, mode: file.mode, revision: file.revision, ...(data ? { sourceSha256: createHash('sha256').update(data).digest('hex') } : {}), bytes: data?.length || 0, remove: file.remove === true });
  }
  if (total > REMOTE_GIT_REVIEW_LIMITS.selectedBytes || !Array.isArray(plan.limitations || []) || (plan.limitations || []).some(value => typeof value !== 'string')) fail('invalid_git_response', 'Remote mutation plan exceeds its bound.');
  const stagedEntries = plan.operation === 'commit' ? plan.indexEntries : null;
  if (stagedEntries && (!Array.isArray(stagedEntries) || stagedEntries.length > 2048 || stagedEntries.some(row => typeof row.path !== 'string' || !/^[0-7]{6}$/.test(row.mode) || !oid(row.oid) || row.oid === null || row.stage !== 0))) fail('invalid_git_response', 'Reviewed commit index is malformed.');
  const paths = plan.operation === 'commit' ? [...new Set((plan.capture?.entries || []).filter(row => ![' ', '?'].includes(row.indexStatus)).flatMap(row => [row.path, ...(row.originalPath ? [row.originalPath] : [])]))] : plan.paths;
  return { headOid: repo.headOid, headRef: repo.headRef, indexDigest: repo.indexDigest, paths: clone(paths), parents: clone(plan.parents), files,
    ...(stagedEntries ? { stagedEntries: clone(stagedEntries) } : {}),
    ...(plan.message !== undefined ? { message: plan.message } : {}), ...(plan.author !== undefined ? { author: clone(plan.author) } : {}), limitations: clone(plan.limitations || []) };
}
function publicResult(value) {
  if (!value || typeof value !== 'object') return undefined;
  const result = {};
  for (const key of ['treeOid', 'commitOid']) if (value[key] !== undefined) { if (!oid(value[key]) || value[key] === null) fail('invalid_git_response', 'Remote Git result OID is invalid.', true); result[key] = value[key]; }
  for (const key of ['headOid']) if (value[key] !== undefined) { if (!oid(value[key])) fail('invalid_git_response', 'Remote Git result HEAD is invalid.', true); result[key] = value[key]; }
  if (value.indexDigest !== undefined) { if (value.indexDigest !== null && !hash(value.indexDigest)) fail('invalid_git_response', 'Remote index proof is invalid.', true); result.indexDigest = value.indexDigest; }
  if (value.headRef !== undefined && (value.headRef === null || typeof value.headRef === 'string')) result.headRef = value.headRef;
  if (value.reconciled === true) result.reconciled = true;
  return result;
}
function project(row) { return { actionId: row.actionId, hostId: row.hostId, target: clone(row.target), operation: row.operation, reviewDigest: row.reviewDigest, state: row.state,
  ownerHeld: row.ownerHeld, terminal: ['completed', 'failed'].includes(row.state), review: summary(row.plan), createdAt: row.createdAt, updatedAt: row.updatedAt,
  ...(row.receiptId ? { receiptId: row.receiptId } : {}), ...(row.reason ? { reason: row.reason } : {}), ...(row.result ? { result: publicResult(row.result) } : {}) }; }

function validateRemoteGitReviewRecords(rows) {
  if (!Array.isArray(rows) || rows.length > REMOTE_GIT_REVIEW_LIMITS.actions || Buffer.byteLength(JSON.stringify(rows)) > REMOTE_GIT_REVIEW_LIMITS.retainedBytes) fail('remote_git_storage', 'Remote Git action storage is unavailable.');
  const ids = new Set();
  for (const row of rows) {
    if (!row || row.version !== 1 || !UUID.test(row.actionId || '') || ids.has(row.actionId) || row.hostId !== row.target?.hostId || !STATES.has(row.state) || typeof row.ownerHeld !== 'boolean' || !hash(row.requestDigest) || !hash(row.reviewDigest) || !hash(row.prepareDigest) || !hash(row.repoKey) || !row.plan || row.plan.operation !== row.operation) fail('remote_git_storage', 'Retained remote Git action is malformed.');
    ids.add(row.actionId); target(row.target); summary(row.plan);
    if (row.reviewDigest !== digest({ version: 1, actionId: row.actionId, target: row.target, plan: row.plan }) || row.requestDigest !== digest({ actionId: row.actionId, target: row.target, plan: row.plan }) || row.repoKey !== repoKey(row.target, row.plan.repository)) fail('remote_git_storage', 'Retained remote Git plan identity changed.');
  }
}
function createRemoteGitReviewController({ withHost, getRecords, storeRecords, begin, finish, storePrepared, storeTerminal }) {
  if (![withHost, getRecords, storeRecords, begin, finish].every(value => typeof value === 'function')) throw new TypeError('Trusted remote Git ownership dependencies are required.');
  const captures = new Map(), bases = new Map(), diffs = new Map(), repoOwners = new Set(), live = new Map(), owners = new Set(), pendingTerminal = new Map(); let closing = false;
  const records = () => {
    const rows = getRecords();
    validateRemoteGitReviewRecords(rows);
    return rows;
  };
  function save(row) {
    const rows = records(), index = rows.findIndex(item => item.actionId === row.actionId);
    const next = rows.map(clone); if (index < 0) next.push(clone(row)); else next[index] = clone(row);
    if (next.length > REMOTE_GIT_REVIEW_LIMITS.actions || Buffer.byteLength(JSON.stringify(next)) > REMOTE_GIT_REVIEW_LIMITS.retainedBytes) fail('remote_git_quota', 'Retained remote Git action capacity is reached.', index >= 0);
    storeRecords(next); return row;
  }
  function found(hostId, actionId) { id(hostId); id(actionId); const row = records().find(row => row.actionId === actionId); if (row && row.hostId !== hostId) fail('remote_git_action_scope', 'Remote Git action belongs to another host.', true); return row ? clone(row) : null; }
  function held(key, actionId) { return records().some(row => row.actionId !== actionId && row.repoKey === key && ['prepared', 'unknown'].includes(row.state)) || [...pendingTerminal.values()].some(item => item.row.actionId !== actionId && item.row.repoKey === key); }
  function settle(row) {
    const detail = { state: row.state, actionId: row.actionId, ...(row.result || {}), ...(row.reason ? { message: row.reason } : {}) };
    try {
      if (storeTerminal && row.receiptId) storeTerminal(clone(row), clone(detail));
      else { save(row); if (row.receiptId) finish(row.receiptId, detail); }
      pendingTerminal.delete(row.actionId); return project(row);
    } catch {
      pendingTerminal.set(row.actionId, { row: clone(row), detail });
      return project({ ...row, state: 'unknown', ownerHeld: true, reason: 'Remote Git result is retained; local receipt settlement requires exact inspection.' });
    }
  }
  const remember = (map, key, value, limit = REMOTE_GIT_REVIEW_LIMITS.captures) => { map.set(key, value); while (map.size > limit) map.delete(map.keys().next().value); return value; };
  function own(action) { if (closing) return Promise.reject(Object.assign(new Error('Remote Git owner is closing.'), { code: 'remote_git_closed', actionRecorded: false })); const promise = Promise.resolve().then(action); owners.add(promise); promise.finally(() => owners.delete(promise)).catch(() => {}); return promise; }
  function checked(response, mutation = false) {
    if (!response || response.ok !== true || !response.result || typeof response.result !== 'object') {
      const noEffect = response?.ok === false && response.mutated === false && response.accepted === false;
      fail(noEffect ? 'remote_git_preflight' : 'remote_git_unknown', typeof response?.error === 'string' ? response.error.slice(0, 200) : 'Remote Git has no verified terminal response.', mutation && !noEffect);
    }
    return response.result;
  }
  function captured(hostId, captureId, scope) { id(captureId); const value = captures.get(captureId); if (!value || value.target.hostId !== hostId || !sameScope(value.target, scope)) fail('remote_git_capture_stale', 'Capture this repository on the current connection again.'); return value; }
  function publicCapture(value) { return { captureId: value.captureId, target: clone(value.target), repository: repository(value.raw.repository), baseOid: value.raw.baseOid, baseRef: value.raw.baseRef,
    entries: entries(value.raw.entries), fingerprint: value.raw.fingerprint, truncated: value.raw.truncated === true, limitations: clone(value.raw.limitations || []), createdAt: value.createdAt }; }
  function rawCapture(raw) { repository(raw.repository); entries(raw.entries); if (!hash(raw.fingerprint) || !oid(raw.baseOid) || raw.baseRef !== null && typeof raw.baseRef !== 'string' || !Array.isArray(raw.limitations || []) || (raw.limitations || []).some(value => typeof value !== 'string')) fail('invalid_git_response', 'Remote Git capture is invalid.'); return raw; }
  const api = {
    bases(hostId) { id(hostId); return own(() => withHost(hostId, async (scope, run) => {
      const scoped = target(scope), value = checked(await run('bases', {})), repo = repository(value.repository);
      if (!Array.isArray(value.choices) || value.choices.length > 129) fail('invalid_git_response', 'Remote Git base choices are invalid.');
      const choices = value.choices.map(choice => {
        if (!['head', 'local', 'remote'].includes(choice.kind) || !oid(choice.oid) || choice.ref !== null && (typeof choice.ref !== 'string' || !/^refs\/(heads|remotes)\/[^\x00-\x20]+$/u.test(choice.ref))) fail('invalid_git_response', 'Remote Git base identity is invalid.');
        const baseId = randomUUID(); remember(bases, baseId, { target: scoped, repository: repo, ref: choice.ref, oid: choice.oid }, 256); return { baseId, kind: choice.kind, ref: choice.ref, oid: choice.oid };
      });
      return { state: 'ready', target: scoped, repository: repo, choices, truncated: value.truncated === true };
    }, 'git-review-bases')); },
    capture(hostId, input = {}) { id(hostId); object(input, ['baseId']); if (input.baseId !== undefined) id(input.baseId); return own(() => withHost(hostId, async (scope, run) => {
      const scoped = target(scope), choice = input.baseId ? bases.get(input.baseId) : null;
      if (input.baseId && (!choice || !sameScope(choice.target, scoped))) fail('remote_git_base_stale', 'Choose a base captured on this connection.');
      const raw = rawCapture(checked(await run('capture', choice ? { baseRef: choice.ref, baseOid: choice.oid } : {})));
      if (choice && (choice.oid !== raw.baseOid || choice.repository.headOid !== raw.repository.headOid || choice.repository.headRef !== raw.repository.headRef)) fail('remote_git_base_stale', 'Remote HEAD or selected base changed.');
      const captureId = randomUUID(), value = { captureId, target: scoped, raw, createdAt: new Date().toISOString() }; remember(captures, captureId, value); return publicCapture(value);
    }, 'git-review-capture')); },
    diff(hostId, input) { id(hostId); object(input, ['captureId', 'kind', 'path', 'stage']); if (!['worktree', 'staged', 'base', 'conflict'].includes(input.kind)) fail('invalid_git_request', 'Choose a supported remote diff.'); if (input.path !== undefined) filePath(input.path); if (input.kind === 'conflict' ? !input.path || ![1, 2, 3].includes(input.stage) : input.stage !== undefined) fail('invalid_git_request', 'Choose an exact conflict path and stage.');
      return own(() => withHost(hostId, async (scope, run) => {
        const capture = captured(hostId, input.captureId, target(scope)), key = canonical(input) + ':' + hostId, previous = diffs.get(key);
        const raw = checked(await run('diff', { capture: capture.raw, ...input }));
        if (!['current', 'stale', 'unavailable'].includes(raw.state) || typeof raw.text !== 'string' || Buffer.byteLength(raw.text) > 512 * 1024) fail('invalid_git_response', 'Remote diff response is invalid.');
        const result = { ...clone(input), state: raw.state, text: raw.state === 'current' ? raw.text : previous?.text || '', binary: raw.state === 'current' ? raw.binary === true : previous?.binary || false,
          truncated: raw.truncated === true, headOid: capture.raw.repository.headOid, baseOid: capture.raw.baseOid, ...(typeof raw.reason === 'string' ? { reason: raw.reason.slice(0, 200) } : {}) };
        if (raw.state === 'current') remember(diffs, key, result); return result;
      }, 'git-review-diff'));
    },
    prepare(hostId, input) {
      id(hostId); object(input, ['actionId', 'captureId', 'operation', 'paths', 'message', 'author']); id(input.actionId); id(input.captureId);
      if (!['stage', 'unstage', 'commit'].includes(input.operation)) fail('invalid_git_request', 'Choose stage, unstage or commit.');
      if (input.operation !== 'commit' && (!Array.isArray(input.paths) || !input.paths.length || input.paths.length > REMOTE_GIT_REVIEW_LIMITS.paths || new Set(input.paths).size !== input.paths.length)) fail('invalid_git_request', 'Choose bounded distinct file paths.');
      if (input.paths !== undefined && !Array.isArray(input.paths)) fail('invalid_git_request', 'Choose a supported path list.'); input.paths?.forEach(filePath);
      if (input.operation === 'commit') { if (input.paths !== undefined || typeof input.message !== 'string' || !input.message.trim() || Buffer.byteLength(input.message) > 16384 || input.message.includes('\0')) fail('invalid_git_request', 'Review a bounded commit message and the entire staged index.'); object(input.author, ['name', 'email']); if (![input.author.name, input.author.email].every(value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200 && !/[<>\x00-\x1f\x7f]/u.test(value)) || !/^[^\s@]+@[^\s@]+$/u.test(input.author.email)) fail('invalid_git_request', 'Provide the explicit commit author name and email.'); }
      else if (input.message !== undefined || input.author !== undefined) fail('invalid_git_request', 'Index review does not accept commit fields.');
      const prepareDigest = digest({ hostId, input }), existing = found(hostId, input.actionId);
      if (existing) { if (existing.prepareDigest !== prepareDigest) fail('remote_git_action_conflict', 'This action ID belongs to another review.', true); return Promise.resolve(project(existing)); }
      return own(() => withHost(hostId, async (scope, run) => {
        const scoped = target(scope), capture = captured(hostId, input.captureId, scoped), key = repoKey(scoped, capture.raw.repository);
        if (repoOwners.has(key) || held(key)) fail('remote_git_owner_held', 'Inspect this repository’s unresolved Git action first.');
        const plan = checked(await run('prepare', { capture: capture.raw, operation: input.operation, ...(input.paths ? { paths: input.paths } : {}), ...(input.message !== undefined ? { message: input.message, author: input.author } : {}) }));
        if (plan.operation !== input.operation || plan.captureFingerprint !== capture.raw.fingerprint || canonical(plan.capture) !== canonical(capture.raw)
          || canonical(plan.repository) !== canonical(capture.raw.repository)
          || (input.operation === 'commit' ? plan.message !== input.message || canonical(plan.author) !== canonical(input.author)
            : canonical([...plan.paths].sort()) !== canonical([...input.paths].sort()))) fail('invalid_git_response', 'Remote mutation review does not match its exact selected input.'); summary(plan);
        const now = new Date().toISOString(), reviewDigest = digest({ version: 1, actionId: input.actionId, target: scoped, plan });
        const row = { version: 1, actionId: input.actionId, hostId, target: scoped, repoKey: key, operation: input.operation, prepareDigest, reviewDigest,
          requestDigest: digest({ actionId: input.actionId, target: scoped, plan }), state: 'reviewed', ownerHeld: false, createdAt: now, updatedAt: now, plan: clone(plan) };
        save(row); return project(row);
      }, 'git-review-prepare'));
    },
    apply(hostId, input) {
      id(hostId); object(input, ['actionId', 'reviewDigest']); id(input.actionId); if (!hash(input.reviewDigest)) fail('invalid_git_request', 'Apply the exact reviewed Git digest.');
      const original = found(hostId, input.actionId); if (!original || original.reviewDigest !== input.reviewDigest) fail('remote_git_review_changed', 'Review this exact Git action before applying.', Boolean(original));
      if (pendingTerminal.has(input.actionId)) return Promise.resolve(project({ ...pendingTerminal.get(input.actionId).row, state: 'unknown', ownerHeld: true, reason: 'Local receipt settlement requires exact inspection; no Git replay.' }));
      if (live.has(input.actionId)) return live.get(input.actionId);
      if (original.state !== 'reviewed') return Promise.resolve(project(original));
      const promise = own(() => withHost(hostId, async (scope, run) => {
        const scoped = target(scope); let row = found(hostId, input.actionId);
        if (!sameScope(row.target, scoped) || row.reviewDigest !== input.reviewDigest) fail('remote_git_scope_changed', 'Reconnect or target changes require a fresh Git review.', true);
        if (row.state !== 'reviewed') return project(row);
        if (repoOwners.has(row.repoKey) || held(row.repoKey, row.actionId)) fail('remote_git_owner_held', 'Reconcile the exact earlier Git action before another mutation.', true);
        repoOwners.add(row.repoKey); let dispatched = false;
        try {
          row.state = 'prepared'; row.ownerHeld = true; row.updatedAt = new Date().toISOString();
          if (storePrepared) { const accepted = clone(storePrepared(clone(row))); if (!accepted.receiptId || !UUID.test(accepted.receiptId) || accepted.actionId !== row.actionId || accepted.requestDigest !== row.requestDigest || accepted.reviewDigest !== row.reviewDigest || accepted.state !== 'prepared') fail('remote_git_storage', 'Prepared Git action has no exact signed receipt.'); row = accepted; }
          else { const receipt = begin(hostId, 'git-' + row.operation, { state: 'started', actionId: row.actionId, reviewDigest: row.reviewDigest }); row.receiptId = receipt.id; save(row); }
          dispatched = true;
          const response = await run('apply', { actionId: row.actionId, requestDigest: row.requestDigest, plan: row.plan });
          const raw = checked(response, true);
          if (raw.actionId !== row.actionId || raw.requestDigest !== row.requestDigest || raw.operation !== row.operation) fail('invalid_git_response', 'Remote result belongs to another Git action.', true);
          if (!['completed', 'failed', 'unknown'].includes(raw.state)) fail('invalid_git_response', 'Remote mutation has no exact terminal state.', true);
          row.result = publicResult(raw.result || raw); row.state = raw.ownerHeld === true ? 'unknown' : raw.state; row.ownerHeld = row.state === 'unknown';
          row.reason = typeof raw.reason === 'string' ? raw.reason.slice(0, 200) : undefined; row.updatedAt = new Date().toISOString();
          return settle(row);
        } catch (error) {
          row.state = dispatched && error.actionRecorded !== false ? 'unknown' : 'failed'; row.ownerHeld = row.state === 'unknown'; row.updatedAt = new Date().toISOString(); row.reason = row.state === 'unknown' ? 'Remote Git has no exact terminal proof; inspect this action without replay.' : 'Remote Git refused before a repository effect.';
          if (!row.receiptId) { try { save(row); } catch {} error.actionRecorded = false; throw error; } return settle(row);
        } finally { repoOwners.delete(row.repoKey); }
      }, 'git-' + original.operation, true));
      live.set(input.actionId, promise); promise.finally(() => live.delete(input.actionId)).catch(() => {}); return promise;
    },
    inspectAction(hostId, actionId) {
      const original = found(hostId, actionId); if (!original) return Promise.resolve(null);
      if (pendingTerminal.has(actionId)) return Promise.resolve(settle(pendingTerminal.get(actionId).row));
      if (live.has(actionId)) return Promise.resolve(project(original));
      if (['completed', 'failed', 'reviewed'].includes(original.state)) return Promise.resolve(project(original));
      return own(() => withHost(hostId, async (scope, run) => {
        const scoped = target(scope); if (!sameScope(original.target, scoped, false)) fail('remote_git_scope_changed', 'Inspect on the exact original host/root identity.', true);
        const response = checked(await run('inspect', { actionId, requestDigest: original.requestDigest, operation: original.operation }));
        if (response.actionId !== actionId || response.requestDigest !== original.requestDigest || response.operation !== original.operation) fail('invalid_git_response', 'Remote receipt does not match the exact Git action.', true);
        if (!['completed', 'failed', 'unknown'].includes(response.state)) fail('invalid_git_response', 'Remote reconciliation is not a terminal proof.', true);
        const row = found(hostId, actionId); row.state = response.ownerHeld === true ? 'unknown' : response.state; row.ownerHeld = row.state === 'unknown'; row.updatedAt = new Date().toISOString(); row.result = publicResult(response.result || response);
        row.reason = typeof response.reason === 'string' ? response.reason.slice(0, 200) : undefined;
        return settle(row);
      }, 'git-review-reconcile'));
    },
    listActions(hostId) { id(hostId); return records().filter(row => row.hostId === hostId).map(row => pendingTerminal.has(row.actionId) ? project({ ...pendingTerminal.get(row.actionId).row, state: 'unknown', ownerHeld: true, reason: 'Local receipt settlement requires inspection.' }) : project(['prepared'].includes(row.state) && !live.has(row.actionId) ? { ...row, state: 'unknown', ownerHeld: true, reason: 'Previous Git owner has no terminal proof; inspect without replay.' } : row)); },
    pruneActions(hostId, actionIds) { id(hostId); if (!Array.isArray(actionIds) || !actionIds.length || actionIds.length > REMOTE_GIT_REVIEW_LIMITS.actions) fail('invalid_git_request', 'Choose exact settled Git actions to forget locally.'); actionIds.forEach(id); const wanted = new Set(actionIds), rows = records();
      for (const actionId of wanted) { const row = found(hostId, actionId); if (!row || row.ownerHeld || !['reviewed', 'completed', 'failed'].includes(row.state) || live.has(actionId) || pendingTerminal.has(actionId)) fail('remote_git_owner_held', 'An unresolved Git action cannot be forgotten.', true); }
      storeRecords(rows.filter(row => !wanted.has(row.actionId))); return { removed: wanted.size };
    },
    currentOperation: () => owners.size ? 'Remote Git Review operation' : null,
    destroy() { closing = true; return Promise.allSettled([...owners]).then(() => { for (const item of [...pendingTerminal.values()]) settle(item.row); if (pendingTerminal.size) fail('remote_git_storage', 'Known Git outcomes still require local receipt settlement.', true); captures.clear(); bases.clear(); diffs.clear(); }); },
  };
  return Object.freeze(api);
}
module.exports = { createRemoteGitReviewController, validateRemoteGitReviewRecords, REMOTE_GIT_REVIEW_LIMITS };
