import type { HTMLAttributes, ReactNode, Ref } from "react";
import { NkIcon, cx, useFocusSafeDisabled, type IconName, type Status, type Tone } from "./shared";

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

export interface NoticeProps extends Omit<HTMLAttributes<HTMLElement>, "title" | "children"> {
  tone?: "info" | "success" | "warning" | "error";
  title?: ReactNode;
  meta?: ReactNode;
  /** One or more small Buttons; they sit right of the body and move under it when the notice is narrow. */
  action?: ReactNode;
  icon?: IconName;
  children?: ReactNode;
  className?: string;
  ref?: Ref<HTMLElement>;
}

/**
 * Inline message in a tinted panel. Errors are role="alert"; other tones role="status" (polite). Other DOM props
 * (data-*, aria-*, id, role, aria-live) go on the section and override those defaults.
 */
export function Notice({ tone = "info", title, meta, action, icon, children, className, ref, ...rest }: NoticeProps) {
  return (
    <section
      aria-live={tone === "error" ? undefined : "polite"}
      role={tone === "error" ? "alert" : "status"}
      {...rest}
      className={cx("nk-notice", tone !== "info" && `nk-notice--${tone}`, !title && !meta && "is-plain", className)}
      ref={ref}
    >
      <NkIcon name={icon || noticeIcon[tone]} />
      <div>
        {title ? <strong>{title}</strong> : null}
        {children ? <p>{children}</p> : null}
        {meta ? <small>{meta}</small> : null}
      </div>
      {action ? <div className="nk-notice__action">{action}</div> : null}
    </section>
  );
}

export interface ProgressMeterProps {
  /** 0..1; null or undefined renders the indeterminate bar (unless `unreported`). */
  value?: number | null;
  /** Visible label; also the progressbar's accessible name. */
  label?: string;
  /** Right-aligned figure ("42%"). */
  valueLabel?: ReactNode;
  /** aria-valuetext of the progressbar, when the figures say more than the percentage (e.g. "12.0 MiB / 80.0 MiB"). */
  valueText?: string;
  /**
   * Nothing was reported (not zero, not in progress). Shows this text in place of the value ("Not reported"; pass
   * `true` to keep valueLabel), leaves the track empty and exposes no progressbar, so nothing is announced as 0%.
   */
  unreported?: ReactNode;
  note?: ReactNode;
  tone?: "success" | "warning" | "error";
  className?: string;
}

export function ProgressMeter({ value, label, valueLabel, valueText, unreported, note, tone, className }: ProgressMeterProps) {
  const isUnreported = unreported != null && unreported !== false;
  const indeterminate = !isUnreported && value == null;
  const percent = isUnreported || value == null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  const figure = isUnreported && unreported !== true ? unreported : valueLabel;
  return (
    <div className={cx("nk-meter", indeterminate && "is-indeterminate", isUnreported && "is-unreported", tone && `nk-meter--${tone}`, className)}>
      {label || figure ? <div className="nk-meter__head"><span>{label}</span>{figure ? <strong>{figure}</strong> : null}</div> : null}
      {isUnreported ? <div aria-hidden="true" className="nk-meter__track" /> : (
        <div
          aria-label={label}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={indeterminate ? undefined : Math.round(percent)}
          aria-valuetext={valueText}
          className="nk-meter__track"
          role="progressbar"
        >
          <span className="nk-meter__fill" style={indeterminate ? undefined : { width: `${percent}%` }} />
        </div>
      )}
      {note ? <div className="nk-meter__foot">{note}</div> : null}
    </div>
  );
}

export interface PhaseStep {
  label: string;
  state?: "complete" | "current" | "upcoming" | "error";
  /** The step on screen (aria-current="step") when its state is not "current", e.g. a completed step revisited. */
  current?: boolean;
  /** With PhaseSteps onSelect: whether this step can be chosen (default: complete and error steps). */
  selectable?: boolean;
}

export interface PhaseStepsProps extends Omit<HTMLAttributes<HTMLOListElement>, "onSelect" | "children"> {
  steps: PhaseStep[];
  /** Accessible name of the list. */
  label?: string;
  /** Makes every step a button ("{n}. {label}"); selectable steps call onSelect(index), the others are disabled. */
  onSelect?: (index: number) => void;
  /** Disables every step button (e.g. while the flow is busy). */
  disabled?: boolean;
  className?: string;
}

export function PhaseSteps({ steps, label, onSelect, disabled = false, className, ...rest }: PhaseStepsProps) {
  return (
    <ol aria-label={label} {...rest} className={cx("nk-steps", className)}>
      {steps.map((step, index) => {
        const state = step.state || "upcoming";
        const current = step.current ?? state === "current";
        const marker = state === "complete" ? <NkIcon name="check" /> : state === "error" ? <NkIcon name="close" /> : index + 1;
        if (!onSelect) {
          return (
            <li aria-current={current ? "step" : undefined} className={`is-${state}`} key={index}>
              <span>{marker}</span>
              {step.label}
            </li>
          );
        }
        const selectable = step.selectable ?? (state === "complete" || state === "error");
        return (
          <li className={`is-${state}`} key={index}>
            <StepButton current={current} disabled={disabled || !selectable} label={`${index + 1}. ${step.label}`} onSelect={() => onSelect(index)}>
              <span aria-hidden="true">{marker}</span>
              {step.label}
            </StepButton>
          </li>
        );
      })}
    </ol>
  );
}

/** A PhaseSteps step button; one that is focused when the flow turns busy keeps focus (see useFocusSafeDisabled). */
function StepButton({ current, disabled, label, onSelect, children }: { current: boolean; disabled: boolean; label: string; onSelect: () => void; children: ReactNode }) {
  const guard = useFocusSafeDisabled<HTMLButtonElement>(disabled);
  return (
    <button
      aria-current={current ? "step" : undefined}
      aria-disabled={guard.soft ? "true" : undefined}
      aria-label={label}
      disabled={guard.disabled}
      onBlur={guard.onBlur}
      onClick={guard.soft ? event => event.preventDefault() : onSelect}
      onFocus={guard.onFocus}
      type="button"
    >
      {children}
    </button>
  );
}
