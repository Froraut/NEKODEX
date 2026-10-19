export type UsagePricingProvider = 'openai' | 'anthropic' | 'google';
export interface UsagePricingSource { id: string; provider: UsagePricingProvider; url: string }
export interface UsagePricingProvenance {
  kind: 'official-provider-snapshot' | 'user-import';
  dateBasis: 'observed-on';
  retrievedAt: string;
  pricingScenario: string;
  sources: UsagePricingSource[];
}
export interface UsagePricingPrice {
  model: string;
  priceModel: string;
  sourceId?: string;
  inputPerMillion: number | null;
  cachedInputPerMillion: number | null;
  cacheWritePerMillion: number | null;
  outputPerMillion: number | null;
}
export interface UsagePricingCatalog { version: string; effectiveDate: string; currency: 'USD'; models: UsagePricingPrice[]; provenance?: UsagePricingProvenance }
export interface UsagePricingTokens { inputTokens: number; outputTokens: number; cachedInputTokens: number | null; cacheWriteTokens: number | null }
export interface UsagePricingEstimate {
  kind: 'estimated-api-equivalent'; amount: number | null; currency: 'USD'; catalogVersion: string | null; effectiveDate: string | null;
  knownTokens: number; pricedTokens: number; unpricedTokens: number; unknownRecords: number; complete: boolean;
  sourceStatus: UsagePricingProvenance['kind'] | 'legacy-unverified' | 'none';
  pricingScenario: string | null; pricingSources: UsagePricingSource[]; unmappedModels: string[];
}
export interface UsagePricingReview {
  catalog: UsagePricingCatalog; digest: string; sourceStatus: UsagePricingEstimate['sourceStatus'];
  mappedModels: string[]; unmappedModels: string[]; warnings: string[];
}
export function validateUsagePricingCatalog(value: unknown): UsagePricingCatalog | null;
export function reviewUsagePricingCatalog(value: unknown, recordedModels?: string[]): UsagePricingReview;
export function listUsagePricingCatalogs(): UsagePricingCatalog[];
export function estimateUsageRecords(records: Array<{model: string | null; usage: UsagePricingTokens | null}>, catalog: UsagePricingCatalog | null): UsagePricingEstimate;
