const { UNKNOWN_ACCOUNT_ID, COUNTERS, NATIVE_COUNTERS, dayOf, classificationKey, rowKey, emptyGroup, nativeGroupKey, nativeRowKey, emptyNativeGroup, normalizedFailureCode } = require('./usage-schema.cjs');

function reportPeriod(observedAt, days) {
  const generated = new Date(observedAt), first = new Date(generated);
  first.setDate(first.getDate() - days + 1);
  return { generated, startDay: dayOf(first), endDay: dayOf(generated),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
    calendarDays: Array.from({ length: days }, (_, offset) => {
      const date = new Date(first); date.setDate(first.getDate() + offset); return dayOf(date);
    }) };
}
function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function diagnosticDurations(values, eligibleSamples) {
  return { observedSamples: values.length, eligibleSamples,
    medianMs: median(values), p95Ms: quantile(values, 0.95) };
}

function diagnosticFailures(counts, expected) {
  const observed = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const classifiedFailureSamples = [...counts].reduce((sum, [code, count]) =>
    sum + (code === 'unknown' ? 0 : count), 0);
  if (observed < expected) counts.set('unknown', (counts.get('unknown') ?? 0) + expected - observed);
  const failures = [...counts].map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return { failures, classifiedFailureSamples };
}

function webDiagnosticGroups(rows, receipts) {
  const groups = new Map(), rowsByKey = new Map(rows.map(row => [rowKey(row), row]));
  for (const row of rows) {
    const key = classificationKey(row);
    const group = groups.get(key) ?? { source: 'web', ...emptyGroup(row), durations: [], failureCounts: new Map() };
    for (const field of COUNTERS) group[field] += row[field];
    groups.set(key, group);
  }
  for (const receipt of receipts) {
    const row = rowsByKey.get(receipt.key);
    if (!row) continue;
    const group = groups.get(classificationKey(row));
    if (receipt.outcome !== null && Number.isSafeInteger(receipt.durationMs)) group.durations.push(receipt.durationMs);
    if (receipt.outcome === 'failed') {
      const code = normalizedFailureCode(receipt.failureCode);
      group.failureCounts.set(code, (group.failureCounts.get(code) ?? 0) + 1);
    }
  }
  return [...groups.values()].map(group => {
    const { durations, failureCounts, aborted, ...identity } = group;
    const knownOutcomeTotal = group.completed + group.failed + aborted;
    return { ...identity, cancelled: aborted, knownOutcomeTotal,
      knownOutcomeCompletionRate: knownOutcomeTotal ? group.completed / knownOutcomeTotal : null,
      durations: diagnosticDurations(durations, knownOutcomeTotal),
      ...diagnosticFailures(failureCounts, group.failed) };
  }).sort((a, b) => classificationKey(a).localeCompare(classificationKey(b)));
}

function nativeDiagnosticGroups(rows, receipts) {
  const groups = new Map(), rowsByKey = new Map(rows.map(row => [nativeRowKey(row), row]));
  for (const row of rows) {
    const key = nativeGroupKey(row);
    const group = groups.get(key) ?? { source: 'native', ...emptyNativeGroup(row), durations: [], failureCounts: new Map() };
    for (const field of NATIVE_COUNTERS) group[field] += row[field];
    for (const [code, count] of Object.entries(row.failures)) {
      group.failureCounts.set(code, (group.failureCounts.get(code) ?? 0) + count);
    }
    groups.set(key, group);
  }
  for (const receipt of receipts) {
    const row = rowsByKey.get(receipt.key);
    if (row) groups.get(nativeGroupKey(row)).durations.push(receipt.durationMs);
  }
  return [...groups.values()].map(group => {
    const { durations, failureCounts, failures: _failures, httpStatuses: _httpStatuses,
      inputTokens: _inputTokens, outputTokens: _outputTokens, totalTokens: _totalTokens,
      cachedInputTokens: _cachedInputTokens, reasoningOutputTokens: _reasoningOutputTokens,
      reportedSamples: _reportedSamples, unreportedSamples: _unreportedSamples,
      cachedInputReportedSamples: _cachedInputReportedSamples,
      reasoningOutputReportedSamples: _reasoningOutputReportedSamples, aborted, ...identity } = group;
    const knownOutcomeTotal = group.completed + group.incomplete + group.failed + aborted;
    return { ...identity, cancelled: aborted, knownOutcomeTotal,
      knownOutcomeCompletionRate: knownOutcomeTotal ? group.completed / knownOutcomeTotal : null,
      durations: diagnosticDurations(durations, knownOutcomeTotal),
      ...diagnosticFailures(failureCounts, group.failed + aborted) };
  }).sort((a, b) => nativeGroupKey(a).localeCompare(nativeGroupKey(b)));
}

function publicNativeAggregate(value) {
  const row = structuredClone(value);
  row.reasoningTokens = row.reasoningOutputTokens;
  row.reasoningReportedSamples = row.reasoningOutputReportedSamples;
  delete row.reasoningOutputTokens;
  delete row.reasoningOutputReportedSamples;
  return row;
}

/** Project validated state without retaining or mutating any of its objects. */
function projectNativeUsage(state, days, observedAt, health) {
    const { generated, endDay, startDay, timeZone, calendarDays } = reportPeriod(observedAt, days);
    const calendar = calendarDays.map(day => ({ day, total: 0, completed: 0, incomplete: 0, failed: 0, cancelled: 0, unrecorded: 0,
      inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0,
      reportedSamples: 0, unreportedSamples: 0, cachedInputReportedSamples: 0, reasoningOutputReportedSamples: 0 }));
    const base = { source: 'native', generatedAt: generated.toISOString(), timeZone,
      period: { startDay, endDay, days }, selectedAccountId: null, accounts: [] };
    const emptyMetrics = { total: 0, messageCount: 0, responseCount: 0, completed: 0, incomplete: 0, failed: 0,
      cancelled: 0, unrecorded: 0, knownOutcomeTotal: 0, knownOutcomeCompletionRate: null };
    if (health.error) return { available: false, error: health.error, rows: [], diagnosticGroups: [], ...base, metrics: emptyMetrics,
      durations: { observedSamples: 0, medianMs: null, p95Ms: null }, failures: [], calendar,
      tokens: { inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null,
        reasoningTokens: null, reportedSamples: 0, unreportedSamples: 0,
        cachedInputReportedSamples: 0, reasoningReportedSamples: 0 } };
    const rows = Object.values(state.native.rows).filter(row => row.day >= startDay && row.day <= endDay)
      .sort((a, b) => a.day.localeCompare(b.day) || a.modelId.localeCompare(b.modelId));
    const metrics = rows.reduce((total, row) => ({ ...total, total: total.total + row.accepted,
      messageCount: total.messageCount + row.accepted, responseCount: total.responseCount + row.accepted,
      completed: total.completed + row.completed, incomplete: total.incomplete + row.incomplete, failed: total.failed + row.failed,
      cancelled: total.cancelled + row.aborted }), { ...emptyMetrics });
    metrics.knownOutcomeTotal = metrics.completed + metrics.incomplete + metrics.failed + metrics.cancelled;
    metrics.unrecorded = metrics.total - metrics.knownOutcomeTotal;
    metrics.knownOutcomeCompletionRate = metrics.knownOutcomeTotal ? metrics.completed / metrics.knownOutcomeTotal : null;
    const rowKeys = new Set(rows.map(nativeRowKey)), durations = [];
    for (const receipt of Object.values(state.native.receipts)) {
      if (rowKeys.has(receipt.key)) durations.push(receipt.durationMs);
    }
    const failures = new Map();
    const tokenSums = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0,
      reasoningOutputTokens: 0, reportedSamples: 0, unreportedSamples: 0,
      cachedInputReportedSamples: 0, reasoningOutputReportedSamples: 0 };
    const byDay = new Map(calendar.map(row => [row.day, row]));
    for (const row of rows) {
      for (const [code, count] of Object.entries(row.failures)) failures.set(code, (failures.get(code) ?? 0) + count);
      for (const field of Object.keys(tokenSums)) tokenSums[field] += row[field];
      const day = byDay.get(row.day);
      day.total += row.accepted; day.completed += row.completed; day.incomplete += row.incomplete;
      day.failed += row.failed; day.cancelled += row.aborted;
      for (const field of Object.keys(tokenSums)) day[field] += row[field];
    }
    const tokens = { inputTokens: tokenSums.reportedSamples ? tokenSums.inputTokens : null,
      outputTokens: tokenSums.reportedSamples ? tokenSums.outputTokens : null,
      totalTokens: tokenSums.reportedSamples ? tokenSums.totalTokens : null,
      cachedInputTokens: tokenSums.cachedInputReportedSamples ? tokenSums.cachedInputTokens : null,
      reasoningTokens: tokenSums.reasoningOutputReportedSamples ? tokenSums.reasoningOutputTokens : null,
      reportedSamples: tokenSums.reportedSamples, unreportedSamples: tokenSums.unreportedSamples,
      cachedInputReportedSamples: tokenSums.cachedInputReportedSamples,
      reasoningReportedSamples: tokenSums.reasoningOutputReportedSamples };
    const diagnosticGroups = nativeDiagnosticGroups(rows,
      Object.values(state.native.receipts).filter(receipt => rowKeys.has(receipt.key)));
    return { available: true, startedAt: state.startedAt, lifetime: state.native.lifetime,
      lifetimeGroups: Object.values(state.native.lifetimeGroups).map(publicNativeAggregate), lifetimeUnclassified: 0,
      recovered: health.recovered, backupAvailable: health.backupAvailable, rows: rows.map(publicNativeAggregate), ...base, metrics,
      durations: { observedSamples: durations.length, medianMs: median(durations), p95Ms: quantile(durations, 0.95) },
      failures: [...failures].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
      diagnosticGroups, calendar: calendar.map(publicNativeAggregate), tokens };
  }

/** Account metadata and store health are observations, never persistence owners. */
function projectWebUsage(state, { days, accountId }, accountMetadata, observedAt, health) {
    const { generated, endDay, startDay, timeZone, calendarDays } = reportPeriod(observedAt, days);
    const currentAccounts = new Map(accountMetadata.map(account => [account.id, account.label]));
    const historical = new Set([...Object.values(state.rows), ...Object.values(state.lifetimeGroups)].map(row => row.accountId));
    const accounts = [...currentAccounts].map(([id, label]) => ({ id, label, available: true }));
    for (const id of [...historical].sort()) if (!currentAccounts.has(id)) {
      accounts.push({ id, label: id === UNKNOWN_ACCOUNT_ID ? 'Historical / unknown' : 'Deleted account', available: false });
    }
    const base = { source: 'web', generatedAt: generated.toISOString(), timeZone,
      period: { startDay, endDay, days }, selectedAccountId: accountId, accounts };
    const calendar = calendarDays.map(day => ({ day, total: 0, completed: 0, failed: 0, cancelled: 0, unrecorded: 0 }));
    const emptyMetrics = { total: 0, messageCount: 0, completed: 0, failed: 0, cancelled: 0, unrecorded: 0,
      knownOutcomeTotal: 0, knownOutcomeCompletionRate: null, observedRunCount: 0,
      runCountCoverage: { observedMessages: 0, totalMessages: 0, complete: true } };
    if (health.error) return { available: false, error: health.error, rows: [], diagnosticGroups: [], ...base, metrics: emptyMetrics,
      durations: { observedSamples: 0, medianMs: null, p95Ms: null }, failures: [], calendar };

    const rows = Object.values(state.rows).filter(row => row.day >= startDay && row.day <= endDay
      && (accountId === null || row.accountId === accountId)).sort((a, b) => a.day.localeCompare(b.day));
    const metrics = rows.reduce((total, row) => ({ ...total, total: total.total + row.accepted,
      messageCount: total.messageCount + row.accepted, completed: total.completed + row.completed,
      failed: total.failed + row.failed, cancelled: total.cancelled + row.aborted }), { ...emptyMetrics });
    metrics.knownOutcomeTotal = metrics.completed + metrics.failed + metrics.cancelled;
    metrics.unrecorded = metrics.total - metrics.knownOutcomeTotal;
    metrics.knownOutcomeCompletionRate = metrics.knownOutcomeTotal ? metrics.completed / metrics.knownOutcomeTotal : null;

    const includedKeys = new Set(rows.map(rowKey)), durations = [], owners = new Set(), failureCounts = new Map();
    let observedMessages = 0, observedFailures = 0;
    for (const saved of Object.values(state.receipts)) {
      if (!includedKeys.has(saved.key)) continue;
      observedMessages++; owners.add(saved.owner);
      if (saved.outcome !== null && Number.isSafeInteger(saved.durationMs)) durations.push(saved.durationMs);
      if (saved.outcome === 'failed') {
        const code = normalizedFailureCode(saved.failureCode);
        failureCounts.set(code, (failureCounts.get(code) ?? 0) + 1); observedFailures++;
      }
    }
    metrics.observedRunCount = owners.size;
    metrics.runCountCoverage = { observedMessages, totalMessages: metrics.messageCount, complete: observedMessages === metrics.messageCount };
    if (metrics.failed > observedFailures) failureCounts.set('unknown', (failureCounts.get('unknown') ?? 0) + metrics.failed - observedFailures);

    const byDay = new Map(calendar.map(row => [row.day, row]));
    for (const row of rows) {
      const day = byDay.get(row.day);
      day.total += row.accepted; day.completed += row.completed; day.failed += row.failed; day.cancelled += row.aborted;
      day.unrecorded += row.accepted - row.completed - row.failed - row.aborted;
    }
    const lifetimeGroups = Object.values(state.lifetimeGroups).filter(row => accountId === null || row.accountId === accountId);
    const lifetimeUnclassified = accountId === null || accountId === UNKNOWN_ACCOUNT_ID ? state.lifetimeUnclassified : 0;
    const diagnosticGroups = webDiagnosticGroups(rows,
      Object.values(state.receipts).filter(receipt => includedKeys.has(receipt.key)));
    return { available: true, startedAt: state.startedAt,
      lifetime: lifetimeGroups.reduce((sum, row) => sum + row.accepted, lifetimeUnclassified),
      lifetimeGroups: structuredClone(lifetimeGroups), lifetimeUnclassified, recovered: health.recovered,
      backupAvailable: health.backupAvailable, rows: structuredClone(rows), ...base, metrics,
      durations: { observedSamples: durations.length, medianMs: median(durations), p95Ms: quantile(durations, 0.95) },
      failures: [...failureCounts].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
      diagnosticGroups, calendar };
}

module.exports = { projectWebUsage, projectNativeUsage };
