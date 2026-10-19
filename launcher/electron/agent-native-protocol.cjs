'use strict';
const { createHash } = require('node:crypto');
const AGENT_NATIVE_PROTOCOL = 'neko-agent-v1';
const AGENT_NATIVE_OUTPUT_SCHEMA_ID = 'neko-agent-result-v1';
const AGENT_NATIVE_TEXT_BYTES = 128 * 1024;
const AGENT_NATIVE_ENVELOPE_BYTES = 512 * 1024;
function isAgentNativeHistorySource(value) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 4 && ['sourceId', 'profileId', 'backendAccountId', 'authEpoch'].every(key => Object.hasOwn(value, key))
    && /^[a-f0-9]{64}$/.test(value.sourceId) && uuid.test(value.profileId) && uuid.test(value.authEpoch)
    && typeof value.backendAccountId === 'string' && value.backendAccountId.length > 0 && value.backendAccountId.length <= 128
    && !/[\u0000-\u0020]/u.test(value.backendAccountId);
}
function freeze(value) { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
// Fixed main-owned schema. Caller task text, skill files and renderer cannot select a different schema.
const AGENT_NATIVE_OUTPUT_SCHEMA = freeze({ type: 'object', properties: {
  protocol: { type: 'string', enum: [AGENT_NATIVE_PROTOCOL] }, kind: { type: 'string', enum: ['tool_request', 'final', 'awaiting_input'] },
  requestId: { type: ['string', 'null'] }, toolId: { type: ['string', 'null'] }, argumentsJson: { type: ['string', 'null'] }, summary: { type: ['string', 'null'] },
}, required: ['protocol', 'kind', 'requestId', 'toolId', 'argumentsJson', 'summary'], additionalProperties: false });
const AGENT_NATIVE_OUTPUT_SCHEMA_HASH = createHash('sha256').update(JSON.stringify(AGENT_NATIVE_OUTPUT_SCHEMA)).digest('hex');
module.exports = Object.freeze({ AGENT_NATIVE_PROTOCOL, AGENT_NATIVE_OUTPUT_SCHEMA_ID, AGENT_NATIVE_OUTPUT_SCHEMA, AGENT_NATIVE_OUTPUT_SCHEMA_HASH, AGENT_NATIVE_TEXT_BYTES, AGENT_NATIVE_ENVELOPE_BYTES, isAgentNativeHistorySource });
