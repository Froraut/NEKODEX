import { useId, useState, type ReactNode } from 'react';
import { Button, Checkbox, Dialog, Notice } from './design';

/**
 * Shared alertdialog for removing app-owned state (Native profiles, OAuth providers, Agent tasks). The safe
 * "keep" action takes focus first. `acknowledge` adds an explicit checkbox for removals that end a signed-in
 * or running owner; the danger action stays disabled until it is ticked. The owner still re-checks every rule.
 */
export function RemovalConfirmation({ title, eyebrow, children, keepLabel, confirmLabel, acknowledge, pending = false, error, onKeep, onConfirm }: {
  title: string; eyebrow?: string; children: ReactNode; keepLabel: string; confirmLabel: string;
  acknowledge?: string; pending?: boolean; error?: string | null;
  onKeep: () => void; onConfirm: (acknowledged: boolean) => void;
}) {
  const descriptionId = useId();
  const [acknowledged, setAcknowledged] = useState(false);
  return <Dialog open role="alertdialog" aria-describedby={descriptionId} className="removal-confirm" eyebrow={eyebrow} title={title}
    onClose={() => { if (!pending) onKeep(); }}
    actions={<>
      <Button variant="ghost" data-autofocus disabled={pending} onClick={onKeep}>{keepLabel}</Button>
      <Button variant="danger" busy={pending} disabled={pending || Boolean(acknowledge) && !acknowledged} onClick={() => onConfirm(acknowledged)}>{confirmLabel}</Button>
    </>}>
    <div id={descriptionId}>{children}</div>
    {acknowledge ? <Checkbox checked={acknowledged} disabled={pending} onChange={setAcknowledged} label={acknowledge} /> : null}
    {error ? <Notice tone="error">{error}</Notice> : null}
  </Dialog>;
}
