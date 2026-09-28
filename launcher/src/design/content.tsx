import { createElement, isValidElement, type JSX, type ReactElement, type ReactNode } from "react";
import { Switch } from "./controls";
import { Mark } from "./Mark";
import { NkIcon, cx, type IconName, type Status, type Tone } from "./shared";
import { Badge, StateDot } from "./status";

/** The app's coding-cat raster (Dark only); Hero's default illustration. */
export const codingCatIllustration = new URL("../assets/cat-workspace.png", import.meta.url).href;

/* ---------------- Page frame ---------------- */

/** Page column: size-content (960) by default, narrow (760) or wide (1280); gutters space-8. */
export function Page({ width, children, className }: { width?: "narrow" | "wide"; children?: ReactNode; className?: string }) {
  return <div className={cx("nk-page", width && `nk-page--${width}`, className)}>{children}</div>;
}

export interface SurfaceHeaderProps { title: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; className?: string }

/** The one h1 of a surface, with an optional subtitle and right-aligned actions. */
export function SurfaceHeader({ title, subtitle, eyebrow, actions, className }: SurfaceHeaderProps) {
  return (
    <header className={cx("nk-surface-header", className)}>
      <div>
        {eyebrow ? <small>{eyebrow}</small> : null}
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="nk-surface-header__actions">{actions}</div> : null}
    </header>
  );
}

export interface HeroProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  /** One primary Button, optionally a ghost Button. */
  actions?: ReactNode;
  /** Raster URL shown in Dark (default: the app's coding cat). Pass "" to show the vector cat instead. */
  illustration?: string;
  /** false omits the art column. */
  art?: boolean;
  /** Body copy (one or two sentences). */
  children?: ReactNode;
  className?: string;
}

/** The Overview focal panel. Light (and an empty illustration) shows the vector cat; art hides under 640px. */
export function Hero({ title, eyebrow, actions, illustration = codingCatIllustration, art, children, className }: HeroProps) {
  return (
    <section aria-label={typeof title === "string" ? title : undefined} className={cx("nk-panel", "nk-panel--brand", "nk-hero", className)}>
      <div>
        {eyebrow ? <small>{eyebrow}</small> : null}
        <h2>{title}</h2>
        {children ? <p>{children}</p> : null}
        {actions ? <div className="nk-hero__actions">{actions}</div> : null}
      </div>
      {art === false ? null : (
        <div className="nk-hero__art" style={illustration ? { backgroundImage: `url("${illustration}")` } : undefined}>
          <Mark focusable size={96} />
        </div>
      )}
    </section>
  );
}

export interface PanelProps {
  title?: ReactNode;
  /** id for the h2; also sets aria-labelledby on the panel. */
  titleId?: string;
  actions?: ReactNode;
  /** Shown in the header (only when title or actions are set). */
  description?: ReactNode;
  variant?: "default" | "raised" | "brand";
  padding?: "compact" | "flush";
  /** Element to render (default "section"). */
  as?: keyof JSX.IntrinsicElements;
  children?: ReactNode;
  className?: string;
}

export function Panel({ title, titleId, actions, description, variant, padding, as = "section", children, className }: PanelProps) {
  const header = title || actions ? (
    <header className="nk-panel__header">
      {title ? <h2 id={titleId}>{title}</h2> : null}
      {actions || null}
      {description ? <p>{description}</p> : null}
    </header>
  ) : null;
  return createElement(as, {
    "aria-labelledby": titleId,
    className: cx("nk-panel", variant && variant !== "default" && `nk-panel--${variant}`, padding && `nk-panel--${padding}`, className),
  }, header, children);
}

/* ---------------- Metrics ---------------- */

export interface StatProps {
  label: ReactNode;
  /** Numbers render as display numerals; non-numeric strings as a title-sized word. */
  value: number | string;
  note?: ReactNode;
  /** Makes the stat a button with a chevron. */
  onClick?: () => void;
  className?: string;
}

export function Stat({ label, value, note, onClick, className }: StatProps) {
  const interactive = typeof onClick === "function";
  const isText = typeof value === "string" && Number.isNaN(Number(value));
  const content = (
    <>
      <span className="nk-stat__label">{label}{interactive ? <NkIcon name="chevron" /> : null}</span>
      <strong className={cx("nk-stat__value", isText && "is-text")}>{value}</strong>
      {note ? <span className="nk-stat__note">{note}</span> : null}
    </>
  );
  return interactive
    ? <button className={cx("nk-stat", className)} onClick={onClick} type="button">{content}</button>
    : <div className={cx("nk-stat", className)}>{content}</div>;
}

export function StatGroup({ label, children, className }: { label?: string; children?: ReactNode; className?: string }) {
  return <div aria-label={label} className={cx("nk-stats", className)} role="group">{children}</div>;
}

/* ---------------- Settings and setup ---------------- */

export interface SettingRowProps {
  title: ReactNode;
  titleId?: string;
  description?: ReactNode;
  /** Right-aligned control; a kit <Switch> keeps its place when the row stacks under 640px. */
  control?: ReactElement;
  className?: string;
}

export function SettingRow({ title, titleId, description, control, className }: SettingRowProps) {
  const isSwitch = isValidElement(control) && control.type === Switch;
  return (
    <div className={cx("nk-setting-row", isSwitch && "has-switch", className)}>
      <div>
        <strong id={titleId}>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      {control ? <div className="nk-setting-row__control">{control}</div> : null}
    </div>
  );
}

/** A titled group of SettingRows inside one panel. */
export function SettingsGroup({ title, description, id, children, className }: { title: ReactNode; description?: ReactNode; id?: string; children?: ReactNode; className?: string }) {
  return (
    <section className={cx("nk-settings-group", className)} id={id}>
      <header>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      <div className="nk-panel">{children}</div>
    </section>
  );
}

export interface SetupRowProps {
  index: number;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  complete?: boolean;
  /** The derived next step (accent index). */
  current?: boolean;
  /** Inline after the title, e.g. <Badge tone="outline">Optional</Badge>. */
  tag?: ReactNode;
  className?: string;
}

export function SetupRow({ index, title, description, actions, complete, current, tag, className }: SetupRowProps) {
  return (
    <div className={cx("nk-setup-row", complete && "is-complete", current && "is-current", className)}>
      <span className="nk-setup-row__index">{complete ? <NkIcon name="check" /> : index}</span>
      <div>
        <strong>{title}{tag || null}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="nk-setup-row__actions">{actions}</div> : null}
    </div>
  );
}

export interface ConnectionRowProps {
  icon?: IconName;
  label: string;
  status: string;
  state?: Exclude<Status, "optional">;
  /** Visible trailing action word ("Manage"); part of the accessible name. */
  action?: string;
  onClick?: () => void;
  className?: string;
}

/** A whole-row button: icon, label, status word + dot, trailing action. Group rows in <div className="nk-conn-list">. */
export function ConnectionRow({ icon, label, status, state = "idle", action, onClick, className }: ConnectionRowProps) {
  return (
    <button aria-label={`${label}: ${status}. ${action || ""}`} className={cx("nk-conn-row", className)} onClick={onClick} type="button">
      <NkIcon name={icon || "chevron"} />
      <span className="nk-conn-row__copy">
        <strong>{label}</strong>
        <span aria-live="polite" className={cx("nk-conn-row__status", `is-${state}`)}><StateDot state={state} />{status}</span>
      </span>
      {action ? <span aria-hidden="true" className="nk-conn-row__action">{action}<NkIcon name="chevron" /></span> : <span />}
    </button>
  );
}

/* ---------------- Lists and empty states ---------------- */

export interface EventItem {
  id?: string;
  text: ReactNode;
  /** Visible time label. */
  time?: string;
  /** Machine-readable time for <time dateTime>. */
  dateTime?: string;
  level?: "info" | "warning" | "error";
  icon?: IconName;
}

/** Event rows; renders `empty` (or nothing) when there are no items. */
export function EventList({ items, empty, className }: { items: EventItem[]; empty?: ReactNode; className?: string }) {
  if (!items.length) return empty ? <>{empty}</> : null;
  return (
    <ul className={cx("nk-events", className)}>
      {items.map((item, index) => {
        const level = item.level || "info";
        return (
          <li className={`is-${level}`} key={item.id || index}>
            <NkIcon name={item.icon || (level === "warning" || level === "error" ? "alert" : "activity")} />
            <span>{item.text}</span>
            {item.time ? <time dateTime={item.dateTime}>{item.time}</time> : <span />}
          </li>
        );
      })}
    </ul>
  );
}

export interface EmptyStateProps {
  title: ReactNode;
  /** Leading icon (default "logs"); ignored when mark is set. */
  icon?: IconName;
  /** Show the cat instead of an icon. */
  mark?: boolean;
  action?: ReactNode;
  centered?: boolean;
  children?: ReactNode;
  className?: string;
}

export function EmptyState({ title, icon, mark, action, centered, children, className }: EmptyStateProps) {
  return (
    <div className={cx("nk-empty", centered && "nk-empty--centered", className)}>
      {mark ? <Mark label={null} size={32} /> : <NkIcon name={icon || "logs"} />}
      <div>
        <strong>{title}</strong>
        {children ? <p>{children}</p> : null}
        {action || null}
      </div>
    </div>
  );
}

/** Native <details> panel for secondary content (advanced settings, troubleshooting). */
export function Disclosure({ title, hint, defaultOpen, children, className }: { title: ReactNode; hint?: ReactNode; defaultOpen?: boolean; children?: ReactNode; className?: string }) {
  return (
    <details className={cx("nk-disclosure", className)} open={defaultOpen}>
      <summary><span>{title}</span>{hint ? <small>{hint}</small> : null}<NkIcon name="chevron" /></summary>
      <div className="nk-disclosure__body">{children}</div>
    </details>
  );
}

/* ---------------- Accounts ---------------- */

export interface AccountCardProps {
  name: string;
  email?: string;
  /** Avatar letter (default: first letter of name). */
  initial?: string;
  selected?: boolean;
  /** Text of the Selected badge (pass localized copy; defaults to "Selected"). */
  selectedLabel?: string;
  facts?: Array<{ label: ReactNode; tone?: Tone; dot?: Status }>;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function AccountCard({ name, email, initial, selected, selectedLabel, facts = [], actions, children, className }: AccountCardProps) {
  const letter = initial || (name ? String(name).trim().charAt(0).toUpperCase() : "?");
  return (
    <article aria-label={name} className={cx("nk-account", selected && "is-selected", className)}>
      <header className="nk-account__header">
        <span aria-hidden="true" className="nk-account__avatar">{letter}</span>
        <div className="nk-account__who">
          <h3>{name}</h3>
          {email ? <p>{email}</p> : null}
        </div>
        {selected ? <Badge tone="accent">{selectedLabel || "Selected"}</Badge> : null}
      </header>
      {facts.length ? (
        <div className="nk-account__facts">
          {facts.map((fact, index) => <Badge dot={fact.dot} key={index} tone={fact.tone}>{fact.label}</Badge>)}
        </div>
      ) : null}
      {children ? <div className="nk-account__body">{children}</div> : null}
      {actions ? <div className="nk-account__actions">{actions}</div> : null}
    </article>
  );
}
