import { useId, useState } from 'react';
import { Select } from './design';
import { RemovalConfirmation } from './RemovalConfirmation';
import type { AgentDispatch, AgentDispatchDisposition } from './agent-mode-types';
import type { agentModeCopy } from './agent-mode-copy';

export type AgentDispatchDispositionInput = { kind: AgentDispatchDisposition['kind']; note?: string };

/**
 * Confirmed user record for one `unknown` send of a stopped task. The dialog states that nothing is resent;
 * "confirmed delivered" is offered only when the dispatch carries its own acceptance receipt. The core owner
 * re-checks every rule and stores the choice as a separate receipt; the dispatch itself stays unknown.
 */
export function AgentDispatchReconciliation({ dispatch, text, pending, error, onKeep, onConfirm }: {
  dispatch: AgentDispatch; text: ReturnType<typeof agentModeCopy>; pending: boolean; error: string | null;
  onKeep: () => void; onConfirm: (disposition: AgentDispatchDispositionInput) => void;
}) {
  const outcomeId = useId(), noteId = useId();
  const delivered = Boolean(dispatch.acceptanceReceipt);
  const [kind, setKind] = useState<AgentDispatchDisposition['kind']>('abandoned');
  const [note, setNote] = useState('');
  return <RemovalConfirmation title={text.reconcileDispatchTitle} eyebrow={`${dispatch.stageId} · ${dispatch.state}`} keepLabel={text.keepUnknown} confirmLabel={text.reconcileDispatch}
    acknowledge={text.reconcileAcknowledge} pending={pending} error={error} onKeep={onKeep}
    onConfirm={() => onConfirm({ kind: delivered ? kind : 'abandoned', ...(note.trim() ? { note: note.trim() } : {}) })}>
    <p>{text.reconcileDispatchBody}</p>
    <p><code>{dispatch.id}</code>{dispatch.acceptanceReceipt ? <> · <code>{dispatch.acceptanceReceipt}</code></> : null}</p>
    <div className="nk-field"><label htmlFor={outcomeId}>{text.reconcileOutcome}</label>
      <Select id={outcomeId} value={delivered ? kind : 'abandoned'} disabled={pending} onChange={value => setKind(value as AgentDispatchDisposition['kind'])}
        options={[{ value: 'abandoned', label: text.reconcileAbandoned }, { value: 'confirmed_delivered', label: text.reconcileDelivered, disabled: !delivered }]} />
      {!delivered ? <p className="nk-field__hint">{text.reconcileDeliveredUnavailable}</p> : null}
    </div>
    <div className="nk-field"><label htmlFor={noteId}>{text.reconcileNote}</label>
      <textarea id={noteId} className="nk-input" rows={3} maxLength={2000} value={note} readOnly={pending} onChange={event => setNote(event.target.value)} />
    </div>
  </RemovalConfirmation>;
}
