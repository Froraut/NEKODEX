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
      : task.terminal && task.phase !== 'completed'))
    && (!search || [task.traceId, task.accountName, task.model ?? ''].some(value => value.toLocaleLowerCase(language).includes(search))));
}
export function eligibleTaskConfirmation(tasks: BrowserTaskState[], target: TaskConfirmationTarget | null): TaskConfirmationTarget | null {
  if (!target) return null;
  const task = tasks.find(task => taskKey(task) === target.taskKey);
  return task && (target.kind === 'cancel' ? task.canCancel : requiresDismissConfirmation(task)) ? target : null;
}
