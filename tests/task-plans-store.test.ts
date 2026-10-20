import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-ignore CommonJS main-process leaf
import { createTaskPlanStore } from '../launcher/electron/task-plans.cjs';

const observed = (revision = 1, now = 10) => ({ version: 1, observedAt: now,
  source: 'native-codex-current-turn', state: 'observed', native: { threadId: 'thread', turnId: 'turn' },
  revisions: Array.from({ length: revision }, (_, index) => ({ revision: index + 1, sourceCallId: `call-${index + 1}`,
    ...(index ? { supersedes: index } : {}), steps: [{ text: `Step ${index}`, claimedStatus: index ? 'completed' : 'pending', evidence: 'observed', verification: 'unverified' }] })), truncated: false });
test('plan capture is private, opt-in, revision-aware and survives disabled restart', () => {
  const coreHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-plans-'));
  try {
    const store = createTaskPlanStore({ coreHome });
    const capture = (observation: unknown) => store.capture({ accountId: 'account', taskId: 'task', observation });
    expect(capture(observed())).toEqual({ recorded: false, reason: 'disabled' });
    expect(fs.existsSync(path.join(coreHome, 'task-plans'))).toBe(false);
    store.setEnabled(true, 0);
    expect(() => store.setEnabled(false, 0)).toThrow('changed');
    expect(capture(observed())).toEqual({ recorded: true });
    const interrupted = path.join(coreHome, 'task-plans', 'records', '.plan-11111111-1111-1111-1111-111111111111.tmp');
    fs.writeFileSync(interrupted, 'uncommitted synthetic bytes', { mode: 0o600 });
    expect(capture(observed(2, 20))).toEqual({ recorded: true });
    expect(fs.readFileSync(interrupted, 'utf8')).toBe('uncommitted synthetic bytes');
    expect(capture(observed(1, 15))).toEqual({ recorded: false, reason: 'stale' });
    const changed = observed(2, 30); changed.revisions[0]!.steps[0]!.text = 'rewritten';
    expect(() => capture(changed)).toThrow('cannot be rewritten');
    const wrong = observed(2, 30); wrong.native.turnId = 'new-turn';
    expect(() => capture(wrong)).toThrow('owner cannot change');
    store.setEnabled(false, 1);
    const reopened = createTaskPlanStore({ coreHome });
    expect(reopened.enabled()).toBe(false);
    expect(reopened.get({ accountId: 'account', taskId: 'task' }).revisions).toHaveLength(2);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(coreHome, 'task-plans', 'policy.json')).mode & 0o077).toBe(0);
    reopened.delete({ accountId: 'account', taskId: 'task' });
    expect(reopened.get({ accountId: 'account', taskId: 'task' })).toBeNull();
  } finally { fs.rmSync(coreHome, { recursive: true, force: true }); }
});
test('quota preserves data and does not prevent disabling capture; malformed policy fails closed', () => {
  const coreHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-plan-quota-'));
  try {
    const store = createTaskPlanStore({ coreHome, maxBytes: 1 });
    store.setEnabled(true, 0);
    expect(store.capture({ accountId: 'a', taskId: 't', observation: observed() })).toEqual({ recorded: false, reason: 'quota' });
    expect(store.setEnabled(false, 1).enabled).toBe(false);
    fs.writeFileSync(path.join(coreHome, 'task-plans', 'policy.json'), '{invalid', { mode: 0o600 });
    expect(store.enabled()).toBe(false);
    expect(() => store.setEnabled(true, 0)).toThrow('unavailable');
  } finally { fs.rmSync(coreHome, { recursive: true, force: true }); }
});
