const UNKNOWN_ACCOUNT_ID = 'unknown';
const OUTCOMES = ['completed', 'failed', 'aborted'];
const COUNTERS = ['accepted', ...OUTCOMES];
const FAILURE_CODES = new Set(['rate_limit', 'safety_stop', 'timeout', 'browser_failure', 'other', 'unknown']);
const NATIVE_OUTCOMES = ['completed', 'incomplete', 'failed', 'aborted'];
const NATIVE_COUNTERS = ['accepted', ...NATIVE_OUTCOMES];
const dayOf = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const classificationKey = row => [row.accountId, row.effort, row.modelVersion, row.modelVersionSource, row.mode, row.messageKind].join('|');
const rowKey = row => `${row.day}|${classificationKey(row)}`;
const emptyGroup = row => ({ accountId: row.accountId, effort: row.effort, modelVersion: row.modelVersion,
  modelVersionSource: row.modelVersionSource, mode: row.mode, messageKind: row.messageKind,
  accepted: 0, completed: 0, failed: 0, aborted: 0 });
const nativeGroupKey = row => `${row.endpoint}|${row.modelIdSource}|${row.modelId}`;
const nativeRowKey = row => `${row.day}|${nativeGroupKey(row)}`;
const emptyNativeGroup = row => ({ endpoint: row.endpoint, modelId: row.modelId, modelIdSource: row.modelIdSource,
  accepted: 0, completed: 0, incomplete: 0, failed: 0, aborted: 0,
  inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0,
  reportedSamples: 0, unreportedSamples: 0, cachedInputReportedSamples: 0, reasoningOutputReportedSamples: 0,
  failures: {}, httpStatuses: {} });

function normalizedFailureCode(value) {
  if (value === 'rate_limit_exceeded') return 'rate_limit';
  if (value === 'account_safety_stop') return 'safety_stop';
  if (value === 'tool_timeout') return 'timeout';
  if (value === 'context_length_exceeded' || value === 'model_unavailable') return 'other';
  if (value === undefined || value === null || value === '') return 'unknown';
  return FAILURE_CODES.has(value) ? value : 'other';
}


module.exports = { UNKNOWN_ACCOUNT_ID, OUTCOMES, COUNTERS, FAILURE_CODES, NATIVE_OUTCOMES, NATIVE_COUNTERS, dayOf, classificationKey, rowKey, emptyGroup, nativeGroupKey, nativeRowKey, emptyNativeGroup, normalizedFailureCode };
