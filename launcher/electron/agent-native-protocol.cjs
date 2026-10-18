'use strict';
const { createHash } = require('node:crypto');
const AGENT_NATIVE_PROTOCOL = 'neko-agent-v1';
const AGENT_NATIVE_OUTPUT_SCHEMA_ID = 'neko-agent-result-v1';
const AGENT_NATIVE_TEXT_BYTES = 128 * 1024;
const AGENT_NATIVE_ENVELOPE_BYTES = 512 * 1024;
function freeze(value) { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
// Fixed main-owned schema. Caller task text, skill files and renderer cannot select a different schema.
const AGENT_NATIVE_OUTPUT_SCHEMA = freeze({ type: 'object', properties: {
  protocol: { type: 'string', enum: [AGENT_NATIVE_PROTOCOL] }, kind: { type: 'string', enum: ['tool_request', 'final'] },
  requestId: { type: ['string', 'null'] }, toolId: { type: ['string', 'null'] }, argumentsJson: { type: ['string', 'null'] }, summary: { type: ['string', 'null'] },
}, required: ['protocol', 'kind', 'requestId', 'toolId', 'argumentsJson', 'summary'], additionalProperties: false });
const AGENT_NATIVE_OUTPUT_SCHEMA_HASH = createHash('sha256').update(JSON.stringify(AGENT_NATIVE_OUTPUT_SCHEMA)).digest('hex');
module.exports = Object.freeze({ AGENT_NATIVE_PROTOCOL, AGENT_NATIVE_OUTPUT_SCHEMA_ID, AGENT_NATIVE_OUTPUT_SCHEMA, AGENT_NATIVE_OUTPUT_SCHEMA_HASH, AGENT_NATIVE_TEXT_BYTES, AGENT_NATIVE_ENVELOPE_BYTES });
