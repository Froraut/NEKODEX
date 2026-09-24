import { expect, test } from 'bun:test';
import { createAccountSnapshotController } from '../src/account-snapshot-controller';
import { newerBrowserState } from '../src/snapshot-observation';
import type { AccountPoolSnapshot, BrowserState } from '../src/types';
const stamp = (revision: number, sourceId = 'pool-a') => ({ sourceId, revision });
const pool = (revision: number, sourceId = 'pool-a'): AccountPoolSnapshot =>
  ({ observation: stamp(revision, sourceId), selectedId: 'default', mode: 'selected', accounts: [] });
const event = (revision: number, sourceId = 'pool-a') => ({ observation: stamp(revision, sourceId) } as BrowserState);
const flush = () => new Promise(resolve => setImmediate(resolve));
test('startup and live browser merging keep the newest same-source observation and legacy compatibility', () => {
  const fresh = event(5), pending = event(4);
  expect(newerBrowserState(fresh, pending)).toBe(fresh);
  expect(newerBrowserState(pending, fresh)).toBe(fresh);
  expect(newerBrowserState(fresh, event(5))).toBe(fresh);
  const replacement = event(1, 'replacement');
  expect(newerBrowserState(fresh, replacement)).toBe(replacement);
  const legacy = {} as BrowserState;
  expect(newerBrowserState(fresh, legacy)).toBe(legacy);
});
function fixture() {
  const requests: Array<{ resolve: (value: AccountPoolSnapshot) => void; reject: (error: Error) => void }> = [];
  const snapshots: AccountPoolSnapshot[] = [], loading: boolean[] = [], timers = new Set<() => void>();
  let failures = 0;
  const controller = createAccountSnapshotController({
    read: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    defer(action) { timers.add(action); return () => { timers.delete(action); }; },
    onSnapshot: value => snapshots.push(value), onLoading: value => loading.push(value), onFailure: () => failures++,
  });
  return { controller, requests, snapshots, loading, timers, failures: () => failures,
    tick() { const actions = [...timers]; timers.clear(); actions.forEach(action => action()); } };
}
test('a read covering an overtaking notification settles without a redundant read', async () => {
  const f = fixture(); f.controller.start(true);
  f.controller.observe(event(5)); f.controller.observe(event(5));
  f.requests[0]!.resolve(pool(5)); await flush();
  expect(f.snapshots.at(-1)?.observation).toEqual(stamp(5));
  expect(f.loading.at(-1)).toBe(false);
  f.controller.observe(event(4)); f.controller.observe(event(5)); f.tick();
  expect(f.requests).toHaveLength(1); expect(f.timers.size).toBe(0);
  f.controller.dispose();
});
test('older host data and reads retired by a mutation cannot replace newer evidence', async () => {
  const f = fixture(); f.controller.start(true); f.controller.observe(event(5));
  f.requests[0]!.resolve(pool(4)); await flush();
  expect(f.snapshots).toHaveLength(0); f.tick();
  f.controller.apply(pool(6));
  f.requests[1]!.resolve(pool(6)); await flush();
  expect(f.snapshots).toHaveLength(1); f.tick();
  f.requests[2]!.resolve(pool(7)); await flush();
  f.controller.apply(pool(6));
  expect(f.snapshots.at(-1)?.observation?.revision).toBe(7);
  f.controller.dispose(); expect(f.timers.size).toBe(0);
});
test('a fresh read can identify a replacement pool; late old-pool events stay retired', async () => {
  const f = fixture(); f.controller.start(true);
  f.requests[0]!.resolve(pool(80)); await flush();
  f.controller.refresh(); f.tick(); f.requests[1]!.resolve(pool(1, 'pool-b')); await flush();
  expect(f.snapshots.at(-1)?.observation).toEqual(stamp(1, 'pool-b'));
  f.controller.observe(event(81)); f.controller.apply(pool(82)); f.tick();
  expect(f.snapshots.at(-1)?.observation).toEqual(stamp(1, 'pool-b'));
  f.controller.dispose();
  f.requests[2]!.reject(new Error('late shutdown failure')); await flush();
  expect(f.failures()).toBe(0); expect(f.timers.size).toBe(0);
});
