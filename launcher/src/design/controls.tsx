import { useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ChangeEvent, type InputHTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref, type SelectHTMLAttributes } from "react";
import { NkIcon, cx, useFocusSafeDisabled, type IconName, type Status } from "./shared";
import { StateDot } from "./status";

/** A focused control that became disabled keeps focus (aria-disabled) but must not act, like a disabled one. */
function blockActivation(event: MouseEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
}

/* ---------------- Actions ---------------- */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: one per view · secondary (default) · ghost · link · danger */
  variant?: "primary" | "secondary" | "ghost" | "link" | "danger";
  size?: "md" | "sm";
  icon?: IconName;
  iconEnd?: IconName;
  /**
   * Spinner, aria-busy="true" and disabled. A caller's own aria-busy is kept when busy is not set. A button that is
   * focused when it turns busy or disabled keeps focus (aria-disabled, clicks ignored) until focus leaves it.
   * The button keeps its width: the spinner takes the leading icon's place, or, when there is no icon and the label
   * stays the same, covers the label (still the accessible name). A caller that switches to a progress label
   * ("Checking…") gets the spinner beside it.
   */
  busy?: boolean;
  block?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = "secondary", size = "md", icon, iconEnd, busy, block, className, children, type, disabled, onClick, onFocus, onBlur, ...rest }: ButtonProps) {
  const guard = useFocusSafeDisabled(Boolean(disabled || busy), { onFocus, onBlur });
  // The label the button had before it turned busy (none when it mounted busy).
  const idleLabel = useRef<ReactNode>(busy ? undefined : children);
  if (!busy) idleLabel.current = children;
  const coverLabel = Boolean(busy) && !icon && typeof children === "string" && children === idleLabel.current;
  return (
    <button
      {...rest}
      aria-busy={busy ? "true" : rest["aria-busy"]}
      aria-disabled={guard.soft ? "true" : rest["aria-disabled"]}
      className={cx("nk-btn", `nk-btn--${variant}`, size === "sm" && "nk-btn--sm", block && "nk-btn--block", coverLabel && "is-busy-cover", className)}
      disabled={guard.disabled}
      onBlur={guard.onBlur}
      onClick={guard.soft ? blockActivation : onClick}
      onFocus={guard.onFocus}
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
  /** md: 32px (default) · sm: 24px with a 14px icon (e.g. closing a tab inside a 32px strip). */
  size?: "md" | "sm";
  buttonRef?: Ref<HTMLButtonElement>;
}

export function IconButton({ icon, label, size = "md", className, buttonRef, disabled, onClick, onFocus, onBlur, ...rest }: IconButtonProps) {
  const guard = useFocusSafeDisabled(Boolean(disabled), { onFocus, onBlur });
  return (
    <button
      aria-label={label}
      className={cx("nk-icon-btn", size === "sm" && "nk-icon-btn--sm", className)}
      ref={buttonRef}
      title={label}
      type="button"
      {...rest}
      aria-disabled={guard.soft ? "true" : rest["aria-disabled"]}
      disabled={guard.disabled}
      onBlur={guard.onBlur}
      onClick={guard.soft ? blockActivation : onClick}
      onFocus={guard.onFocus}
    >
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

export function TextField({ label, hint, error, action, id, type, className, disabled, readOnly, onFocus, onBlur, ...rest }: TextFieldProps) {
  const autoId = useId();
  const fieldId = id || autoId;
  const hintId = `${fieldId}-hint`;
  const guard = useFocusSafeDisabled(Boolean(disabled), { onFocus, onBlur });
  const input = (
    <input
      aria-describedby={error || hint ? hintId : undefined}
      aria-invalid={error ? "true" : undefined}
      className="nk-input"
      id={fieldId}
      type={type || "text"}
      {...rest}
      aria-disabled={guard.soft ? "true" : rest["aria-disabled"]}
      disabled={guard.disabled}
      onBlur={guard.onBlur}
      onFocus={guard.onFocus}
      readOnly={readOnly || guard.soft}
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

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "size"> {
  options: Array<string | SelectOption>;
  /** Accessible name when there is no visible label. */
  label?: string;
  onChange?: (value: string, event: ChangeEvent<HTMLSelectElement>) => void;
  /** md: 36px (default) · sm: 32px, level with small buttons in a dense bar. (Not the native list-box size.) */
  size?: "md" | "sm";
  ref?: Ref<HTMLSelectElement>;
}

export function Select({ options, className, label, onChange, size = "md", style, disabled, onFocus, onBlur, onKeyDown, onMouseDown, ...rest }: SelectProps) {
  const guard = useFocusSafeDisabled(Boolean(disabled), { onFocus, onBlur });
  return (
    <span className={cx("nk-select", size === "sm" && "nk-select--sm", className)} style={style}>
      <select
        aria-label={label}
        {...rest}
        aria-disabled={guard.soft ? "true" : rest["aria-disabled"]}
        disabled={guard.disabled}
        onBlur={guard.onBlur}
        // Soft-disabled: the list does not open and keys other than Tab do not change the value.
        onChange={onChange ? event => { if (!guard.soft) onChange(event.target.value, event); } : undefined}
        onFocus={guard.onFocus}
        onKeyDown={guard.soft ? event => { if (event.key !== "Tab") event.preventDefault(); } : onKeyDown}
        onMouseDown={guard.soft ? event => event.preventDefault() : onMouseDown}
      >
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
  /** The change is being saved: aria-busy, a pulsing thumb, and no further toggles (focus stays on the switch). */
  busy?: boolean;
  id?: string;
  className?: string;
}

export function Switch({ checked, defaultChecked, onChange, label, disabled, busy, id, className }: SwitchProps) {
  const controlled = checked !== undefined;
  const [inner, setInner] = useState(Boolean(defaultChecked));
  const on = controlled ? Boolean(checked) : inner;
  const guard = useFocusSafeDisabled<HTMLButtonElement>(Boolean(disabled || busy));
  return (
    <button
      aria-busy={busy ? "true" : undefined}
      aria-checked={on ? "true" : "false"}
      aria-disabled={guard.soft ? "true" : undefined}
      aria-label={label}
      className={cx("nk-switch", on && "is-on", className)}
      disabled={guard.disabled}
      id={id}
      onBlur={guard.onBlur}
      onClick={guard.soft ? blockActivation : () => {
        if (!controlled) setInner(!on);
        onChange?.(!on);
      }}
      onFocus={guard.onFocus}
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

export function Checkbox({ label, className, onChange, disabled, onClick, onFocus, onBlur, ...rest }: CheckboxProps) {
  const guard = useFocusSafeDisabled(Boolean(disabled), { onFocus, onBlur });
  return (
    <label className={cx("nk-check", className)}>
      <input
        type="checkbox"
        {...rest}
        aria-disabled={guard.soft ? "true" : rest["aria-disabled"]}
        disabled={guard.disabled}
        onBlur={guard.onBlur}
        onChange={onChange ? event => { if (!guard.soft) onChange(event.target.checked, event); } : undefined}
        // preventDefault on the click keeps the box as it was.
        onClick={guard.soft ? event => event.preventDefault() : onClick}
        onFocus={guard.onFocus}
      />
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
  /** Accessible name of the tab list. */
  label?: string;
  /** Tab element ids are `${idPrefix}-${tab.id}` (default: generated), e.g. for a TabPanel's labelledBy. */
  idPrefix?: string;
  /** id of the TabPanel that shows the active tab; the active tab points at it (aria-controls) while it exists. */
  panelId?: string;
  className?: string;
}

/**
 * Section tabs with a status line (ARIA tabs). Roving tabindex: Tab enters on the active tab; Left/Right/Home/End move
 * focus and select (selection follows focus). Put the active tab's content in a <TabPanel>.
 */
export function Tabs({ tabs, active, onSelect, label, idPrefix, panelId, className }: TabsProps) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const autoPrefix = useId();
  const prefix = idPrefix || `nk-tab${autoPrefix}`;
  const current = Math.max(0, tabs.findIndex(tab => tab.id === active));
  // aria-controls must name an element in the document; the panel is rendered by the page after the tabs.
  const [panelPresent, setPanelPresent] = useState(false);
  useLayoutEffect(() => {
    setPanelPresent(Boolean(panelId && document.getElementById(panelId)));
  });
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
    <div aria-label={label} className={cx("nk-tabs", className)} role="tablist">
      {tabs.map((tab, index) => (
        <button
          aria-controls={index === current && panelPresent ? panelId : undefined}
          aria-selected={index === current ? "true" : "false"}
          id={`${prefix}-${tab.id}`}
          key={tab.id}
          onClick={() => { if (tab.id !== active) onSelect?.(tab.id); }}
          onKeyDown={event => onKeyDown(event, index)}
          ref={element => { buttons.current[index] = element; }}
          role="tab"
          tabIndex={index === current ? 0 : -1}
          type="button"
        >
          <span>{tab.label}</span>
          {tab.status ? <small><StateDot state={tab.state || "idle"} />{tab.status}</small> : null}
        </button>
      ))}
    </div>
  );
}

/** The content of the active tab: role="tabpanel", labelled by its tab (`${idPrefix}-${activeTabId}`). */
export function TabPanel({ id, labelledBy, children, className }: { id: string; labelledBy: string; children?: ReactNode; className?: string }) {
  return <div aria-labelledby={labelledBy} className={className} id={id} role="tabpanel">{children}</div>;
}
