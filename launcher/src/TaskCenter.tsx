import { taskCenterCopy } from "./task-center-copy";
export { taskCenterTitle } from "./task-center-copy";
import { filterTasks, taskKey, eligibleTaskConfirmation, requiresDismissConfirmation, type HistoryStatus, type TaskConfirmationTarget } from "./task-center-model";
import { TaskActionConfirmation } from "./TaskActionConfirmation";
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { BrowserTaskState, Language } from './types';
import './task-center.css';

type HistoryHealth = Array<{ accountId: string; accountName: string; issue: 'task-history-unavailable' }>;

const unknownModel: Record<Language, string> = { en: 'Model unknown', ru: 'Модель неизвестна', 'zh-CN': '模型未知', 'zh-TW': '模型未知', ja: 'モデル不明', ko: '모델 알 수 없음' };

export function TaskCenter({ tasks, language, disabled, open, cancel, dismiss, onError, historyHealth = [] }: {
  tasks: BrowserTaskState[]; historyHealth?: HistoryHealth; language: Language; disabled: boolean;
  open: (tabId: string) => Promise<unknown>; cancel: (tabId: string, traceId: string) => Promise<unknown>;
  dismiss: (accountId: string, id: string) => Promise<unknown>; onError: (error: unknown) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [target, setTarget] = useState<TaskConfirmationTarget | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<HistoryStatus>('all');
  const [account, setAccount] = useState('');
  const actionPending = useRef(false);
  const confirmationId = useId();
  const confirmationPanel = useRef<HTMLDivElement>(null);
  const confirmationFocused = useRef(false);
  const confirmationKeep = useRef<HTMLButtonElement>(null);
  const confirmationTrigger = useRef<HTMLButtonElement | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const text = taskCenterCopy(language);
  const accounts = new Map(tasks.map(task => [task.accountId, task.accountName]));
  for (const health of historyHealth) accounts.set(health.accountId, health.accountName);
  const visible = filterTasks(tasks, { account, status, query, language });
  const confirmation = eligibleTaskConfirmation(visible, target);
  const confirmationKey = confirmation ? `${confirmation.kind}:${confirmation.taskKey}` : null;
  useLayoutEffect(() => {
    if (!confirmationKey) return;
    const panel = confirmationPanel.current;
    const trigger = confirmationTrigger.current;
    confirmationKeep.current?.focus();
    confirmationFocused.current = !!panel?.contains(panel.ownerDocument.activeElement);
    return () => {
      // Do not steal focus from a filter or another control the user moved to.
      if (!panel) return;
      const active = panel.ownerDocument.activeElement;
      if (!panel.contains(active) && !(active === panel.ownerDocument.body && confirmationFocused.current)) return;
      // Wait until React has removed/disabled stale row controls before choosing
      // a destination. A removed task must not receive focus just before removal.
      queueMicrotask(() => {
        const active = panel.ownerDocument.activeElement;
        if (active !== panel.ownerDocument.body && !panel.contains(active)) return;
        if (trigger?.isConnected && !trigger.disabled) trigger.focus();
        else searchInput.current?.focus();
      });
    };
  }, [confirmationKey]);
  const clearConfirmations = () => setTarget(null);
  const act = async (id: string, action: () => Promise<unknown>) => {
    if (actionPending.current || disabled) return;
    actionPending.current = true;
    setPending(id);
    try { await action(); } catch (error) { onError(error); } finally { actionPending.current = false; setPending(null); }
  };
  return <section className="task-center" aria-label={text.title}>
    {historyHealth.map(health => <p className="task-history-warning" role="status" key={health.accountId}>
      <strong>{health.accountName}</strong>: {text.historyUnavailable}
    </p>)}
    <div className="task-history-filters">
      <label>{text.search}<input type="search" ref={searchInput} value={query} onChange={event => { setQuery(event.target.value); clearConfirmations(); }} /></label>
      <label>{text.status}<select value={status} onChange={event => { setStatus(event.target.value as HistoryStatus); clearConfirmations(); }}>
        {(['all', 'active', 'attention', 'completed'] as const).map(value => <option key={value} value={value}>{text[value]}</option>)}
      </select></label>
      <label>{text.account}<select value={account} onChange={event => { setAccount(event.target.value); clearConfirmations(); }}>
        <option value="">{text.allAccounts}</option>
        {[...accounts].map(([id, name]) => <option value={id} key={id}>{name}</option>)}
        {account && !accounts.has(account) ? <option value={account}>{account}</option> : null}
      </select></label>
      <button className="text-button" type="button" disabled={!query && status === 'all' && !account}
        onClick={() => { setQuery(''); setStatus('all'); setAccount(''); clearConfirmations(); }}>{text.clearFilters}</button>
    </div>
    <p className="task-history-count" role="status">{text.recordCount!.replace('{shown}', String(visible.length)).replace('{total}', String(tasks.length))}</p>
    <div className="task-center-list">
      {!tasks.length ? (historyHealth.length ? null : <p>{text.empty}</p>) : !visible.length ? <p>{text.noMatches}</p> : visible.map(task => <article key={taskKey(task)}>
        <header><strong>{task.accountName}</strong><span>{text.phases[task.phase] ?? task.phase}</span></header>
        <p><span>{task.model ?? unknownModel[language]}</span> · <code>{task.traceId}</code> · <time dateTime={new Date(task.updatedAt).toISOString()}>
          {new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'medium' }).format(task.updatedAt)}</time></p>
        {task.terminal && task.phase !== 'completed' ? <p role="status">{task.retrySafe ? text.retrySafe : task.phase === 'cancelled' ? text.observationStopped : task.canOpen ? text.inspectFirst : text.documentUnavailable}</p> : null}
        <div className="task-center-actions">
          {task.canOpen ? <button type="button" className="text-button" disabled={disabled || !!pending}
            onClick={() => void act(taskKey(task), () => open(task.tabId))}>{text.open}</button> : null}
          {task.canCancel ? <button type="button" className="text-button" disabled={disabled || !!pending}
            onClick={event => { confirmationTrigger.current = event.currentTarget; setTarget({ kind: 'cancel', taskKey: taskKey(task) }); }}>{text.cancel}</button> : null}
          {task.canDismiss ? <button type="button" className="text-button" disabled={disabled || !!pending}
            onClick={event => {
              confirmationTrigger.current = event.currentTarget;
              if (requiresDismissConfirmation(task)) { setTarget({ kind: 'dismiss', taskKey: taskKey(task) }); }
              else void act(taskKey(task), () => dismiss(task.accountId, task.id));
            }}>{text.dismiss}</button> : null}
        </div>
        {confirmation?.taskKey === taskKey(task) ? <TaskActionConfirmation
          kind={confirmation.kind} copy={text} descriptionId={confirmationId}
          panelRef={confirmationPanel} keepRef={confirmationKeep}
          disabled={disabled} pending={!!pending}
          onFocusChange={focused => { confirmationFocused.current = focused; }}
          onKeep={clearConfirmations}
          canEscape={() => !actionPending.current}
          onConfirm={() => void act(taskKey(task), async () => {
            if (confirmation.kind === 'cancel') await cancel(task.tabId, task.traceId);
            else await dismiss(task.accountId, task.id);
            clearConfirmations();
          })} /> : null}
      </article>)}
    </div>
  </section>;
}
