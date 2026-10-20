import type { AccountQuotaSnapshot } from "./types";

/**
 * Delays before the automatic re-reads of an allowance read that failed transiently (timeout, network, 5xx,
 * session not ready, cancelled read). Their count is each account's budget for the launch.
 */
export const QUOTA_AUTO_RETRY_DELAYS_MS = [30_000, 60_000, 120_000] as const;
const MAX_RETRY_HINT_MS = 5 * 60_000;

export function isTransientQuota(value: AccountQuotaSnapshot | null | undefined): value is AccountQuotaSnapshot {
  return value?.availability === "unavailable" && value.transient === true;
}

/**
 * Milliseconds until this result's next automatic re-read, or null when it gets none: the result is not transient,
 * or `spent` re-reads used the budget. Measured from the failed read, so an older failure is read again sooner;
 * the backend's retryAfterMs is a lower bound.
 */
export function quotaAutoRetryDelay(value: AccountQuotaSnapshot | null | undefined, spent: number, now: number) {
  if (!isTransientQuota(value) || !Number.isInteger(spent) || spent < 0
    || spent >= QUOTA_AUTO_RETRY_DELAYS_MS.length) return null;
  const hint = typeof value.retryAfterMs === "number" && Number.isFinite(value.retryAfterMs)
    ? Math.min(Math.max(0, value.retryAfterMs), MAX_RETRY_HINT_MS) : 0;
  const delay = Math.max(QUOTA_AUTO_RETRY_DELAYS_MS[spent], hint);
  const checkedAt = typeof value.checkedAt === "string" ? Date.parse(value.checkedAt) : Number.NaN;
  return Number.isFinite(checkedAt) ? Math.min(delay, Math.max(0, checkedAt + delay - now)) : delay;
}

/** Automatic re-reads spent per account. */
export function createQuotaAutoRetryBudget() {
  const spent = new Map<string, number>();
  return {
    spent: (id: string) => spent.get(id) ?? 0,
    spend: (id: string) => { spent.set(id, (spent.get(id) ?? 0) + 1); },
  };
}

/** This launch's budget: it outlives the Accounts page, so leaving and reopening the page does not reset it. */
export const quotaAutoRetries = createQuotaAutoRetryBudget();
