import { expect, test } from 'bun:test';
import { eligibleTaskConfirmation, taskOverview, taskKey } from '../launcher/src/task-center-model';
import { taskDetailCopy } from '../launcher/src/task-detail-copy';
import type { BrowserQueueState, BrowserTaskState, Language } from '../launcher/src/types';

const task = (id: string, phase: BrowserTaskState['phase'], updatedAt: number): BrowserTaskState => ({
  id, traceId: id, accountId: 'a', accountName: 'Account A', tabId: id, model: 'model', createdAt: 1, updatedAt,
  sequence: 1, phase, submission: phase === 'send-uncertain' ? 'uncertain' : 'accepted',
  terminal: phase !== 'responding', canOpen: true, canCancel: phase === 'responding', canDismiss: phase !== 'responding', retrySafe: false,
});
const queued = (id: string, reason: string, createdAt: number): BrowserQueueState['entries'][number] => ({
  id, traceId: id, accountId: 'a', status: 'waiting', reason, createdAt, position: 1, retryAt: null,
  ownerConnected: true, canCancel: true, canPrioritize: false, canResume: false, canDismiss: false,
});
test('attention overview preserves queue owner reasons, uncertainty, ordinary waits and filters', () => {
  const tasks = [task('done', 'completed', 90), task('live', 'responding', 80), task('uncertain', 'send-uncertain', 70), task('cancelled', 'cancelled', 100)];
  const queue: BrowserQueueState = { paused: false, pausedAccounts: [], storageIssue: null, accounts: [{ id: 'a', label: 'Account A' }], entries: [queued('capacity', 'capacity', 10), queued('review', 'previous-submission-needs-review', 1)] };
  const filters = { account: '', query: '', status: 'all' as const, language: 'en' as const };
  const overview = taskOverview(tasks, queue, filters, 'attention');
  expect(overview.map(row => row.kind === 'task' ? row.task.id : row.entry.id)).toEqual(['review', 'uncertain', 'live', 'capacity', 'cancelled', 'done']);
  expect(queue.entries[1].reason).toBe('previous-submission-needs-review');
  expect(taskOverview(tasks, queue, { ...filters, status: 'attention' }, 'attention').map(row => row.key)).toEqual(['queue:review', taskKey(tasks[2])]);
  expect(taskOverview(tasks, queue, { ...filters, account: 'other' }, 'attention')).toEqual([]);
  expect(taskOverview(tasks, queue, { ...filters, query: 'uncertain' }, 'attention')).toHaveLength(1);
  expect(taskOverview(tasks, queue, filters, 'recent')[0].key).toBe(taskKey(tasks[3]));
  expect(eligibleTaskConfirmation([{ ...tasks[1], canCancel: false }], { kind: 'cancel', taskKey: taskKey(tasks[1]) })).toBeNull();
});
test('detail labels are present for all supported locales', () => {
  for (const language of ['en', 'ru', 'zh-CN', 'zh-TW', 'ja', 'ko'] as Language[]) {
    expect(Object.values(taskDetailCopy(language)).every(value => typeof value === 'string' && value.length > 0)).toBe(true);
  }
});
