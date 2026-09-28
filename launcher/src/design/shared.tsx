import { useState, type CSSProperties, type FocusEvent } from "react";
import { Icon, type IconName } from "../icons";

export type { IconName };
export type Status = "idle" | "ready" | "busy" | "error" | "optional";
export type Tone = "neutral" | "accent" | "success" | "warning" | "error" | "outline";

export function cx(...parts: Array<string | false | null | undefined | 0>) {
  return parts.filter(Boolean).join(" ");
}

/** The app's Icon with the system's class and default 16px box (contextual CSS resizes it). */
export function NkIcon({ name, size = 16 }: { name: IconName; size?: number }) {
  return <Icon className="nk-icon" focusable="false" name={name} size={size} />;
}

/** Custom properties in inline styles (e.g. --mark-size). */
export type StyleWithVars = CSSProperties & Record<`--${string}`, string | number>;

/**
 * Disabling the focused element makes Chromium drop keyboard focus to <body>. A kit control that becomes disabled
 * (or busy) while it has focus is therefore only aria-disabled — it keeps focus and ignores activation — and gets
 * the real disabled attribute once focus leaves. Controls that were not focused are disabled at once.
 *
 * `soft`: render aria-disabled and swallow activation. `disabled`: the value for the native attribute.
 * Spread `onFocus` / `onBlur` on the element (they call the caller's own handlers).
 */
export function useFocusSafeDisabled<T extends HTMLElement>(
  disabled: boolean,
  handlers: { onFocus?: (event: FocusEvent<T>) => void; onBlur?: (event: FocusEvent<T>) => void } = {},
) {
  const [focused, setFocused] = useState(false);
  return {
    soft: disabled && focused,
    disabled: disabled && !focused,
    onFocus(event: FocusEvent<T>) {
      setFocused(true);
      handlers.onFocus?.(event);
    },
    onBlur(event: FocusEvent<T>) {
      // A window blur leaves the element as document.activeElement: it still owns focus when the window returns.
      if (event.currentTarget !== document.activeElement) setFocused(false);
      handlers.onBlur?.(event);
    },
  };
}
