import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LAUNCHER_BROWSER_HOST_KIND, LAUNCHER_BROWSER_IDLE_URL, LauncherRetainedConversationUnavailableError, notifyLauncherTurn } from '../src/launcher-browser-host';
const require = createRequire(import.meta.url);
const { BrowserAdmissionQueue } = require('../launcher/electron/browser-admission-queue.cjs');
const { BrowserControlServer } = require('../launcher/electron/control-server.cjs');
const { AccountBrowserPool } = require('../launcher/electron/account-pool.cjs');
const { BrowserHost } = require('../launcher/electron/browser-host.cjs');
const { createAccountRegistry } = require('../launcher/electron/account-registry.cjs');
const { AccountSafety } = require('../launcher/electron/account-safety.cjs');
const { BrowserTaskLedger } = require('../launcher/electron/browser-task-ledger.cjs');

async function fixture(hold: (polls: number) => boolean, onPoll: () => void = () => {},
  dispatchFactory?: (root: string) => (request: any, signal: AbortSignal) => Promise<unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'nekodex-queue-protocol-'));
  let polls = 0; let starts = 0;
  const dispatch = dispatchFactory?.(root);
  const queue = new BrowserAdmissionQueue({ file: join(root, 'queue.json'), autoPump: false,
    inspect: () => hold(polls) ? { reason: 'capacity' } : null,
    dispatch: async (request: any, signal: AbortSignal) => { starts++; if (dispatch) return dispatch(request, signal); return { surfaceId: 'a'.repeat(32), reused: false, connectorBound: false,
      taskProgressVersion: 1, taskProgressSequence: 0 }; }, releaseUnsent: async () => true, leaseCurrent: () => true });
  const pool = { admissionQueue: queue, registry: { snapshot: () => ({ mode: 'selected', selectedId: 'default' }) } };
  const host = { browserInteractionMode: () => 'automatic',
    queueTurn: (body: unknown, reveal: boolean) => {
      polls++; const result = AccountBrowserPool.prototype.queueTurn.call(pool, body, reveal); onPoll(); return result;
    }, cancelQueuedOwner: (trace: string, pid: number) => queue.cancelOwner(trace, pid),
    acknowledgeQueuedOwner: (trace: string, pid: number, surface: string) => queue.acknowledge(trace, pid, surface) };
  const server = await new BrowserControlServer({ logger: { info() {}, warn() {}, error() {} },
    getBrowserHost: () => host, getPreferences: () => ({ showBrowserDuringTurns: false }) }).start();
  const descriptor = join(root, 'browser.json');
  writeFileSync(descriptor, JSON.stringify({ version: 3, kind: LAUNCHER_BROWSER_HOST_KIND, profile: 'development',
    pid: process.pid, endpoint: 'http://127.0.0.1:39110', control: server.descriptor(),
    helper: { executable: process.execPath, script: import.meta.path }, partition: 'persist:codex-web-gpt-dev-chatgpt',
    idleUrl: LAUNCHER_BROWSER_IDLE_URL, surfaceId: 'a'.repeat(32), surfaceTargets: { ['a'.repeat(32)]: 'owned-test-target' },
    createdAt: new Date().toISOString() }), { mode: 0o600 });
  return { descriptor, queue, root, get polls() { return polls; }, get starts() { return starts; },
    async close() { queue.close(); await server.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('real control protocol keeps a queued owner alive beyond retry attempts and grants one lease', async () => {
  const f = await fixture(polls => polls < 3);
  try {
    const result = await notifyLauncherTurn(f.descriptor, { phase: 'start', taskProgressVersion: 1,
      traceId: 'trace-protocol-admit', helperPid: process.pid, requestedEffort: 'medium' }, 250);
    expect(result.surfaceId).toBe('a'.repeat(32));
    expect(f.polls).toBeGreaterThanOrEqual(3);
    expect(f.starts).toBe(1);
    expect(f.queue.entries).toHaveLength(1);
  } finally { await f.close(); }
}, 5000);

test('aborting a waiting helper obtains a durable not-sent cancellation receipt', async () => {
  const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  const f = await fixture(() => true, () => { timer ??= setTimeout(() => abort.abort(new DOMException('Stopped', 'AbortError')), 20); });
  try {
    const result = await notifyLauncherTurn(f.descriptor, { phase: 'start', taskProgressVersion: 1,
      traceId: 'trace-protocol-cancel', helperPid: process.pid, requestedEffort: 'medium' }, 250, abort.signal).catch(error => error);
    expect(result.name).toBe('AbortError');
    expect(f.starts).toBe(0);
    expect(f.queue.snapshot().entries[0].status).toBe('cancelled');
  } finally { clearTimeout(timer); await f.close(); }
}, 5000);

for (const priorSubmission of [false, true]) test(`retained precheck propagates typed failure only with no-work proof (prior submission: ${priorSubmission})`, async () => {
  let prechecks = 0;
  let captured: any;
  let pool: any;
  let ledger: any;
  const traceId = 'trace-retained-protocol';
  const f = await fixture(() => false, () => {}, root => {
    ledger = new BrowserTaskLedger(join(root, 'tasks.json'));
    if (priorSubmission) {
      const id = ledger.start(traceId, 'tab-prior-send', 1);
      ledger.progress(id, 'sending', 1);
    }
    const host = { accountId: 'default', state: { authenticated: true }, taskLedger: ledger,
      turnTabs: new Map(), ready: async () => {}, currentOperation: () => null,
      exactRetainedTurnTab: BrowserHost.prototype.exactRetainedTurnTab,
      precheckRetainedTurn(...args: unknown[]) {
        prechecks++;
        return BrowserHost.prototype.precheckRetainedTurn.apply(this, args);
      },
      beginTurn() { throw new Error('Retained precheck must fail before browser acquisition'); },
    };
    pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
      registry: createAccountRegistry(root), safety: new AccountSafety(root),
      hosts: new Map([['default', host]]), options: { maxTabs: 2 },
      taskLedgers: new Map([['default', ledger]]), unsentAdmissions: new Map(),
      reservations: new Map(), pendingAffinity: new Map(), traceOwners: new Map(),
      lastAssigned: new Map(), sequence: 0, selectionRevision: 0, affinity: new Map(),
      affinityPath: join(root, 'affinity.json'), capabilities: new Map([['default', { solAvailable: true }]]),
      connectors: new Map(), evidenceEpochs: new Map(), accountOperations: new Map(), accountReadOperations: new Map(),
      turnAdmission: { open: true, reason: null }, turnAdmissionRevision: 0,
      writeDescriptor() {}, publish() {}, logger: { warn() {} },
    });
    return async (req, signal) => {
      try {
        return await pool.beginTurn(req.traceId, false, req.helperPid, req.key, req.connector, true,
          { effort: req.effort, requestedAccountId: req.requestedAccountId,
            taskProgressVersion: 1, deferAffinity: true, admissionSignal: signal });
      } catch (error) { captured = error; throw error; }
    };
  });
  let restored: any;
  try {
    pool.admissionQueue = f.queue;
    f.queue.inspect = (req: unknown) => pool.previewAdmission(req);
    let cleanups = 0;
    f.queue.releaseUnsent = () => { cleanups++; throw new Error('No refund from a missing tab'); };
    const result = await notifyLauncherTurn(f.descriptor, { phase: 'start', taskProgressVersion: 1,
      traceId, helperPid: process.pid, requestedEffort: 'medium',
      conversationKey: 'b'.repeat(64), requireRetainedConversation: true }, 500).catch(error => error);
    expect(prechecks).toBe(1);
    expect(captured.code).toBe('retained_conversation_unavailable');
    expect(captured.workStarted).toBe(priorSubmission ? undefined : false);
    expect(f.starts).toBe(1);
    expect(pool.reservations.size).toBe(0);
    expect(pool.unsentAdmissions.size).toBe(0);
    expect(cleanups).toBe(0);
    expect(ledger.snapshot().length).toBe(priorSubmission ? 1 : 0);
    if (priorSubmission) {
      expect(result).toBeInstanceOf(AggregateError);
      expect(result.errors[0]).toBeInstanceOf(LauncherRetainedConversationUnavailableError);
      expect(await f.queue.cancelOwner(traceId, process.pid)).toEqual({ cancelled: false, notSent: false });
      expect(ledger.snapshot()[0].submission).toBe('uncertain');
    } else {
      expect(result).toBeInstanceOf(LauncherRetainedConversationUnavailableError);
      expect(result.workStarted).toBe(false);
      expect(f.queue.cancelledOwners.size).toBe(0);
      const saved = JSON.parse(readFileSync(join(f.root, 'queue.json'), 'utf8'));
      expect(saved.entries[0].terminalFailure).toEqual({ code: 'retained_conversation_unavailable', workStarted: false });
      restored = new BrowserAdmissionQueue({ file: join(f.root, 'queue.json'), autoPump: false,
        inspect: () => null, dispatch: () => { throw new Error('Must not redispatch'); }, alive: () => true });
      expect(restored.storageIssue).toBeNull();
      const replay = (() => { try { restored.request(f.queue.entries[0].request); } catch (error) { return error; } })() as any;
      expect(replay.code).toBe('retained_conversation_unavailable');
      expect(replay.workStarted).toBe(false);
    }
  } finally { restored?.close(); await f.close(); }
}, 5000);
