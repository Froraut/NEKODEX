import { expect, test } from 'bun:test';
import { enqueueBrowserSurfaceCommand } from '../launcher/src/browser-surface-queue';

test('surface queue drops invalidated queued activation and never shows an activation superseded during IPC', async () => {
  let intent = 1;
  const calls: string[] = [];
  let release!: () => void;
  const previous = new Promise<void>(resolve => { release = resolve; });
  const stale = enqueueBrowserSurfaceCommand(previous, () => intent === 1,
    async () => { calls.push('stale-active'); }, async () => { calls.push('stale-show'); });
  intent = 2; release(); await stale;
  expect(calls).toEqual([]);

  let admitted!: () => void;
  const started = new Promise<void>(resolve => { admitted = resolve; });
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const active = enqueueBrowserSurfaceCommand(Promise.resolve(), () => intent === 2,
    async () => { calls.push('active'); admitted(); await pending; return 'accepted'; },
    async () => { calls.push('show'); });
  await started;
  intent = 3;
  const inactive = enqueueBrowserSurfaceCommand(active, () => intent === 3,
    async () => { calls.push('inactive'); return 'inactive'; });
  finish();
  expect(await active).toBe('accepted');
  expect(await inactive).toBe('inactive');
  expect(calls).toEqual(['active', 'inactive']);
});
