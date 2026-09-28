import { useEffect, useId, useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalFocus, type FocusRestoreTarget } from "../modal-focus";
import { Button } from "./controls";
import { cx } from "./shared";
import { StateDot } from "./status";

interface ToastBaseProps {
  title: ReactNode;
  /** Detail; scrolls after 160px. */
  children?: ReactNode;
  /** error (default, role="alert") · success · busy (role="status"). */
  tone?: "error" | "success" | "busy";
  /**
   * Pins it bottom-right above the page: it portals into the shared toast stack on <body>, so several fixed
   * toasts stack upwards with a gap instead of covering each other (newest at the bottom).
   */
  fixed?: boolean;
  className?: string;
}

/** A dismiss button needs its localized label. */
export type ToastProps = ToastBaseProps & (
  | { onDismiss: () => void; dismissLabel: string }
  | { onDismiss?: undefined; dismissLabel?: string }
);

let toastStackElement: HTMLElement | null = null;

/** The one bottom-right viewport that fixed toasts portal into (created on first use). */
function toastStack(): HTMLElement {
  if (!toastStackElement?.isConnected) {
    toastStackElement = document.createElement("div");
    toastStackElement.className = "nk-toast-stack";
    document.body.append(toastStackElement);
  }
  return toastStackElement;
}

export function Toast({ title, children, tone, onDismiss, dismissLabel, fixed, className }: ToastProps) {
  const toast = (
    <div className={cx("nk-toast", fixed && "nk-toast--fixed", className)} role={tone === "error" || !tone ? "alert" : "status"}>
      <StateDot state={tone === "success" ? "ready" : tone === "busy" ? "busy" : "error"} />
      <span><strong>{title}</strong>{children ? <p>{children}</p> : null}</span>
      {onDismiss ? <Button onClick={onDismiss} size="sm" variant="ghost">{dismissLabel}</Button> : null}
    </div>
  );
  return fixed && typeof document !== "undefined" ? createPortal(toast, toastStack()) : toast;
}

export interface DialogProps extends Omit<HTMLAttributes<HTMLElement>, "title" | "role" | "children"> {
  open: boolean;
  title: ReactNode;
  eyebrow?: ReactNode;
  /** Footer buttons, primary last. Mark the default with data-autofocus (or data-modal-autofocus). */
  actions?: ReactNode;
  /** Escape and backdrop press call it; without it the dialog cannot be dismissed that way. */
  onClose?: () => void;
  /** "alertdialog" for a confirmation that interrupts (describe it with aria-describedby). Default "dialog". */
  role?: "dialog" | "alertdialog";
  /**
   * Where focus goes on close: a ref, or a function called then (one frame after closing). Unusable targets
   * (gone, disabled, inert) fall back to the element focused before opening, then the current nav item.
   */
  restoreFocus?: FocusRestoreTarget;
  /** Render inside a positioned parent (previews): no portal, no focus trap. */
  inline?: boolean;
  children?: ReactNode;
  className?: string;
}

const noop = () => {};

/**
 * Modal for a decision. Non-inline dialogs portal to <body>, trap focus, make the rest of the page inert and
 * restore focus on close (useModalFocus). Other DOM props (aria-describedby, data-*, id) go on the dialog element.
 */
export function Dialog({ open, title, eyebrow, actions, onClose, role = "dialog", restoreFocus, inline = false, children, className, ...rest }: DialogProps) {
  const box = useRef<HTMLElement>(null);
  const labelId = useId();
  const modal = open && !inline;
  // useModalFocus focuses [data-modal-autofocus]; the system marks the default action with data-autofocus.
  useLayoutEffect(() => {
    if (!modal) return;
    box.current?.querySelectorAll("[data-autofocus]").forEach(element => element.setAttribute("data-modal-autofocus", ""));
  }, [modal]);
  useModalFocus(modal, box, onClose ?? noop, { closeAllowed: Boolean(onClose), restoreFocus });
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
      <section aria-labelledby={labelId} aria-modal="true" {...rest} className={cx("nk-dialog", className)} ref={box} role={role} tabIndex={-1}>
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
