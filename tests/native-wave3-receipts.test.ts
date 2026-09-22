import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeNativeResponseBody } from '../src/native-passthrough';
import { NativeUsageOutbox } from '../src/native-usage-outbox';
import type { NativeUsageTelemetryEvent } from '../src/native-usage-telemetry';

const { validateNativeUsageSample } = require('../launcher/electron/usage-store.cjs');
function receipt(): NativeUsageTelemetryEvent {
  return { schemaVersion: 1, eventId: randomUUID(), source: 'native', endpoint: 'responses',
    requestedModelId: 'gpt-5', reportedModelId: null, startedAt: new Date().toISOString(),
    durationMs: 0, outcome: 'completed', httpStatus: 200, failureCategory: null,
    usageStatus: 'reported', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } };
}

test('replay discards receiver-invalid usage and dates so a valid receipt can be acknowledged', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nekodex-wave3-outbox-'));
  try {
    const outbox = new NativeUsageOutbox(directory);
    const invalid = [
      { ...receipt(), usage: { inputTokens: 2, outputTokens: 3, totalTokens: 4 } },
      { ...receipt(), usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5, cachedInputTokens: 3 } },
      { ...receipt(), usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5, reasoningOutputTokens: 4 } },
      { ...receipt(), startedAt: new Date().toISOString().replace('Z', '+00:00') },
    ];
    for (const event of invalid) {
      expect(() => validateNativeUsageSample(event)).toThrow();
      expect(() => outbox.put(event)).toThrow();
      writeFileSync(join(directory, `${event.eventId}.json`), JSON.stringify(event));
    }
    const valid = receipt();
    writeFileSync(join(directory, `${valid.eventId}.json`), JSON.stringify(valid));
    expect(outbox.pending()).toEqual([valid]);
    for (const event of invalid) expect(existsSync(join(directory, `${event.eventId}.json`))).toBe(false);
    expect(() => validateNativeUsageSample(valid)).not.toThrow();
    outbox.acknowledge(valid.eventId);
    expect(outbox.pending()).toEqual([]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('oversized usage preserves terminal receipt on cancellation and exact bytes with unreported usage', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nekodex-wave3-cancel-'));
  try {
    const outbox = new NativeUsageOutbox(directory);
    let cancelled: unknown;
    const payload = new TextEncoder().encode(`data: ${JSON.stringify({ type: 'response.completed',
      response: { model: 'gpt-5', usage: { input_tokens: 1_000_000_001, output_tokens: 0, total_tokens: 1_000_000_001 } },
    })}\n\n`);
    const events: NativeUsageTelemetryEvent[] = [];
    const source = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(payload); },
      cancel(reason) { cancelled = reason; },
    });
    const observed = observeNativeResponseBody(source, {
      endpoint: 'responses', requestedModelId: 'gpt-5', startedAt: new Date().toISOString(),
      startedAtMs: Date.now(), httpStatus: 200, eventStream: true, signal: new AbortController().signal,
    }, event => { const complete = { ...receipt(), ...event }; outbox.put(complete); events.push(complete); });
    const reader = observed.getReader();
    expect((await reader.read()).value).toEqual(payload);
    await reader.cancel('terminal consumed');
    expect(cancelled).toBe('terminal consumed');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'completed', failureCategory: null, usageStatus: 'unreported', usage: null });
    expect(() => validateNativeUsageSample(events[0])).not.toThrow();
    expect(outbox.pending()).toEqual(events);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
