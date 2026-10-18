// Passive adapters over existing owners. No host creation, endpoint probes,
// shell commands, authentication or repair is permitted while exporting.
function supportReportSources({ app, webContents, mainWindow, runtimeHost, runtimeSupervisor, browserHost,
  logger, profile, now = Date.now }) {
  const sampled = value => ({ value, observedAt: now() });
  const tasks = () => [...(browserHost?.taskLedgers ?? [])].flatMap(([accountId, ledger]) =>
    ledger.snapshot().map(task => ({ ...task, accountId })));
  const health = () => {
    if (!runtimeSupervisor?.lastOwnedHealth) return undefined;
    const config = runtimeHost?.runtimeConfigSnapshot?.().config;
    const current = runtimeSupervisor.ownedHealthMatches?.(config, runtimeSupervisor.lastOwnedHealth) === true;
    return { value: runtimeSupervisor.lastOwnedHealth, observedAt: runtimeSupervisor.lastOwnedHealthAt,
      stale: !current, current };
  };
  const logs = () => logger?.recent?.() ?? [];
  return {
    app: () => sampled({ version: app.getVersion(), electron: process.versions.electron,
      chrome: process.versions.chrome, node: process.versions.node, platform: process.platform,
      arch: process.arch, packaged: app.isPackaged, channel: profile }),
    build: () => ({ version: app.getVersion(), releaseVersion: runtimeHost?.runtimeConfigSnapshot?.().config?.releaseVersion }),
    runtime: () => runtimeSupervisor?.capabilitySnapshot?.(),
    route: () => runtimeHost?.lastRouteDiagnostics,
    accounts: () => browserHost?.accountSnapshot?.().accounts,
    tunnel: () => runtimeSupervisor?.accountTunnelSupervisor?.snapshot?.()
      ?? (runtimeSupervisor ? { status: runtimeSupervisor.capabilitySnapshot().tunnelStatus,
        pid: runtimeSupervisor.tunnel?.pid, ready: runtimeSupervisor.reportedTunnelReady } : undefined),
    broker: () => {
      const current = health();
      if (!current) return undefined;
      return { observedAt: current.observedAt, stale: current.stale, value: {
        current: current.current, ownerPid: current.value.pid,
        brokerReady: current.value.broker_ready,
        nativeAccepting: current.value.native_accepting_turns,
        webAccepting: current.value.web_accepting_turns ?? current.value.accepting_turns,
        activeBrowserTurns: current.value.active_browser_turns,
        activeCompactionRuns: current.value.active_compaction_runs,
        draining: current.value.draining,
      } };
    },
    tasks: () => {
      const rows = tasks();
      return { value: { tasks: rows, queue: browserHost?.admissionQueue?.snapshot?.().entries,
        historyIssues: [...(browserHost?.taskLedgers ?? [])].filter(([, ledger]) => ledger.storageIssue)
          .map(([accountId]) => ({ accountId, issue: 'task-history-unavailable' })) },
        ...(rows.length ? { observedAt: Math.max(...rows.map(row => row.updatedAt)) } : {}) };
    },
    logs: () => logger?.filePath ? { filePath: logger.filePath } : logs(),
    processMemory: () => {
      const mainRenderer = mainWindow?.isDestroyed?.() === false ? mainWindow.webContents.getOSProcessId() : null;
      const chatProcesses = new Set();
      for (const contents of webContents.getAllWebContents()) {
        try {
          const host = new URL(contents.getURL()).hostname;
          if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com')) chatProcesses.add(contents.getOSProcessId());
        } catch { /* Unknown/retired documents do not establish a ChatGPT role. */ }
      }
      return sampled({ ...process.memoryUsage(), processes: app.getAppMetrics().map(metric => ({
        pid: metric.pid,
        kind: metric.type === 'Browser' ? 'main' : metric.type === 'GPU' ? 'gpu'
          : metric.pid === mainRenderer ? 'renderer' : chatProcesses.has(metric.pid) ? 'chatgpt'
            : metric.type === 'Utility' ? 'helper' : 'other',
        // Electron reports these fields in KiB; report schema uses bytes.
        workingSetSize: metric.memory.workingSetSize * 1024,
        peakWorkingSetSize: metric.memory.peakWorkingSetSize * 1024,
        ...(typeof metric.memory.privateBytes === 'number' ? { privateBytes: metric.memory.privateBytes * 1024 } : {}),
      })) });
    },
    crashes: () => ({ records: logs().filter(record =>
      ['launcher.renderer_gone', 'launcher.child_process_gone'].includes(record.event))
      .map(record => ({ at: record.at, reason: record.detail?.reason, exitCode: record.detail?.exitCode })) }),
    toolCounters: () => {
      const observed = tasks().filter(row => row.observation?.toolCounters);
      if (!observed.length) return undefined;
      const fields = ['total', 'succeeded', 'errors', 'samples', 'totalLatencyMs'];
      const value = Object.fromEntries(fields.map(key => [key, observed.reduce((sum, row) => sum + row.observation.toolCounters[key], 0)]));
      if (value.samples > 0) value.meanLatencyMs = value.totalLatencyMs / value.samples;
      return { value, observedAt: Math.max(...observed.map(row => row.updatedAt)) };
    },
  };
}

module.exports = { supportReportSources };
