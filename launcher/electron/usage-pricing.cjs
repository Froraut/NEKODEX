'use strict';
// Passive catalog validation/valuation only. No account, network, billing or log access.
const { createHash } = require('node:crypto');
const snapshots = require('./usage-pricing-snapshots.json');
const RATE_KEYS = ['inputPerMillion', 'cachedInputPerMillion', 'cacheWritePerMillion', 'outputPerMillion'];
const modelId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}$/.test(value) && !value.includes('://');
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const token = value => Number.isSafeInteger(value) && value >= 0 && value <= 1e12;
function fail(message) { throw new Error(message); }
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('Invalid pricing catalog fields');
}
function realDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function officialUrl(provider, value) {
  if (typeof value !== 'string' || value.length > 512) return false;
  let url; try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port) return false;
  const hosts = { openai: ['developers.openai.com', 'platform.openai.com', 'openai.com'],
    anthropic: ['platform.claude.com', 'docs.anthropic.com', 'anthropic.com', 'www.anthropic.com', 'claude.com'],
    google: ['ai.google.dev', 'cloud.google.com'] };
  return hosts[provider]?.includes(url.hostname) === true;
}
function normalizeCatalog(value) {
  fields(value, ['version', 'effectiveDate', 'currency', 'models', 'provenance']);
  if (!safeId(value.version) || !realDate(value.effectiveDate) || value.currency !== 'USD'
      || !Array.isArray(value.models) || value.models.length > 80) fail('Choose a real calendar date and a bounded USD catalog');
  let provenance;
  if (value.provenance !== undefined) {
    const p = value.provenance;
    fields(p, ['kind', 'dateBasis', 'retrievedAt', 'pricingScenario', 'sources']);
    if (!['official-provider-snapshot', 'user-import'].includes(p.kind) || p.dateBasis !== 'observed-on'
        || typeof p.retrievedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(p.retrievedAt)
        || !Number.isFinite(Date.parse(p.retrievedAt)) || p.retrievedAt.slice(0, 10) !== value.effectiveDate
        || typeof p.pricingScenario !== 'string' || p.pricingScenario.trim().length < 10 || p.pricingScenario.length > 1200
        || /[\x00-\x1f\x7f]/.test(p.pricingScenario) || !Array.isArray(p.sources) || !p.sources.length || p.sources.length > 8) fail('Catalog provenance requires an observation date, scenario and official provider sources');
    const sources = p.sources.map(source => {
      fields(source, ['id', 'provider', 'url']);
      if (!safeId(source.id) || !officialUrl(source.provider, source.url)) fail('Use an official provider HTTPS source without credentials or query parameters');
      return { id: source.id, provider: source.provider, url: source.url };
    });
    if (new Set(sources.map(source => source.id)).size !== sources.length) fail('Pricing source IDs must be unique');
    provenance = { kind: p.kind, dateBasis: p.dateBasis, retrievedAt: new Date(p.retrievedAt).toISOString(), pricingScenario: p.pricingScenario.trim(), sources };
  }
  const models = value.models.map(row => {
    fields(row, ['model', 'priceModel', 'sourceId', ...RATE_KEYS]);
    if (!modelId(row.model) || !modelId(row.priceModel)) fail('Use exact recorded and priced model IDs; no inferred aliases');
    if (provenance && (!safeId(row.sourceId) || !provenance.sources.some(source => source.id === row.sourceId))) fail('Each mapped model must name its selected pricing source');
    if (!provenance && row.sourceId !== undefined) fail('A pricing source requires catalog provenance');
    const result = { model: row.model, priceModel: row.priceModel };
    if (provenance) result.sourceId = row.sourceId;
    for (const key of RATE_KEYS) {
      if (row[key] !== null && (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < 0 || row[key] > 1e6)) fail('Prices must be nonnegative USD per million tokens, or explicit null when unknown');
      result[key] = row[key];
    }
    return result;
  });
  if (new Set(models.map(row => row.model)).size !== models.length) fail('Each recorded model needs exactly one explicit price mapping');
  return { version: value.version, effectiveDate: value.effectiveDate, currency: 'USD', models, ...(provenance ? { provenance } : {}) };
}
const canonicalSnapshots = snapshots.map(normalizeCatalog);
function validateUsagePricingCatalog(value) {
  if (value === null) return null;
  const catalog = normalizeCatalog(value);
  // An imported URL is a citation, not proof of its prices. Only unchanged bundled
  // snapshots carry the official-snapshot badge; altered imports must say user-import.
  if (catalog.provenance?.kind === 'official-provider-snapshot'
      && !canonicalSnapshots.some(snapshot => JSON.stringify(snapshot) === JSON.stringify(catalog))) {
    fail('Changed or new values must use provenance.kind user-import; they are not a bundled official snapshot');
  }
  return catalog;
}
function listUsagePricingCatalogs() { return structuredClone(canonicalSnapshots); }
function reviewUsagePricingCatalog(value, recordedModels = []) {
  const catalog = validateUsagePricingCatalog(value);
  if (!catalog) fail('Choose a catalog to review');
  if (!Array.isArray(recordedModels) || recordedModels.length > 4096) fail('Invalid recorded model list');
  const recorded = [...new Set(recordedModels.filter(modelId))].sort();
  const mapped = new Set(catalog.models.map(row => row.model));
  return { catalog, digest: createHash('sha256').update(JSON.stringify(catalog)).digest('hex'),
    sourceStatus: catalog.provenance?.kind ?? 'legacy-unverified',
    mappedModels: recorded.filter(model => mapped.has(model)), unmappedModels: recorded.filter(model => !mapped.has(model)),
    warnings: ['Estimate of the selected API pricing scenario only; not an actual bill or proven savings.',
      ...(catalog.provenance ? [] : ['Legacy catalog has no verifiable source attribution.']),
      ...(catalog.provenance?.kind === 'user-import' ? ['Imported rates are user supplied; official URLs do not authenticate the numeric values.'] : [])] };
}
function estimateUsageRecords(records, selectedCatalog) {
  const catalog = validateUsagePricingCatalog(selectedCatalog);
  if (!Array.isArray(records) || records.length > 20000) fail('Invalid usage record collection');
  const mapping = new Map((catalog?.models ?? []).map(row => [row.model, row]));
  let amount = 0, knownTokens = 0, pricedTokens = 0, unpricedTokens = 0, unknownRecords = 0;
  const unmappedModels = new Set();
  const addCount = (total, count) => { const next = total + count; if (!Number.isSafeInteger(next)) fail('Usage totals exceed exact integer range'); return next; };
  const add = (count, rate) => {
    if (rate === null) unpricedTokens = addCount(unpricedTokens, count);
    else { amount += count * rate / 1e6; pricedTokens = addCount(pricedTokens, count); }
  };
  for (const record of records) {
    const usage = record?.usage;
    if (!usage || !token(usage.inputTokens) || !token(usage.outputTokens)
        || ![usage.cachedInputTokens, usage.cacheWriteTokens].every(count => count === null || token(count))
        || (usage.cachedInputTokens ?? 0) + (usage.cacheWriteTokens ?? 0) > usage.inputTokens) { unknownRecords++; continue; }
    const total = usage.inputTokens + usage.outputTokens;
    knownTokens = addCount(knownTokens, total);
    const price = mapping.get(record.model);
    if (!price) { unpricedTokens = addCount(unpricedTokens, total); unmappedModels.add(modelId(record.model) ? record.model : 'unknown'); continue; }
    add(usage.outputTokens, price.outputPerMillion);
    if (usage.cachedInputTokens === null || usage.cacheWriteTokens === null) unpricedTokens = addCount(unpricedTokens, usage.inputTokens);
    else {
      add(usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens, price.inputPerMillion);
      add(usage.cachedInputTokens, price.cachedInputPerMillion);
      add(usage.cacheWriteTokens, price.cacheWritePerMillion);
    }
  }
  return { kind: 'estimated-api-equivalent', amount: catalog && pricedTokens ? amount : null, currency: 'USD',
    catalogVersion: catalog?.version ?? null, effectiveDate: catalog?.effectiveDate ?? null,
    knownTokens, pricedTokens, unpricedTokens, unknownRecords,
    complete: Boolean(catalog && pricedTokens && !unpricedTokens && !unknownRecords && records.length),
    sourceStatus: catalog?.provenance?.kind ?? (catalog ? 'legacy-unverified' : 'none'),
    pricingScenario: catalog?.provenance?.pricingScenario ?? null,
    pricingSources: catalog?.provenance?.sources ?? [], unmappedModels: [...unmappedModels].sort() };
}
module.exports = { validateUsagePricingCatalog, reviewUsagePricingCatalog, listUsagePricingCatalogs, estimateUsageRecords };
