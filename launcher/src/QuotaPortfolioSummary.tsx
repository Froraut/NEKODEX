import type { AccountQuotaSnapshot } from "./types";

type QuotaPortfolioRow = {
  status: "updated" | "retained" | "unavailable" | "skipped";
  snapshot: AccountQuotaSnapshot | null;
};

interface QuotaPortfolioCopy {
  refreshing: string;
  summary: string;
}

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

export function QuotaPortfolioSummary({ copy, pending = 0, rows }: {
  copy: QuotaPortfolioCopy;
  pending?: number;
  rows: QuotaPortfolioRow[];
}) {
  const counts = quotaPortfolioCounts(rows);
  const summary = copy.summary.replace("{updated}", String(counts.updated))
    .replace("{retained}", String(counts.retained))
    .replace("{unavailable}", String(counts.unavailable))
    .replace("{skipped}", String(counts.skipped));
  return <section className="quota-portfolio-summary" aria-live="polite" aria-atomic="true">
    <span>{pending > 0 ? copy.refreshing : summary}</span>
  </section>;
}
