import { expect, test } from 'bun:test';
import { enqueueBrowserSurfaceCommand } from '../launcher/src/browser-surface-queue';

test('surface queue drops invalidated queued activation and never shows an activation superseded during IPC', async () => {
  let intent = 1;
  const calls: string[] = [];
  let release!: () => void;
  const previous = new Promise<void>(resolve => { release = resolve; });
  const stale = enqueueBrowserSurfaceCommand(previous, () => intent === 1,
    async () => { calls.push('stale-active'); }, async () => { calls.push('stale-show'); });
  intent = 2; release(); await stale.result;
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
  const inactive = enqueueBrowserSurfaceCommand(active.queueTail, () => intent === 3,
    async () => { calls.push('inactive'); return 'inactive'; });
  finish();
  expect(await active.result).toBe('accepted');
  expect(await inactive.result).toBe('inactive');
  expect(calls).toEqual(['active', 'inactive']);
});

for (const rejectShow of [false, true]) {
  test(`deactivation reaches IPC before a pending reveal ${rejectShow ? 'rejects' : 'completes'}`, async () => {
    let intent = 1, visible = false, revealFinished = false;
    const calls: string[] = [];
    let started!: () => void, finish!: () => void, fail!: (error: Error) => void;
    const revealStarted = new Promise<void>(resolve => { started = resolve; });
    const reveal = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    const active = enqueueBrowserSurfaceCommand(Promise.resolve(), () => intent === 1,
      async () => { visible = true; calls.push('active'); return 'active'; },
      async () => { calls.push('show'); started(); await reveal; revealFinished = true; });
    try {
      await revealStarted;
      intent = 2;
      const inactive = enqueueBrowserSurfaceCommand(active.queueTail, () => intent === 2,
        async () => { visible = false; calls.push('inactive'); return 'inactive'; });
      expect(await inactive.result).toBe('inactive');
      expect(revealFinished).toBe(false);
      expect(visible).toBe(false);
      if (rejectShow) fail(new Error('Superseded reveal failed')); else finish();
      expect(await active.result).toBe(rejectShow ? undefined : 'active');
      expect(visible).toBe(false);
      expect(calls).toEqual(['active', 'show', 'inactive']);
    } finally { finish(); }
  }, 1_000);
}
