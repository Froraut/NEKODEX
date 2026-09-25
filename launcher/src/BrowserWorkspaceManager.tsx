import { useFeatureAction } from "./useFeatureAction";
import { useEffect, useMemo, useState } from "react";
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
  const initial = selectedAccountId && snapshot.accounts.some(account => account.accountId === selectedAccountId)
    ? selectedAccountId : snapshot.accounts[0]?.accountId ?? "";
  const [accountId, setAccountId] = useState(initial);
  const [error, setError] = useState<{ accountId: string; message: string } | null>(null);
  const { pending, run: runAction } = useFeatureAction<{ accountId: string; action: string }>(disabled, (cause, identity) => {
    setError({ accountId: identity.accountId, message: stripIpcErrorPrefix(cause instanceof Error ? cause.message : String(cause)) });
  });

  useEffect(() => {
    if (!snapshot.accounts.some(account => account.accountId === accountId)) setAccountId(initial);
  }, [accountId, initial, snapshot.accounts]);

  const account = useMemo(
    () => snapshot.accounts.find(candidate => candidate.accountId === accountId) ?? snapshot.accounts[0] ?? null,
    [accountId, snapshot.accounts],
  );

  const run = (key: string, action: () => Promise<unknown>) => {
    if (!account) return;
    return runAction({ accountId: account.accountId, action: key }, async () => {
      setError(null);
      await action();
    });
  };

  if (!account) return null;
  const saved = account.items.filter(item => item.state === "saved").length;
  const busy = disabled || pending !== null;
  const restoreVisible = saved > 0 || (account.manifestStatus === "uninitialized" && !account.restoreAttempted);
  const restoreBlocked = busy || snapshot.total >= snapshot.maximum || Boolean(account.sessionMutation)
    || (saved > 0 && !account.items.some(item => item.state === "saved" && item.restorable));

  return <section className="browser-workspace-manager" aria-labelledby="browser-workspace-title">
    <div className="browser-workspace-manager-heading">
      <div>
        <h3 id="browser-workspace-title">{copy.windows}</h3>
        <p>{snapshot.total} / {snapshot.maximum}</p>
      </div>
      <label>
        <span>{copy.account}</span>
        <select className="settings-select" value={account.accountId} disabled={busy} onChange={event => setAccountId(event.target.value)}>
          {snapshot.accounts.map(candidate => <option value={candidate.accountId} key={candidate.accountId}>{candidate.label}</option>)}
        </select>
      </label>
    </div>

    {error?.accountId === account.accountId ? <p className="browser-workspace-error" role="alert">{error.message}</p> : null}
    {account.persistenceFailed ? <p className="browser-workspace-error" role="status">{copy.saveFailed}</p> : null}
    {account.sessionMutation ? <p className="browser-workspace-platform-note" role="status">{copy.identityChanging}</p> : null}
    {!snapshot.nativeTabs ? <p className="browser-workspace-platform-note">{copy.tabsMacOnly}</p> : null}

    <div className="browser-workspace-manager-actions">
      <button type="button" className="button-secondary" disabled={busy || snapshot.total >= snapshot.maximum}
        onClick={() => void run("new-window", () => onOpen(account.accountId, false))}>{copy.newWindow}</button>
      {snapshot.nativeTabs ? <button type="button" className="button-secondary" disabled={busy || snapshot.total >= snapshot.maximum}
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
          <span className="browser-workspace-item-title">{item.title || locationLabel(item)}</span>
          <span>{item.state === "open" ? copy.current : item.needsOriginalAccount
            ? copy.needsOriginalAccount : item.temporary ? copy.temporary : copy.saved}</span>
        </button>
        <button type="button" className="browser-workspace-close" disabled={busy}
          aria-label={`${copy.close}: ${item.title || locationLabel(item)}`}
          onClick={() => void run(`close-${item.id}`, () => onClose(account.accountId, item.id))}>×</button>
      </li>)}
    </ul>}
    <p className="browser-workspace-temporary-note">{copy.temporary}</p>
  </section>;
}
