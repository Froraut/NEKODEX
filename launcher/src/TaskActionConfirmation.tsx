import { Button, Dialog, Notice, type FocusRestoreTarget } from './design';
import type { TaskCenterCopy } from './task-center-copy';
import type { TaskConfirmationTarget } from './task-center-model';

/**
 * Cancel/dismiss confirmation as the kit Dialog: an alertdialog whose title asks the question and whose body gives the
 * consequence. It traps focus, focuses the safe "keep" action first and on close returns focus to `restoreFocus`
 * (TaskCenter: the row control that opened it, a neighbouring row, or the search field). A failed confirm is reported
 * inside the dialog (the page toast would sit under its backdrop) and leaves the choice open.
 */
export function TaskActionConfirmation({ kind, copy, descriptionId, accountName, traceId, disabled, pending, error, onKeep, onConfirm, canEscape, restoreFocus }: {
  kind: TaskConfirmationTarget['kind']; copy: TaskCenterCopy; descriptionId: string;
  accountName: string; traceId: string;
  disabled: boolean; pending: boolean; error?: string | null;
  onKeep: () => void; onConfirm: () => void; canEscape: () => boolean;
  restoreFocus?: FocusRestoreTarget;
}) {
  const cancel = kind === 'cancel';
  return <Dialog open role="alertdialog" aria-describedby={descriptionId} restoreFocus={restoreFocus}
    className="task-confirm" eyebrow={accountName} title={cancel ? copy.cancelTitle : copy.dismissTitle}
    onClose={() => { if (canEscape()) onKeep(); }}
    actions={<>
      <Button variant="ghost" data-autofocus disabled={pending} onClick={onKeep}>{cancel ? copy.keepWorking : copy.keepRecord}</Button>
      <Button variant="danger" busy={pending} disabled={disabled} onClick={onConfirm}>{cancel ? copy.cancel : copy.confirmDismiss}</Button>
    </>}>
    <p id={descriptionId}>{cancel ? copy.cancelBody : copy.dismissBody}</p>
    <p className="task-confirm__trace"><code>{traceId}</code></p>
    {error ? <Notice tone="error" title={cancel ? copy.cancelFailed : copy.dismissFailed}>{error}</Notice> : null}
  </Dialog>;
}
