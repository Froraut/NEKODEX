const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { renameAtomicFile } = require('./atomic-file.cjs');

const UNKNOWN_ACCOUNT_ID = 'unknown';
const ACCOUNT_ID = /^(?:default|unknown|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const OUTCOMES = ['completed', 'failed', 'aborted'];
const COUNTERS = ['accepted', ...OUTCOMES];
const FAILURE_CODES = new Set(['rate_limit', 'safety_stop', 'timeout', 'browser_failure', 'other', 'unknown']);
const MODEL_VERSION_SOURCES = new Set(['observed', 'pinned', 'unknown']);
const MESSAGE_KINDS = new Set(['task', 'context_stage', 'compaction', 'unknown']);
const MAX_BYTES = 20_000_000;
const RECEIPT_HIGH_WATER_BYTES = 16_000_000;
const RECEIPT_TARGET_BYTES = 14_000_000;
const MAX_WEB_RECEIPTS = 50_000;
const MAX_OBSERVED_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NATIVE_RECEIPTS = 10_000;
const MAX_NATIVE_GROUPS = 4_096;
const MAX_REPORTED_TOKENS = 1_000_000_000;
const NATIVE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}$/;
const NATIVE_OUTCOMES = ['completed', 'incomplete', 'failed', 'aborted'];
const NATIVE_COUNTERS = ['accepted', ...NATIVE_OUTCOMES];
const NATIVE_FAILURE_CODES = new Set([
  'http-auth', 'http-rate-limit', 'http-client', 'http-server', 'transport', 'stream', 'protocol', 'aborted', 'unknown',
]);
const NATIVE_INPUT_FAILURE_CODES = new Set([...NATIVE_FAILURE_CODES].filter(code => code !== 'unknown'));

const dayOf = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const digest = value => createHash('sha256').update(value).digest('hex');
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCounter = value => Number.isSafeInteger(value) && value >= 0;
const validAccountId = value => typeof value === 'string' && ACCOUNT_ID.test(value);
const validNativeModelId = value => typeof value === 'string' && NATIVE_MODEL_ID.test(value) && !value.includes('://')
  && value.split('/').every(segment => segment && segment !== '.' && segment !== '..');
const classificationKey = row => [row.accountId, row.effort, row.modelVersion, row.modelVersionSource, row.mode, row.messageKind].join('|');
const rowKey = row => `${row.day}|${classificationKey(row)}`;
const emptyGroup = row => ({ accountId: row.accountId, effort: row.effort, modelVersion: row.modelVersion,
  modelVersionSource: row.modelVersionSource, mode: row.mode, messageKind: row.messageKind,
  accepted: 0, completed: 0, failed: 0, aborted: 0 });
const validClassification = row => validAccountId(row.accountId)
  && ['luna', 'low', 'medium', 'high', 'xhigh', 'max', 'unknown'].includes(row.effort)
  && ['5.5', '5.6', '6', 'unknown'].includes(row.modelVersion)
  && MODEL_VERSION_SOURCES.has(row.modelVersionSource) && ['automatic', 'manual'].includes(row.mode)
  && MESSAGE_KINDS.has(row.messageKind);
const validCounters = row => COUNTERS.every(field => isCounter(row[field]))
  && OUTCOMES.reduce((sum, field) => sum + row[field], 0) <= row.accepted;

const nativeGroupKey = row => `${row.endpoint}|${row.modelIdSource}|${row.modelId}`;
const nativeRowKey = row => `${row.day}|${nativeGroupKey(row)}`;
const emptyNativeGroup = row => ({ endpoint: row.endpoint, modelId: row.modelId, modelIdSource: row.modelIdSource,
  accepted: 0, completed: 0, incomplete: 0, failed: 0, aborted: 0,
  inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0,
  reportedSamples: 0, unreportedSamples: 0, cachedInputReportedSamples: 0, reasoningOutputReportedSamples: 0,
  failures: {}, httpStatuses: {} });

function emptyNativeState() {
  return { rows: {}, receipts: {}, lifetime: 0, lifetimeGroups: {} };
}

function validNativeAggregate(row) {
  return isRecord(row) && ['responses', 'responses/compact'].includes(row.endpoint)
    && (row.modelId === 'unknown' || validNativeModelId(row.modelId))
    && ['reported', 'requested', 'unknown'].includes(row.modelIdSource)
    && NATIVE_COUNTERS.every(field => isCounter(row[field]))
    && NATIVE_OUTCOMES.reduce((sum, field) => sum + row[field], 0) === row.accepted
    && ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens', 'reasoningOutputTokens',
      'reportedSamples', 'unreportedSamples', 'cachedInputReportedSamples', 'reasoningOutputReportedSamples']
      .every(field => isCounter(row[field]))
    && row.reportedSamples + row.unreportedSamples === row.accepted
    && row.cachedInputReportedSamples <= row.reportedSamples
    && row.reasoningOutputReportedSamples <= row.reportedSamples
    && isRecord(row.failures) && Object.entries(row.failures).every(([code, count]) => NATIVE_FAILURE_CODES.has(code) && isCounter(count))
    && Object.values(row.failures).reduce((sum, count) => sum + count, 0) <= row.accepted
    && isRecord(row.httpStatuses) && Object.entries(row.httpStatuses).every(([status, count]) => /^(?:0|[1-5][0-9]{2})$/.test(status) && isCounter(count))
    && Object.values(row.httpStatuses).reduce((sum, count) => sum + count, 0) === row.accepted
    && row.totalTokens >= row.inputTokens + row.outputTokens;
}

function addNativeAggregate(target, key, row) {
  const saved = target[key];
  const group = saved ? { ...saved, failures: { ...saved.failures }, httpStatuses: { ...saved.httpStatuses } }
    : { ...(row.day ? { day: row.day } : {}), ...emptyNativeGroup(row) };
  for (const field of [...NATIVE_COUNTERS, 'inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens',
    'reasoningOutputTokens', 'reportedSamples', 'unreportedSamples', 'cachedInputReportedSamples',
    'reasoningOutputReportedSamples']) {
    group[field] += row[field];
  }
  for (const [code, count] of Object.entries(row.failures)) group.failures[code] = (group.failures[code] ?? 0) + count;
  for (const [status, count] of Object.entries(row.httpStatuses)) group.httpStatuses[status] = (group.httpStatuses[status] ?? 0) + count;
  if (!validNativeAggregate(group)) throw new Error('Native usage counters exceed capacity');
  target[key] = group;
}

function normalizedFailureCode(value) {
  if (value === 'rate_limit_exceeded') return 'rate_limit';
  if (value === 'account_safety_stop') return 'safety_stop';
  if (value === 'tool_timeout') return 'timeout';
  if (value === 'context_length_exceeded' || value === 'model_unavailable') return 'other';
  if (value === undefined || value === null || value === '') return 'unknown';
  return FAILURE_CODES.has(value) ? value : 'other';
}

function validateNativeUsageSample(value) {
  const keys = ['schemaVersion', 'eventId', 'source', 'endpoint', 'requestedModelId', 'reportedModelId',
    'startedAt', 'durationMs', 'outcome', 'httpStatus', 'failureCategory', 'usageStatus', 'usage'];
  if (!isRecord(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
    || value.schemaVersion !== 1 || value.source !== 'native'
    || typeof value.eventId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.eventId)
    || !['responses', 'responses/compact'].includes(value.endpoint)
    || (value.requestedModelId !== null && !validNativeModelId(value.requestedModelId))
    || (value.reportedModelId !== null && !validNativeModelId(value.reportedModelId))
    || typeof value.startedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.startedAt)) {
    throw new Error('Invalid native usage sample identity');
  }
  const startedAt = Date.parse(value.startedAt), finishedAt = startedAt + value.durationMs;
  if (!Number.isFinite(startedAt)
    || value.durationMs < 0 || value.durationMs > MAX_OBSERVED_DURATION_MS
    || !Number.isSafeInteger(value.durationMs) || !Number.isSafeInteger(finishedAt)
    || !NATIVE_OUTCOMES.includes(value.outcome)
    || !Number.isInteger(value.httpStatus) || (value.httpStatus !== 0 && (value.httpStatus < 100 || value.httpStatus > 599))) {
    throw new Error('Invalid native usage sample terminal state');
  }
  const zeroStatusAllowed = value.failureCategory === 'transport' || value.failureCategory === 'aborted';
  if ((value.httpStatus === 0 && !zeroStatusAllowed) || (value.httpStatus !== 0 && zeroStatusAllowed && value.failureCategory === 'transport')
    || (value.failureCategory !== null && !NATIVE_INPUT_FAILURE_CODES.has(value.failureCategory))
    || (value.outcome === 'completed' && value.failureCategory !== null)
    || (value.outcome === 'aborted' && value.failureCategory !== 'aborted')
    || (value.outcome === 'failed' && value.failureCategory === null)) {
    throw new Error('Invalid native usage failure');
  }
  let tokens = null;
  if (!['reported', 'unreported'].includes(value.usageStatus)
    || (value.usageStatus === 'reported') !== (value.usage !== null)) {
    throw new Error('Invalid native usage coverage state');
  }
  if (value.usage !== null) {
    const required = ['inputTokens', 'outputTokens', 'totalTokens'];
    const optional = ['cachedInputTokens', 'reasoningOutputTokens'];
    if (!isRecord(value.usage) || Object.keys(value.usage).some(key => ![...required, ...optional].includes(key))
      || required.some(key => !Object.hasOwn(value.usage, key))
      || [...required, ...optional].some(key => value.usage[key] !== undefined
        && (!Number.isSafeInteger(value.usage[key]) || value.usage[key] < 0 || value.usage[key] > MAX_REPORTED_TOKENS))
      || value.usage.totalTokens < value.usage.inputTokens + value.usage.outputTokens
      || (value.usage.cachedInputTokens !== undefined && value.usage.cachedInputTokens > value.usage.inputTokens)
      || (value.usage.reasoningOutputTokens !== undefined && value.usage.reasoningOutputTokens > value.usage.outputTokens)) {
      throw new Error('Invalid native usage token report');
    }
    tokens = { inputTokens: value.usage.inputTokens, outputTokens: value.usage.outputTokens,
      totalTokens: value.usage.totalTokens,
      ...(value.usage.cachedInputTokens === undefined ? {} : { cachedInputTokens: value.usage.cachedInputTokens }),
      ...(value.usage.reasoningOutputTokens === undefined ? {} : { reasoningOutputTokens: value.usage.reasoningOutputTokens }) };
  }
  const modelId = value.reportedModelId ?? value.requestedModelId ?? 'unknown';
  const modelIdSource = value.reportedModelId !== null ? 'reported' : value.requestedModelId !== null ? 'requested' : 'unknown';
  return { eventId: value.eventId, endpoint: value.endpoint, modelId, modelIdSource, startedAt, finishedAt,
    durationMs: value.durationMs, outcome: value.outcome, httpStatus: value.httpStatus,
    failure: value.failureCategory, tokens };
}

function addGroup(target, key, row) {
  const group = target[key] ?? emptyGroup(row);
  for (const field of COUNTERS) group[field] += row[field];
  if (!validCounters(group)) throw new Error('Usage counters exceed capacity');
  target[key] = group;
}

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

function replaceBackupWithClone(primary, backup, fallbackText) {
  const temporary = `${backup}.clone-${process.pid}-${randomUUID()}`;
  try {
    fs.copyFileSync(primary, temporary, fs.constants.COPYFILE_FICLONE);
    try { fs.chmodSync(temporary, 0o600); } catch {}
    const fd = fs.openSync(temporary, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    renameAtomicFile(temporary, backup);
    if (process.platform !== 'win32') {
      const directory = fs.openSync(path.dirname(backup), 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
  } catch {
    fs.rmSync(temporary, { force: true });
    writeDurable(backup, fallbackText);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function receiptCandidates(state, kind) {
  if (kind === 'web') return Object.entries(state.receipts).map(([id, receipt]) => ({
    kind, id, at: receipt.at, pending: receipt.outcome === null,
  }));
  return Object.entries(state.native.receipts).map(([id, receipt]) => ({
    kind, id, at: receipt.finishedAt, pending: false,
  }));
}

function deleteReceipt(state, candidate) {
  if (candidate.kind === 'web') delete state.receipts[candidate.id];
  else delete state.native.receipts[candidate.id];
}

function preparePersistedState(next) {
  next = { ...next, receipts: { ...next.receipts }, native: { ...next.native, receipts: { ...next.native.receipts } } };
  const web = receiptCandidates(next, 'web').sort((a, b) => Number(a.pending) - Number(b.pending) || a.at - b.at);
  const native = receiptCandidates(next, 'native').sort((a, b) => a.at - b.at);
  while (web.length > MAX_WEB_RECEIPTS) deleteReceipt(next, web.shift());
  while (native.length > MAX_NATIVE_RECEIPTS) deleteReceipt(next, native.shift());

  let text = JSON.stringify(next) + '\n';
  if (Buffer.byteLength(text) > RECEIPT_HIGH_WATER_BYTES) {
    const remaining = [...web, ...native]
      .sort((a, b) => Number(a.pending) - Number(b.pending) || a.at - b.at);
    while (remaining.length && Buffer.byteLength(text) > RECEIPT_TARGET_BYTES) {
      const batchSize = Math.min(512, remaining.length);
      for (let index = 0; index < batchSize; index++) deleteReceipt(next, remaining.shift());
      text = JSON.stringify(next) + '\n';
    }
  }
  if (Buffer.byteLength(text) > MAX_BYTES) {
    const error = new Error('Usage aggregates exceed their storage limit');
    error.code = 'USAGE_CAPACITY';
    throw error;
  }
  return { state: next, text };
}

function legacyClassification(saved) {
  return { ...saved, accountId: UNKNOWN_ACCOUNT_ID, modelVersionSource: 'unknown', messageKind: 'unknown' };
}

function readState(file) {
  if (fs.statSync(file).size > MAX_BYTES) throw new Error('Usage history exceeds its storage limit');
  const text = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(text);
  if (!isRecord(data) || ![1, 2, 3].includes(data.version)) {
    const error = new Error(isRecord(data) ? 'Usage history has an unsupported version' : 'Invalid usage history');
    if (isRecord(data) && data.version !== undefined) error.code = 'USAGE_VERSION';
    throw error;
  }
  if (!isRecord(data.rows) || !isRecord(data.receipts) || !isCounter(data.lifetime)
    || typeof data.startedAt !== 'string' || !Number.isFinite(Date.parse(data.startedAt))) throw new Error('Invalid usage history');

  const rows = {}, keyMigration = new Map();
  for (const [key, saved] of Object.entries(data.rows)) {
    if (!isRecord(saved) || !/^\d{4}-\d{2}-\d{2}$/.test(saved.day)) throw new Error('Invalid usage group');
    const row = data.version < 3 ? legacyClassification(saved) : saved;
    const expected = data.version < 3 ? `${saved.day}|${saved.effort}|${saved.modelVersion}|${saved.mode}` : rowKey(row);
    if (key !== expected || !validClassification(row) || !validCounters(row)) throw new Error('Invalid usage group');
    const nextKey = rowKey(row);
    keyMigration.set(key, nextKey);
    if (!rows[nextKey]) rows[nextKey] = { day: row.day, ...emptyGroup(row) };
    for (const field of COUNTERS) rows[nextKey][field] += row[field];
    if (!validCounters(rows[nextKey])) throw new Error('Usage counters exceed capacity');
  }

  const receipts = {};
  for (const [id, saved] of Object.entries(data.receipts)) {
    const key = keyMigration.get(saved?.key);
    if (!isRecord(saved) || !/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(saved.owner)
      || !key || !Number.isFinite(saved.at) || (saved.outcome !== null && !OUTCOMES.includes(saved.outcome))) {
      throw new Error('Invalid usage receipt');
    }
    const receipt = { owner: saved.owner, key, at: saved.at, outcome: saved.outcome };
    if (data.version === 3 && saved.durationMs !== undefined) {
      if (!Number.isSafeInteger(saved.durationMs) || saved.durationMs < 0 || saved.durationMs > MAX_OBSERVED_DURATION_MS
        || saved.outcome === null) throw new Error('Invalid usage duration');
      receipt.durationMs = saved.durationMs;
    }
    if (data.version === 3 && saved.failureCode !== undefined) {
      if (saved.outcome !== 'failed' || !FAILURE_CODES.has(saved.failureCode)) throw new Error('Invalid usage failure code');
      receipt.failureCode = saved.failureCode;
    }
    receipts[id] = receipt;
  }

  const retained = {};
  for (const row of Object.values(rows)) addGroup(retained, classificationKey(row), row);
  const lifetimeGroups = {};
  let lifetimeUnclassified;
  if (data.version === 1) {
    Object.assign(lifetimeGroups, retained);
    const known = Object.values(retained).reduce((sum, row) => sum + row.accepted, 0);
    if (known > data.lifetime) throw new Error('Usage history exceeds lifetime total');
    lifetimeUnclassified = data.lifetime - known;
  } else {
    if (!isRecord(data.lifetimeGroups) || !isCounter(data.lifetimeUnclassified)) throw new Error('Invalid lifetime history');
    for (const [key, saved] of Object.entries(data.lifetimeGroups)) {
      if (!isRecord(saved)) throw new Error('Invalid lifetime group');
      const row = data.version < 3 ? legacyClassification(saved) : saved;
      const expected = data.version < 3 ? `${saved.effort}|${saved.modelVersion}|${saved.mode}` : classificationKey(row);
      if (key !== expected || !validClassification(row) || !validCounters(row)) throw new Error('Invalid lifetime group');
      addGroup(lifetimeGroups, classificationKey(row), row);
    }
    lifetimeUnclassified = data.lifetimeUnclassified;
  }
  const total = Object.values(lifetimeGroups).reduce((sum, row) => sum + row.accepted, lifetimeUnclassified);
  if (!isCounter(total) || total !== data.lifetime) throw new Error('Invalid lifetime total');
  for (const [key, row] of Object.entries(retained)) {
    const group = lifetimeGroups[key];
    if (!group || COUNTERS.some(field => row[field] > group[field])) throw new Error('Lifetime history is missing retained usage');
  }
  const native = emptyNativeState();
  if (data.version === 3 && data.native !== undefined) {
    if (!isRecord(data.native) || !isRecord(data.native.rows) || !isRecord(data.native.receipts)
      || !isCounter(data.native.lifetime) || !isRecord(data.native.lifetimeGroups)) {
      throw new Error('Invalid native usage history');
    }
    for (const [key, row] of Object.entries(data.native.rows)) {
      if (!validNativeAggregate(row) || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)
        || key !== nativeRowKey(row)) throw new Error('Invalid native usage group');
      native.rows[key] = structuredClone(row);
    }
    for (const [key, row] of Object.entries(data.native.lifetimeGroups)) {
      if (!validNativeAggregate(row) || key !== nativeGroupKey(row)) throw new Error('Invalid native lifetime group');
      native.lifetimeGroups[key] = structuredClone(row);
    }
    for (const [id, receipt] of Object.entries(data.native.receipts)) {
      if (!/^[a-f0-9]{64}$/.test(id) || !isRecord(receipt) || !Object.hasOwn(native.rows, receipt.key)
        || !Number.isFinite(receipt.at) || !Number.isFinite(receipt.finishedAt)
        || !Number.isSafeInteger(receipt.durationMs) || receipt.durationMs < 0 || receipt.durationMs > MAX_OBSERVED_DURATION_MS
        || !NATIVE_OUTCOMES.includes(receipt.outcome)) throw new Error('Invalid native usage receipt');
      native.receipts[id] = { key: receipt.key, at: receipt.at, finishedAt: receipt.finishedAt,
        durationMs: receipt.durationMs, outcome: receipt.outcome };
    }
    if (Object.values(native.lifetimeGroups).reduce((sum, row) => sum + row.accepted, 0) !== data.native.lifetime) {
      throw new Error('Invalid native lifetime total');
    }
    for (const row of Object.values(native.rows)) {
      const group = native.lifetimeGroups[nativeGroupKey(row)];
      if (!group || [...NATIVE_COUNTERS, 'inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens',
        'reasoningOutputTokens', 'reportedSamples', 'unreportedSamples', 'cachedInputReportedSamples',
        'reasoningOutputReportedSamples']
        .some(field => row[field] > group[field])) throw new Error('Native lifetime history is missing retained usage');
    }
    native.lifetime = data.native.lifetime;
  }
  return { state: { version: 3, startedAt: data.startedAt, rows, receipts, lifetime: data.lifetime,
    lifetimeGroups, lifetimeUnclassified, native }, ...(data.version === 3 ? {} : { legacyText: text, legacyVersion: data.version }) };
}

function normalizeQuery(value) {
  if (typeof value === 'number') return { days: value, accountId: null, source: 'web' };
  if (!isRecord(value) || Object.keys(value).some(key => !['days', 'accountId', 'source'].includes(key))) throw new Error('Usage query is invalid');
  return { days: value.days, accountId: value.accountId ?? null, source: value.source ?? 'web' };
}

function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function diagnosticDurations(values, eligibleSamples) {
  return { observedSamples: values.length, eligibleSamples,
    medianMs: median(values), p95Ms: quantile(values, 0.95) };
}

function diagnosticFailures(counts, expected) {
  const observed = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const classifiedFailureSamples = [...counts].reduce((sum, [code, count]) =>
    sum + (code === 'unknown' ? 0 : count), 0);
  if (observed < expected) counts.set('unknown', (counts.get('unknown') ?? 0) + expected - observed);
  const failures = [...counts].map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return { failures, classifiedFailureSamples };
}

function webDiagnosticGroups(rows, receipts) {
  const groups = new Map(), rowsByKey = new Map(rows.map(row => [rowKey(row), row]));
  for (const row of rows) {
    const key = classificationKey(row);
    const group = groups.get(key) ?? { source: 'web', ...emptyGroup(row), durations: [], failureCounts: new Map() };
    for (const field of COUNTERS) group[field] += row[field];
    groups.set(key, group);
  }
  for (const receipt of receipts) {
    const row = rowsByKey.get(receipt.key);
    if (!row) continue;
    const group = groups.get(classificationKey(row));
    if (receipt.outcome !== null && Number.isSafeInteger(receipt.durationMs)) group.durations.push(receipt.durationMs);
    if (receipt.outcome === 'failed') {
      const code = normalizedFailureCode(receipt.failureCode);
      group.failureCounts.set(code, (group.failureCounts.get(code) ?? 0) + 1);
    }
  }
  return [...groups.values()].map(group => {
    const { durations, failureCounts, aborted, ...identity } = group;
    const knownOutcomeTotal = group.completed + group.failed + aborted;
    return { ...identity, cancelled: aborted, knownOutcomeTotal,
      knownOutcomeCompletionRate: knownOutcomeTotal ? group.completed / knownOutcomeTotal : null,
      durations: diagnosticDurations(durations, knownOutcomeTotal),
      ...diagnosticFailures(failureCounts, group.failed) };
  }).sort((a, b) => classificationKey(a).localeCompare(classificationKey(b)));
}

function nativeDiagnosticGroups(rows, receipts) {
  const groups = new Map(), rowsByKey = new Map(rows.map(row => [nativeRowKey(row), row]));
  for (const row of rows) {
    const key = nativeGroupKey(row);
    const group = groups.get(key) ?? { source: 'native', ...emptyNativeGroup(row), durations: [], failureCounts: new Map() };
    for (const field of NATIVE_COUNTERS) group[field] += row[field];
    for (const [code, count] of Object.entries(row.failures)) {
      group.failureCounts.set(code, (group.failureCounts.get(code) ?? 0) + count);
    }
    groups.set(key, group);
  }
  for (const receipt of receipts) {
    const row = rowsByKey.get(receipt.key);
    if (row) groups.get(nativeGroupKey(row)).durations.push(receipt.durationMs);
  }
  return [...groups.values()].map(group => {
    const { durations, failureCounts, failures: _failures, httpStatuses: _httpStatuses,
      inputTokens: _inputTokens, outputTokens: _outputTokens, totalTokens: _totalTokens,
      cachedInputTokens: _cachedInputTokens, reasoningOutputTokens: _reasoningOutputTokens,
      reportedSamples: _reportedSamples, unreportedSamples: _unreportedSamples,
      cachedInputReportedSamples: _cachedInputReportedSamples,
      reasoningOutputReportedSamples: _reasoningOutputReportedSamples, aborted, ...identity } = group;
    const knownOutcomeTotal = group.completed + group.incomplete + group.failed + aborted;
    return { ...identity, cancelled: aborted, knownOutcomeTotal,
      knownOutcomeCompletionRate: knownOutcomeTotal ? group.completed / knownOutcomeTotal : null,
      durations: diagnosticDurations(durations, knownOutcomeTotal),
      ...diagnosticFailures(failureCounts, group.failed + aborted) };
  }).sort((a, b) => nativeGroupKey(a).localeCompare(nativeGroupKey(b)));
}

function publicNativeAggregate(value) {
  const row = structuredClone(value);
  row.reasoningTokens = row.reasoningOutputTokens;
  row.reasoningReportedSamples = row.reasoningOutputReportedSamples;
  delete row.reasoningOutputTokens;
  delete row.reasoningOutputReportedSamples;
  return row;
}

class UsageStore {
  constructor(coreHome, clock = Date.now) {
    this.path = path.join(coreHome, 'local-usage.json'); this.backupPath = `${this.path}.backup`; this.clock = clock;
    this.state = { version: 3, startedAt: new Date(clock()).toISOString(), rows: {}, receipts: {}, lifetime: 0,
      lifetimeGroups: {}, lifetimeUnclassified: 0, native: emptyNativeState() };
    this.serializedState = JSON.stringify(this.state) + '\n'; this.primaryAvailable = false;
    this.error = null; this.recovered = false; this.backupAvailable = false;
    let primaryError, loaded;
    try {
      loaded = readState(this.path); this.state = loaded.state;
      this.serializedState = JSON.stringify(this.state) + '\n'; this.primaryAvailable = true;
    } catch (error) { primaryError = error; }
    if (primaryError) {
      if (primaryError.code && primaryError.code !== 'ENOENT') {
        this.error = 'Usage history is unreadable; existing data was preserved.'; return;
      }
      try { loaded = readState(this.backupPath); this.state = loaded.state; }
      catch (backupError) {
        if (primaryError.code !== 'ENOENT' || backupError.code !== 'ENOENT') this.error = 'Usage history is unreadable; existing data was preserved.';
        return;
      }
      try {
        if (loaded.legacyText) writeDurable(`${this.path}.v${loaded.legacyVersion}-${randomUUID()}.backup`, loaded.legacyText);
        if (primaryError.code !== 'ENOENT') {
          renameAtomicFile(this.path, `${this.path}.corrupt-${Date.now()}-${randomUUID()}`);
        }
        this.serializedState = JSON.stringify(this.state) + '\n';
        writeDurable(this.path, this.serializedState); this.primaryAvailable = true; this.recovered = true;
      } catch { this.error = 'Usage history could not be restored; the backup was preserved.'; return; }
    }
    try {
      if (!this.recovered && loaded.legacyText) writeDurable(`${this.path}.v${loaded.legacyVersion}-${randomUUID()}.backup`, loaded.legacyText);
      if (loaded.legacyText) this.persist(this.state);
      else if (this.primaryAvailable) {
        replaceBackupWithClone(this.path, this.backupPath, this.serializedState);
        this.backupAvailable = true;
      }
    } catch { this.error = 'Usage history could not be saved; existing data was preserved.'; }
  }

  persist(next) {
    const prepared = preparePersistedState(next);
    try { writeDurable(this.path, prepared.text); }
    catch (error) { this.error = 'Usage history could not be saved; restart to reload the preserved history.'; throw error; }
    this.state = prepared.state; this.serializedState = prepared.text; this.primaryAvailable = true;
    try {
      replaceBackupWithClone(this.path, this.backupPath, this.serializedState);
      this.backupAvailable = true;
    } catch { this.backupAvailable = false; }
  }

  accept(trace, pid, receipt, effort, modelVersion, mode = 'automatic', accountId = UNKNOWN_ACCOUNT_ID, metadata = {}) {
    if (this.error) return;
    const id = digest(`${trace}:${pid}:${receipt}`);
    if (this.state.receipts[id]) return;
    const classification = { accountId, effort, modelVersion, mode,
      modelVersionSource: metadata.modelVersionSource ?? 'unknown', messageKind: metadata.messageKind ?? 'unknown' };
    if (!validClassification(classification)) throw new Error('Invalid usage classification');
    const now = this.clock(), day = dayOf(new Date(now)), key = rowKey({ day, ...classification });
    const next = { ...this.state, rows: { ...this.state.rows }, receipts: { ...this.state.receipts },
      lifetimeGroups: { ...this.state.lifetimeGroups } };
    const cutoff = dayOf(new Date(now - 90 * 86400_000));
    for (const [name, row] of Object.entries(next.rows)) if (row.day < cutoff) delete next.rows[name];
    for (const [name, saved] of Object.entries(next.receipts)) if (!next.rows[saved.key]) delete next.receipts[name];
    if (next.lifetime >= Number.MAX_SAFE_INTEGER) throw new Error('Usage lifetime capacity reached; history was preserved');
    const row = next.rows[key] ? { ...next.rows[key] } : { day, ...emptyGroup(classification) };
    row.accepted++; next.rows[key] = row; next.lifetime++;
    const name = classificationKey(row), group = next.lifetimeGroups[name] ? { ...next.lifetimeGroups[name] } : emptyGroup(row);
    group.accepted++; next.lifetimeGroups[name] = group;
    next.receipts[id] = { owner: digest(`${trace}:${pid}`), key, at: now, outcome: null };
    this.persist(next);
  }

  finish(trace, pid, outcome, receipt, failureCode, finishedAt = this.clock()) {
    if (this.error || !OUTCOMES.includes(outcome)) return;
    const owner = digest(`${trace}:${pid}`), wanted = receipt && digest(`${trace}:${pid}:${receipt}`);
    const next = { ...this.state, rows: { ...this.state.rows }, receipts: { ...this.state.receipts },
      lifetimeGroups: { ...this.state.lifetimeGroups } };
    const clonedRows = new Set(), clonedGroups = new Set(); let changed = false;
    for (const [id, original] of Object.entries(next.receipts)) {
      const saved = original;
      if (saved.owner !== owner || saved.outcome !== null || (wanted && id !== wanted)) continue;
      const receiptCopy = { ...saved }; next.receipts[id] = receiptCopy;
      if (!clonedRows.has(saved.key)) { next.rows[saved.key] = { ...next.rows[saved.key] }; clonedRows.add(saved.key); }
      const row = next.rows[saved.key], groupKey = classificationKey(row);
      if (!clonedGroups.has(groupKey)) {
        next.lifetimeGroups[groupKey] = { ...next.lifetimeGroups[groupKey] }; clonedGroups.add(groupKey);
      }
      receiptCopy.outcome = outcome; row[outcome]++; next.lifetimeGroups[groupKey][outcome]++;
      const duration = finishedAt - receiptCopy.at;
      if (Number.isSafeInteger(duration) && duration >= 0 && duration <= MAX_OBSERVED_DURATION_MS) receiptCopy.durationMs = duration;
      if (outcome === 'failed') receiptCopy.failureCode = normalizedFailureCode(failureCode);
      changed = true;
    }
    if (changed) this.persist(next);
  }

  recordNative(value) {
    if (this.error) return { recorded: false, unavailable: true };
    const sample = validateNativeUsageSample(value);
    const observedAt = this.clock();
    if (sample.finishedAt > observedAt + 60_000 || sample.finishedAt < observedAt - 24 * 60 * 60 * 1000) {
      throw new Error('Native usage sample time is outside the delivery window');
    }
    const id = digest(`native:${sample.eventId}`);
    if (this.state.native.receipts[id]) return { recorded: false, duplicate: true };
    const next = { ...this.state, native: { ...this.state.native, rows: { ...this.state.native.rows },
      receipts: { ...this.state.native.receipts }, lifetimeGroups: { ...this.state.native.lifetimeGroups } } };
    const day = dayOf(new Date(sample.finishedAt));
    const cutoff = dayOf(new Date(this.clock() - 90 * 86400_000));
    for (const [key, row] of Object.entries(next.native.rows)) if (row.day < cutoff) delete next.native.rows[key];
    for (const [key, receipt] of Object.entries(next.native.receipts)) {
      if (!next.native.rows[receipt.key]) delete next.native.receipts[key];
    }
    while (Object.keys(next.native.receipts).length >= MAX_NATIVE_RECEIPTS) {
      delete next.native.receipts[Object.keys(next.native.receipts)[0]];
    }
    let aggregateIdentity = sample;
    const exactLifetimeKey = nativeGroupKey(sample);
    const exactRowKey = nativeRowKey({ day, ...sample });
    if ((!Object.hasOwn(next.native.lifetimeGroups, exactLifetimeKey)
        && Object.keys(next.native.lifetimeGroups).length >= MAX_NATIVE_GROUPS)
      || (!Object.hasOwn(next.native.rows, exactRowKey)
        && Object.keys(next.native.rows).length >= MAX_NATIVE_GROUPS)) {
      aggregateIdentity = { ...sample, modelId: 'unknown', modelIdSource: 'unknown' };
    }
    const key = nativeRowKey({ day, ...aggregateIdentity });
    const delta = { day, ...emptyNativeGroup(aggregateIdentity) };
    delta.accepted = 1;
    delta[sample.outcome] = 1;
    const status = String(sample.httpStatus);
    delta.httpStatuses[status] = 1;
    if (sample.failure !== null) delta.failures[sample.failure] = 1;
    if (sample.tokens) {
      delta.reportedSamples = 1;
      delta.inputTokens = sample.tokens.inputTokens;
      delta.outputTokens = sample.tokens.outputTokens;
      delta.totalTokens = sample.tokens.totalTokens;
      if (sample.tokens.cachedInputTokens !== undefined) {
        delta.cachedInputTokens = sample.tokens.cachedInputTokens;
        delta.cachedInputReportedSamples = 1;
      }
      if (sample.tokens.reasoningOutputTokens !== undefined) {
        delta.reasoningOutputTokens = sample.tokens.reasoningOutputTokens;
        delta.reasoningOutputReportedSamples = 1;
      }
    } else delta.unreportedSamples = 1;
    if (!validNativeAggregate(delta)) throw new Error('Native usage aggregate is invalid');
    addNativeAggregate(next.native.rows, key, delta);
    addNativeAggregate(next.native.lifetimeGroups, nativeGroupKey(delta), delta);
    next.native.lifetime++;
    next.native.receipts[id] = { key, at: sample.startedAt, finishedAt: sample.finishedAt,
      durationMs: sample.durationMs, outcome: sample.outcome };
    this.persist(next);
    return { recorded: true };
  }

  snapshotNative(days) {
    const generated = new Date(this.clock()), endDay = dayOf(generated), first = new Date(generated);
    first.setDate(first.getDate() - days + 1);
    const startDay = dayOf(first), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
    const calendar = [];
    for (let offset = 0; offset < days; offset++) {
      const date = new Date(first); date.setDate(first.getDate() + offset);
      calendar.push({ day: dayOf(date), total: 0, completed: 0, incomplete: 0, failed: 0, cancelled: 0, unrecorded: 0,
        inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0,
        reportedSamples: 0, unreportedSamples: 0, cachedInputReportedSamples: 0, reasoningOutputReportedSamples: 0 });
    }
    const base = { source: 'native', generatedAt: generated.toISOString(), timeZone,
      period: { startDay, endDay, days }, selectedAccountId: null, accounts: [] };
    const emptyMetrics = { total: 0, messageCount: 0, responseCount: 0, completed: 0, incomplete: 0, failed: 0,
      cancelled: 0, unrecorded: 0, knownOutcomeTotal: 0, knownOutcomeCompletionRate: null };
    if (this.error) return { available: false, error: this.error, rows: [], diagnosticGroups: [], ...base, metrics: emptyMetrics,
      durations: { observedSamples: 0, medianMs: null, p95Ms: null }, failures: [], calendar,
      tokens: { inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null,
        reasoningTokens: null, reportedSamples: 0, unreportedSamples: 0,
        cachedInputReportedSamples: 0, reasoningReportedSamples: 0 } };
    const rows = Object.values(this.state.native.rows).filter(row => row.day >= startDay && row.day <= endDay)
      .sort((a, b) => a.day.localeCompare(b.day) || a.modelId.localeCompare(b.modelId));
    const metrics = rows.reduce((total, row) => ({ ...total, total: total.total + row.accepted,
      messageCount: total.messageCount + row.accepted, responseCount: total.responseCount + row.accepted,
      completed: total.completed + row.completed, incomplete: total.incomplete + row.incomplete, failed: total.failed + row.failed,
      cancelled: total.cancelled + row.aborted }), { ...emptyMetrics });
    metrics.knownOutcomeTotal = metrics.completed + metrics.incomplete + metrics.failed + metrics.cancelled;
    metrics.unrecorded = metrics.total - metrics.knownOutcomeTotal;
    metrics.knownOutcomeCompletionRate = metrics.knownOutcomeTotal ? metrics.completed / metrics.knownOutcomeTotal : null;
    const rowKeys = new Set(rows.map(nativeRowKey)), durations = [];
    for (const receipt of Object.values(this.state.native.receipts)) {
      if (rowKeys.has(receipt.key)) durations.push(receipt.durationMs);
    }
    const failures = new Map();
    const tokenSums = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0,
      reasoningOutputTokens: 0, reportedSamples: 0, unreportedSamples: 0,
      cachedInputReportedSamples: 0, reasoningOutputReportedSamples: 0 };
    const byDay = new Map(calendar.map(row => [row.day, row]));
    for (const row of rows) {
      for (const [code, count] of Object.entries(row.failures)) failures.set(code, (failures.get(code) ?? 0) + count);
      for (const field of Object.keys(tokenSums)) tokenSums[field] += row[field];
      const day = byDay.get(row.day);
      day.total += row.accepted; day.completed += row.completed; day.incomplete += row.incomplete;
      day.failed += row.failed; day.cancelled += row.aborted;
      for (const field of Object.keys(tokenSums)) day[field] += row[field];
    }
    const tokens = { inputTokens: tokenSums.reportedSamples ? tokenSums.inputTokens : null,
      outputTokens: tokenSums.reportedSamples ? tokenSums.outputTokens : null,
      totalTokens: tokenSums.reportedSamples ? tokenSums.totalTokens : null,
      cachedInputTokens: tokenSums.cachedInputReportedSamples ? tokenSums.cachedInputTokens : null,
      reasoningTokens: tokenSums.reasoningOutputReportedSamples ? tokenSums.reasoningOutputTokens : null,
      reportedSamples: tokenSums.reportedSamples, unreportedSamples: tokenSums.unreportedSamples,
      cachedInputReportedSamples: tokenSums.cachedInputReportedSamples,
      reasoningReportedSamples: tokenSums.reasoningOutputReportedSamples };
    const diagnosticGroups = nativeDiagnosticGroups(rows,
      Object.values(this.state.native.receipts).filter(receipt => rowKeys.has(receipt.key)));
    return { available: true, startedAt: this.state.startedAt, lifetime: this.state.native.lifetime,
      lifetimeGroups: Object.values(this.state.native.lifetimeGroups).map(publicNativeAggregate), lifetimeUnclassified: 0,
      recovered: this.recovered, backupAvailable: this.backupAvailable, rows: rows.map(publicNativeAggregate), ...base, metrics,
      durations: { observedSamples: durations.length, medianMs: median(durations), p95Ms: quantile(durations, 0.95) },
      failures: [...failures].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
      diagnosticGroups, calendar: calendar.map(publicNativeAggregate), tokens };
  }

  snapshot(query = 7, accountMetadata = []) {
    const { days, accountId, source } = normalizeQuery(query);
    if (![1, 7, 30, 90].includes(days)) throw new Error('Usage range must be 1, 7, 30 or 90 days');
    if (!['web', 'native'].includes(source)) throw new Error('Usage source must be web or native');
    if (source === 'native') {
      if (accountId !== null) throw new Error('Native usage does not support ChatGPT account filtering');
      return this.snapshotNative(days);
    }
    if (accountId !== null && !validAccountId(accountId)) throw new Error('Usage account filter is invalid');
    const generated = new Date(this.clock()), endDay = dayOf(generated), first = new Date(generated);
    first.setDate(first.getDate() - days + 1);
    const startDay = dayOf(first), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
    const currentAccounts = new Map(accountMetadata.map(account => [account.id, account.label]));
    const historical = new Set([...Object.values(this.state.rows), ...Object.values(this.state.lifetimeGroups)].map(row => row.accountId));
    const accounts = [...currentAccounts].map(([id, label]) => ({ id, label, available: true }));
    for (const id of [...historical].sort()) if (!currentAccounts.has(id)) {
      accounts.push({ id, label: id === UNKNOWN_ACCOUNT_ID ? 'Historical / unknown' : 'Deleted account', available: false });
    }
    const base = { source: 'web', generatedAt: generated.toISOString(), timeZone,
      period: { startDay, endDay, days }, selectedAccountId: accountId, accounts };
    const calendar = [];
    for (let offset = 0; offset < days; offset++) {
      const date = new Date(first); date.setDate(first.getDate() + offset);
      calendar.push({ day: dayOf(date), total: 0, completed: 0, failed: 0, cancelled: 0, unrecorded: 0 });
    }
    const emptyMetrics = { total: 0, messageCount: 0, completed: 0, failed: 0, cancelled: 0, unrecorded: 0,
      knownOutcomeTotal: 0, knownOutcomeCompletionRate: null, observedRunCount: 0,
      runCountCoverage: { observedMessages: 0, totalMessages: 0, complete: true } };
    if (this.error) return { available: false, error: this.error, rows: [], diagnosticGroups: [], ...base, metrics: emptyMetrics,
      durations: { observedSamples: 0, medianMs: null, p95Ms: null }, failures: [], calendar };

    const rows = Object.values(this.state.rows).filter(row => row.day >= startDay && row.day <= endDay
      && (accountId === null || row.accountId === accountId)).sort((a, b) => a.day.localeCompare(b.day));
    const metrics = rows.reduce((total, row) => ({ ...total, total: total.total + row.accepted,
      messageCount: total.messageCount + row.accepted, completed: total.completed + row.completed,
      failed: total.failed + row.failed, cancelled: total.cancelled + row.aborted }), { ...emptyMetrics });
    metrics.knownOutcomeTotal = metrics.completed + metrics.failed + metrics.cancelled;
    metrics.unrecorded = metrics.total - metrics.knownOutcomeTotal;
    metrics.knownOutcomeCompletionRate = metrics.knownOutcomeTotal ? metrics.completed / metrics.knownOutcomeTotal : null;

    const includedKeys = new Set(rows.map(rowKey)), durations = [], owners = new Set(), failureCounts = new Map();
    let observedMessages = 0, observedFailures = 0;
    for (const saved of Object.values(this.state.receipts)) {
      if (!includedKeys.has(saved.key)) continue;
      observedMessages++; owners.add(saved.owner);
      if (saved.outcome !== null && Number.isSafeInteger(saved.durationMs)) durations.push(saved.durationMs);
      if (saved.outcome === 'failed') {
        const code = normalizedFailureCode(saved.failureCode);
        failureCounts.set(code, (failureCounts.get(code) ?? 0) + 1); observedFailures++;
      }
    }
    metrics.observedRunCount = owners.size;
    metrics.runCountCoverage = { observedMessages, totalMessages: metrics.messageCount, complete: observedMessages === metrics.messageCount };
    if (metrics.failed > observedFailures) failureCounts.set('unknown', (failureCounts.get('unknown') ?? 0) + metrics.failed - observedFailures);

    const byDay = new Map(calendar.map(row => [row.day, row]));
    for (const row of rows) {
      const day = byDay.get(row.day);
      day.total += row.accepted; day.completed += row.completed; day.failed += row.failed; day.cancelled += row.aborted;
      day.unrecorded += row.accepted - row.completed - row.failed - row.aborted;
    }
    const lifetimeGroups = Object.values(this.state.lifetimeGroups).filter(row => accountId === null || row.accountId === accountId);
    const lifetimeUnclassified = accountId === null || accountId === UNKNOWN_ACCOUNT_ID ? this.state.lifetimeUnclassified : 0;
    const diagnosticGroups = webDiagnosticGroups(rows,
      Object.values(this.state.receipts).filter(receipt => includedKeys.has(receipt.key)));
    return { available: true, startedAt: this.state.startedAt,
      lifetime: lifetimeGroups.reduce((sum, row) => sum + row.accepted, lifetimeUnclassified),
      lifetimeGroups: structuredClone(lifetimeGroups), lifetimeUnclassified, recovered: this.recovered,
      backupAvailable: this.backupAvailable, rows: structuredClone(rows), ...base, metrics,
      durations: { observedSamples: durations.length, medianMs: median(durations), p95Ms: quantile(durations, 0.95) },
      failures: [...failureCounts].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
      diagnosticGroups, calendar };
  }
}

module.exports = { FAILURE_CODES, MESSAGE_KINDS, MODEL_VERSION_SOURCES, NATIVE_FAILURE_CODES,
  UNKNOWN_ACCOUNT_ID, UsageStore, normalizedFailureCode, validateNativeUsageSample };
