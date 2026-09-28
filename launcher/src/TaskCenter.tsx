import { taskCenterCopy } from "./task-center-copy";
import { filterTasks, taskKey, eligibleTaskConfirmation, requiresDismissConfirmation, type HistoryStatus, type TaskConfirmationTarget } from "./task-center-model";
import { TaskActionConfirmation } from "./TaskActionConfirmation";
import { Button, EmptyState, Notice, Panel, Select, StateDot, TextField, type Status } from './design';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { BrowserTaskState, Language } from './types';
import './surfaces/tasks-updates.css';

type HistoryHealth = Array<{ accountId: string; accountName: string; issue: 'task-history-unavailable' }>;

const unknownModel: Record<Language, string> = { en: 'Model unknown', ru: 'Модель неизвестна', 'zh-CN': '模型未知', 'zh-TW': '模型未知', ja: 'モデル不明', ko: '모델 알 수 없음' };

/** Running work pulses; finished work is ready; anything that ended without completing needs attention. */
const taskState = (task: BrowserTaskState): Status => !task.terminal ? 'busy'
  : task.phase === 'completed' ? 'ready' : task.phase === 'cancelled' ? 'idle' : 'error';

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
  const statusFieldId = useId();
  const accountFieldId = useId();
  const confirmationTrigger = useRef<HTMLButtonElement | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const text = taskCenterCopy(language);
  const timeFormat = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'medium' }), [language]);
  const accounts = new Map(tasks.map(task => [task.accountId, task.accountName]));
  for (const health of historyHealth) accounts.set(health.accountId, health.accountName);
  const visible = filterTasks(tasks, { account, status, query, language });
  const confirmation = eligibleTaskConfirmation(visible, target);
  const confirmationKey = confirmation ? `${confirmation.kind}:${confirmation.taskKey}` : null;
  const confirmationTask = confirmation ? visible.find(task => taskKey(task) === confirmation.taskKey) : undefined;
  useEffect(() => {
    if (!confirmationKey) return;
    const trigger = confirmationTrigger.current;
    return () => {
      // The Dialog returns focus to the row control that opened it (one frame after closing). A cancelled or
      // dismissed task removes or disables that control; continue from the search field instead of the sidebar.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (trigger?.isConnected && !trigger.disabled) return;
        const active = document.activeElement;
        if (active && active !== document.body && !active.matches('.nk-nav-item[aria-current="page"]')) return;
        searchInput.current?.focus();
      }));
    };
  }, [confirmationKey]);
  const clearConfirmations = () => setTarget(null);
  const act = async (id: string, action: () => Promise<unknown>) => {
    if (actionPending.current || disabled) return;
    actionPending.current = true;
    setPending(id);
    try { await action(); } catch (error) { onError(error); } finally { actionPending.current = false; setPending(null); }
  };
  const filtered = Boolean(query || status !== 'all' || account);
  const accountOptions = [{ value: '', label: text.allAccounts }, ...[...accounts].map(([value, label]) => ({ value, label })),
    ...(account && !accounts.has(account) ? [{ value: account, label: account }] : [])];
  const list = !tasks.length
    ? (historyHealth.length ? null : <div className="task-row task-row--empty"><EmptyState centered mark title={text.empty} /></div>)
    : !visible.length ? <div className="task-row task-row--empty"><EmptyState icon="logs" title={text.noMatches} /></div>
      : visible.map(task => {
        const state = taskState(task);
        return <article className="task-row" key={taskKey(task)}>
          <div className="task-row__main">
            <strong className="task-row__title">{task.accountName}</strong>
            <span className={`task-row__status is-${state}`}><StateDot state={state} /><span>{text.phases[task.phase] ?? task.phase}</span></span>
            <p className="task-row__meta"><span>{task.model ?? unknownModel[language]}</span> · <code>{task.traceId}</code> · <time dateTime={new Date(task.updatedAt).toISOString()}>
              {timeFormat.format(task.updatedAt)}</time></p>
            {task.terminal && task.phase !== 'completed' ? <p className="task-row__note" role="status">{task.retrySafe ? text.retrySafe : task.phase === 'cancelled' ? text.observationStopped : task.canOpen ? text.inspectFirst : text.documentUnavailable}</p> : null}
          </div>
          {task.canOpen || task.canCancel || task.canDismiss ? <div className="task-row__actions">
            {task.canOpen ? <Button size="sm" disabled={disabled || !!pending}
              onClick={() => void act(taskKey(task), () => open(task.tabId))}>{text.open}</Button> : null}
            {task.canCancel ? <Button size="sm" variant="ghost" disabled={disabled || !!pending}
              onClick={event => { confirmationTrigger.current = event.currentTarget; setTarget({ kind: 'cancel', taskKey: taskKey(task) }); }}>{text.cancel}</Button> : null}
            {task.canDismiss ? <Button size="sm" variant="ghost" disabled={disabled || !!pending}
              onClick={event => {
                confirmationTrigger.current = event.currentTarget;
                if (requiresDismissConfirmation(task)) { setTarget({ kind: 'dismiss', taskKey: taskKey(task) }); }
                else void act(taskKey(task), () => dismiss(task.accountId, task.id));
              }}>{text.dismiss}</Button> : null}
          </div> : null}
        </article>;
      });
  return <section className="task-center" aria-label={text.title}>
    <Panel as="div" padding="flush" className="task-history" title={text.history}
      actions={<span className="task-history-count">{text.recordCount!.replace('{shown}', String(visible.length)).replace('{total}', String(tasks.length))}</span>}>
      {historyHealth.length ? <div className="task-history-notices">
        {historyHealth.map(health => <Notice tone="warning" key={health.accountId} title={health.accountName}>{text.historyUnavailable}</Notice>)}
      </div> : null}
      <div className="task-history-filters">
        <TextField className="task-history-search" ref={searchInput} type="search" label={text.search} value={query}
          onChange={event => { setQuery(event.target.value); clearConfirmations(); }} />
        <div className="nk-field">
          <label htmlFor={statusFieldId}>{text.status}</label>
          <Select id={statusFieldId} value={status} onChange={value => { setStatus(value as HistoryStatus); clearConfirmations(); }}
            options={(['all', 'active', 'attention', 'completed'] as const).map(value => ({ value, label: text[value] }))} />
        </div>
        <div className="nk-field">
          <label htmlFor={accountFieldId}>{text.account}</label>
          <Select id={accountFieldId} value={account} onChange={value => { setAccount(value); clearConfirmations(); }} options={accountOptions} />
        </div>
        <Button variant="ghost" disabled={!filtered}
          onClick={() => { setQuery(''); setStatus('all'); setAccount(''); clearConfirmations(); }}>{text.clearFilters}</Button>
      </div>
      {list ? <div className="task-center-list">{list}</div> : null}
    </Panel>
    {confirmation && confirmationTask ? <TaskActionConfirmation
      kind={confirmation.kind} copy={text} descriptionId={confirmationId}
      accountName={confirmationTask.accountName} traceId={confirmationTask.traceId}
      disabled={disabled} pending={!!pending}
      onKeep={clearConfirmations}
      canEscape={() => !actionPending.current}
      onConfirm={() => void act(taskKey(confirmationTask), async () => {
        if (confirmation.kind === 'cancel') await cancel(confirmationTask.tabId, confirmationTask.traceId);
        else await dismiss(confirmationTask.accountId, confirmationTask.id);
        clearConfirmations();
      })} /> : null}
  </section>;
}
