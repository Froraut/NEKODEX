import { useLayoutEffect } from 'react';
import { Button } from './design';
// Direct module import: re-exporting Dialog through ./design from this lazy chunk makes Rollup split a cycle.
import { Dialog } from './design/overlays';
import type { TaskCenterCopy } from './task-center-copy';
import type { TaskConfirmationTarget } from './task-center-model';

/**
 * Cancel/dismiss confirmation as the kit Dialog. The Dialog traps focus, focuses the safe "keep" action first and
 * returns focus to the row control that opened it; TaskCenter picks the search field when that control is gone.
 */
export function TaskActionConfirmation({ kind, copy, descriptionId, accountName, traceId, disabled, pending, onKeep, onConfirm, canEscape }: {
  kind: TaskConfirmationTarget['kind']; copy: TaskCenterCopy; descriptionId: string;
  accountName: string; traceId: string;
  disabled: boolean; pending: boolean;
  onKeep: () => void; onConfirm: () => void; canEscape: () => boolean;
}) {
  const cancel = kind === 'cancel';
  // Kit Dialog has no role/aria-describedby props: keep the confirmation an alertdialog described by its warning.
  useLayoutEffect(() => {
    const dialog = document.getElementById(descriptionId)?.closest<HTMLElement>('.nk-dialog');
    dialog?.setAttribute('role', 'alertdialog');
    dialog?.setAttribute('aria-describedby', descriptionId);
  }, [descriptionId, kind]);
  return <Dialog open className="task-confirm" eyebrow={accountName} title={cancel ? copy.cancel : copy.dismiss}
    onClose={() => { if (canEscape()) onKeep(); }}
    actions={<>
      <Button variant="ghost" data-autofocus disabled={pending} onClick={onKeep}>{cancel ? copy.keepWorking : copy.keepRecord}</Button>
      <Button variant="danger" busy={pending} disabled={disabled} onClick={onConfirm}>{cancel ? copy.cancel : copy.confirmDismiss}</Button>
    </>}>
    <p id={descriptionId}>{cancel ? copy.cancelWarning : copy.dismissWarning}</p>
    <p className="task-confirm__trace"><code>{traceId}</code></p>
  </Dialog>;
}
