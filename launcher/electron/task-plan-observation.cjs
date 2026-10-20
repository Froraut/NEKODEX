// Content-bearing plans have a separate opt-in contract from metadata-only task observations.
const identifier = /^[A-Za-z0-9_.:-]{1,128}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, required, optional = []) => object(value) && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const text = (value, bytes) => typeof value === 'string' && value.trim().length > 0
  && Buffer.byteLength(value, 'utf8') <= bytes && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const id = value => typeof value === 'string' && identifier.test(value);
const natural = value => Number.isSafeInteger(value) && value > 0;
function validTaskPlanObservation(value) {
  if (!keys(value, ['version', 'observedAt', 'source', 'state', 'revisions', 'truncated'], ['reason', 'native'])
    || value.version !== 1 || value.source !== 'native-codex-current-turn'
    || !Number.isSafeInteger(value.observedAt) || value.observedAt < 0 || value.observedAt > 8_640_000_000_000_000
    || !['disabled', 'unavailable', 'observed'].includes(value.state) || typeof value.truncated !== 'boolean'
    || !Array.isArray(value.revisions) || value.revisions.length > 8
    || Buffer.byteLength(JSON.stringify(value), 'utf8') > 8_000) return false;
  if (value.native !== undefined && !(keys(value.native, ['threadId', 'turnId']) && id(value.native.threadId) && id(value.native.turnId))) return false;
  if (value.state !== 'observed') return value.revisions.length === 0 && value.truncated === false
    && (value.state === 'disabled' ? value.reason === undefined && value.native === undefined
      : ['native-source-unavailable', 'no-native-plan', 'invalid-native-plan', 'plan-budget-exceeded'].includes(value.reason));
  if (!value.native || value.reason !== undefined || !value.revisions.length) return false;
  const calls = new Set(); const messages = new Set();
  for (let index = 0; index < value.revisions.length; index++) {
    const row = value.revisions[index];
    if (!keys(row, ['revision', 'sourceCallId', 'steps'], ['sourceMessageId', 'supersedes', 'explanation'])
      || !natural(row.revision) || !id(row.sourceCallId) || calls.has(row.sourceCallId)
      || (row.sourceMessageId !== undefined && (!id(row.sourceMessageId) || messages.has(row.sourceMessageId)))
      || (row.revision === 1 ? row.supersedes !== undefined : row.supersedes !== row.revision - 1)
      || (index > 0 && row.revision !== value.revisions[index - 1].revision + 1)
      || (index === 0 && !value.truncated && row.revision !== 1)
      || (row.explanation !== undefined && !text(row.explanation, 1500))
      || !Array.isArray(row.steps) || row.steps.length > 32 || !row.steps.every(step =>
        keys(step, ['text', 'claimedStatus', 'evidence', 'verification']) && text(step.text, 1000)
        && ['pending', 'in_progress', 'completed'].includes(step.claimedStatus)
        && step.evidence === 'observed' && step.verification === 'unverified')
      || row.steps.filter(step => step.claimedStatus === 'in_progress').length > 1) return false;
    calls.add(row.sourceCallId);
    if (row.sourceMessageId) messages.add(row.sourceMessageId);
  }
  return true;
}
function assertTaskPlanObservation(value) {
  if (!validTaskPlanObservation(value)) throw new Error('Invalid bounded task plan observation');
}
module.exports = { validTaskPlanObservation, assertTaskPlanObservation };
