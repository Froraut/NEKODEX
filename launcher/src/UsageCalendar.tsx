import { Fragment, useId, useState, type ReactNode } from "react";
import type { Copy } from "./i18n";
import type { Language, UsageCalendarDay, UsageSnapshot } from "./types";
import { usageCalendarSummary, type ActivityCopy } from "./activity-copy";
import { Button, Panel } from "./design";
const number = (value: number, language: Language) => value.toLocaleString(language);
const DAY = 86_400_000;
const utcDate = (day: string) => new Date(`${day}T00:00:00Z`);
export function dateLabel(day: string, language: Language, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  const date = utcDate(day);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(language, { ...options, timeZone: "UTC" }).format(date) : day;
}

/** "Sep 15 – 21" / "15–21 сент.": the locale's own range format (one date for a one-day period). */
export function dateRangeLabel(start: string, end: string, language: Language, fallback: string) {
  const from = utcDate(start), to = utcDate(end);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return fallback;
  const format = new Intl.DateTimeFormat(language, { month: "short", day: "numeric", timeZone: "UTC" });
  try { return format.formatRange(from, to); } catch { return fallback; }
}

export function completeCalendar(report: UsageSnapshot): UsageCalendarDay[] {
  const present = new Map(report.calendar.map(day => [day.day, day]));
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(report.period.startDay);
  if (!match) return report.calendar;
  const first = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Array.from({ length: report.period.days }, (_, index) => {
    const date = new Date(first + index * DAY);
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

const weekdayOf = (day: string) => utcDate(day).getUTCDay();
const heatLevels = [0, 1, 2, 3, 4] as const;
/** 0 = no messages; 1–4 = quarters of the busiest day in the period. */
const heatLevel = (total: number, maximum: number) => total <= 0 || maximum <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(total / maximum * 4)));
/** More weeks than this turn the grid on its side (weeks as columns), so 30–90 days stay short and wide. */
const DENSE_WEEKS = 6;

/**
 * Calendar heat grid, one cell per day shaded by the day's total. Up to six weeks: one row per week, labelled by the
 * week's first day. Longer periods: one column per week with month labels, weekdays as rows. Decorative; the table
 * carries the numbers.
 */
function CalendarHeat({ calendar, language, totalLabel, failedLabel, action }: { calendar: UsageCalendarDay[]; language: Language; totalLabel: string; failedLabel: string; action?: ReactNode }) {
  if (!calendar.length || !Number.isFinite(utcDate(calendar[0].day).getTime())) return action ? <div className="usage-heat__footer">{action}</div> : null;
  const first = firstWeekday(language);
  const maximum = Math.max(0, ...calendar.map(day => day.total));
  const lead = (weekdayOf(calendar[0].day) - first + 7) % 7;
  const cells: Array<UsageCalendarDay | null> = [...Array.from({ length: lead }, () => null), ...calendar];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
  // Every week is named by its first day, even when that day falls before the period (the same week keeps one label).
  const gridStart = utcDate(calendar[0].day).getTime() - lead * DAY;
  const weekStart = (index: number) => new Date(gridStart + index * 7 * DAY);
  const weekLabel = new Intl.DateTimeFormat(language, { month: "short", day: "numeric", timeZone: "UTC" });
  const monthLabel = new Intl.DateTimeFormat(language, { month: "short", timeZone: "UTC" });
  const weekdayFormat = new Intl.DateTimeFormat(language, { weekday: "short", timeZone: "UTC" });
  // 2024-01-07 was a Sunday.
  const weekdays = Array.from({ length: 7 }, (_, index) => weekdayFormat.format(new Date(Date.UTC(2024, 0, 7 + (first + index) % 7))));
  const anyFailed = calendar.some(day => day.failed > 0);
  const dense = weeks.length > DENSE_WEEKS;
  const cell = (day: UsageCalendarDay | null, key: string) => day
    ? <span className="usage-heat__day" data-level={heatLevel(day.total, maximum)} key={key}
      title={`${dateLabel(day.day, language, { weekday: "short", month: "short", day: "numeric" })} · ${totalLabel}: ${number(day.total, language)}${day.failed ? ` · ${failedLabel}: ${number(day.failed, language)}` : ""}`}>
      {day.failed ? <i className="usage-heat__failed" /> : null}
    </span>
    : <span className="usage-heat__pad" key={key} />;
  // Dense: a month label where a new month starts (the first column's only when the next label is not right beside it).
  const monthColumns = dense ? weeks.map((_, index) => index === 0 || weekStart(index).getUTCMonth() !== weekStart(index - 1).getUTCMonth()) : [];
  if (dense && monthColumns.slice(1, 3).some(Boolean)) monthColumns[0] = false;
  return <div className={`usage-heat${dense ? " is-dense" : ""}`}>
    {dense
      ? <div className="usage-heat__grid usage-heat__grid--weeks" aria-hidden="true" style={{ gridTemplateColumns: `max-content repeat(${weeks.length}, minmax(0, 24px))` }}>
        <span />
        {weeks.map((_, index) => <span className="usage-heat__month" key={`month-${index}`}>{monthColumns[index] ? monthLabel.format(weekStart(index)) : ""}</span>)}
        {weekdays.map((name, slot) => <Fragment key={`weekday-${slot}`}>
          <span className="usage-heat__week">{name}</span>
          {weeks.map((week, index) => cell(week[slot], week[slot]?.day ?? `pad-${index}-${slot}`))}
        </Fragment>)}
      </div>
      : <div className="usage-heat__grid" aria-hidden="true">
        <span />
        {weekdays.map((name, index) => <span className="usage-heat__weekday" key={index}>{name}</span>)}
        {weeks.map((week, index) => <Fragment key={index}>
          <span className="usage-heat__week">{weekLabel.format(weekStart(index))}</span>
          {week.map((day, slot) => cell(day, day?.day ?? `pad-${slot}`))}
        </Fragment>)}
      </div>}
    <div className="usage-heat__footer">
      <div className="usage-heat__legend" aria-hidden="true">
        {maximum > 0 ? <span className="usage-heat__scale">
          <span>0</span>
          {heatLevels.map(level => <span className="usage-heat__day" data-level={level} key={level} />)}
          <span>{number(maximum, language)}</span>
        </span> : null}
        {anyFailed ? <span className="usage-heat__key"><i className="usage-heat__failed" />{failedLabel}</span> : null}
      </div>
      {action}
    </div>
  </div>;
}

function CalendarTable({ id, calendar, copy, language, showIncomplete, showUnrecorded, totalLabel }: { id: string; calendar: UsageCalendarDay[]; copy: Copy; language: Language; showIncomplete: boolean; showUnrecorded: boolean; totalLabel: string }) {
  return <div className="usage-table-scroll" id={id}><table className="usage-table usage-calendar-table">
    <caption>{copy.usageCalendarTable}</caption>
    <thead><tr><th scope="col">{copy.usageDate}</th><th scope="col">{totalLabel}</th><th scope="col">{copy.usageCompleted}</th><th scope="col">{copy.usageFailed}</th><th scope="col">{copy.usageAborted}</th>{showIncomplete ? <th scope="col">{copy.usageIncomplete}</th> : null}{showUnrecorded ? <th scope="col">{copy.usageUnrecorded}</th> : null}</tr></thead>
    <tbody>{calendar.map(day => <tr key={day.day}><th scope="row">{dateLabel(day.day, language, { year: "numeric", month: "short", day: "numeric" })}</th><td>{number(day.total, language)}</td><td>{number(day.completed, language)}</td><td>{number(day.failed, language)}</td><td>{number(day.cancelled, language)}</td>{showIncomplete ? <td>{number(day.incomplete ?? 0, language)}</td> : null}{showUnrecorded ? <td>{number(day.unrecorded, language)}</td> : null}</tr>)}</tbody>
  </table></div>;
}

export function UsageCalendar({ report: visible, copy, text, language }: { report: UsageSnapshot; copy: Copy; text: ActivityCopy; language: Language }) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  const calendar = completeCalendar(visible);
  const activeDays = calendar.filter(day => day.total > 0).length;
  const web = visible.source === "web";
  const totalLabel = web ? copy.usageWebTotal : copy.usageNativeTotal;
  // The toggle sits with the legend, right under the grid it tabulates (not in the header, where it would wrap
  // between the title and the summary in a narrow workspace).
  const toggle = <Button variant="ghost" size="sm" aria-expanded={showTable} aria-controls={showTable ? tableId : undefined}
    onClick={() => setShowTable(value => !value)}>{showTable ? text.hideDailyTable : text.showDailyTable}</Button>;
  return <Panel headingLevel={3} titleId="usage-calendar-title" title={copy.usageCalendar} className="usage-calendar"
    description={usageCalendarSummary(text, web, number(visible.metrics.total, language), number(activeDays, language), visible.period.days, number(visible.period.days, language))}>
    <CalendarHeat calendar={calendar} language={language} totalLabel={totalLabel} failedLabel={copy.usageFailed} action={toggle} />
    {showTable ? <CalendarTable id={tableId} calendar={calendar} copy={copy} language={language} showIncomplete={!web} showUnrecorded={web} totalLabel={totalLabel} /> : null}
  </Panel>;
}
