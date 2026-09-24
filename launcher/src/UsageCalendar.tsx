import { useState } from "react";
import type { Copy } from "./i18n";
import type { Language, UsageCalendarDay, UsageSnapshot } from "./types";
const number = (value: number, language: Language) => value.toLocaleString(language);
export function dateLabel(day: string, language: Language, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(language, { ...options, timeZone: "UTC" }).format(date) : day;
}

export function completeCalendar(report: UsageSnapshot): UsageCalendarDay[] {
  const present = new Map(report.calendar.map(day => [day.day, day]));
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(report.period.startDay);
  if (!match) return report.calendar;
  const first = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Array.from({ length: report.period.days }, (_, index) => {
    const date = new Date(first + index * 86_400_000);
    const day = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    return present.get(day) ?? { day, total: 0, completed: 0, failed: 0, cancelled: 0,
      ...(report.source === "native" ? { incomplete: 0 } : {}), unrecorded: 0 };
  });
}

function CalendarChart({ calendar, language, totalLabel }: { calendar: UsageCalendarDay[]; language: Language; totalLabel: string }) {
  const maximum = Math.max(1, ...calendar.map(day => day.total));
  return <div className="usage-calendar" aria-hidden="true">
    <div className="usage-calendar-bars">
      {calendar.map(day => {
        const height = day.total ? Math.max(5, day.total / maximum * 100) : 2;
        const segment = (value: number) => day.total ? `${value / day.total * 100}%` : "0%";
        return <div className="usage-calendar-column" key={day.day} title={`${dateLabel(day.day, language)} · ${totalLabel}: ${day.total}`}>
          <span className={`usage-calendar-bar${day.total ? "" : " is-zero"}`} style={{ height: `${height}%` }}>
            <i className="is-completed" style={{ height: segment(day.completed) }} />
            <i className="is-failed" style={{ height: segment(day.failed) }} />
            <i className="is-cancelled" style={{ height: segment(day.cancelled) }} />
            <i className="is-incomplete" style={{ height: segment(day.incomplete ?? 0) }} />
            <i className="is-unrecorded" style={{ height: segment(day.unrecorded) }} />
          </span>
        </div>;
      })}
    </div>
    <div className="usage-calendar-axis"><span>{dateLabel(calendar[0]?.day ?? "", language)}</span><span>{dateLabel(calendar.at(-1)?.day ?? "", language)}</span></div>
  </div>;
}

function CalendarTable({ calendar, copy, language, showIncomplete, showUnrecorded, totalLabel }: { calendar: UsageCalendarDay[]; copy: Copy; language: Language; showIncomplete: boolean; showUnrecorded: boolean; totalLabel: string }) {
  return <div className="usage-table-scroll"><table className="usage-calendar-table">
    <caption>{copy.usageCalendarTable}</caption>
    <thead><tr><th scope="col">{copy.usageDate}</th><th scope="col">{totalLabel}</th><th scope="col">{copy.usageCompleted}</th><th scope="col">{copy.usageFailed}</th><th scope="col">{copy.usageAborted}</th>{showIncomplete ? <th scope="col">{copy.usageIncomplete}</th> : null}{showUnrecorded ? <th scope="col">{copy.usageUnrecorded}</th> : null}</tr></thead>
    <tbody>{calendar.map(day => <tr key={day.day}><th scope="row">{dateLabel(day.day, language, { year: "numeric", month: "short", day: "numeric" })}</th><td>{number(day.total, language)}</td><td>{number(day.completed, language)}</td><td>{number(day.failed, language)}</td><td>{number(day.cancelled, language)}</td>{showIncomplete ? <td>{number(day.incomplete ?? 0, language)}</td> : null}{showUnrecorded ? <td>{number(day.unrecorded, language)}</td> : null}</tr>)}</tbody>
  </table></div>;
}

export function UsageCalendar({ report: visible, copy, language }: { report: UsageSnapshot; copy: Copy; language: Language }) {
  const [showTable, setShowTable] = useState(false);
  const calendar = completeCalendar(visible);
  const activeDays = calendar.filter(day => day.total > 0).length;
  const web = visible.source === "web";
  const totalLabel = web ? copy.usageWebTotal : copy.usageNativeTotal;
  const calendarSummary = web ? copy.usageCalendarSummary : copy.usageNativeCalendarSummary;
  return <section className="usage-calendar-section" aria-labelledby="usage-calendar-title">
        <div className="usage-section-heading"><div><h3 id="usage-calendar-title">{copy.usageCalendar}</h3><p>{calendarSummary.replace("{total}", number(visible.metrics.total, language)).replace("{active}", number(activeDays, language)).replace("{days}", number(visible.period.days, language))}</p></div>
          <button className="text-button" type="button" aria-expanded={showTable} onClick={() => setShowTable(value => !value)}>{showTable ? copy.usageHideTable : copy.usageShowTable}</button>
        </div>
        <CalendarChart calendar={calendar} language={language} totalLabel={totalLabel} />
        {showTable ? <CalendarTable calendar={calendar} copy={copy} language={language} showIncomplete={!web} showUnrecorded={web} totalLabel={totalLabel} /> : null}
      </section>;
}
