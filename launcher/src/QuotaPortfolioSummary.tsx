import type { AccountQuotaSnapshot } from "./types";
import type { AccountsCopy } from "./accounts-copy";

type QuotaPortfolioRow = {
  status: "updated" | "retained" | "unavailable" | "skipped";
  snapshot: AccountQuotaSnapshot | null;
};

function quotaPortfolioCounts(rows: QuotaPortfolioRow[]) {
  const counts = { updated: 0, retained: 0, unavailable: 0, skipped: 0 };
  for (const row of rows) {
    if (row.status === "retained") { counts.retained += 1; continue; }
    if (row.status === "unavailable") { counts.unavailable += 1; continue; }
    if (row.status === "skipped") { counts.skipped += 1; continue; }
    counts.updated += 1;
  }
  return counts;
}

/**
 * "Last refresh: 1 current, 1 earlier, 1 unavailable" for the allowance notice after "Refresh all allowances".
 * Zero counts are left out; null when nothing was refreshed.
 */
export function quotaPortfolioSummary(copy: AccountsCopy, rows: QuotaPortfolioRow[], language: string): string | null {
  const counts = quotaPortfolioCounts(rows);
  const number = new Intl.NumberFormat(language);
  const parts = (Object.keys(counts) as Array<keyof typeof counts>)
    .filter(key => counts[key] > 0)
    .map(key => copy.lastRefreshParts[key].replace("{count}", number.format(counts[key])));
  return parts.length ? copy.lastRefresh.replace("{parts}", parts.join(copy.lastRefreshSeparator)) : null;
}
