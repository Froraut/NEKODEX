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

const usable = (element: HTMLElement | null | undefined): element is HTMLElement =>
  Boolean(element?.isConnected && !element.closest("[inert]") && !element.matches(":disabled"));

/**
 * Modal focus handling shared by the kit Dialog and the app's own overlays: the rest of the page is made inert,
 * Tab and Shift+Tab stay inside, the first focus goes to [data-modal-autofocus] (else the first control),
 * Escape calls onClose, and focus is restored on close.
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
        if (element instanceof HTMLElement && element !== branch && !inerted.has(element)) {
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
    const focusable = () => [...modal.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), video[controls], [href], [tabindex]:not([tabindex="-1"])')].filter(visible);
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
      if (!controls.length) { event.preventDefault(); modal.focus(); return; }
      const first = controls[0]!;
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof Node && modal.contains(event.target)) return;
      event.stopPropagation();
      focusFirst();
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin, true);
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
