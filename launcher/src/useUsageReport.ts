import { useEffect, useMemo, useRef, useState } from "react";
import type { UsageQuery, UsageSnapshot } from "./types";
import { normalizedUsageSnapshot } from "./usage-statistics";
const usageQueryKey = ({ days, source, accountId = null }: UsageQuery) => `${source}:${days}:${source === "web" ? accountId ?? "all" : "native"}`;
export type UsageLoader = (query: UsageQuery) => Promise<UsageSnapshot>;
export function useUsageReport(load: UsageLoader, unavailable: string) {
  const [filters, setFilters] = useState<UsageQuery>({ days: 7, source: "web", accountId: null });
  const activeKey = usageQueryKey(filters);
  const cache = useRef(new Map<string, UsageSnapshot>());
  const [result, setResult] = useState<{ key: string; report: UsageSnapshot } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [knownAccounts, setKnownAccounts] = useState<UsageSnapshot["accounts"]>([]);
  const rawVisible = result?.key === activeKey ? result.report : cache.current.get(activeKey) ?? null;
  const visible = useMemo(() => normalizedUsageSnapshot(rawVisible), [rawVisible]);
  const visibleError = error?.key === activeKey ? error.message : null;
  const changeFilters = (next: UsageQuery) => {
    setError(current => current?.key === usageQueryKey(next) ? current : null);
    setRefreshing(usageQueryKey(next));
    setFilters(next);
  };
  const rememberReport = (key: string, report: UsageSnapshot) => {
    cache.current.delete(key);
    cache.current.set(key, report);
    while (cache.current.size > 12) {
      const oldest = cache.current.keys().next().value;
      if (oldest === undefined) break;
      cache.current.delete(oldest);
    }
  };

  useEffect(() => {
    let disposed = false;
    let pending = false;
    const key = usageQueryKey(filters);
    const refresh = async () => {
      if (document.hidden || pending) return;
      pending = true;
      setRefreshing(key);
      try {
        const next = await load({ days: filters.days, source: filters.source,
          ...(filters.source === "web" ? { accountId: filters.accountId ?? null } : {}) });
        if (disposed) return;
        if (!next.available) {
          setError({ key, message: next.error ?? unavailable });
          return;
        }
        rememberReport(key, next);
        setResult({ key, report: next });
        if (filters.source === "web") setKnownAccounts(next.accounts);
        setError(current => current?.key === key ? null : current);
      } catch {
        if (!disposed) setError({ key, message: unavailable });
      } finally {
        pending = false;
        if (!disposed) setRefreshing(current => current === key ? null : current);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const resume = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [filters.days, filters.source, filters.accountId, unavailable, retryAttempt, load]);

  return { filters, activeKey, visible, visibleError, refreshing: refreshing === activeKey, knownAccounts, changeFilters, retry: () => { setRefreshing(activeKey); setRetryAttempt(value => value + 1); } };
}
