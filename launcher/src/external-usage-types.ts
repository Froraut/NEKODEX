import type { ExternalUsageRequest, ExternalUsageSelection, ExternalUsageSnapshot } from '../electron/external-usage.cjs';
export type { ExternalUsageClient, ExternalUsageScope, ExternalUsageSelection, ExternalUsageRequest, ExternalUsageCatalog, ExternalUsageSource, ExternalUsageSnapshot, ExternalUsageEstimate } from '../electron/external-usage.cjs';
export interface ExternalUsageApi {
  request(body: ExternalUsageRequest): Promise<ExternalUsageSnapshot>;
  selectRoot(selection: ExternalUsageSelection): Promise<ExternalUsageSnapshot>;
}
