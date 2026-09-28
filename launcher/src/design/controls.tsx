import { useId, useRef, useState, type ButtonHTMLAttributes, type ChangeEvent, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref, type SelectHTMLAttributes } from "react";
import { NkIcon, cx, type IconName, type Status } from "./shared";
import { StateDot } from "./status";

/* ---------------- Actions ---------------- */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: one per view · secondary (default) · ghost · link · danger */
  variant?: "primary" | "secondary" | "ghost" | "link" | "danger";
  size?: "md" | "sm";
  icon?: IconName;
  iconEnd?: IconName;
  busy?: boolean;
  block?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = "secondary", size = "md", icon, iconEnd, busy, block, className, children, type, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      aria-busy={busy ? "true" : undefined}
      className={cx("nk-btn", `nk-btn--${variant}`, size === "sm" && "nk-btn--sm", block && "nk-btn--block", className)}
      disabled={disabled || busy}
      type={type || "button"}
    >
      {busy ? <span aria-hidden="true" className="nk-spinner" /> : icon ? <NkIcon name={icon} /> : null}
      {children != null ? <span>{children}</span> : null}
      {iconEnd ? <NkIcon name={iconEnd} /> : null}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** Required: becomes aria-label and the tooltip. */
  label: string;
  buttonRef?: Ref<HTMLButtonElement>;
}

export function IconButton({ icon, label, className, buttonRef, ...rest }: IconButtonProps) {
  return (
    <button aria-label={label} className={cx("nk-icon-btn", className)} ref={buttonRef} title={label} type="button" {...rest}>
      <NkIcon name={icon} />
    </button>
  );
}

/* ---------------- Forms ---------------- */

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  /** Sets aria-invalid and replaces the hint. */
  error?: string;
  /** A control on the same row as the input (e.g. an "Add" Button). */
  action?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ label, hint, error, action, id, type, className, ...rest }: TextFieldProps) {
  const autoId = useId();
  const fieldId = id || autoId;
  const hintId = `${fieldId}-hint`;
  const input = (
    <input
      aria-describedby={error || hint ? hintId : undefined}
      aria-invalid={error ? "true" : undefined}
      className="nk-input"
      id={fieldId}
      type={type || "text"}
      {...rest}
    />
  );
  return (
    <div className={cx("nk-field", className)}>
      {label ? <label htmlFor={fieldId}>{label}</label> : null}
      {action ? <div className="nk-field__row">{input}{action}</div> : input}
      {error ? <p className="nk-field__error" id={hintId}>{error}</p>
        : hint ? <p className="nk-field__hint" id={hintId}>{hint}</p> : null}
    </div>
  );
}

export interface SelectOption { value: string; label: string; disabled?: boolean }

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  options: Array<string | SelectOption>;
  /** Accessible name when there is no visible label. */
  label?: string;
  onChange?: (value: string, event: ChangeEvent<HTMLSelectElement>) => void;
  ref?: Ref<HTMLSelectElement>;
}

export function Select({ options, className, label, onChange, style, ...rest }: SelectProps) {
  return (
    <span className={cx("nk-select", className)} style={style}>
      <select aria-label={label} onChange={onChange ? event => onChange(event.target.value, event) : undefined} {...rest}>
        {options.map(option => {
          const item = typeof option === "string" ? { value: option, label: option } : option;
          return <option disabled={item.disabled} key={item.value} value={item.value}>{item.label}</option>;
        })}
      </select>
      <NkIcon name="chevron" />
    </span>
  );
}

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  /** Required accessible name. */
  label: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Switch({ checked, defaultChecked, onChange, label, disabled, id, className }: SwitchProps) {
  const controlled = checked !== undefined;
  const [inner, setInner] = useState(Boolean(defaultChecked));
  const on = controlled ? Boolean(checked) : inner;
  return (
    <button
      aria-checked={on ? "true" : "false"}
      aria-label={label}
      className={cx("nk-switch", on && "is-on", className)}
      disabled={disabled}
      id={id}
      onClick={() => {
        if (!controlled) setInner(!on);
        onChange?.(!on);
      }}
      role="switch"
      type="button"
    >
      <span />
    </button>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label: ReactNode;
  onChange?: (checked: boolean, event: ChangeEvent<HTMLInputElement>) => void;
  ref?: Ref<HTMLInputElement>;
}

export function Checkbox({ label, className, onChange, ...rest }: CheckboxProps) {
  return (
    <label className={cx("nk-check", className)}>
      <input type="checkbox" onChange={onChange ? event => onChange(event.target.checked, event) : undefined} {...rest} />
      <span>{label}</span>
    </label>
  );
}

/* ---------------- Tabs ---------------- */

export interface TabItem { id: string; label: string; status?: string; state?: Status }

export interface TabsProps {
  tabs: TabItem[];
  active: string;
  onSelect?: (id: string) => void;
  /** Accessible name of the nav. */
  label?: string;
  className?: string;
}

/** Section tabs with a status line. Roving tabindex: Tab enters on the active tab; Left/Right/Home/End move and select. */
export function Tabs({ tabs, active, onSelect, label, className }: TabsProps) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(0, tabs.findIndex(tab => tab.id === active));
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    buttons.current[next]?.focus();
    if (tabs[next] && tabs[next].id !== active) onSelect?.(tabs[next].id);
  };
  return (
    <nav aria-label={label} className={cx("nk-tabs", className)}>
      {tabs.map((tab, index) => (
        <button
          aria-current={tab.id === active ? "page" : undefined}
          key={tab.id}
          onClick={() => onSelect?.(tab.id)}
          onKeyDown={event => onKeyDown(event, index)}
          ref={element => { buttons.current[index] = element; }}
          tabIndex={index === current ? 0 : -1}
          type="button"
        >
          <span>{tab.label}</span>
          {tab.status ? <small><StateDot state={tab.state || "idle"} />{tab.status}</small> : null}
        </button>
      ))}
    </nav>
  );
}
