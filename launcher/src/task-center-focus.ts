import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Keyboard focus for lists whose rows and row actions come and go (Task center queue and recorded tasks).
 * Rows carry `data-focus-row` (a stable key); row controls may carry `data-action`.
 *
 * When the focused row control is removed or replaced (its row was dismissed, the action no longer applies,
 * or the row was re-ordered), focus moves to the same row's matching or first control, then to the row that took
 * its place, then the row before it, and finally to `fallback`. A control that is still mounted but disabled is left
 * alone: the kit keeps focus on controls that turn disabled or busy.
 */
export interface RowFocusMemory { element: HTMLElement; row: string; action: string | null; index: number }

const ROW = "[data-focus-row]";
const CONTROL = "button, select, input, textarea, a[href]";

const blocked = (element: Element) => (element as HTMLButtonElement).disabled === true || element.getAttribute("aria-disabled") === "true";
const usable = (element: HTMLElement) => element.isConnected && !blocked(element) && !element.closest("[inert]") && element.getClientRects().length > 0;

export function rowFocusMemory(root: HTMLElement | null, element: HTMLElement | null): RowFocusMemory | null {
  const row = element && root?.contains(element) ? element.closest<HTMLElement>(ROW) : null;
  if (!root || !element || !row || !root.contains(row)) return null;
  return { element, row: row.dataset.focusRow ?? "", action: element.dataset.action ?? null,
    index: [...root.querySelectorAll<HTMLElement>(ROW)].indexOf(row) };
}

/** The control to continue from, or null when no row offers a usable one. */
export function rowFocusTarget(root: HTMLElement | null, memory: RowFocusMemory): HTMLElement | null {
  if (usable(memory.element) && root?.contains(memory.element)) return memory.element;
  if (!root) return null;
  const rows = [...root.querySelectorAll<HTMLElement>(ROW)];
  const same = rows.findIndex(row => row.dataset.focusRow === memory.row);
  const order = same >= 0 ? [rows[same], rows[same + 1], rows[same - 1]] : [rows[memory.index], rows[memory.index - 1]];
  for (const row of order) {
    if (!row) continue;
    const controls = [...row.querySelectorAll<HTMLElement>(CONTROL)].filter(usable);
    const match = memory.action ? controls.find(control => control.dataset.action === memory.action) : undefined;
    if (match ?? controls[0]) return match ?? controls[0];
  }
  return null;
}

export function useRowFocusRecovery(list: RefObject<HTMLElement | null>, { busy, fallback }: { busy: boolean; fallback: () => HTMLElement | null }) {
  const memory = useRef<RowFocusMemory | null>(null);
  useEffect(() => {
    // Remember the row control that has focus; focus anywhere else (another control, a dialog) clears it.
    const remember = (event: FocusEvent) => {
      memory.current = event.target instanceof HTMLElement ? rowFocusMemory(list.current, event.target) : null;
    };
    // A pointer press elsewhere is the user moving on, not focus lost to a re-render.
    const forget = (event: PointerEvent) => {
      if (memory.current && !(event.target instanceof Node && memory.current.element.contains(event.target))) memory.current = null;
    };
    document.addEventListener("focusin", remember);
    document.addEventListener("pointerdown", forget, true);
    return () => {
      document.removeEventListener("focusin", remember);
      document.removeEventListener("pointerdown", forget, true);
    };
  }, [list]);

  useLayoutEffect(() => {
    const current = memory.current;
    if (!current) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) return;
    if (current.element.isConnected && blocked(current.element)) return;
    const target = rowFocusTarget(list.current, current);
    if (target) { target.focus(); return; }
    // While the action runs every row control is disabled; try again once it settles.
    if (busy && list.current?.querySelector(ROW)) return;
    memory.current = null;
    fallback()?.focus();
  });
}

/** A region heading that can take focus when the list under it empties. */
export function focusableHeading(id: string): HTMLElement | null {
  const heading = document.getElementById(id);
  if (heading && !heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
  return heading;
}
