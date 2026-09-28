import { Button, Dialog, type FocusRestoreTarget } from './design';
import type { TaskCenterCopy } from './task-center-copy';
import type { TaskConfirmationTarget } from './task-center-model';

/**
 * Cancel/dismiss confirmation as the kit Dialog: an alertdialog described by its warning. It traps focus, focuses
 * the safe "keep" action first and on close returns focus to `restoreFocus` (TaskCenter: the row control that
 * opened it, or the search field when that control is gone).
 */
export function TaskActionConfirmation({ kind, copy, descriptionId, accountName, traceId, disabled, pending, onKeep, onConfirm, canEscape, restoreFocus }: {
  kind: TaskConfirmationTarget['kind']; copy: TaskCenterCopy; descriptionId: string;
  accountName: string; traceId: string;
  disabled: boolean; pending: boolean;
  onKeep: () => void; onConfirm: () => void; canEscape: () => boolean;
  restoreFocus?: FocusRestoreTarget;
}) {
  const cancel = kind === 'cancel';
  return <Dialog open role="alertdialog" aria-describedby={descriptionId} restoreFocus={restoreFocus}
    className="task-confirm" eyebrow={accountName} title={cancel ? copy.cancel : copy.dismiss}
    onClose={() => { if (canEscape()) onKeep(); }}
    actions={<>
      <Button variant="ghost" data-autofocus disabled={pending} onClick={onKeep}>{cancel ? copy.keepWorking : copy.keepRecord}</Button>
      <Button variant="danger" busy={pending} disabled={disabled} onClick={onConfirm}>{cancel ? copy.cancel : copy.confirmDismiss}</Button>
    </>}>
    <p id={descriptionId}>{cancel ? copy.cancelWarning : copy.dismissWarning}</p>
    <p className="task-confirm__trace"><code>{traceId}</code></p>
  </Dialog>;
}
