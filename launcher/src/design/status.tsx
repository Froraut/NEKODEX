import type { ReactNode } from "react";
import { NkIcon, cx, type IconName, type Status, type Tone } from "./shared";

export function StateDot({ state = "idle", className }: { state?: Status; className?: string }) {
  return <i aria-hidden="true" className={cx("nk-dot", `is-${state}`, className)} />;
}

export interface BadgeProps {
  tone?: Tone;
  /** Leading StateDot (wins over icon). */
  dot?: Status;
  icon?: IconName;
  shape?: "tag" | "pill";
  children?: ReactNode;
  className?: string;
}

export function Badge({ tone, dot, icon, shape, children, className }: BadgeProps) {
  return (
    <span className={cx("nk-badge", tone && tone !== "neutral" && `nk-badge--${tone}`, shape === "pill" && "nk-badge--pill", className)}>
      {dot ? <StateDot state={dot} /> : icon ? <NkIcon name={icon} /> : null}
      {children}
    </span>
  );
}

const noticeIcon: Record<NonNullable<NoticeProps["tone"]>, IconName> = { info: "info", success: "check", warning: "alert", error: "alert" };

export interface NoticeProps {
  tone?: "info" | "success" | "warning" | "error";
  title?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  icon?: IconName;
  children?: ReactNode;
  className?: string;
}

/** Inline message in a tinted panel. Errors are role="alert"; other tones role="status" (polite). */
export function Notice({ tone = "info", title, meta, action, icon, children, className }: NoticeProps) {
  return (
    <section
      aria-live={tone === "error" ? undefined : "polite"}
      className={cx("nk-notice", tone !== "info" && `nk-notice--${tone}`, !title && !meta && "is-plain", className)}
      role={tone === "error" ? "alert" : "status"}
    >
      <NkIcon name={icon || noticeIcon[tone]} />
      <div>
        {title ? <strong>{title}</strong> : null}
        {children ? <p>{children}</p> : null}
        {meta ? <small>{meta}</small> : null}
      </div>
      {action ? <div className="nk-notice__action">{action}</div> : <span />}
    </section>
  );
}

export interface ProgressMeterProps {
  /** 0..1; null or undefined renders the indeterminate bar. */
  value?: number | null;
  label?: string;
  valueLabel?: ReactNode;
  note?: ReactNode;
  tone?: "success" | "warning" | "error";
  className?: string;
}

export function ProgressMeter({ value, label, valueLabel, note, tone, className }: ProgressMeterProps) {
  const indeterminate = value == null;
  const percent = indeterminate ? 0 : Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cx("nk-meter", indeterminate && "is-indeterminate", tone && `nk-meter--${tone}`, className)}>
      {label || valueLabel ? <div className="nk-meter__head"><span>{label}</span>{valueLabel ? <strong>{valueLabel}</strong> : null}</div> : null}
      <div
        aria-label={label}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={indeterminate ? undefined : Math.round(percent)}
        className="nk-meter__track"
        role="progressbar"
      >
        <span className="nk-meter__fill" style={indeterminate ? undefined : { width: `${percent}%` }} />
      </div>
      {note ? <div className="nk-meter__foot">{note}</div> : null}
    </div>
  );
}

export interface PhaseStep { label: string; state?: "complete" | "current" | "upcoming" | "error" }

export function PhaseSteps({ steps, label, className }: { steps: PhaseStep[]; label?: string; className?: string }) {
  return (
    <ol aria-label={label} className={cx("nk-steps", className)}>
      {steps.map((step, index) => {
        const state = step.state || "upcoming";
        return (
          <li aria-current={state === "current" ? "step" : undefined} className={`is-${state}`} key={index}>
            <span>{state === "complete" ? <NkIcon name="check" /> : state === "error" ? <NkIcon name="close" /> : index + 1}</span>
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}
