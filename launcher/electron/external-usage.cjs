'use strict';
// Explicit picker grants only. Never discover homes, credentials, or configurations.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const LIMITS = Object.freeze({ sources: 12, files: 512, entries: 4096, depth: 8, batchBytes: 8 * 1024 * 1024,
  lineBytes: 256 * 1024, records: 20000, stateBytes: 24 * 1024 * 1024 });
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const token = value => Number.isSafeInteger(value) && value >= 0 && value <= 1e12;
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const safeModel = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}$/.test(value) && !value.includes('://') ? value : null;
const scopes = ['external-only', 'may-overlap-nekodex', 'unknown'];
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const digestId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function fail(message) { throw new Error(message); }
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('Invalid external usage request');
  return value;
}
function validateSelection(value) {
  fields(value, ['client', 'accountPseudonym', 'scope', 'consent']);
  if (!['codex', 'claude'].includes(value.client) || !scopes.includes(value.scope) || value.consent !== true
    || typeof value.accountPseudonym !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(value.accountPseudonym)) {
    fail('Choose a client, a local account pseudonym, a scope and metadata consent');
  }
  return value;
}
function validateCatalog(value) {
  if (value === null) return null;
  fields(value, ['version', 'effectiveDate', 'currency', 'models']);
  if (!safeId(value.version) || !/^\d{4}-\d{2}-\d{2}$/.test(value.effectiveDate) || !Number.isFinite(Date.parse(value.effectiveDate))
      || value.currency !== 'USD' || !Array.isArray(value.models) || value.models.length > 80) fail('Invalid dated USD price catalog');
  const models = value.models.map(row => {
    fields(row, ['model', 'priceModel', 'inputPerMillion', 'cachedInputPerMillion', 'cacheWritePerMillion', 'outputPerMillion']);
    if (!safeModel(row.model) || !safeModel(row.priceModel)) fail('Use exact model IDs in the price catalog');
    const result = { model: row.model, priceModel: row.priceModel };
    for (const key of ['inputPerMillion', 'cachedInputPerMillion', 'cacheWritePerMillion', 'outputPerMillion']) {
      if (row[key] !== null && (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < 0 || row[key] > 1e6)) fail('Prices must be nonnegative USD per million tokens, or null when unknown');
      result[key] = row[key];
    }
    return result;
  });
  if (new Set(models.map(row => row.model)).size !== models.length) fail('Each recorded model needs exactly one explicit price mapping');
  return { version: value.version, effectiveDate: value.effectiveDate, currency: 'USD', models };
}
function normalizeUsage(raw, client) {
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
function estimateRecords(records, catalog) {
  let amount = 0, unpricedTokens = 0, knownTokens = 0, unknownRecords = 0, pricedTokens = 0;
  const mapping = new Map((catalog?.models ?? []).map(row => [row.model, row]));
  for (const record of records) {
    const usage = record.usage;
    if (!usage) { unknownRecords++; continue; }
    const total = usage.inputTokens + usage.outputTokens; knownTokens += total;
    const price = mapping.get(record.model);
    if (!price) { unpricedTokens += total; continue; }
    const add = (count, rate) => { if (rate === null) unpricedTokens += count; else { amount += count * rate / 1e6; pricedTokens += count; } };
    add(usage.outputTokens, price.outputPerMillion);
    if (usage.cachedInputTokens === null || usage.cacheWriteTokens === null) unpricedTokens += usage.inputTokens;
    else {
      add(usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens, price.inputPerMillion);
      add(usage.cachedInputTokens, price.cachedInputPerMillion); add(usage.cacheWriteTokens, price.cacheWritePerMillion);
    }
  }
  return { kind: 'estimated-api-equivalent', amount: catalog && pricedTokens ? amount : null, currency: 'USD',
    catalogVersion: catalog?.version ?? null, effectiveDate: catalog?.effectiveDate ?? null,
    knownTokens, pricedTokens, unpricedTokens, unknownRecords,
    complete: Boolean(catalog && !unpricedTokens && !unknownRecords && records.length) };
}
function ancestry(directory) {
  const nodes = [];
  for (let current = directory; ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Selected root ancestry must be real directories');
    nodes.push({ path: current, dev: String(stat.dev), ino: String(stat.ino) });
    if (path.dirname(current) === current) return nodes;
  }
}
function assertRoot(source) {
  for (const node of source.ancestry) {
    const stat = fs.lstatSync(node.path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || String(stat.dev) !== node.dev || String(stat.ino) !== node.ino) fail('Selected root changed; choose it again');
  }
}
function createExternalUsageService({ statePath = null, pickDirectory } = {}) {
  if (typeof pickDirectory !== 'function') fail('A main-owned native directory picker is required');
  if (statePath !== null && (!path.isAbsolute(statePath) || typeof statePath !== 'string')) fail('Private state path must be absolute');
  let state = { version: 1, sources: [], cursors: {}, sessions: {}, records: {}, knownTurns: {}, catalog: null };
  let busy = false;
  if (statePath && fs.existsSync(statePath)) {
    const stat = fs.lstatSync(statePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.stateBytes
      || (process.getuid && stat.uid !== process.getuid()) || (process.platform !== 'win32' && (stat.mode & 0o077))) fail('External usage state must be a bounded private regular file');
    const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (saved.version !== 1 || !Array.isArray(saved.sources) || saved.sources.length > LIMITS.sources
      || !plain(saved.cursors) || !plain(saved.sessions) || !plain(saved.records) || (saved.knownTurns !== undefined && !plain(saved.knownTurns)) || Object.keys(saved.records).length > LIMITS.records) fail('Unsupported external usage state; preserve for recovery');
    for (const source of saved.sources) {
      validateSelection({ client: source.client, accountPseudonym: source.accountPseudonym, scope: source.scope, consent: true });
      if (!safeId(source.id) || !path.isAbsolute(source.path) || !Array.isArray(source.ancestry)
        || source.ancestry[0]?.path !== source.path || !source.ancestry.every(node => path.isAbsolute(node.path) && /^\d+$/.test(node.ino) && /^\d+$/.test(node.dev))) fail('Invalid saved picker grant');
    }
    const sourceIds = new Set(saved.sources.map(source => source.id));
    for (const [key, row] of Object.entries(saved.records)) {
      if (!digestId(key) || !plain(row) || row.eventId !== key || !sourceIds.has(row.sourceId)
        || !['codex', 'claude'].includes(row.client) || !digestId(row.sessionId)
        || (row.turnId !== null && !digestId(row.turnId)) || (row.model !== null && !safeModel(row.model))
        || (row.clientVersion !== null && !safeId(row.clientVersion))
        || (row.usage !== null && (!plain(row.usage) || !token(row.usage.inputTokens) || !token(row.usage.outputTokens)
          || ![row.usage.cachedInputTokens, row.usage.cacheWriteTokens].every(n => n === null || token(n))
          || (row.usage.cachedInputTokens ?? 0) + (row.usage.cacheWriteTokens ?? 0) > row.usage.inputTokens))) fail('Invalid saved external usage record; preserve for recovery');
    }
    for (const [key, cursor] of Object.entries(saved.cursors)) {
      if (!digestId(key) || !plain(cursor) || !sourceIds.has(cursor.sourceId) || !token(cursor.offset)
        || typeof cursor.identity !== 'string' || !/^\d+:\d+$/.test(cursor.identity)
        || (cursor.prefix !== null && !digestId(cursor.prefix)) || (cursor.session !== null && !digestId(cursor.session))
        || (cursor.model !== null && !safeModel(cursor.model)) || (cursor.turn !== null && !safeId(cursor.turn))
        || (cursor.clientVersion !== null && !safeId(cursor.clientVersion)) || typeof cursor.supported !== 'boolean' || typeof cursor.skipping !== 'boolean') fail('Invalid saved external usage cursor; preserve for recovery');
    }
    for (const [key, usage] of Object.entries(saved.sessions)) {
      if (!digestId(key) || !plain(usage) || !token(usage.inputTokens) || !token(usage.outputTokens)
        || ![usage.cachedInputTokens, usage.cacheWriteTokens].every(n => n === null || token(n))) fail('Invalid saved cumulative usage; preserve for recovery');
    }
    if (!Object.entries(saved.knownTurns ?? {}).every(([key, id]) => digestId(key) && sourceIds.has(id))) fail('Invalid saved turn index');
    saved.catalog = validateCatalog(saved.catalog); saved.knownTurns ??= {}; state = saved;
  }
  function commit(next) {
    const serialized = JSON.stringify(next);
    if (Buffer.byteLength(serialized) > LIMITS.stateBytes) fail('Metadata storage limit reached; saved records preserved');
    if (statePath) {
      if (fs.existsSync(statePath) && fs.lstatSync(statePath).isSymbolicLink()) fail('Unsafe external usage state path');
      writePrivateFileAtomic(statePath, serialized, { durable: true, protectDirectory: false });
    }
    state = next;
  }
  const rowsFor = id => Object.values(state.records).filter(row => row.sourceId === id);
  function snapshot() {
    const sources = state.sources.map(source => {
      const rows = rowsFor(source.id), reported = rows.filter(row => row.usage);
      return { id: source.id, client: source.client, accountPseudonym: source.accountPseudonym, scope: source.scope,
        enabled: source.enabled, directoryName: path.basename(source.path), adapter: source.client === 'codex' ? 'codex-rollout-v1' : 'claude-transcript-v1',
        clientVersions: [...new Set(rows.map(row => row.clientVersion).filter(Boolean))],
        records: rows.length, reportedRecords: reported.length, unknownRecords: rows.length - reported.length,
        inputTokens: reported.reduce((n, row) => n + row.usage.inputTokens, 0), outputTokens: reported.reduce((n, row) => n + row.usage.outputTokens, 0),
        models: [...new Set(rows.map(row => row.model ?? 'unknown'))], lastImport: source.lastImport ?? null,
        warnings: source.warnings ?? [], estimate: estimateRecords(rows, state.catalog) };
    });
    // Keep imported records separate from NEKODEX native/web receipts. An unknown
    // overlap cannot be joined safely by timestamp/model/token coincidence.
    const eligible = Object.values(state.records).filter(row => state.sources.find(source => source.id === row.sourceId)?.scope === 'external-only');
    return { schemaVersion: 1, sources, catalog: state.catalog, limits: LIMITS,
      aggregate: { scope: 'user-declared-external-only', excludedSources: sources.filter(source => source.scope !== 'external-only').length,
        ...estimateRecords(eligible, state.catalog) },
      coverage: 'Selected JSONL roots only; token coverage, account identity and source scope are not provider verified. No NEKODEX receipt is added to these totals.' };
  }
  async function exclusive(work) {
    if (busy) fail('An external usage operation is already running'); busy = true;
    try { return await work(); } finally { busy = false; }
  }
  async function selectRoot(selection) {
    validateSelection(selection);
    return exclusive(async () => {
      const selected = await pickDirectory();
      if (!selected) return snapshot();
      if (typeof selected !== 'string' || !path.isAbsolute(selected)) fail('Native picker did not return an absolute directory');
      const real = fs.realpathSync(selected), nodes = ancestry(real);
      if (state.sources.some(source => source.path === real)) fail('This directory is already registered; edit its scope instead');
      if (state.sources.length >= LIMITS.sources) fail('Source limit reached');
      const next = structuredClone(state);
      next.sources.push({ id: randomUUID(), path: real, ancestry: nodes, client: selection.client,
        accountPseudonym: selection.accountPseudonym, scope: selection.scope, enabled: true, warnings: [], lastImport: null });
      commit(next); return snapshot();
    });
  }
  function inventory(source, warnings) {
    assertRoot(source);
    const files = [], queue = [{ relative: '', depth: 0 }]; let entries = 0;
    while (queue.length && entries < LIMITS.entries && files.length < LIMITS.files) {
      const directory = queue.shift();
      let handle;
      try {
        handle = fs.opendirSync(path.join(source.path, directory.relative));
        let entry;
        while ((entry = handle.readSync())) {
          if (++entries > LIMITS.entries) { warnings.add('directory-entry-limit: choose a narrower log root'); break; }
          if (entry.isSymbolicLink()) { warnings.add('symlinks-excluded'); continue; }
          const relative = path.join(directory.relative, entry.name);
          if (entry.isDirectory()) {
            if (directory.depth < LIMITS.depth) queue.push({ relative, depth: directory.depth + 1 });
            else warnings.add('depth-limit: choose a narrower log root');
          } else if (entry.isFile() && entry.name.endsWith('.jsonl') && (source.client !== 'codex' || /^rollout-.*\.jsonl$/.test(entry.name))) {
            files.push(relative); if (files.length >= LIMITS.files) { warnings.add('file-limit: choose a narrower log root'); break; }
          }
        }
      } catch { warnings.add('unreadable-directory'); } finally { handle?.closeSync(); }
    }
    if (queue.length) warnings.add('inventory-incomplete: choose a narrower log root');
    return files.sort();
  }
  function parseLine(next, source, cursor, line, warnings, recordBudget) {
    let row; try { row = JSON.parse(line); } catch { warnings.add('malformed-jsonl'); return; }
    if (!row || typeof row !== 'object') { warnings.add('unsupported-record'); return; }
    const put = (identity, usage, model, clientVersion, turnId) => {
      const eventId = hash(`${source.client}:${cursor.session}:${identity}`);
      const old = next.records[eventId];
      if (!old) {
        if (recordBudget.count >= LIMITS.records) recordBudget.count = Object.keys(next.records).length;
        if (recordBudget.count >= LIMITS.records) fail('Metadata record limit reached; saved records and resume offsets preserved');
        recordBudget.count++;
      }
      if (old && old.sourceId !== source.id) { warnings.add('duplicate-session-in-another-source: original attribution retained'); return; }
      if (old?.usage && !usage) return;
      if (old?.usage && usage && (usage.inputTokens < old.usage.inputTokens || usage.outputTokens < old.usage.outputTokens)) { warnings.add('conflicting-usage-snapshot'); return; }
      next.records[eventId] = { eventId, sourceId: source.id, client: source.client,
        sessionId: cursor.session, turnId: turnId ? hash(turnId) : null,
        model: safeModel(model), clientVersion, usage, timestamp: typeof row.timestamp === 'string' && /^\d{4}-\d\d-\d\dT/.test(row.timestamp) && Number.isFinite(Date.parse(row.timestamp)) ? new Date(row.timestamp).toISOString() : null };
    };
    if (source.client === 'codex') {
      const p = row.payload;
      if (row.type === 'session_meta') {
        if (!safeId(p?.id)) { warnings.add('unsupported-session-identity'); return; }
        cursor.session = hash(`codex:${p.id}`); cursor.clientVersion = safeId(p.cli_version) ? p.cli_version : null;
        cursor.supported = /^0\.\d+\.\d+(?:[-+].*)?$/.test(cursor.clientVersion ?? '');
        if (!next.sessions[cursor.session]) put('session-without-usage', null, null, cursor.clientVersion, null);
        if (!cursor.supported) warnings.add('unsupported-client-version');
      } else if (row.type === 'turn_context') {
        cursor.model = safeModel(p?.model); cursor.turn = safeId(p?.turn_id) ? p.turn_id : safeId(p?.id) ? p.id : null;
        if (cursor.session && cursor.turn) {
          delete next.records[hash(`${source.client}:${cursor.session}:session-without-usage`)];
          if (!next.knownTurns[hash(`${cursor.session}:${cursor.turn}`)]) put(`turn:${cursor.turn}`, null, cursor.model, cursor.clientVersion, cursor.turn);
        }
      } else if (row.type === 'event_msg' && p?.type === 'token_count') {
        if (!cursor.session) { warnings.add('missing-session-identity'); return; }
        const raw = p.info?.total_token_usage;
        const usage = cursor.supported ? normalizeUsage(raw, 'codex') : null;
        if (!usage) { warnings.add(cursor.supported ? 'missing-or-unsupported-usage' : 'unsupported-client-version'); return; }
        const session = next.sessions[cursor.session];
        if (session && (usage.inputTokens < session.inputTokens || usage.outputTokens < session.outputTokens)) { warnings.add('older-or-reset-cumulative-counter'); return; }
        if (session && usage.inputTokens === session.inputTokens && usage.outputTokens === session.outputTokens) {
          delete next.records[hash(`${source.client}:${cursor.session}:session-without-usage`)];
          if (cursor.turn && next.knownTurns[hash(`${cursor.session}:${cursor.turn}`)]) delete next.records[hash(`${source.client}:${cursor.session}:turn:${cursor.turn}`)];
          return;
        }
        const delta = { inputTokens: usage.inputTokens - (session?.inputTokens ?? 0), outputTokens: usage.outputTokens - (session?.outputTokens ?? 0),
          cachedInputTokens: usage.cachedInputTokens === null || (session && session.cachedInputTokens === null) ? null : usage.cachedInputTokens - (session?.cachedInputTokens ?? 0),
          cacheWriteTokens: usage.cacheWriteTokens === null || (session && session.cacheWriteTokens === null) ? null : usage.cacheWriteTokens - (session?.cacheWriteTokens ?? 0) };
        if ((delta.cachedInputTokens ?? 0) < 0 || (delta.cacheWriteTokens ?? 0) < 0 || (delta.cachedInputTokens ?? 0) + (delta.cacheWriteTokens ?? 0) > delta.inputTokens) { warnings.add('unsupported-cumulative-cache-counter'); return; }
        const key = `cumulative:${usage.inputTokens}:${usage.outputTokens}`;
        put(key, delta, cursor.model, cursor.clientVersion, cursor.turn);
        delete next.records[hash(`${source.client}:${cursor.session}:session-without-usage`)];
        if (cursor.turn) {
          delete next.records[hash(`${source.client}:${cursor.session}:turn:${cursor.turn}`)];
          next.knownTurns[hash(`${cursor.session}:${cursor.turn}`)] = source.id;
        }
        next.sessions[cursor.session] = usage;
      }
    } else if (row.type === 'assistant') {
      if (!safeId(row.sessionId) || !safeId(row.message?.id)) { warnings.add('unsupported-message-identity'); return; }
      cursor.session = hash(`claude:${row.sessionId}`);
      const version = safeId(row.version) ? row.version : null;
      const supported = /^[12]\.\d+\.\d+(?:[-+].*)?$/.test(version ?? '');
      const usage = supported ? normalizeUsage(row.message.usage, 'claude') : null;
      if (!supported) warnings.add('unsupported-client-version'); else if (!usage) warnings.add('missing-or-unsupported-usage');
      put(`message:${row.message.id}`, usage, row.message.model, version, row.uuid);
    }
  }
  async function importSource(id) {
    return exclusive(async () => {
      const next = structuredClone(state), source = next.sources.find(item => item.id === id);
      if (!source || !source.enabled) fail('Enable an explicitly selected source before importing');
      const warnings = new Set(), files = inventory(source, warnings);
      if (!files.length) warnings.add('no-supported-jsonl-files: usage unknown');
      let budget = LIMITS.batchBytes;
      const recordBudget = { count: Object.keys(next.records).length };
      const after = source.afterFile ?? '';
      const ordered = [...files.filter(file => file > after), ...files.filter(file => file <= after)];
      for (const relative of ordered) {
        if (budget <= 0) { warnings.add('batch-limit: import again to continue'); break; }
        assertRoot(source);
        const absolute = path.join(source.path, relative);
        let fd;
        try {
          // Recheck every descendant immediately before O_NOFOLLOW open. No link
          // traversal or renderer-supplied file path crosses the picker grant.
          let current = source.path;
          for (const part of relative.split(path.sep)) { current = path.join(current, part); if (fs.lstatSync(current).isSymbolicLink()) fail('Link excluded'); }
          fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
          const stat = fs.fstatSync(fd);
          if (!stat.isFile() || fs.realpathSync(absolute) !== absolute) fail('Not a selected-root regular file');
          const cursorKey = hash(`${source.id}:${relative}`), identity = `${stat.dev}:${stat.ino}`;
          let cursor = next.cursors[cursorKey];
          if (!cursor || cursor.identity !== identity || stat.size < cursor.offset) {
            if (cursor) warnings.add('rotation-or-truncation: reread with stable dedup');
            cursor = { sourceId: source.id, identity, offset: 0, prefix: null, session: null, model: null, turn: null, clientVersion: null, supported: false, skipping: false };
          }
          // A same-inode truncate/rewrite can regain the previous size before the
          // next import. A bounded prefix fingerprint catches that replacement.
          const prefixLength = Math.min(128, cursor.offset);
          if (prefixLength && cursor.prefix) {
            const prefix = Buffer.alloc(prefixLength); fs.readSync(fd, prefix, 0, prefixLength, 0);
            if (hash(prefix) !== cursor.prefix) { warnings.add('rewritten-file: reread with stable dedup'); cursor = { ...cursor, offset: 0, session: null, model: null, turn: null, supported: false, skipping: false }; }
          }
          let pending = Buffer.alloc(0), position = cursor.offset;
          while (position < stat.size && budget > 0) {
            const buffer = Buffer.alloc(Math.min(64 * 1024, stat.size - position, budget));
            const read = fs.readSync(fd, buffer, 0, buffer.length, position); if (!read) break;
            position += read; budget -= read; pending = Buffer.concat([pending, buffer.subarray(0, read)]);
            let newline;
            while ((newline = pending.indexOf(10)) >= 0) {
              const line = pending.subarray(0, newline); cursor.offset = position - pending.length + newline + 1;
              if (!cursor.skipping && line.length <= LIMITS.lineBytes) parseLine(next, source, cursor, line.toString('utf8'), warnings, recordBudget);
              else warnings.add('oversized-jsonl-line-excluded');
              cursor.skipping = false; pending = pending.subarray(newline + 1);
            }
            if (pending.length > LIMITS.lineBytes || cursor.skipping) { cursor.offset = position; cursor.skipping = true; pending = Buffer.alloc(0); warnings.add('oversized-jsonl-line-excluded'); }
          }
          if (pending.length) warnings.add('partial-line: waiting for complete append');
          const prefix = Buffer.alloc(Math.min(128, cursor.offset)); fs.readSync(fd, prefix, 0, prefix.length, 0); cursor.prefix = hash(prefix);
          next.cursors[cursorKey] = cursor; source.afterFile = relative;
          if (position < stat.size) warnings.add('batch-limit: import again to continue');
        } catch (reason) {
          if (reason.message?.startsWith('Metadata record limit')) throw reason;
          warnings.add('unreadable-or-out-of-scope-file');
        } finally { if (fd !== undefined) fs.closeSync(fd); }
      }
      if (!Object.values(next.records).some(row => row.sourceId === source.id)) warnings.add('no-recorded-usage: usage unknown');
      source.lastImport = new Date().toISOString(); source.warnings = [...warnings]; commit(next); return snapshot();
    });
  }
  async function request(body) {
    fields(body, ['action', 'sourceId', 'enabled', 'scope', 'catalog']);
    if (body.action === 'status') return snapshot();
    if (body.action === 'import') { if (!safeId(body.sourceId)) fail('Invalid source'); return importSource(body.sourceId); }
    return exclusive(async () => {
      const next = structuredClone(state);
      if (body.action === 'set-catalog') next.catalog = validateCatalog(body.catalog);
      else {
        const source = next.sources.find(item => item.id === body.sourceId); if (!source) fail('Unknown external usage source');
        if (body.action === 'set-enabled' && typeof body.enabled === 'boolean') source.enabled = body.enabled;
        else if (body.action === 'set-scope' && scopes.includes(body.scope)) source.scope = body.scope;
        else if (body.action === 'forget-source') {
          next.sources = next.sources.filter(item => item.id !== source.id);
          for (const [key, cursor] of Object.entries(next.cursors)) if (cursor.sourceId === source.id) delete next.cursors[key];
          const removedSessions = new Set(Object.values(next.records).filter(row => row.sourceId === source.id).map(row => row.sessionId));
          for (const [key, row] of Object.entries(next.records)) if (row.sourceId === source.id) delete next.records[key];
          for (const session of removedSessions) if (!Object.values(next.records).some(row => row.sessionId === session)) delete next.sessions[session];
          for (const [key, owner] of Object.entries(next.knownTurns)) if (owner === source.id) delete next.knownTurns[key];
        } else fail('Unsupported external usage action');
      }
      commit(next); return snapshot();
    });
  }
  return { snapshot, request, selectRoot };
}
module.exports = { createExternalUsageService, estimateRecords, validateCatalog, validateSelection, normalizeUsage, LIMITS };
