import { describe, expect, test } from 'bun:test';
import { estimateUsageRecords, listUsagePricingCatalogs, reviewUsagePricingCatalog, validateUsagePricingCatalog } from '../launcher/electron/usage-pricing.cjs';

describe('selected pricing source', () => {
  test('dated official scenario values exact recorded tokens and preserves unmapped/unknown amounts', () => {
    const catalog = listUsagePricingCatalogs()[0]!;
    const usage = { inputTokens: 1_000_000, cachedInputTokens: 200_000, cacheWriteTokens: 100_000, outputTokens: 100_000 };
    const result = estimateUsageRecords([{ model: 'gpt-6.1-sol', usage }], catalog);
    expect(result.amount).toBeCloseTo(2.67, 10); // .7*2 + .2*.1 + .1*2.5 + .1*10
    expect(result.pricedTokens).toBe(1_100_000);
    expect(result.complete).toBe(true);
    expect(result.sourceStatus).toBe('official-provider-snapshot');
    expect(result.pricingSources[0]?.url).toBe('https://developers.openai.com/api/docs/pricing');
    expect(result.kind).toBe('estimated-api-equivalent');
    const unmapped = estimateUsageRecords([{ model: 'chatgpt-web/gpt-6.1-sol', usage }], catalog);
    expect(unmapped.amount).toBeNull();
    expect(unmapped.unpricedTokens).toBe(1_100_000);
    expect(unmapped.unmappedModels).toEqual(['chatgpt-web/gpt-6.1-sol']);
    expect(unmapped.complete).toBe(false);
    const unknownCache = estimateUsageRecords([{ model: 'gpt-6.1-sol', usage: { ...usage, cachedInputTokens: null } }], catalog);
    expect(unknownCache.amount).toBe(1);
    expect(unknownCache.unpricedTokens).toBe(1_000_000);
    expect(unknownCache.complete).toBe(false);
    expect(estimateUsageRecords([{ model: 'gpt-6.1-sol', usage }], null).amount).toBeNull();
  });
  test('import review binds explicit values and refuses forged official provenance', () => {
    const original = listUsagePricingCatalogs()[0]!;
    const tampered = structuredClone(original);
    tampered.models[0]!.inputPerMillion = 0;
    expect(() => validateUsagePricingCatalog(tampered)).toThrow('user-import');
    tampered.provenance!.kind = 'user-import';
    const review = reviewUsagePricingCatalog(tampered, ['gpt-6-astra', 'unmapped-model']);
    expect(review.catalog.models[0]!.inputPerMillion).toBe(0);
    expect(review.sourceStatus).toBe('user-import');
    expect(review.mappedModels).toEqual(['gpt-6-astra']);
    expect(review.unmappedModels).toEqual(['unmapped-model']);
    expect(review.digest).toHaveLength(64);
    expect(review.digest).not.toBe(reviewUsagePricingCatalog(original).digest);
    const badHost = structuredClone(tampered);
    badHost.provenance!.sources[0]!.url = 'https://developers.openai.com.evil.example/pricing';
    expect(() => validateUsagePricingCatalog(badHost)).toThrow('official provider');
    const badDate = structuredClone(tampered); badDate.effectiveDate = '2026-02-30';
    expect(() => validateUsagePricingCatalog(badDate)).toThrow('calendar date');
    const legacy = { version: 'legacy', effectiveDate: '2026-10-18', currency: 'USD' as const, models: [] };
    expect(reviewUsagePricingCatalog(legacy).sourceStatus).toBe('legacy-unverified');
  });
  test('unknown cache lifetime and malformed token categories cannot become zero-price proof', () => {
    const catalog = listUsagePricingCatalogs()[1]!;
    const usage = { inputTokens: 1_000_000, cachedInputTokens: 200_000, cacheWriteTokens: 100_000, outputTokens: 100_000 };
    const estimate = estimateUsageRecords([{ model: 'claude-opus-5-5', usage }], catalog);
    expect(estimate.amount).toBeCloseTo(4.84, 10);
    expect(estimate.unpricedTokens).toBe(100_000);
    expect(estimate.complete).toBe(false);
    const invalid = estimateUsageRecords([{ model: 'claude-opus-5-5', usage: { ...usage, cachedInputTokens: 2_000_000 } }], catalog);
    expect(invalid.amount).toBeNull();
    expect(invalid.unknownRecords).toBe(1);
    const zero = structuredClone(catalog); zero.provenance!.kind = 'user-import';
    for (const row of zero.models) for (const key of ['inputPerMillion', 'cachedInputPerMillion', 'cacheWritePerMillion', 'outputPerMillion'] as const) row[key] = 0;
    const freeScenario = estimateUsageRecords([{ model: 'claude-opus-5-5', usage }], zero);
    expect(freeScenario.amount).toBe(0);
    expect(freeScenario.complete).toBe(true);
    expect(freeScenario.sourceStatus).toBe('user-import');
  });
});
