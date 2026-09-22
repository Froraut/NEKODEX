import type { Ref } from 'react';
import type { TaskCenterCopy } from './task-center-copy';
import type { TaskConfirmationTarget } from './task-center-model';
export function TaskActionConfirmation({ kind, copy, descriptionId, panelRef, keepRef, disabled, pending, onFocusChange, onKeep, onConfirm, canEscape }: {
  kind: TaskConfirmationTarget['kind']; copy: TaskCenterCopy; descriptionId: string;
  panelRef: Ref<HTMLDivElement>; keepRef: Ref<HTMLButtonElement>;
  disabled: boolean; pending: boolean; onFocusChange: (focused: boolean) => void;
  onKeep: () => void; onConfirm: () => void; canEscape: () => boolean;
}) {
  const cancel = kind === 'cancel';
  return <div className="task-cancel-confirm" ref={panelRef} role="alertdialog"
    aria-label={cancel ? copy.cancel : copy.dismiss} aria-describedby={descriptionId}
    onFocusCapture={() => onFocusChange(true)}
    onBlurCapture={event => onFocusChange(event.currentTarget.contains(event.relatedTarget))}
    onKeyDown={event => { if (event.key === 'Escape' && canEscape()) { event.preventDefault(); event.stopPropagation(); onKeep(); } }}>
    <p id={descriptionId}>{cancel ? copy.cancelWarning : copy.dismissWarning}</p>
    <button className="button-secondary" type="button" disabled={disabled || pending} onClick={onConfirm}>{cancel ? copy.cancel : copy.confirmDismiss}</button>
    <button ref={keepRef} className="text-button" type="button" disabled={pending} onClick={onKeep}>{cancel ? copy.keepWorking : copy.keepRecord}</button>
  </div>;
}
