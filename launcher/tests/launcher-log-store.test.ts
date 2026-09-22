import { expect, test } from 'bun:test';
import { createLauncherLogStore } from '../src/launcher-log-store';
const record = (i: number) => ({ at: String(i), level: 'info' as const, event: 'sample', detail: { i } });

test('log history reconciles startup and retains distinct ordered rows through bounded bursts', async () => {
  const store = createLauncherLogStore();
  store.seed([record(0), record(1)], [record(1), record(2)]);
  expect(store.getSnapshot().map(entry => entry.record.detail.i)).toEqual([0, 1, 2]);
  const original = store.getSnapshot();
  expect(store.getSnapshot()).toBe(original);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  for (let i = 3; i < 310; i++) store.append(record(i));
  await Bun.sleep(130);
  const current = store.getSnapshot();
  expect(notifications).toBe(1);
  expect(current).toHaveLength(300);
  expect(current[0].record.detail.i).toBe(10);
  expect(current.at(-1)?.record.detail.i).toBe(309);
  expect(new Set(current.map(entry => entry.id)).size).toBe(300);
  expect(original.map(entry => entry.record.detail.i)).toEqual([0, 1, 2]);
  unsubscribe();
});

test('offscreen logs remain available without notifications and returning views get the latest history', async () => {
  const store = createLauncherLogStore();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  store.append(record(1));
  unsubscribe();
  await Bun.sleep(130);
  expect(notifications).toBe(0);
  store.append(record(2));
  const stop = store.subscribe(() => notifications++);
  const before = store.getSnapshot();
  expect(before.map(entry => entry.record.detail.i)).toEqual([1, 2]);
  store.append(record(3));
  await Bun.sleep(130);
  expect(notifications).toBe(1);
  expect(store.getSnapshot()[0].id).toBe(before[0].id);
  stop();
});
