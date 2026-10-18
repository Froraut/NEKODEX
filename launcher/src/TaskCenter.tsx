import { taskCenterCopy, type TaskCenterCopy } from "./task-center-copy";
import { taskOverview, taskKey, eligibleTaskConfirmation, requiresDismissConfirmation, type HistoryStatus, type TaskOrder, type TaskConfirmationTarget } from "./task-center-model";
import { focusableHeading, rowFocusMemory, rowFocusTarget, useRowFocusRecovery, type RowFocusMemory } from "./task-center-focus";
import { TaskDetails } from "./TaskDetails";
import { taskDetailCopy } from "./task-detail-copy";
import { queueEntryReason } from "./QueueControls";
import { TaskActionConfirmation } from "./TaskActionConfirmation";
import { stripIpcErrorPrefix } from "./ipc-error";
import languages from "../electron/languages.json";
import { Button, EmptyState, Notice, Panel, Select, StateDot, TextField, type Status } from './design';
import { useId, useMemo, useRef, useState } from 'react';
import type { BrowserTaskState, BrowserQueueState, Language } from './types';
import './surfaces/tasks-updates.css';

type HistoryHealth = Array<{ accountId: string; accountName: string; issue: 'task-history-unavailable' }>;

const unknownModel: Record<Language, string> = { en: 'Model unknown', ru: 'Модель неизвестна', 'zh-CN': '模型未知', 'zh-TW': '模型未知', ja: 'モデル不明', ko: '모델 알 수 없음' };

/** Running work pulses; finished work is ready; a cancelled task is quiet; anything else that ended without completing needs attention. */
const taskState = (task: BrowserTaskState): Status => !task.terminal ? 'busy'
  : task.phase === 'completed' ? 'ready' : task.phase === 'cancelled' ? 'idle' : 'error';

const errorText = (error: unknown) => stripIpcErrorPrefix(error instanceof Error ? error.message : String(error));

function TaskRow({ task, text, language, timeFormat, controlsDisabled, onOpen, onCancel, onDismiss }: {
  task: BrowserTaskState; text: TaskCenterCopy; language: Language; timeFormat: Intl.DateTimeFormat; controlsDisabled: boolean;
  onOpen: () => void; onCancel: (trigger: HTMLButtonElement) => void; onDismiss: (trigger: HTMLButtonElement) => void;
}) {
  const id = useId();
  const state = taskState(task);
  // Row buttons repeat across rows ("Dismiss", "Open conversation"): describe each by its row's account and trace.
  const describedBy = `${id}-title ${id}-trace`;
  return <article className="task-row" data-focus-row={taskKey(task)} aria-labelledby={`${id}-title`}>
    <div className="task-row__main">
      <strong className="task-row__title" id={`${id}-title`}>{task.accountName}</strong>
      <span className={`task-row__status is-${state}`}><StateDot state={state} /><span>{text.phases[task.phase] ?? task.phase}</span></span>
      <p className="task-row__meta"><span>{task.model ?? unknownModel[language]}</span> · <code id={`${id}-trace`}>{task.traceId}</code> · <time dateTime={new Date(task.updatedAt).toISOString()}>
        {timeFormat.format(task.updatedAt)}</time></p>
      {task.terminal && task.phase !== 'completed' ? <p className="task-row__note" role="status">{task.retrySafe ? text.retrySafe : task.phase === 'cancelled' ? text.observationStopped : task.canOpen ? text.inspectFirst : text.documentUnavailable}</p> : null}
    </div>
    {task.canOpen || task.canCancel || task.canDismiss ? <div className="task-row__actions">
      {task.canOpen ? <Button size="sm" data-action="open" aria-describedby={describedBy} disabled={controlsDisabled}
        onClick={onOpen}>{text.open}</Button> : null}
      {task.canCancel ? <Button size="sm" variant="ghost" data-action="cancel" aria-describedby={describedBy} disabled={controlsDisabled}
        onClick={event => onCancel(event.currentTarget)}>{text.cancel}</Button> : null}
      {task.canDismiss ? <Button size="sm" variant="ghost" data-action="dismiss" aria-describedby={describedBy} disabled={controlsDisabled}
        onClick={event => onDismiss(event.currentTarget)}>{text.dismiss}</Button> : null}
    </div> : null}
    <TaskDetails task={task} language={language} timeFormat={timeFormat} />
  </article>;
}

export function TaskCenter({ tasks, language, disabled, open, cancel, dismiss, onError, historyHealth = [], queue }: {
  tasks: BrowserTaskState[]; queue?: BrowserQueueState; historyHealth?: HistoryHealth; language: Language; disabled: boolean;
  open: (tabId: string) => Promise<unknown>; cancel: (tabId: string, traceId: string) => Promise<unknown>;
  dismiss: (accountId: string, id: string) => Promise<unknown>; onError: (error: unknown) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [target, setTarget] = useState<TaskConfirmationTarget | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<HistoryStatus>('all');
  const [order, setOrder] = useState<TaskOrder>('attention');
  const [account, setAccount] = useState('');
  const actionPending = useRef(false);
  const confirmationId = useId();
  const statusFieldId = useId();
  const accountFieldId = useId();
  const orderFieldId = useId();
  const historyTitleId = useId();
  const confirmationTrigger = useRef<RowFocusMemory | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const text = taskCenterCopy(language);
  const detailText = taskDetailCopy(language);
  const timeFormat = useMemo(() => new Intl.DateTimeFormat(languages[language]?.locale ?? language, { dateStyle: 'medium', timeStyle: 'short' }), [language]);
  const deadlineFormat = useMemo(() => new Intl.DateTimeFormat(languages[language]?.locale ?? language, { timeStyle: 'medium' }), [language]);
  const accounts = new Map(tasks.map(task => [task.accountId, task.accountName]));
  for (const health of historyHealth) accounts.set(health.accountId, health.accountName);
  for (const queuedAccount of queue?.accounts ?? []) accounts.set(queuedAccount.id, queuedAccount.label);
  const overview = taskOverview(tasks, queue, { account, status, query, language }, order);
  const visible = overview.flatMap(row => row.kind === 'task' ? [row.task] : []);
  const total = tasks.length + (queue?.entries.length ?? 0);
  const confirmation = eligibleTaskConfirmation(visible, target);
  const confirmationTask = confirmation ? visible.find(task => taskKey(task) === confirmation.taskKey) : undefined;
  // A dismissed row takes its focused button with it: continue from the neighbouring row, else the search field
  // (hidden once no records are left; then the panel heading).
  const listFallback = () => searchInput.current ?? focusableHeading(historyTitleId);
  useRowFocusRecovery(listRef, { busy: pending !== null, fallback: listFallback });
  // After the confirmation closes, focus returns to the row control that opened it. A cancelled or dismissed task
  // removes or disables that control; continue from the neighbouring row, then the search field or heading.
  const confirmationFocus = () => {
    const trigger = confirmationTrigger.current;
    return (trigger ? rowFocusTarget(listRef.current, trigger) : null) ?? listFallback();
  };
  const clearConfirmations = () => { setTarget(null); setConfirmError(null); };
  const openConfirmation = (kind: TaskConfirmationTarget['kind'], task: BrowserTaskState, trigger: HTMLButtonElement) => {
    confirmationTrigger.current = rowFocusMemory(listRef.current, trigger);
    setConfirmError(null);
    setTarget({ kind, taskKey: taskKey(task) });
  };
  const act = async (id: string, action: () => Promise<unknown>, onFailure: (error: unknown) => void = onError) => {
    if (actionPending.current || disabled) return;
    actionPending.current = true;
    setPending(id);
    try { await action(); } catch (error) { onFailure(error); } finally { actionPending.current = false; setPending(null); }
  };
  const filtered = Boolean(query || status !== 'all' || account);
  const clearFilters = () => { setQuery(''); setStatus('all'); setAccount(''); clearConfirmations(); searchInput.current?.focus(); };
  const accountOptions = [{ value: '', label: text.allAccounts }, ...[...accounts].map(([value, label]) => ({ value, label })),
    ...(account && !accounts.has(account) ? [{ value: account, label: account }] : [])];
  const controlsDisabled = disabled || !!pending;
  const list = !total
    ? <div className="task-row task-row--empty"><EmptyState icon="logs" title={historyHealth.length ? text.emptyUnavailable : text.empty}>
      {historyHealth.length ? null : text.emptyBody}</EmptyState></div>
    : !overview.length ? <div className="task-row task-row--empty"><EmptyState icon="logs" title={text.noMatches}
      action={<Button size="sm" onClick={clearFilters}>{text.clearFilters}</Button>} /></div>
      : overview.map(row => {
        if (row.kind === 'queue') {
          const entry = row.entry;
          return <article className="task-row" key={row.key} data-focus-row={row.key}>
            <div className="task-row__main">
              <strong className="task-row__title">{entry.accountId ? accounts.get(entry.accountId) ?? entry.accountId : text.allAccounts}</strong>
              <span className="task-row__status">{detailText.queue} · {queueEntryReason(entry, queue!, language, deadlineFormat)}</span>
              <p className="task-row__meta"><code>{entry.traceId}</code> · {detailText.owner}: {detailText.originalClient}</p>
            </div>
            <Button size="sm" data-action="queue" onClick={() => {
              const node = document.getElementById(`queue-entry-${encodeURIComponent(entry.id)}`);
              node?.scrollIntoView({ block: 'center' }); node?.focus();
            }}>{detailText.queueControls}</Button>
          </article>;
        }
        const task = row.task;
        return <TaskRow key={taskKey(task)} task={task} text={text} language={language} timeFormat={timeFormat}
        controlsDisabled={controlsDisabled}
        onOpen={() => void act(taskKey(task), () => open(task.tabId))}
        onCancel={trigger => openConfirmation('cancel', task, trigger)}
        onDismiss={trigger => {
          if (requiresDismissConfirmation(task)) openConfirmation('dismiss', task, trigger);
          else void act(taskKey(task), () => dismiss(task.accountId, task.id));
        }} />;
      });
  return <div className="task-center">
    <Panel padding="flush" className="task-history" title={detailText.overview} titleId={historyTitleId}
      actions={total ? <span className="task-history-count">{text.recordCount!.replace('{shown}', String(overview.length)).replace('{total}', String(total))}</span> : undefined}>
      {historyHealth.length ? <div className="task-history-notices">
        {historyHealth.map(health => <Notice tone="warning" key={health.accountId} title={health.accountName}>{text.historyUnavailable}</Notice>)}
      </div> : null}
      {/* Filters only help when there are records to narrow down. */}
      {total ? <div className="task-history-filters">
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
        <div className="nk-field">
          <label htmlFor={orderFieldId}>{detailText.order}</label>
          <Select id={orderFieldId} value={order} onChange={value => setOrder(value as TaskOrder)} options={[{ value: 'attention', label: detailText.attentionView }, { value: 'recent', label: detailText.recentView }]} />
        </div>
        <Button variant="ghost" disabled={!filtered} onClick={clearFilters}>{text.clearFilters}</Button>
      </div> : null}
      <div className="task-center-list" ref={listRef}>{list}</div>
    </Panel>
    {confirmation && confirmationTask ? <TaskActionConfirmation
      kind={confirmation.kind} copy={text} descriptionId={confirmationId}
      accountName={confirmationTask.accountName} traceId={confirmationTask.traceId}
      disabled={disabled} pending={!!pending} error={confirmError}
      onKeep={clearConfirmations}
      canEscape={() => !actionPending.current}
      restoreFocus={confirmationFocus}
      onConfirm={() => void act(taskKey(confirmationTask), async () => {
        setConfirmError(null);
        if (confirmation.kind === 'cancel') await cancel(confirmationTask.tabId, confirmationTask.traceId);
        else await dismiss(confirmationTask.accountId, confirmationTask.id);
        clearConfirmations();
        // The dialog covers the page toast; a failure is reported inside it and the choice stays open.
      }, error => setConfirmError(errorText(error)))} /> : null}
  </div>;
}
