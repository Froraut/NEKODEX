import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { supportReportSources } = require('../launcher/electron/support-report-sources.cjs');
const { collectSupportReport } = require('../launcher/electron/support-report.cjs');

test('support export samples cached owners and numeric process roles without creating hosts or running probes', async () => {
  let prohibited = 0;
  const probe = () => { prohibited++; throw new Error('probe must not run'); };
  const source = supportReportSources({
    app: { getVersion: () => '6.1.32-nekodex.7', isPackaged: false,
      getAppMetrics: () => [{ pid: 20, type: 'Tab', memory: { workingSetSize: 12, peakWorkingSetSize: 18 } }] },
    mainWindow: { isDestroyed: () => false, webContents: { getOSProcessId: () => 10 } },
    webContents: { getAllWebContents: () => [{ getURL: () => 'https://chatgpt.com/c/PRIVATE_CHAT', getOSProcessId: () => 20 }] },
    runtimeHost: { routeDiagnostics: probe, runtimeConfigSnapshot: () => ({ config: { releaseVersion: '6.1.32-nekodex.7' } }),
      lastRouteDiagnostics: { value: { installed: true, availability: { current: true, brokerReady: true } }, observedAt: 100 } },
    runtimeSupervisor: { capabilitySnapshot: () => ({ runtimeStatus: 'ready', brokerReady: true, tunnelStatus: 'ready' }),
      lastOwnedHealth: { broker_ready: true, active_browser_turns: 1 }, lastOwnedHealthAt: 150, ownedHealthMatches: () => true },
    browserHost: { snapshot: probe, getHost: probe, accountSnapshot: () => ({ accounts: [{ id: 'account-private', label: 'PRIVATE_LABEL', authenticated: true }] }),
      taskLedgers: new Map([['account-private', { snapshot: () => [{ id: 'task-private', traceId: 'trace-private', phase: 'responding',
        updatedAt: 190, observation: { observedAt: 20, toolCounters: { total: 3, succeeded: 2, errors: 0, samples: 2, totalLatencyMs: 40 } } }] }]]) },
    logger: { recent: () => [{ at: new Date(180).toISOString(), event: 'launcher.renderer_gone', level: 'error', detail: { reason: 'crashed', exitCode: 1, message: 'PRIVATE_MESSAGE' } }] },
    profile: 'development', now: () => 200,
  });
  const report = await collectSupportReport({ sources: source, now: () => 200 });
  expect(prohibited).toBe(0);
  expect(report.sections.processMemory.data.processes[0]).toMatchObject({ pid: 20, kind: 'chatgpt', workingSetSize: 12 * 1024 });
  expect(report.sections.toolCounters).toMatchObject({ observedAt: new Date(190).toISOString(), data: { succeeded: 2, meanLatencyMs: 20 } });
  expect(report.sections.route.data.availability.brokerReady).toBe(true);
  expect(report.sections.crashes.data.records[0]).toMatchObject({ reason: 'crashed', exitCode: 1 });
  expect(JSON.stringify(report)).not.toContain('PRIVATE_');
});

test('missing cached route, health and tool receipts remain unavailable instead of starting a collector', async () => {
  const source = supportReportSources({ app: { getVersion: () => '6.1.32' },
    webContents: { getAllWebContents: () => [] }, logger: { recent: () => [] } });
  const report = await collectSupportReport({ sources: source });
  expect(report.sections.route.available).toBe(false);
  expect(report.sections.broker.available).toBe(false);
  expect(report.sections.toolCounters.available).toBe(false);
});

test('retired health and unreadable histories remain explicit while waiting tasks are included', async () => {
  const source = supportReportSources({ app: { getVersion: () => '6.1.32' },
    runtimeSupervisor: { lastOwnedHealth: { pid: 91, broker_ready: true }, lastOwnedHealthAt: 190,
      ownedHealthMatches: () => false },
    browserHost: { taskLedgers: new Map([['private-account', { storageIssue: 'task-history-unavailable', snapshot: () => [] }]]),
      admissionQueue: { snapshot: () => ({ entries: [{ id: 'private-queue', accountId: 'private-account', status: 'waiting',
        reason: 'capacity', createdAt: 120, traceId: 'private-trace', prompt: 'PRIVATE_PROMPT' }] }) } },
    logger: { recent: () => [] }, now: () => 200,
  });
  const report = await collectSupportReport({ sources: source, now: () => 200 });
  expect(report.sections.broker).toMatchObject({ freshness: 'stale', data: { current: false, ownerPid: 91 } });
  expect(report.sections.tasks.data).toMatchObject({ historyComplete: false, queued: 1,
    unavailableHistory: [{ accountId: 'account-1', issue: 'task-history-unavailable' }],
    queue: [{ accountId: 'account-1', status: 'waiting', reason: 'capacity' }] });
  expect(JSON.stringify(report)).not.toContain('PRIVATE_PROMPT');
  expect(JSON.stringify(report)).not.toContain('private-account');
});
