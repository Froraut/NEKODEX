import { useRef, useState } from 'react';
import { Button, Dialog, Notice, TextField } from './design';
import { accountManagementCopy } from './account-management-copy';
import type { Language } from './types';

type Action = 'rename' | 'remove' | 'reauthenticate';
export function AccountCardManagement({ id, label, language, authenticated, manual, disabled, accessBlocked,
  removeReason, fallbackLabel, rename, remove, reauthenticate }: {
  id: string; label: string; language: Language; authenticated: boolean; manual: boolean;
  disabled: boolean; accessBlocked?: string; removeReason?: string; fallbackLabel?: string;
  rename: (label: string) => Promise<boolean>; remove: () => Promise<boolean>; reauthenticate: () => Promise<boolean>;
}) {
  const text = accountManagementCopy(language);
  const [action, setAction] = useState<Action | null>(null);
  const [name, setName] = useState(label);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const gate = useRef(false);
  const restoreFocus = () => trigger.current?.isConnected ? trigger.current
    : document.querySelector<HTMLElement>('.accounts-surface [data-account-id] button:not(:disabled), .nk-surface-header h1');
  const open = (next: Action, element: HTMLButtonElement) => {
    if (disabled || gate.current) return;
    trigger.current = element; setName(label); setError(null); setAction(next);
  };
  const close = () => { if (!gate.current) setAction(null); };
  const actionBlocked = action === 'remove' ? removeReason ?? accessBlocked
    : action === 'reauthenticate' ? accessBlocked ?? (manual ? text.manualReason : undefined) : undefined;
  const perform = async () => {
    if (!action || gate.current || disabled || actionBlocked) return;
    if (action === 'rename' && (!name.trim() || name.trim().length > 80 || name.trim() === label)) return;
    gate.current = true; setPending(true); setError(null);
    try {
      const ok = await (action === 'rename' ? rename(name.trim()) : action === 'remove' ? remove() : reauthenticate());
      if (ok) setAction(null); else setError(text.failed);
    } catch (cause) { setError(cause instanceof Error ? cause.message : text.failed); }
    finally { gate.current = false; setPending(false); }
  };
  const blocked = disabled || pending;
  return <>
    <Button size="sm" disabled={disabled} aria-label={`${text.rename} · ${label}`}
      onClick={event => open('rename', event.currentTarget)}>{text.rename}</Button>
    {authenticated ? <Button size="sm" disabled={disabled || !!accessBlocked || manual}
      title={accessBlocked ?? (manual ? text.manualReason : undefined)} aria-label={`${text.reauthenticate} · ${label}`}
      onClick={event => open('reauthenticate', event.currentTarget)}>{text.reauthenticate}</Button> : null}
    <span className="accounts-management-remove">
      <Button size="sm" variant="ghost" className="accounts-management-remove__entry" disabled={disabled || !!removeReason || !!accessBlocked}
        aria-label={`${text.remove} · ${label}`} title={removeReason ?? accessBlocked}
        onClick={event => open('remove', event.currentTarget)}>{text.remove}</Button>
      {removeReason ? <small className="field-hint">{removeReason}</small> : null}
    </span>
    {action ? <Dialog open title={action === 'rename' ? text.renameTitle : action === 'remove' ? text.removeTitle : text.reauthTitle}
      role={action === 'rename' ? 'dialog' : 'alertdialog'} onClose={close} restoreFocus={restoreFocus}
      actions={<>
        <Button data-autofocus={action !== 'rename' || undefined} disabled={pending} onClick={close}>{action === 'remove' ? text.keep : text.cancel}</Button>
        <Button variant={action === 'rename' ? 'primary' : 'danger'} busy={pending}
          disabled={blocked || !!actionBlocked || (action === 'rename' && (!name.trim() || name.trim().length > 80 || name.trim() === label))}
          onClick={() => void perform()}>{action === 'rename' ? text.save : action === 'remove' ? text.remove : text.reauthConfirm}</Button>
      </>}>
      <p><strong>{label}</strong></p>
      {action === 'rename' ? <form onSubmit={event => { event.preventDefault(); void perform(); }}>
        <TextField id={`account-rename-${id}`} label={text.name} data-autofocus autoComplete="off" maxLength={80}
          disabled={pending} value={name} onChange={event => setName(event.target.value)}
          hint={text.renameHint} error={!name.trim() || name.trim().length > 80 ? text.invalidName : undefined} />
      </form> : <>
        <p>{action === 'remove' ? text.removeBody : text.reauthBody}</p>
        {action === 'remove' ? <><p>{text.retained}</p>{fallbackLabel ? <Notice tone="info">{text.fallback.replace('{account}', fallbackLabel)}</Notice> : null}</> : null}
      </>}
      {actionBlocked ? <Notice tone="warning">{actionBlocked}</Notice> : null}
      {error ? <Notice tone="error" role="alert">{error}</Notice> : null}
    </Dialog> : null}
  </>;
}
