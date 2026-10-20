import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createTaskPlanStore } = require('../launcher/electron/task-plans.cjs');
const { BrowserTaskLedger } = require('../launcher/electron/browser-task-ledger.cjs');

test('native requirement revisions retain consent/history and backend-invalidated coverage without manufacturing property verification', () => {
  const coreHome = mkdtempSync(join(tmpdir(), 'nk-requirement-contract-'));
  try {
    let now = 1000; let swapped = false;
    const ledger = new BrowserTaskLedger(join(coreHome, 'tasks.json'), () => ++now);
    const taskId = ledger.start('trace_requirements_123', 'tab_requirements_123', 1);
    const native = { threadId: 'native_thread', turnId: 'native_turn' };
    ledger.progress(taskId, 'preparing', 1, { version: 1, observedAt: 100, source: 'validated-request',
      native: { ...native, source: 'codex-client', state: 'request-observed' }, lineage: [], skills: [],
      tools: [{ name: 'read', namespace: 'mcp__files', advertised: true, selected: false, observed: 'succeeded', observedAt: 200 }],
      toolsTruncated: false, skillsTruncated: false });
    const resolveTask = ({ accountId, taskId: selected }: { accountId: string; taskId: string }) => {
      if (accountId !== 'account_a') return null;
      const task = structuredClone(ledger.get(selected));
      if (task && swapped) task.observation.native.turnId = 'other_turn';
      return task;
    };
    const store = createTaskPlanStore({ coreHome, resolveTask, clock: () => ++now });
    const identity = { accountId: 'account_a', taskId };
    const plan = (revision: number) => ({ version: 1, observedAt: revision * 100, source: 'native-codex-current-turn', state: 'observed', native,
      revisions: Array.from({ length: revision }, (_, index) => ({ revision: index + 1, sourceCallId: `call_${index + 1}`,
        ...(index ? { supersedes: index } : {}), steps: [{ text: `Plan step ${index + 1}`, claimedStatus: 'completed', evidence: 'observed', verification: 'unverified' }] })), truncated: false });
    store.setEnabled(true, 0); expect(store.capture({ ...identity, observation: plan(1) })).toEqual({ recorded: true });
    expect(() => store.saveRequirements({ ...identity, expectedRevision: 0, texts: ['Original requirement'], captureConsent: false })).toThrow('Explicit content consent');
    expect(store.requirements(identity)).toBeNull();
    let book = store.saveRequirements({ ...identity, expectedRevision: 0, texts: ['Original requirement', 'Second requirement'], captureConsent: true });
    expect(book.propertyVerification).toBe('unavailable'); expect(book.native).toEqual(native);
    expect(book.history[0].source).toBe('user-original'); expect(book.consent.source).toBe('explicit-user-input');
    expect(store.saveRequirements({ ...identity, expectedRevision: book.revision, texts: ['Original requirement', 'Second requirement'], captureConsent: true }).revision).toBe(book.revision);
    const originalId = book.history[0].requirements[0].id;
    const review = { ...identity, expectedRevision: book.revision, requirementId: originalId, stepIndexes: [0], actionKeys: [book.availableActions[0].key], userConfirmed: true };
    expect(() => store.updateCoverage({ ...review, actionKeys: ['invented_action'] })).toThrow('trusted task owner');
    expect(() => store.updateCoverage({ ...review, verified: true })).toThrow('Invalid requirement coverage');
    book = store.updateCoverage(review);
    expect(book.coverage[0]).toMatchObject({ requirementId: originalId, requirementRevision: 1, planRevision: 1,
      stepIndexes: [0], actionReferences: [{ source: 'task-tool-result', name: 'read' }], userAttestation: { source: 'user-confirmed' } });
    expect(book.coverage[0].verification).toBeUndefined(); expect(book.propertyVerification).toBe('unavailable');
    expect(store.updateCoverage({ ...review, expectedRevision: book.revision }).coverageHistory).toHaveLength(1);
    const oldRevision = book.revision;
    store.capture({ ...identity, observation: plan(2) });
    expect(() => store.updateCoverage({ ...review, expectedRevision: oldRevision })).toThrow('revision changed');
    book = store.requirements(identity);
    expect(book.planRevision).toBe(2); expect(book.coverage).toEqual([]);
    expect(book.invalidation.reason).toBe('plan-changed'); expect(book.coverageHistory[0].userAttestation.source).toBe('user-confirmed');
    const reopened = createTaskPlanStore({ coreHome, resolveTask, clock: () => ++now });
    expect(reopened.requirements(identity).coverage).toEqual([]);
    store.setEnabled(false, 1);
    book = reopened.saveRequirements({ ...identity, expectedRevision: book.revision, texts: ['Corrected requirement'], captureConsent: true });
    expect(book.requirementRevision).toBe(2); expect(book.history[0].requirements[0].text).toBe('Original requirement');
    expect(book.history[1].source).toBe('user-correction'); expect(book.coverage).toEqual([]);
    expect(() => reopened.updateCoverage({ ...review, expectedRevision: book.revision })).toThrow('current correction');
    swapped = true; expect(() => reopened.requirements(identity)).toThrow('Invalid retained task requirements'); swapped = false;
    expect(() => reopened.requirements({ ...identity, accountId: 'different_account' })).toThrow('owner is unavailable');
    for (let revision = 3; revision <= 8; revision++) book = reopened.saveRequirements({ ...identity, expectedRevision: book.revision, texts: [`Correction ${revision}`], captureConsent: true });
    expect(() => reopened.saveRequirements({ ...identity, expectedRevision: book.revision, texts: ['Ninth correction'], captureConsent: true })).toThrow('history is full');
    expect(reopened.requirements(identity).history).toHaveLength(8); expect(reopened.requirements(identity).history[0].requirements[0].text).toBe('Original requirement');
    const constrained = createTaskPlanStore({ coreHome, resolveTask, maxBytes: 1 });
    expect(() => constrained.updateCoverage({ ...identity, expectedRevision: book.revision, requirementId: book.history.at(-1).requirements[0].id, stepIndexes: [], actionKeys: [], userConfirmed: false })).toThrow('quota');
    expect(reopened.requirements(identity).revision).toBe(book.revision);
    expect(() => constrained.deleteRequirements({ ...identity, expectedRevision: book.revision - 1 })).toThrow('revision changed');
    expect(constrained.deleteRequirements({ ...identity, expectedRevision: book.revision })).toEqual({ deleted: true }); expect(reopened.requirements(identity)).toBeNull();
    expect(reopened.get(identity).revisions.at(-1).revision).toBe(2);
  } finally { rmSync(coreHome, { recursive: true, force: true }); }
});
