import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../launcher-ui";
import { Button } from "./controls";
import { cx } from "./shared";
import { StateDot } from "./status";

export interface ToastProps {
  title: ReactNode;
  /** Detail; scrolls after 160px. */
  children?: ReactNode;
  /** error (default, role="alert") · success · busy (role="status"). */
  tone?: "error" | "success" | "busy";
  onDismiss?: () => void;
  /** Label of the dismiss button (pass localized copy; defaults to "Dismiss"). */
  dismissLabel?: string;
  /** Pins bottom-right above everything (position: fixed; render it outside container-query ancestors). */
  fixed?: boolean;
  className?: string;
}

export function Toast({ title, children, tone, onDismiss, dismissLabel, fixed, className }: ToastProps) {
  return (
    <div className={cx("nk-toast", fixed && "nk-toast--fixed", className)} role={tone === "error" || !tone ? "alert" : "status"}>
      <StateDot state={tone === "success" ? "ready" : tone === "busy" ? "busy" : "error"} />
      <span><strong>{title}</strong>{children ? <p>{children}</p> : null}</span>
      {onDismiss ? <Button onClick={onDismiss} size="sm" variant="ghost">{dismissLabel || "Dismiss"}</Button> : null}
    </div>
  );
}

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  eyebrow?: ReactNode;
  /** Footer buttons, primary last. Mark the default with data-autofocus (or data-modal-autofocus). */
  actions?: ReactNode;
  /** Escape and backdrop press call it; without it the dialog cannot be dismissed that way. */
  onClose?: () => void;
  /** Render inside a positioned parent (previews): no portal, no focus trap. */
  inline?: boolean;
  children?: ReactNode;
  className?: string;
}

const noop = () => {};

/**
 * Modal for a decision. Non-inline dialogs portal to <body>, trap focus, make the rest of the page inert and
 * restore focus on close (the app's useModalFocus).
 */
export function Dialog({ open, title, eyebrow, actions, onClose, inline = false, children, className }: DialogProps) {
  const box = useRef<HTMLElement>(null);
  const labelId = useId();
  const modal = open && !inline;
  // useModalFocus focuses [data-modal-autofocus]; the system marks the default action with data-autofocus.
  useLayoutEffect(() => {
    if (!modal) return;
    box.current?.querySelectorAll("[data-autofocus]").forEach(element => element.setAttribute("data-modal-autofocus", ""));
  }, [modal]);
  useModalFocus(modal, box, onClose ?? noop, { closeAllowed: Boolean(onClose) });
  useEffect(() => {
    if (!open || !inline || !onClose) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, inline, onClose]);
  if (!open) return null;
  const dialog = (
    <div
      className={cx("nk-dialog-backdrop", inline && "is-inline")}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}
    >
      <section aria-labelledby={labelId} aria-modal="true" className={cx("nk-dialog", className)} ref={box} role="dialog" tabIndex={-1}>
        <header>
          {eyebrow ? <small>{eyebrow}</small> : null}
          <h2 id={labelId}>{title}</h2>
        </header>
        <div className="nk-dialog__body">{children}</div>
        {actions ? <footer>{actions}</footer> : null}
      </section>
    </div>
  );
  return inline ? dialog : createPortal(dialog, document.body);
}
