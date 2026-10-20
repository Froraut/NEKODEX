'use strict';
// Read-only format projection: no paths, filesystem, saved state or consent.
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const token = value => Number.isSafeInteger(value) && value >= 0 && value <= 1e12;
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const safeModel = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}$/.test(value) && !value.includes('://') ? value : null;
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const clients = Object.freeze(['codex', 'claude', 'gemini']);
const adapters = Object.freeze({ codex: 'codex-rollout-v1', claude: 'claude-transcript-v1', gemini: 'gemini-session-v1' });
function supportsUsageFilename(client, name) {
  if (client === 'gemini') return /^session-.*\.jsonl?$/.test(name) || /^[a-f0-9-]{36}\.jsonl$/i.test(name);
  return name.endsWith('.jsonl') && (client !== 'codex' || /^rollout-.*\.jsonl$/.test(name));
}
function normalizeUsage(raw, client) {
  if (client === 'gemini') {
    if (!plain(raw) || !token(raw.input) || !token(raw.output) || !token(raw.cached)
      || (raw.thoughts !== undefined && !token(raw.thoughts)) || (raw.tool !== undefined && !token(raw.tool))
      || raw.cached > raw.input || !token(raw.output + (raw.thoughts ?? 0))
      || !token(raw.total) || raw.total !== raw.input + raw.output + (raw.thoughts ?? 0) + (raw.tool ?? 0)) return null;
    // Gemini reports thinking separately from candidates; both are output.
    // Tool-use prompt tokens have no documented inclusion guarantee here.
    if ((raw.tool ?? 0) !== 0) return null;
    return { inputTokens: raw.input, outputTokens: raw.output + (raw.thoughts ?? 0),
      cachedInputTokens: raw.cached, cacheWriteTokens: 0 };
  }
  if (!raw || !token(raw.input_tokens) || !token(raw.output_tokens)) return null;
  const read = client === 'claude' ? raw.cache_read_input_tokens : raw.cached_input_tokens;
  const write = client === 'claude' ? raw.cache_creation_input_tokens : raw.cache_write_input_tokens;
  if ((read !== undefined && !token(read)) || (write !== undefined && !token(write))) return null;
  // Missing cache detail is unknown, not zero. Claude documents input as uncached;
  // Codex input includes cached input. Cache-write pricing is intentionally explicit.
  const input = client === 'claude' ? raw.input_tokens + (read ?? 0) + (write ?? 0) : raw.input_tokens;
  if (!token(input) || (read ?? 0) + (write ?? 0) > input) return null;
  return { inputTokens: input, outputTokens: raw.output_tokens,
    cachedInputTokens: read ?? null, cacheWriteTokens: write ?? null };
}

// Returns only usage metadata events and the supplied parser context's next
// values. Durable deduplication, cumulative deltas and cursor offsets belong to
// the service; raw provider objects never cross this projection boundary.
function parseUsageLine({ client, line, context }) {
  const cursor = { ...context };
  const events = [];
  const warn = code => events.push({ kind: 'warning', code });
  const emit = (kind, row, details = {}) => events.push({
    kind, context: { ...cursor }, ...details,
    timestamp: typeof row.timestamp === 'string' && /^\d{4}-\d\d-\d\dT/.test(row.timestamp)
      && Number.isFinite(Date.parse(row.timestamp)) ? new Date(row.timestamp).toISOString() : null,
  });
  const visit = row => {
    if (!row || typeof row !== 'object') { warn('unsupported-record'); return; }
    if (client === 'codex') {
      const payload = row.payload;
      if (row.type === 'session_meta') {
        if (!safeId(payload?.id)) { warn('unsupported-session-identity'); return; }
        cursor.session = hash(`codex:${payload.id}`);
        cursor.clientVersion = safeId(payload.cli_version) ? payload.cli_version : null;
        cursor.supported = /^0\.\d+\.\d+(?:[-+].*)?$/.test(cursor.clientVersion ?? '');
        emit('session', row);
        if (!cursor.supported) warn('unsupported-client-version');
      } else if (row.type === 'turn_context') {
        cursor.model = safeModel(payload?.model);
        cursor.turn = safeId(payload?.turn_id) ? payload.turn_id : safeId(payload?.id) ? payload.id : null;
        if (cursor.session && cursor.turn) emit('turn', row);
      } else if (row.type === 'event_msg' && payload?.type === 'token_count') {
        if (!cursor.session) { warn('missing-session-identity'); return; }
        const usage = cursor.supported ? normalizeUsage(payload.info?.total_token_usage, 'codex') : null;
        if (!usage) { warn(cursor.supported ? 'missing-or-unsupported-usage' : 'unsupported-client-version'); return; }
        emit('cumulative', row, { usage });
      }
    } else if (client === 'gemini') {
      // Legacy JSON/checkpoints and current metadata + message JSONL use the
      // same projection. Rewinds concern history, not incurred token usage.
      if (safeId(row.sessionId) && typeof row.projectHash === 'string') {
        cursor.session = hash(`gemini:${row.sessionId}`);
        if (Array.isArray(row.messages)) for (const message of row.messages) visit(message);
        return;
      }
      if (row.$set) {
        if (Array.isArray(row.$set.messages)) for (const message of row.$set.messages) visit(message);
        return;
      }
      if (row.type !== 'gemini') return;
      if (!cursor.session || !safeId(row.id)) { warn('unsupported-message-identity'); return; }
      const usage = normalizeUsage(row.tokens, 'gemini');
      if (!usage) warn((row.tokens?.tool ?? 0) ? 'unsupported-gemini-tool-token-accounting' : 'missing-or-unsupported-usage');
      emit('message', row, { identity: `message:${row.id}`, usage, model: safeModel(row.model), clientVersion: null, turnIdHash: hash(row.id) });
    } else if (client === 'claude' && row.type === 'assistant') {
      if (!safeId(row.sessionId) || !safeId(row.message?.id)) { warn('unsupported-message-identity'); return; }
      cursor.session = hash(`claude:${row.sessionId}`);
      const version = safeId(row.version) ? row.version : null;
      const supported = /^[12]\.\d+\.\d+(?:[-+].*)?$/.test(version ?? '');
      const usage = supported ? normalizeUsage(row.message.usage, 'claude') : null;
      if (!supported) warn('unsupported-client-version'); else if (!usage) warn('missing-or-unsupported-usage');
      emit('message', row, { identity: `message:${row.message.id}`, usage, model: safeModel(row.message.model), clientVersion: version, turnIdHash: row.uuid ? hash(row.uuid) : null });
    }
  };
  let row;
  try { row = JSON.parse(line); } catch { warn('malformed-jsonl'); }
  if (row !== undefined) visit(row);
  return { context: cursor, events };
}
module.exports = { parseUsageLine, supportsUsageFilename, adapters, clients, normalizeUsage, hash, token, safeId, safeModel, plain };
