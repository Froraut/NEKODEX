import { useEffect, useRef, type RefObject } from "react";

/** Where focus goes when a modal closes: a ref, or a function evaluated when focus is restored. */
export type FocusRestoreTarget = RefObject<HTMLElement | null> | (() => HTMLElement | null | undefined);

export interface ModalFocusOptions {
  /** false ignores Escape (e.g. while the modal's action runs). Default true. */
  closeAllowed?: boolean;
  /**
   * Preferred focus target after closing. It is resolved one frame after the modal unmounts, so a function can
   * look at the page as it is then. Falls back to the element focused before opening, then the current nav item.
   */
  restoreFocus?: FocusRestoreTarget;
}

/** The toast stack (design/overlays) stays usable above a modal: it is not made inert and joins the Tab cycle. */
const TOAST_STACK = ".nk-toast-stack";

const usable = (element: HTMLElement | null | undefined): element is HTMLElement =>
  Boolean(element?.isConnected && !element.closest("[inert]") && !element.matches(":disabled"));

/**
 * Moves focus to the first usable candidate (connected, not inert, not disabled); without one, to the open modal,
 * then the current nav item, then the page heading. For focus that would otherwise fall to <body> because the
 * focused element went away (a dismissed toast, a closed overlay).
 */
export function focusFirstUsable(...candidates: Array<HTMLElement | null | undefined>) {
  const target = candidates.find(usable)
    ?? [
      document.querySelector<HTMLElement>('[aria-modal="true"]'),
      document.querySelector<HTMLElement>('.nk-nav-item[aria-current="page"]'),
      document.querySelector<HTMLElement>("main h1"),
    ].find(usable);
  if (!target) return;
  if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus();
}

/**
 * Modal focus handling shared by the kit Dialog and the app's own overlays: the rest of the page is made inert,
 * Tab and Shift+Tab stay inside, the first focus goes to [data-modal-autofocus] (else the first control),
 * Escape calls onClose, and focus is restored on close. A toast raised while the modal is open stays reachable:
 * Tab moves from the modal's last control to the toast and back to the modal's first control.
 */
export function useModalFocus(
  active: boolean,
  container: RefObject<HTMLElement | null>,
  onClose: () => void,
  { closeAllowed = true, restoreFocus }: ModalFocusOptions = {},
) {
  const close = useRef(onClose);
  const canClose = useRef(closeAllowed);
  const restoreTarget = useRef(restoreFocus);
  close.current = onClose;
  canClose.current = closeAllowed;
  restoreTarget.current = restoreFocus;
  useEffect(() => {
    if (!active || !container.current) return;
    const modal = container.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inerted = new Map<HTMLElement, boolean>();
    let branch: HTMLElement = modal;
    let parent = branch.parentElement;
    while (parent) {
      for (const element of parent.children) {
        if (element instanceof HTMLElement && element !== branch && !inerted.has(element) && !element.matches(TOAST_STACK)) {
          inerted.set(element, element.inert);
          element.inert = true;
        }
      }
      if (parent === document.body) break;
      branch = parent;
      parent = branch.parentElement;
    }
    const visible = (element: HTMLElement) => {
      if (element.hidden || element.closest("[inert]")) return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const selector = 'button:not(:disabled), select:not(:disabled), input:not(:disabled), video[controls], [href], [tabindex]:not([tabindex="-1"])';
    const focusable = () => [...modal.querySelectorAll<HTMLElement>(selector)].filter(visible);
    const toastControls = () => [...(document.querySelector(TOAST_STACK)?.querySelectorAll<HTMLElement>(selector) ?? [])].filter(visible);
    const inToasts = (node: Node | null) => Boolean(node && document.querySelector(TOAST_STACK)?.contains(node));
    const focusFirst = () => {
      const preferred = modal.querySelector<HTMLElement>("[data-modal-autofocus]");
      (preferred && visible(preferred) && !preferred.matches(":disabled") ? preferred : focusable()[0] ?? modal).focus();
    };
    const frame = requestAnimationFrame(focusFirst);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (canClose.current) close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      const toasts = toastControls();
      const current = document.activeElement;
      if (!controls.length && !toasts.length) { event.preventDefault(); modal.focus(); return; }
      const move = (target: HTMLElement | undefined) => { if (target) { event.preventDefault(); target.focus(); } };
      if (current instanceof Node && inToasts(current)) {
        if (!event.shiftKey && current === toasts.at(-1)) move(controls[0] ?? toasts[0]);
        else if (event.shiftKey && current === toasts[0]) move(controls.at(-1) ?? toasts.at(-1));
        return;
      }
      if (!controls.length) { move(toasts[0]); return; }
      if (event.shiftKey && current === controls[0]) move(toasts.at(-1) ?? controls.at(-1));
      else if (!event.shiftKey && current === controls.at(-1)) move(toasts[0] ?? controls[0]);
    };
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof Node && (modal.contains(event.target) || inToasts(event.target))) return;
      event.stopPropagation();
      focusFirst();
    };
    // The focused control went away or was disabled: focus falls to <body>, outside the trap. Bring it back to the
    // modal. (A window blur keeps the element as activeElement, so it is left alone.)
    let dropCheck = 0;
    const focusout = (event: FocusEvent) => {
      if (event.relatedTarget || !(event.target instanceof Node) || !(modal.contains(event.target) || inToasts(event.target))) return;
      cancelAnimationFrame(dropCheck);
      dropCheck = requestAnimationFrame(() => {
        const current = document.activeElement;
        if (modal.isConnected && (!current || current === document.body)) modal.focus();
      });
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin, true);
    document.addEventListener("focusout", focusout, true);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(dropCheck);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin, true);
      document.removeEventListener("focusout", focusout, true);
      for (const [element, inert] of inerted) element.inert = inert;
      requestAnimationFrame(() => {
        const preferred = restoreTarget.current;
        const target = [typeof preferred === "function" ? preferred() : preferred?.current, previous].find(usable)
          ?? document.querySelector<HTMLElement>('.nk-nav-item[aria-current="page"]:not(:disabled)');
        target?.focus();
      });
    };
  }, [active, container]);
}
