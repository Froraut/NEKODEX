import { useFeatureAction } from "./useFeatureAction";
import { useId, useState, type ReactNode } from "react";
import { Button, Icon, IconButton, Notice, StateDot } from "./design";
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
  const busy = disabled || pending !== null;
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
      <Button variant="ghost" size="sm" iconEnd="chevron" className="browser-windows__toggle" title={copy.windows}
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
    <div className="browser-windows" id={panelId} hidden={!expanded}>
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
        {account.items.map((item, index) => <li className={item.active ? "is-active" : undefined} key={item.id} data-window-row={index}>
          <button type="button" className="browser-windows__item" disabled={busy || item.state !== "open"}
            onClick={() => void run(`focus-${item.id}`, () => onFocus(account.accountId, item.id))}>
            <span className="browser-windows__item-title" title={item.title || locationLabel(item)}>{item.title || locationLabel(item)}</span>
            <span className="browser-windows__item-state">
              <StateDot state={item.state === "open" ? "ready" : "idle"} />
              {item.state === "open" ? copy.current : item.needsOriginalAccount
                ? copy.needsOriginalAccount : item.temporary ? copy.temporary : copy.saved}
            </span>
          </button>
          <IconButton icon="close" disabled={busy}
            label={`${item.state === "saved" ? copy.forget : copy.close}: ${item.title || locationLabel(item)}`}
            title={item.state === "saved" ? copy.forget : copy.close}
            onClick={() => void run(`close-${item.id}`, () => onClose(account.accountId, item.id))} />
        </li>)}
      </ul>}
      <div className="browser-windows__footnotes">
        {snapshot.nativeTabs && open === 0 ? <p className="browser-windows__note">{copy.openFirst}</p> : null}
        {snapshot.nativeTabs && open > 0 ? <p className="browser-windows__note">{copy.hint}</p> : null}
        {account.items.some(item => item.temporary) ? <p className="browser-windows__note">{copy.temporary}</p> : null}
      </div>
    </div>
  </>;
}
