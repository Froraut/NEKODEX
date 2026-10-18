// Read-only aggregation. Callers supply observations from existing owners, never
// lifecycle commands, browser probes, credentials, process arguments or chat data.
const fs = require("node:fs");
const path = require("node:path");
const { sanitizeForExport } = require("./logging.cjs");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");
const { READINESS_CODES } = require("./admission-failure-copy.cjs");

const REPORT_VERSION = 1;
const DEFAULT_LOG_BYTES = 128 * 1024;
const DEFAULT_LOG_RECORDS = 300;
const SOURCE_NAMES = ["app", "runtime", "build", "route", "accounts", "tunnel", "broker", "tasks", "logs", "processMemory", "crashes", "toolCounters"];
const STATES = new Set(["unknown", "unavailable", "ready", "not-ready", "unconfigured", "not-configured", "starting", "recovering", "stopping", "stopped", "absent", "degraded", "failed", "error", "idle", "running", "completed", "cancelled", "interrupted", "signed-out", "authenticated", "checking", "verified", "loaded", "missing", "invalid", "unreadable", "waiting", "observed", "active", "inactive", "local-usable", "full", "bridge", "automatic", "manual", "default", "root", "profile", "production", "development", "direct", "proxy", "system", "crashed", "oom", "killed", "clean-exit", "abnormal-exit", "launch-failed", "integrity-failure", "memory-eviction", "preparing", "sending-context", "context-accepted", "sending", "accepted", "responding", "waiting-tools", "failed-before-send", "send-uncertain", "failed-after-send", "not-sent", "uncertain"]);
const BOOL_FIELDS = ["ready", "current", "installed", "active", "routeMatches", "customProvider", "modelCatalogOverride", "brokerReady", "tunnelReady", "nativeAccepting", "webAccepting", "draining", "authenticated", "connectorReady", "enabled", "checked", "terminal", "retrySafe", "canOpen", "canCancel", "canDismiss", "packaged"];
const NUMBER_FIELDS = ["pid", "ownerPid", "daemonPid", "tunnelPid", "revision", "sequence", "activeTurns", "reserved", "successfulRequests", "count", "total", "completed", "failed", "cancelled", "aborted", "succeeded", "errors", "samples", "durationMs", "latencyMs", "totalLatencyMs", "minLatencyMs", "maxLatencyMs", "meanLatencyMs", "p50Ms", "p95Ms", "activeOperations", "pendingOperations", "activeBrowserTurns", "activeCompactionRuns", "exitCode"];
for (const code of [...READINESS_CODES, 'capacity', 'runtime-transition', 'local-admission', 'owner-reconnect-required',
  'previous-submission-needs-review', 'account-not-ready', 'account-checking', 'account-busy', 'paused',
  'task-history-unavailable', 'inspection-tabs', 'paused-global', 'paused-account']) STATES.add(code);
const STATE_FIELDS = ["status", "runtimeStatus", "nativeAvailability", "webAvailability", "tunnelStatus", "authenticationStatus", "configStatus", "providerSource", "interactionMode", "mode", "phase", "submission", "reason", "cause", "failure"];
const TIME_FIELDS = ["at", "createdAt", "updatedAt", "checkedAt", "authenticationCheckedAt", "lastVerifiedAt", "lastSuccessfulAt", "startedAt", "finishedAt", "observedAt"];

const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const finite = value => typeof value === "number" && Number.isFinite(value);
function timestamp(value) {
  if (!(typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value)) && !(finite(value) && value >= 0)) return null;
  const milliseconds = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(milliseconds) && milliseconds <= 8_640_000_000_000_000 ? new Date(milliseconds).toISOString() : null;
}
function version(value) {
  return typeof value === "string" && /^\d{1,5}(?:\.\d{1,5}){0,3}(?:[-+][a-zA-Z0-9.-]{1,64})?$/.test(value) ? value : null;
}
function limit(value, fallback, maximum) { return Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback; }
function metadata(value) {
  const source = object(value), result = {};
  for (const key of BOOL_FIELDS) if (typeof source[key] === "boolean") result[key] = source[key];
  for (const key of NUMBER_FIELDS) if (finite(source[key]) && (source[key] >= 0 || key === "exitCode")) result[key] = source[key];
  for (const key of STATE_FIELDS) if (STATES.has(source[key])) result[key] = source[key];
  for (const key of TIME_FIELDS) if (timestamp(source[key])) result[key] = timestamp(source[key]);
  for (const key of ["version", "releaseVersion", "runtimeVersion", "electron", "node", "chrome", "bun"]) {
    if (version(source[key])) result[key] = version(source[key]);
  }
  return result;
}
function pseudonyms() {
  const ids = new Map();
  return (kind, value) => {
    if (typeof value !== "string" || !value) return null;
    const key = `${kind}:${value}`;
    if (!ids.has(key)) ids.set(key, `${kind}-${[...ids.keys()].filter(item => item.startsWith(`${kind}:`)).length + 1}`);
    return ids.get(key);
  };
}
function identified(value, id) {
  const result = metadata(value);
  for (const [key, kind] of [["id", "task"], ["taskId", "task"], ["traceId", "trace"], ["tabId", "tab"], ["accountId", "account"], ["parentId", "task"], ["replacementId", "task"]]) {
    const alias = id(kind, value?.[key]);
    if (alias) result[key] = alias;
  }
  return result;
}
function rows(value, key) { return Array.isArray(value) ? value : Array.isArray(value?.[key]) ? value[key] : []; }
function projectSection(name, input, id) {
  const value = object(input);
  if (name === "app" || name === "build") {
    const result = metadata(value);
    for (const key of ["sourceRevision", "revision", "commit"]) if (typeof value[key] === "string" && /^[a-f0-9]{7,64}$/i.test(value[key])) result[key] = value[key];
    if (["darwin", "linux", "win32"].includes(value.platform)) result.platform = value.platform;
    if (["arm64", "x64", "ia32", "arm"].includes(value.arch)) result.arch = value.arch;
    if (["stable", "beta", "dev", "production", "development"].includes(value.channel)) result.channel = value.channel;
    return result;
  }
  if (name === "accounts") return {
    count: rows(input, "accounts").length,
    accounts: rows(input, "accounts").slice(0, 100).map(account => ({ ...metadata(account), id: id("account", account.id),
      availability: metadata(account.availability),
      tunnels: { automatic: metadata(account.tunnels?.automatic), manual: metadata(account.tunnels?.manual) } })),
  };
  if (name === "tasks") {
    const tasks = rows(input, "tasks");
    const unresolved = tasks.filter(task => task.phase !== "completed");
    const issues = rows(value.historyIssues).filter(row => row.issue === 'task-history-unavailable');
    const queue = rows(value.queue);
    return { total: tasks.length, unresolved: unresolved.length, truncated: unresolved.length > 2048,
      historyComplete: Array.isArray(value.historyIssues) ? issues.length === 0 : null,
      unavailableHistory: issues.slice(0, 100).map(row => ({ accountId: id('account', row.accountId), issue: 'task-history-unavailable' })),
      queued: queue.length, queueTruncated: queue.length > 2048,
      queue: queue.slice(0, 2048).map(row => identified(row, id)),
      tasks: unresolved.slice(0, 2048).map(task => identified(task, id)) };
  }
  if (name === "tunnel") return Array.isArray(input)
    ? { peers: input.slice(0, 200).map(peer => identified(peer, id)), truncated: input.length > 200 }
    : identified(value, id);
  if (name === "runtime") return { ...metadata(value),
    ...(Array.isArray(value.accountTunnels) ? { accountTunnels: value.accountTunnels.slice(0, 200).map(peer => identified(peer, id)) } : {}) };
  if (name === "route") return { ...metadata(value), availability: metadata(value.availability), catalog: metadata(value.catalog),
    // Never export custom provider labels, URLs, profiles or credential paths.
    issueCodes: Array.isArray(value.issueCodes) ? value.issueCodes.filter(code => ["integration-unreadable", "integration-drift", "config-missing", "config-invalid", "config-unreadable", "profile-unavailable", "profile-invalid", "profile-unreadable", "provider-invalid", "custom-provider", "catalog-override", "route-mismatch", "integration-recovery-pending"].includes(code)) : [] };
  if (name === "processMemory") {
    const memory = input?.memory ?? value;
    const memoryKeys = ["rss", "heapTotal", "heapUsed", "external", "arrayBuffers", "privateBytes", "sharedBytes", "residentSetBytes", "workingSetSize", "peakWorkingSetSize", "privateMemory", "sharedMemory"];
    const projectMemory = row => Object.fromEntries(memoryKeys.filter(key => finite(row?.[key]) && row[key] >= 0).map(key => [key, row[key]]));
    const result = projectMemory(memory);
    if (Array.isArray(value.processes)) {
      const processes = value.processes.slice(0, 128).map(row => ({ ...projectMemory(row),
        pid: Number.isSafeInteger(row?.pid) && row.pid > 0 ? row.pid : null,
        kind: ["main", "renderer", "chatgpt", "gpu", "helper", "other"].includes(row?.kind) ? row.kind : "other" }));
      result.unit = "bytes";
      result.processes = processes;
      result.processCount = value.processes.length;
      result.truncated = value.processes.length > processes.length;
      // A partial observation cannot establish the application's total memory.
      result.total = Object.fromEntries(["workingSetSize", "privateBytes"].map(key => [key,
        result.truncated || !processes.length || !processes.every(row => finite(row[key])) ? null
          : processes.reduce((sum, row) => sum + row[key], 0)]));
    }
    return result;
  }
  if (name === "crashes") return { records: rows(input, "records").slice(-50).map(crash => metadata(crash)),
    truncated: rows(input, "records").length > 50 };
  if (name === "toolCounters") return metadata(value); // Aggregates only; no tool names, calls, arguments or outputs.
  return metadata(value);
}

function readLogTail(filePath, maxBytes, io = fs) {
  const fd = io.openSync(filePath, "r");
  try {
    const stat = io.fstatSync(fd);
    if (!stat.isFile()) throw new Error("Unsupported log source");
    const length = Math.min(stat.size, maxBytes), start = stat.size - length;
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const count = io.readSync(fd, buffer, read, length - read, start + read);
      if (!count) break;
      read += count;
    }
    const text = buffer.subarray(0, read).toString("utf8");
    return { text: start ? text.slice(text.indexOf("\n") + 1) : text, truncated: start > 0 };
  } finally { io.closeSync(fd); }
}
function projectLogs(input, options) {
  const maxBytes = limit(options.maxLogBytes, DEFAULT_LOG_BYTES, 1024 * 1024);
  const maxRecords = limit(options.maxLogRecords, DEFAULT_LOG_RECORDS, 1000);
  let text, truncated = false;
  if (typeof input?.filePath === "string") {
    const tail = readLogTail(input.filePath, maxBytes, options.fs);
    text = tail.text; truncated = tail.truncated;
  } else if (Array.isArray(input) || Array.isArray(input?.records)) {
    const records = rows(input, "records");
    text = records.slice(-maxRecords).map(record => JSON.stringify(record)).join("\n");
    truncated = records.length > maxRecords;
  } else text = typeof input === "string" ? input : typeof input?.text === "string" ? input.text : "";
  const bytes = Buffer.from(text);
  if (bytes.length > maxBytes) {
    const tail = bytes.subarray(bytes.length - maxBytes).toString("utf8");
    text = tail.slice(tail.indexOf("\n") + 1); truncated = true;
  }
  const lines = text.split(/\r?\n/).filter(Boolean), records = [];
  for (const line of lines.slice(-maxRecords)) {
    try {
      const record = sanitizeForExport(JSON.parse(line));
      if (!timestamp(record.at) || !["debug", "info", "warning", "error"].includes(record.level)
        || typeof record.event !== "string" || !/^[a-z][a-z0-9_.-]{0,127}$/i.test(record.event)
        || record.event !== sanitizeForExport(record.event)) continue;
      records.push({ at: timestamp(record.at), level: record.level, event: record.event, detail: metadata(record.detail) });
    } catch { /* Partial/unstructured log lines may contain arbitrary user content. */ }
  }
  // Bound the actual exported text, including projection overhead.
  let output = records.map(record => JSON.stringify(record));
  while (output.length && Buffer.byteLength(`${output.join("\n")}\n`) > maxBytes) { output.shift(); truncated = true; }
  return { recordCount: output.length, maxBytes, maxRecords, truncated: truncated || lines.length > maxRecords,
    detailPolicy: "structural-metadata-only", text: output.length ? `${output.join("\n")}\n` : "" };
}

// Pure projection except for an explicitly supplied logs.filePath. For a fully
// pure build pass logs text/records; collectSupportReport also accepts the path.
function buildSupportReport(observations = {}, options = {}) {
  const createdAt = timestamp(typeof options.now === "function" ? options.now() : options.now ?? Date.now());
  if (!createdAt) throw new TypeError("Support report requires a valid observation time");
  const staleAfterMs = limit(options.staleAfterMs, 60_000, 24 * 60 * 60 * 1000);
  const id = pseudonyms(), sections = {};
  for (const name of SOURCE_NAMES) {
    const observation = observations[name];
    const wrapped = object(observation);
    const value = Object.hasOwn(wrapped, "value") ? wrapped.value : observation;
    const observedAt = timestamp(wrapped.observedAt);
    const collectedAt = timestamp(wrapped.collectedAt) ?? createdAt;
    const freshness = wrapped.stale === true || (observedAt && Date.parse(createdAt) - Date.parse(observedAt) > staleAfterMs)
      ? "stale" : observedAt && Date.parse(observedAt) <= Date.parse(createdAt) ? "current" : "unknown";
    const base = { collectedAt, observedAt, freshness };
    if (value === undefined || value === null || wrapped.available === false) {
      sections[name] = { ...base, available: false, reason: wrapped.reason === "collection-failed" ? "collection-failed" : "not-supplied" };
      continue;
    }
    try {
      const data = name === "logs" ? projectLogs(value, options) : projectSection(name, value, id);
      sections[name] = Object.keys(data).length ? { ...base, available: true, data }
        : { ...base, available: false, reason: "no-supported-fields" };
    } catch {
      // Do not export exception messages: they may carry credentials or content.
      sections[name] = { ...base, available: false, reason: "collection-failed" };
    }
  }
  return { reportVersion: REPORT_VERSION, createdAt, privacy: { identifiers: "report-local-pseudonyms", logs: "bounded-structural-metadata", contents: "excluded" }, sections };
}

async function collectSupportReport({ sources = {}, now = Date.now, ...options } = {}) {
  const observations = {};
  // Sources must be existing cached/read-only owners. This module has no process,
  // network, browser, lifecycle, authentication or task execution dependencies.
  await Promise.all(SOURCE_NAMES.map(async name => {
    try {
      const source = sources[name];
      const value = typeof source === "function" ? await source() : source;
      const wrapped = object(value);
      observations[name] = Object.hasOwn(wrapped, "value") ? { ...wrapped, collectedAt: now() }
        : { value, collectedAt: now() };
    } catch { observations[name] = { available: false, reason: "collection-failed", collectedAt: now() }; }
  }));
  return buildSupportReport(observations, { ...options, now });
}

function writeSupportReport({ destinationPath, report, sourceLogPaths = [], write = writePrivateFileAtomic }) {
  if (!report || report.reportVersion !== REPORT_VERSION || !report.sections) throw new TypeError("Invalid support report");
  const destination = path.resolve(destinationPath);
  const destinationStat = fs.statSync(destination, { throwIfNoEntry: false });
  for (const sourcePath of sourceLogPaths) {
    const sourceStat = fs.statSync(sourcePath, { throwIfNoEntry: false });
    if (path.resolve(sourcePath) === destination || (sourceStat && destinationStat
      && sourceStat.dev === destinationStat.dev && sourceStat.ino === destinationStat.ino)) {
      throw new Error("Refusing to overwrite a source log with a support report");
    }
  }
  const content = `${JSON.stringify(report, null, 2)}\n`;
  const receipt = write(destination, content, { mode: 0o600, protectDirectory: false, durable: true });
  return { destinationPath: destination, bytes: Buffer.byteLength(content), ...receipt };
}

module.exports = { REPORT_VERSION, buildSupportReport, collectSupportReport, writeSupportReport };
