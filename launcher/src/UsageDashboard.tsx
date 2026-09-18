import { useEffect, useState } from "react";
import type { UsageSnapshot } from "./types";
import type { Copy } from "./i18n";

export function UsageDashboard({ copy }: { copy: Copy }) {
  const [days, setDays] = useState<7 | 30 | 90>(7);
  const [data, setData] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false, pending = false;
    setData(null); setError(null);
    const refresh = async () => {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const next = await window.codexWebLauncher!.usage(days);
        if (!disposed) { setData(next); setError(next.available ? null : next.error ?? copy.usageUnavailable); }
      } catch {
        if (!disposed) { setData(null); setError(copy.usageUnavailable); }
      } finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    return () => { disposed = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible); };
  }, [days, copy.usageUnavailable]);
  const groups = new Map<string, { accepted: number; completed: number; failed: number; aborted: number }>();
  const daily = new Map<string, number>();
  for (const row of data?.available ? data.rows : []) {
    const effort = row.effort === 'max' ? 'Pro' : row.effort === 'unknown' ? copy.usageUnknown : row.effort;
    const key = `${row.mode} · ${effort} · ${row.modelVersion === 'unknown' ? copy.usageUnknown : `GPT-${row.modelVersion}`}`;
    const group = groups.get(key) ?? { accepted: 0, completed: 0, failed: 0, aborted: 0 };
    for (const field of ['accepted', 'completed', 'failed', 'aborted'] as const) group[field] += row[field];
    groups.set(key, group); daily.set(row.day, (daily.get(row.day) ?? 0) + row.accepted);
  }
  const max = Math.max(1, ...daily.values());
  return <section className="usage-dashboard" aria-label={copy.usageTitle}>
    <h2>{copy.usageTitle}</h2>
    <p>{copy.usageBody}</p>
    <select className="settings-select" aria-label={copy.usageRange} value={days}
      onChange={event => setDays(Number(event.target.value) as 7 | 30 | 90)}>
      {[7, 30, 90].map(value => <option key={value} value={value}>{value} {copy.usageDays}</option>)}
    </select>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">{copy.loading}</p> : <>
      <p>{copy.usageLifetime}: {data.lifetime ?? 0} · {copy.usageSince}: {data.startedAt ? new Date(data.startedAt).toLocaleDateString() : copy.usageUnknown}</p>
      {daily.size ? <div aria-label={copy.usageAccepted} style={{ display: 'flex', gap: 3, height: 90, alignItems: 'end', marginBlock: 16 }}>
        {[...daily].map(([day, count]) => <div key={day} title={`${day}: ${count}`} role="img" aria-label={`${day}: ${count}`}
          style={{ flex: 1, height: `${Math.max(3, count / max * 100)}%`, background: 'var(--accent, #7569ee)', borderRadius: 3 }} />)}
      </div> : null}
      <div style={{ overflowX: 'auto' }}><table>
        <caption>{copy.usageGroups}</caption>
        <thead><tr><th scope="col">{copy.usageModel}</th><th scope="col">{copy.usageAccepted}</th><th scope="col">{copy.usageCompleted}</th><th scope="col">{copy.usageFailed}</th><th scope="col">{copy.usageAborted}</th><th scope="col">{copy.usageUnrecorded}</th></tr></thead>
        <tbody>{[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, row]) => <tr key={name}>
          <th scope="row">{name}</th><td>{row.accepted}</td><td>{row.completed}</td><td>{row.failed}</td><td>{row.aborted}</td>
          <td>{row.accepted - row.completed - row.failed - row.aborted}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </section>;
}
