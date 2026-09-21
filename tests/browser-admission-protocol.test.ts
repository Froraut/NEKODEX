import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LAUNCHER_BROWSER_HOST_KIND, LAUNCHER_BROWSER_IDLE_URL, notifyLauncherTurn } from '../src/launcher-browser-host';
const require = createRequire(import.meta.url);
const { BrowserAdmissionQueue } = require('../launcher/electron/browser-admission-queue.cjs');
const { BrowserControlServer } = require('../launcher/electron/control-server.cjs');
const { AccountBrowserPool } = require('../launcher/electron/account-pool.cjs');

async function fixture(hold: (polls: number) => boolean, onPoll: () => void = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'nekodex-queue-protocol-'));
  let polls = 0; let starts = 0;
  const queue = new BrowserAdmissionQueue({ file: join(root, 'queue.json'), autoPump: false,
    inspect: () => hold(polls) ? { reason: 'capacity' } : null,
    dispatch: async () => { starts++; return { surfaceId: 'a'.repeat(32), reused: false, connectorBound: false,
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
  return { descriptor, queue, get polls() { return polls; }, get starts() { return starts; },
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
