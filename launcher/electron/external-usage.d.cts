export type ExternalUsageClient = 'codex' | 'claude';
export type ExternalUsageScope = 'external-only' | 'may-overlap-nekodex' | 'unknown';
export interface ExternalUsageSelection { client: ExternalUsageClient; accountPseudonym: string; scope: ExternalUsageScope; consent: true }
export interface ExternalUsageTokens { inputTokens: number; outputTokens: number; cachedInputTokens: number | null; cacheWriteTokens: number | null }
export interface ExternalUsagePrice { model: string; priceModel: string; inputPerMillion: number | null; cachedInputPerMillion: number | null; cacheWritePerMillion: number | null; outputPerMillion: number | null }
export interface ExternalUsageCatalog { version: string; effectiveDate: string; currency: 'USD'; models: ExternalUsagePrice[] }
export interface ExternalUsageEstimate { kind: 'estimated-api-equivalent'; amount: number | null; currency: 'USD'; catalogVersion: string | null; effectiveDate: string | null; knownTokens: number; pricedTokens: number; unpricedTokens: number; unknownRecords: number; complete: boolean }
export interface ExternalUsageSource { id: string; client: ExternalUsageClient; accountPseudonym: string; scope: ExternalUsageScope; enabled: boolean; directoryName: string; adapter: string; clientVersions: string[]; records: number; reportedRecords: number; unknownRecords: number; inputTokens: number; outputTokens: number; models: string[]; lastImport: string | null; warnings: string[]; estimate: ExternalUsageEstimate }
export interface ExternalUsageSnapshot { schemaVersion: 1; sources: ExternalUsageSource[]; catalog: ExternalUsageCatalog | null; limits: Record<string, number>; aggregate: ExternalUsageEstimate & { scope: 'user-declared-external-only'; excludedSources: number }; coverage: string }
export type ExternalUsageRequest = { action: 'status' } | { action: 'import' | 'forget-source'; sourceId: string } | { action: 'set-enabled'; sourceId: string; enabled: boolean } | { action: 'set-scope'; sourceId: string; scope: ExternalUsageScope } | { action: 'set-catalog'; catalog: ExternalUsageCatalog | null };
export interface ExternalUsageService { snapshot(): ExternalUsageSnapshot; request(body: ExternalUsageRequest): Promise<ExternalUsageSnapshot>; selectRoot(selection: ExternalUsageSelection): Promise<ExternalUsageSnapshot> }
export function createExternalUsageService(options: { statePath?: string | null; pickDirectory: () => Promise<string | null> }): ExternalUsageService;
export function estimateRecords(records: Array<{ model: string | null; usage: ExternalUsageTokens | null }>, catalog: ExternalUsageCatalog | null): ExternalUsageEstimate;
export function validateCatalog(value: unknown): ExternalUsageCatalog | null;
export function validateSelection(value: unknown): ExternalUsageSelection;
export function normalizeUsage(raw: unknown, client: ExternalUsageClient): ExternalUsageTokens | null;
export const LIMITS: Readonly<Record<string, number>>;
