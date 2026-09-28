import { useFeatureAction } from "./useFeatureAction";
import { useId, useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { Button, Icon, IconButton, Notice, StateDot, useFocusSafeDisabled } from "./design";
import type { BrowserWorkspaceDirectorySnapshot, BrowserWorkspaceItem, Language } from "./types";
import { browserWindowCopy } from "./browser-window-copy";
import { stripIpcErrorPrefix } from "./ipc-error";

type Props = {
  language: Language;
  snapshot: BrowserWorkspaceDirectorySnapshot;
  selectedAccountId?: string | null;
  disabled?: boolean;
  onOpen(accountId: string, asTab: boolean): Promise<unknown>;
  onRestore(accountId: string): Promise<unknown>;
  onFocus(accountId: string, workspaceId: string): Promise<unknown>;
  onClose(accountId: string, workspaceId: string): Promise<unknown>;
  /** Controls that lead the bar's end group (the account selector). */
  children?: ReactNode;
};

function locationLabel(item: BrowserWorkspaceItem) {
  if (item.temporary) return "Temporary Chat";
  if (!item.location) return "ChatGPT";
  try {
    const location = new URL(item.location);
    return location.pathname === "/" ? "ChatGPT" : location.pathname;
  } catch {
    return "ChatGPT";
  }
}

/**
 * A row's "bring this window to the front" button. Activating it makes the whole directory busy; a native disabled
 * attribute on the focused button would drop keyboard focus to <body>, so, like the kit's controls, it stays
 * focusable (aria-disabled, activation ignored) while it has focus and is disabled once focus leaves.
 */
function ItemButton({ disabled, onActivate, children }: { disabled: boolean; onActivate(): void; children: ReactNode }) {
  const guard = useFocusSafeDisabled<HTMLButtonElement>(disabled);
  return <button type="button" className="browser-windows__item" aria-disabled={guard.soft ? "true" : undefined}
    disabled={guard.disabled} onFocus={guard.onFocus} onBlur={guard.onBlur}
    onClick={() => { if (!guard.soft) onActivate(); }}>{children}</button>;
}

/**
 * Separate ChatGPT windows for the selected account. Renders into the browser bar: the end group (children, the
 * always-visible "New window" button and the disclosure toggle), then the disclosure panel, which takes its own
 * full-width line under the bar.
 */
export function BrowserWorkspaceManager({
  language,
  snapshot,
  selectedAccountId,
  disabled = false,
  onOpen,
  onRestore,
  onFocus,
  onClose,
  children,
}: Props) {
  const copy = browserWindowCopy(language);
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<{ accountId: string; message: string } | null>(null);
  const { pending, run: runAction } = useFeatureAction<{ accountId: string; action: string }>(disabled, (cause, identity) => {
    setError({ accountId: identity.accountId, message: stripIpcErrorPrefix(cause instanceof Error ? cause.message : String(cause)) });
    // A failure started from the bar ("New window") must be seen: open the panel, whose error Notice explains it.
    setExpanded(true);
  });

  const account = snapshot.accounts.find(candidate => candidate.accountId === selectedAccountId);
  const busy = disabled || pending !== null;

  // When the focused panel control goes away (a closed or forgotten row, a Restore button that is no longer offered),
  // focus moves to the row now in that place, else the panel's first available action, else the toggle, once the
  // panel's controls are enabled again, instead of falling to <body>.
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef<{ element: HTMLElement; row: number | null } | null>(null);
  const rememberFocus = (event: FocusEvent<HTMLDivElement>) => {
    const element = event.target as HTMLElement;
    const row = element.closest<HTMLElement>(".browser-windows__list > li");
    lastFocused.current = { element, row: row && element.matches(".nk-icon-btn")
      ? Array.prototype.indexOf.call(row.parentElement!.children, row) : null };
  };
  useLayoutEffect(() => {
    const last = lastFocused.current;
    if (!last || last.element.isConnected) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) { lastFocused.current = null; return; }
    if (busy) return;
    lastFocused.current = null;
    const panel = panelRef.current;
    const rows = panel?.querySelectorAll<HTMLElement>(".browser-windows__list > li") ?? [];
    const row = last.row === null ? undefined : rows[Math.min(last.row, rows.length - 1)];
    const target = row?.querySelector<HTMLElement>(".nk-icon-btn:not(:disabled)")
      ?? (panel && !panel.hidden ? panel.querySelector<HTMLElement>(".browser-windows__actions > button:not(:disabled)") : null)
      ?? toggleRef.current;
    target?.focus();
  });

  const run = (key: string, action: () => Promise<unknown>) => {
    if (!account) return;
    return runAction({ accountId: account.accountId, action: key }, async () => {
      setError(null);
      await action();
    });
  };

  if (!account) return <div className="browser-bar__end">{children}</div>;
  const saved = account.items.filter(item => item.state === "saved").length;
  const open = account.items.filter(item => item.state === "open").length;
  const restoreVisible = saved > 0 || (account.manifestStatus === "uninitialized" && !account.restoreAttempted);
  const restoreBlocked = busy || snapshot.total >= snapshot.maximum || Boolean(account.sessionMutation)
    || (saved > 0 && !account.items.some(item => item.state === "saved" && item.restorable));
  const accountError = error?.accountId === account.accountId ? error : null;

  const newWindowBlocked = busy || Boolean(account.sessionMutation) || snapshot.total >= snapshot.maximum;
  const openNewWindow = () => void run("new-window", () => onOpen(account.accountId, false));
  return <>
    <div className="browser-bar__end">
      {children}
      {/* The visible label is the accessible name; the tooltip says where it opens. */}
      <Button size="sm" icon="plus" className="browser-windows__new" disabled={newWindowBlocked}
        title={copy.newWindow} onClick={openNewWindow}>{copy.newWindowShort}</Button>
      <Button variant="ghost" size="sm" iconEnd="chevron" className="browser-windows__toggle" title={copy.windows} ref={toggleRef}
        aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(value => !value)}>
        <span className="browser-windows__label">{copy.windows}</span>{" "}
        <span className="browser-windows__count">{copy.openCount(open)}{saved > 0 ? ` · ${copy.savedCount(saved)}` : ""}</span>
        {/* A secondary cue while the panel is closed; the panel's Notice carries the message (and role=alert). */}
        {account.persistenceFailed || accountError ? <span className="browser-windows__alert"
          title={account.persistenceFailed ? copy.saveFailed : accountError?.message}>
          <Icon name="alert" />
          <span className="nk-visually-hidden">{account.persistenceFailed ? copy.saveFailed : accountError?.message}</span>
        </span> : null}
      </Button>
    </div>
    <div className="browser-windows" id={panelId} hidden={!expanded} ref={panelRef} onFocus={rememberFocus}>
      <div className="browser-windows__notes">
        <p>{copy.scope}</p>
        <p className="browser-windows__capacity">{copy.totalCapacity(snapshot.total, snapshot.maximum)}</p>
      </div>

      {accountError ? <Notice tone="error">{accountError.message}</Notice> : null}
      {account.persistenceFailed ? <Notice tone="warning">{copy.saveFailed}</Notice> : null}
      {account.sessionMutation ? <p className="browser-windows__note" role="status"><StateDot state="busy" />{copy.identityChanging}</p> : null}
      {!snapshot.nativeTabs ? <p className="browser-windows__note">{copy.tabsMacOnly}</p> : null}

      <div className="browser-windows__actions">
        <Button size="sm" disabled={newWindowBlocked} onClick={openNewWindow}>{copy.newWindow}</Button>
        {snapshot.nativeTabs ? <Button size="sm" title={open === 0 ? copy.openFirst : undefined}
          disabled={busy || open === 0 || Boolean(account.sessionMutation) || snapshot.total >= snapshot.maximum}
          onClick={() => void run("new-tab", () => onOpen(account.accountId, true))}>{copy.newTab}</Button> : null}
        {restoreVisible ? <Button size="sm" disabled={restoreBlocked}
          onClick={() => void run("restore", () => onRestore(account.accountId))}>{copy.restore}{saved > 0 ? ` (${saved})` : ""}</Button> : null}
      </div>

      {account.restoreResult ? <div className="browser-windows__result" role="status">
        <span>{copy.restored(account.restoreResult.opened)}</span>
        {account.restoreResult.skippedTemporary > 0
          ? <span>{copy.skippedTemporary(account.restoreResult.skippedTemporary)}</span> : null}
        {account.restoreResult.skippedCapacity > 0
          ? <span>{copy.skippedCapacity(account.restoreResult.skippedCapacity)}</span> : null}
        {account.restoreResult.skippedIdentity > 0
          ? <span>{copy.skippedIdentity(account.restoreResult.skippedIdentity)}</span> : null}
      </div> : null}

      {account.items.length === 0 ? <p className="browser-windows__note">{copy.empty}</p> : <ul className="browser-windows__list">
        {account.items.map(item => <li className={item.active ? "is-active" : undefined} key={item.id}>
          <ItemButton disabled={busy || item.state !== "open"}
            onActivate={() => void run(`focus-${item.id}`, () => onFocus(account.accountId, item.id))}>
            <span className="browser-windows__item-title" title={item.title || locationLabel(item)}>{item.title || locationLabel(item)}</span>
            <span className="browser-windows__item-state">
              <StateDot state={item.state === "open" ? "ready" : "idle"} />
              {item.state === "open" ? copy.current : item.needsOriginalAccount
                ? copy.needsOriginalAccount : item.temporary ? copy.temporary : copy.saved}
            </span>
          </ItemButton>
          <IconButton icon="close" disabled={busy}
            label={`${item.state === "saved" ? copy.forget : copy.close}: ${item.title || locationLabel(item)}`}
            title={item.state === "saved" ? copy.forget : copy.close}
            onClick={() => void run(`close-${item.id}`, () => onClose(account.accountId, item.id))} />
        </li>)}
      </ul>}
      <div className="browser-windows__footnotes">
        {snapshot.nativeTabs && open === 0 ? <p className="browser-windows__note">{copy.openFirst}</p> : null}
        {snapshot.nativeTabs && open > 0 ? <p className="browser-windows__note">{copy.hint}</p> : null}
        {/* A saved Temporary Chat row already says this; an open one shows "Open now", so the note says it here. */}
        {account.items.some(item => item.temporary && item.state === "open")
          ? <p className="browser-windows__note">{copy.temporary}</p> : null}
      </div>
    </div>
  </>;
}
