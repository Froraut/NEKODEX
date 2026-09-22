import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeNativeResponseBody } from '../src/native-passthrough';
import { NativeUsageOutbox } from '../src/native-usage-outbox';
import type { NativeUsageTelemetryEvent } from '../src/native-usage-telemetry';

const { validateNativeUsageSample } = require('../launcher/electron/usage-store.cjs');

function receipt(): NativeUsageTelemetryEvent {
  return {
    schemaVersion: 1, eventId: randomUUID(), source: 'native', endpoint: 'responses',
    requestedModelId: 'gpt-5', reportedModelId: null, startedAt: new Date().toISOString(),
    durationMs: 0, outcome: 'completed', httpStatus: 200, failureCategory: null,
    usageStatus: 'unreported', usage: null,
  };
}

test('clean SSE EOF preserves terminal authority and forwards identical bytes exactly once', async () => {
  for (const outcome of ['completed', 'incomplete', 'failed'] as const) {
    const payload = `event: response.${outcome}\ndata: ${JSON.stringify({
      type: `response.${outcome}`, response: { model: 'gpt-5', usage: {
        input_tokens: 2, output_tokens: 3, total_tokens: 5,
      } },
    })}\n\ndata: [DONE]\n\n`;
    const bytes = new TextEncoder().encode(payload);
    const events: NativeUsageTelemetryEvent[] = [];
    const stream = observeNativeResponseBody(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 33));
      controller.enqueue(bytes.slice(33));
      controller.close();
    } }), {
      endpoint: 'responses', requestedModelId: 'gpt-5', startedAt: new Date().toISOString(),
      startedAtMs: Date.now(), httpStatus: 200, eventStream: true, signal: new AbortController().signal,
    }, event => events.push({ ...receipt(), ...event }));
    expect(new Uint8Array(await new Response(stream).arrayBuffer())).toEqual(bytes);
    expect(events).toHaveLength(1);
    expect(events[0]!.outcome).toBe(outcome);
    expect(events[0]!.failureCategory).toBe(outcome === 'failed' ? 'protocol' : null);
    expect(events[0]!.usage).toEqual({ inputTokens: 2, outputTokens: 3, totalTokens: 5 });
    expect(() => validateNativeUsageSample(events[0])).not.toThrow();
  }
});

test('missing terminal EOF stays incomplete/protocol with no invented usage', async () => {
  const events: NativeUsageTelemetryEvent[] = [];
  const payload = 'data: [DONE]\n\n';
  const stream = observeNativeResponseBody(new Response(payload).body!, {
    endpoint: 'responses', requestedModelId: 'gpt-5', startedAt: new Date().toISOString(),
    startedAtMs: Date.now(), httpStatus: 200, eventStream: true, signal: new AbortController().signal,
  }, event => events.push({ ...receipt(), ...event }));
  expect(await new Response(stream).text()).toBe(payload);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ outcome: 'incomplete', failureCategory: 'protocol', usageStatus: 'unreported', usage: null });
  expect(() => validateNativeUsageSample(events[0])).not.toThrow();
});

test('replay drops historical impossible receipts without rewriting valid usage or blocking the next receipt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nekodex-terminal-outbox-'));
  try {
    const invalid = { ...receipt(), startedAt: new Date(Date.now() - 1000).toISOString(), failureCategory: 'protocol' as const };
    const valid = { ...receipt(), usageStatus: 'reported' as const, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } };
    const badPath = join(dir, `${invalid.eventId}.json`);
    const goodPath = join(dir, `${valid.eventId}.json`);
    writeFileSync(badPath, JSON.stringify(invalid), { mode: 0o600 });
    const original = JSON.stringify(valid);
    writeFileSync(goodPath, original, { mode: 0o600 });
    const outbox = new NativeUsageOutbox(dir);
    expect(() => outbox.put(invalid)).toThrow('Invalid native usage event');
    expect(outbox.pending()).toEqual([valid]);
    expect(existsSync(badPath)).toBe(false);
    expect(readFileSync(goodPath, 'utf8')).toBe(original);
    // Same consumption boundary as drain(): only validated pending receipts reach the receiver.
    for (const event of outbox.pending()) {
      expect(() => validateNativeUsageSample(event)).not.toThrow();
      outbox.acknowledge(event.eventId);
    }
    expect(new NativeUsageOutbox(dir).pending()).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('outbox terminal-state validation agrees with receiver for transport, abort and failure receipts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nekodex-terminal-validation-'));
  const outbox = new NativeUsageOutbox(dir);
  const cases: Array<[Partial<NativeUsageTelemetryEvent>, boolean]> = [
    [{ outcome: 'failed', failureCategory: 'transport', httpStatus: 0 }, true],
    [{ outcome: 'aborted', failureCategory: 'aborted', httpStatus: 0 }, true],
    [{ outcome: 'aborted', failureCategory: 'aborted', httpStatus: 200 }, true],
    [{ outcome: 'incomplete', failureCategory: null }, true],
    [{ outcome: 'failed', failureCategory: null }, false],
    [{ outcome: 'aborted', failureCategory: 'protocol' }, false],
    [{ outcome: 'failed', failureCategory: 'transport', httpStatus: 200 }, false],
    [{ httpStatus: 0 }, false],
    [{ httpStatus: 99 }, false],
  ];
  try {
    for (const [fields, valid] of cases) {
      const event = { ...receipt(), ...fields };
      if (valid) {
        expect(() => validateNativeUsageSample(event)).not.toThrow();
        outbox.put(event);
        expect(outbox.pending()).toContainEqual(event);
        outbox.acknowledge(event.eventId);
      } else {
        expect(() => validateNativeUsageSample(event)).toThrow();
        expect(() => outbox.put(event)).toThrow('Invalid native usage event');
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
