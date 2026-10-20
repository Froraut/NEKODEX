// Metadata-only validation at the untrusted helper and durable journal boundary.
const identifier = /^[A-Za-z0-9_.:-]{1,128}$/;
const trace = /^[A-Za-z0-9_-]{6,128}$/;
const hash = /^[a-f0-9]{64}$/;
const time = value => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, required, optional = []) => object(value)
  && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
function validTaskObservation(value) {
  return keys(value, ['version', 'observedAt', 'source', 'lineage', 'tools', 'skills', 'toolsTruncated', 'skillsTruncated'], ['native', 'toolCounters'])
    && value.version === 1 && value.source === 'validated-request' && time(value.observedAt)
    && (value.toolCounters === undefined || (keys(value.toolCounters, ['total', 'succeeded', 'errors', 'samples', 'totalLatencyMs'], ['minLatencyMs', 'maxLatencyMs'])
      && Object.values(value.toolCounters).every(time)
      && value.toolCounters.succeeded + value.toolCounters.errors <= value.toolCounters.total
      && value.toolCounters.samples <= value.toolCounters.succeeded + value.toolCounters.errors))
    && typeof value.toolsTruncated === 'boolean' && typeof value.skillsTruncated === 'boolean'
    && (value.native === undefined || (keys(value.native, ['threadId', 'turnId', 'source', 'state'], ['parentThreadId', 'agentName'])
      && typeof value.native.threadId === 'string' && identifier.test(value.native.threadId)
      && typeof value.native.turnId === 'string' && identifier.test(value.native.turnId)
      && ['codex-client', 'external-client'].includes(value.native.source) && value.native.state === 'request-observed'
      && (value.native.parentThreadId === undefined || (typeof value.native.parentThreadId === 'string' && identifier.test(value.native.parentThreadId)
        && value.native.parentThreadId !== value.native.threadId))
      && (value.native.agentName === undefined || (typeof value.native.agentName === 'string' && value.native.agentName.length <= 128
        && /^\/root(?:\/[A-Za-z0-9_-]+)*$/.test(value.native.agentName)))))
    && Array.isArray(value.lineage) && value.lineage.length <= 16 && value.lineage.every(row =>
      keys(row, ['kind', 'observedAt'], ['sourceTraceId', 'fromId', 'toId'])
      && ['compaction', 'checkpoint', 'browser-rebind', 'assistant-replacement'].includes(row.kind) && time(row.observedAt)
      && (row.sourceTraceId === undefined || (typeof row.sourceTraceId === 'string' && trace.test(row.sourceTraceId)))
      && (row.fromId === undefined || (typeof row.fromId === 'string' && identifier.test(row.fromId))) && (row.toId === undefined || (typeof row.toId === 'string' && identifier.test(row.toId))))
    && Array.isArray(value.tools) && value.tools.length <= 128 && value.tools.every(row =>
      keys(row, ['name', 'advertised', 'selected', 'observed'], ['namespace', 'observedAt'])
      && typeof row.name === 'string' && identifier.test(row.name)
      && (row.namespace === undefined || (typeof row.namespace === 'string' && identifier.test(row.namespace)))
      && typeof row.advertised === 'boolean' && typeof row.selected === 'boolean'
      && ['unobserved', 'succeeded'].includes(row.observed)
      && (row.observedAt === undefined || (row.observed === 'succeeded' && time(row.observedAt))))
    && new Set(value.tools.map(row => JSON.stringify([row.namespace, row.name]))).size === value.tools.length
    && Array.isArray(value.skills) && value.skills.length <= 16 && value.skills.every(row =>
      keys(row, ['name', 'source', 'contentDigest'], ['sourceDigest'])
      && typeof row.name === 'string' && /^[\p{L}\p{N}_.:/ -]{1,128}$/u.test(row.name)
      && row.source === 'codex-selected-skill' && hash.test(row.contentDigest)
      && (row.sourceDigest === undefined || hash.test(row.sourceDigest)))
    && Buffer.byteLength(JSON.stringify(value), 'utf8') <= 12_000;
}
function assertTaskObservation(value) {
  if (!validTaskObservation(value)) throw new Error('Invalid bounded task observation');
}
module.exports = { validTaskObservation, assertTaskObservation };
