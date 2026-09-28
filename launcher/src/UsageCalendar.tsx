import { Fragment, useState } from "react";
import type { Copy } from "./i18n";
import type { Language, UsageCalendarDay, UsageSnapshot } from "./types";
import { Button } from "./design";
import { UsagePanel } from "./usage-panel";
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

/** First day of the week for the language (0 = Sunday), from Intl week info when the runtime has it; Monday otherwise. */
function firstWeekday(language: Language): number {
  try {
    const locale = new Intl.Locale(language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    if (info && Number.isInteger(info.firstDay)) return info.firstDay % 7;
  } catch { /* Older runtimes: fall through to Monday. */ }
  return 1;
}

const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const heatLevels = [0, 1, 2, 3, 4] as const;
/** 0 = no messages; 1–4 = quarters of the busiest day in the period. */
const heatLevel = (total: number, maximum: number) => total <= 0 || maximum <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(total / maximum * 4)));

/** Calendar heat grid: one row per week, one cell per day, shaded by the day's total. Decorative; the table carries the numbers. */
function CalendarHeat({ calendar, language, totalLabel, failedLabel }: { calendar: UsageCalendarDay[]; language: Language; totalLabel: string; failedLabel: string }) {
  if (!calendar.length || !Number.isFinite(new Date(`${calendar[0].day}T00:00:00Z`).getTime())) return null;
  const first = firstWeekday(language);
  const maximum = Math.max(0, ...calendar.map(day => day.total));
  const lead = (weekdayOf(calendar[0].day) - first + 7) % 7;
  const cells: Array<UsageCalendarDay | null> = [...Array.from({ length: lead }, () => null), ...calendar];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
  const weekdayFormat = new Intl.DateTimeFormat(language, { weekday: "short", timeZone: "UTC" });
  // 2024-01-07 was a Sunday.
  const weekdays = Array.from({ length: 7 }, (_, index) => weekdayFormat.format(new Date(Date.UTC(2024, 0, 7 + (first + index) % 7))));
  const anyFailed = calendar.some(day => day.failed > 0);
  return <div className={`usage-heat${weeks.length > 6 ? " is-dense" : ""}`} aria-hidden="true">
    <div className="usage-heat__grid">
      <span />
      {weekdays.map((name, index) => <span className="usage-heat__weekday" key={index}>{name}</span>)}
      {weeks.map((week, index) => {
        const firstDay = week.find(Boolean);
        return <Fragment key={firstDay?.day ?? index}>
          <span className="usage-heat__week">{firstDay ? dateLabel(firstDay.day, language) : ""}</span>
          {week.map((day, slot) => day
            ? <span className="usage-heat__day" data-level={heatLevel(day.total, maximum)} key={day.day}
              title={`${dateLabel(day.day, language, { weekday: "short", month: "short", day: "numeric" })} · ${totalLabel}: ${number(day.total, language)}${day.failed ? ` · ${failedLabel}: ${number(day.failed, language)}` : ""}`}>
              {day.failed ? <i className="usage-heat__failed" /> : null}
            </span>
            : <span className="usage-heat__pad" key={`pad-${slot}`} />)}
        </Fragment>;
      })}
    </div>
    <div className="usage-heat__legend">
      {maximum > 0 ? <span className="usage-heat__scale">
        <span>0</span>
        {heatLevels.map(level => <span className="usage-heat__day" data-level={level} key={level} />)}
        <span>{number(maximum, language)}</span>
      </span> : null}
      {anyFailed ? <span className="usage-heat__key"><i className="usage-heat__failed" />{failedLabel}</span> : null}
    </div>
  </div>;
}

function CalendarTable({ calendar, copy, language, showIncomplete, showUnrecorded, totalLabel }: { calendar: UsageCalendarDay[]; copy: Copy; language: Language; showIncomplete: boolean; showUnrecorded: boolean; totalLabel: string }) {
  return <div className="usage-table-scroll"><table className="usage-table usage-calendar-table">
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
  return <UsagePanel titleId="usage-calendar-title" title={copy.usageCalendar} className="usage-calendar"
    description={calendarSummary.replace("{total}", number(visible.metrics.total, language)).replace("{active}", number(activeDays, language)).replace("{days}", number(visible.period.days, language))}
    actions={<Button variant="ghost" size="sm" aria-expanded={showTable} onClick={() => setShowTable(value => !value)}>{showTable ? copy.usageHideTable : copy.usageShowTable}</Button>}>
    <CalendarHeat calendar={calendar} language={language} totalLabel={totalLabel} failedLabel={copy.usageFailed} />
    {showTable ? <CalendarTable calendar={calendar} copy={copy} language={language} showIncomplete={!web} showUnrecorded={web} totalLabel={totalLabel} /> : null}
  </UsagePanel>;
}
