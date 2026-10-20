import type { BrowserTaskState, Language } from './types';
export type HistoryStatus = 'all' | 'active' | 'attention' | 'completed';
export type TaskConfirmationTarget = { kind: 'cancel' | 'dismiss'; taskKey: string };
export const taskKey = (task: BrowserTaskState) => JSON.stringify([task.accountId, task.id]);
export const requiresDismissConfirmation = (task: BrowserTaskState) => task.canDismiss && task.canOpen && task.phase !== 'completed';
export function filterTasks(tasks: BrowserTaskState[], filters: { account: string; status: HistoryStatus; query: string; language: Language }) {
  const { account, status, language } = filters;
  const search = filters.query.trim().toLocaleLowerCase(language);
  return tasks.filter(task => (!account || task.accountId === account)
    && (status === 'all' || (status === 'active' ? !task.terminal
      : status === 'completed' ? task.terminal && task.phase === 'completed'
      // A task the user cancelled is drawn as quiet (grey dot), so it is not listed as needing attention.
      : task.terminal && task.phase !== 'completed' && task.phase !== 'cancelled'))
    && (!search || [task.traceId, task.accountName, task.model ?? ''].some(value => value.toLocaleLowerCase(language).includes(search))));
}
export function eligibleTaskConfirmation(tasks: BrowserTaskState[], target: TaskConfirmationTarget | null): TaskConfirmationTarget | null {
  if (!target) return null;
  const task = tasks.find(task => taskKey(task) === target.taskKey);
  return task && (target.kind === 'cancel' ? task.canCancel : requiresDismissConfirmation(task)) ? target : null;
}

export type TaskOrder = 'attention' | 'recent';
export type QueueEntry = import('./types').BrowserQueueState['entries'][number];
export type TaskOverviewEntry = { kind: 'task'; task: BrowserTaskState; key: string; rank: number; at: number }
  | { kind: 'queue'; entry: QueueEntry; key: string; rank: number; at: number };
const queueActionReasons = new Set(['owner-reconnect-required', 'previous-submission-needs-review', 'task-history-unavailable', 'inspection-tabs']);
const accountActionCauses = new Set(['account_signed_out', 'account_disabled', 'account_tunnel_unconfigured', 'account_tunnel_not_ready', 'account_unchecked', 'account_model_unavailable', 'account_connector_unverified', 'account_not_ready']);
/** Rank only observed states and explicit owner reasons. Elapsed human wait time is never a priority/deadline. */
export function queueAttentionRank(entry: QueueEntry): number {
  if (entry.status === 'cancelled') return 3;
  if (entry.status === 'failed' || entry.status === 'interrupted') return 1;
  if (queueActionReasons.has(entry.reason ?? '') || accountActionCauses.has(entry.cause ?? '') || entry.canResume) return 0;
  return 2;
}
export const taskAttentionRank = (task: BrowserTaskState) => task.terminal
  ? task.phase === 'completed' || task.phase === 'cancelled' ? 3 : 1 : 2;

export function taskOverview(tasks: BrowserTaskState[], queue: import('./types').BrowserQueueState | undefined,
  filters: { account: string; status: HistoryStatus; query: string; language: Language }, order: TaskOrder): TaskOverviewEntry[] {
  const search = filters.query.trim().toLocaleLowerCase(filters.language);
  const labels = new Map(queue?.accounts.map(account => [account.id, account.label]));
  const taskRows: TaskOverviewEntry[] = filterTasks(tasks, filters).map(task => ({ kind: 'task', task, key: taskKey(task), rank: taskAttentionRank(task), at: task.updatedAt }));
  const queueRows: TaskOverviewEntry[] = (queue?.entries ?? []).filter(entry => (!filters.account || entry.accountId === filters.account)
    && (filters.status === 'all' || (filters.status === 'attention' ? queueAttentionRank(entry) <= 1
      : filters.status === 'active' ? !['cancelled', 'failed', 'interrupted'].includes(entry.status) : false))
    && (!search || [entry.traceId, entry.accountId ? labels.get(entry.accountId) ?? entry.accountId : '', entry.reason ?? '', entry.cause ?? '']
      .some(value => value.toLocaleLowerCase(filters.language).includes(search))))
    .map(entry => ({ kind: 'queue', entry, key: `queue:${entry.id}`, rank: queueAttentionRank(entry), at: entry.createdAt }));
  return [...taskRows, ...queueRows].sort((a, b) => (order === 'attention' ? a.rank - b.rank : 0) || b.at - a.at || a.key.localeCompare(b.key));
}
