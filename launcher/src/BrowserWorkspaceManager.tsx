import { useFeatureAction } from "./useFeatureAction";
import { useState } from "react";
import type { BrowserWorkspaceDirectorySnapshot, BrowserWorkspaceItem, Language } from "./types";
import { browserWindowCopy } from "./browser-window-copy";
import { stripIpcErrorPrefix } from "./ipc-error";
import "./browser-workspace-manager.css";

type Props = {
  language: Language;
  snapshot: BrowserWorkspaceDirectorySnapshot;
  selectedAccountId?: string | null;
  disabled?: boolean;
  onOpen(accountId: string, asTab: boolean): Promise<unknown>;
  onRestore(accountId: string): Promise<unknown>;
  onFocus(accountId: string, workspaceId: string): Promise<unknown>;
  onClose(accountId: string, workspaceId: string): Promise<unknown>;
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

export function BrowserWorkspaceManager({
  language,
  snapshot,
  selectedAccountId,
  disabled = false,
  onOpen,
  onRestore,
  onFocus,
  onClose,
}: Props) {
  const copy = browserWindowCopy(language);
  const [error, setError] = useState<{ accountId: string; message: string } | null>(null);
  const { pending, run: runAction } = useFeatureAction<{ accountId: string; action: string }>(disabled, (cause, identity) => {
    setError({ accountId: identity.accountId, message: stripIpcErrorPrefix(cause instanceof Error ? cause.message : String(cause)) });
  });

  const account = snapshot.accounts.find(candidate => candidate.accountId === selectedAccountId);

  const run = (key: string, action: () => Promise<unknown>) => {
    if (!account) return;
    return runAction({ accountId: account.accountId, action: key }, async () => {
      setError(null);
      await action();
    });
  };

  if (!account) return null;
  const saved = account.items.filter(item => item.state === "saved").length;
  const open = account.items.filter(item => item.state === "open").length;
  const busy = disabled || pending !== null;
  const restoreVisible = saved > 0 || (account.manifestStatus === "uninitialized" && !account.restoreAttempted);
  const restoreBlocked = busy || snapshot.total >= snapshot.maximum || Boolean(account.sessionMutation)
    || (saved > 0 && !account.items.some(item => item.state === "saved" && item.restorable));

  return <details className="browser-workspace-manager">
    <summary>
      <span>{copy.windows}</span>{" "}
      <span className="browser-workspace-count">{copy.openCount(open)}{saved > 0 ? ` · ${copy.savedCount(saved)}` : ""}</span>
      {account.persistenceFailed || error?.accountId === account.accountId ? <span className="browser-workspace-error" role="status"
        aria-label={account.persistenceFailed ? copy.saveFailed : error?.message}
        title={account.persistenceFailed ? copy.saveFailed : error?.message}> !</span> : null}
    </summary>
    <div className="browser-workspace-content">
      <p className="browser-workspace-platform-note">{copy.scope}</p>
      <p className="browser-workspace-platform-note">{copy.totalCapacity(snapshot.total, snapshot.maximum)}</p>

      {error?.accountId === account.accountId ? <p className="browser-workspace-error" role="alert">{error.message}</p> : null}
      {account.persistenceFailed ? <p className="browser-workspace-error" role="status">{copy.saveFailed}</p> : null}
      {account.sessionMutation ? <p className="browser-workspace-platform-note" role="status">{copy.identityChanging}</p> : null}
      {!snapshot.nativeTabs ? <p className="browser-workspace-platform-note">{copy.tabsMacOnly}</p> : null}

      <div className="browser-workspace-manager-actions">
        <button type="button" className="button-secondary" disabled={busy || Boolean(account.sessionMutation) || snapshot.total >= snapshot.maximum}
          onClick={() => void run("new-window", () => onOpen(account.accountId, false))}>{copy.newWindow}</button>
        {snapshot.nativeTabs ? <button type="button" className="button-secondary" title={open === 0 ? copy.openFirst : undefined}
          disabled={busy || open === 0 || Boolean(account.sessionMutation) || snapshot.total >= snapshot.maximum}
          onClick={() => void run("new-tab", () => onOpen(account.accountId, true))}>{copy.newTab}</button> : null}
        {restoreVisible ? <button type="button" className="button-secondary" disabled={restoreBlocked}
          onClick={() => void run("restore", () => onRestore(account.accountId))}>{copy.restore}{saved > 0 ? ` (${saved})` : ""}</button> : null}
      </div>

      {account.restoreResult ? <div className="browser-workspace-restore-result" role="status">
        <span>{copy.restored(account.restoreResult.opened)}</span>
        {account.restoreResult.skippedTemporary > 0
          ? <span>{copy.skippedTemporary(account.restoreResult.skippedTemporary)}</span> : null}
        {account.restoreResult.skippedCapacity > 0
          ? <span>{copy.skippedCapacity(account.restoreResult.skippedCapacity)}</span> : null}
        {account.restoreResult.skippedIdentity > 0
          ? <span>{copy.skippedIdentity(account.restoreResult.skippedIdentity)}</span> : null}
      </div> : null}

      {account.items.length === 0 ? <p className="browser-workspace-empty">{copy.empty}</p> : <ul>
        {account.items.map(item => <li className={item.active ? "is-active" : undefined} key={item.id}>
          <button type="button" className="browser-workspace-open" disabled={busy || item.state !== "open"}
            onClick={() => void run(`focus-${item.id}`, () => onFocus(account.accountId, item.id))}>
            <span className="browser-workspace-item-title" title={item.title || locationLabel(item)}>{item.title || locationLabel(item)}</span>
            <span>{item.state === "open" ? copy.current : item.needsOriginalAccount
              ? copy.needsOriginalAccount : item.temporary ? copy.temporary : copy.saved}</span>
          </button>
          <button type="button" className="browser-workspace-close" disabled={busy}
            aria-label={`${item.state === "saved" ? copy.forget : copy.close}: ${item.title || locationLabel(item)}`}
            title={item.state === "saved" ? copy.forget : copy.close}
            onClick={() => void run(`close-${item.id}`, () => onClose(account.accountId, item.id))}>×</button>
        </li>)}
      </ul>}
      {snapshot.nativeTabs && open === 0 ? <p className="browser-workspace-platform-note">{copy.openFirst}</p> : null}
      {snapshot.nativeTabs && open > 0 ? <p className="browser-workspace-platform-note">{copy.hint}</p> : null}
      {account.items.some(item => item.temporary) ? <p className="browser-workspace-temporary-note">{copy.temporary}</p> : null}
    </div>
  </details>;
}
