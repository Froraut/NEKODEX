import { expect, test } from 'bun:test';
import { observeNativeResponseBody, withUncleanCloseTolerance } from '../src/native-response-body';
import type { enqueueNativeUsageTelemetry } from '../src/native-usage-telemetry';

type Receipt = Parameters<typeof enqueueNativeUsageTelemetry>[0];
const options = () => ({ endpoint: 'responses' as const, requestedModelId: 'gpt-5',
  startedAt: new Date().toISOString(), startedAtMs: Date.now(), httpStatus: 200,
  eventStream: true, signal: new AbortController().signal });
const terminal = 'event: response.completed\ndata: {"response":{"model":"gpt-5","usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}}\n\n';

test('telemetry stops interpreting after DONE while forwarding every original byte', async () => {
  const payload = 'data: [DONE]\r\n\r\n' + terminal;
  const bytes = new TextEncoder().encode(payload);
  // Split inside the terminator and CRLF to exercise incremental frame parsing.
  const events: Receipt[] = [];
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const chunk of [bytes.slice(0, 9), bytes.slice(9, 13), bytes.slice(13)]) controller.enqueue(chunk);
    controller.close();
  } });
  const output = observeNativeResponseBody(body, options(), event => events.push(event));
  expect(new Uint8Array(await new Response(output).arrayBuffer())).toEqual(bytes);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ outcome: 'incomplete', failureCategory: 'protocol', usage: null });
});

test('terminal before DONE retains usage and ignores later conflicting frames', async () => {
  const payload = terminal + 'data: [DONE]\n\nevent: response.failed\ndata: {"type":"error"}\n\n';
  const events: Receipt[] = [];
  expect(await new Response(observeNativeResponseBody(new Response(payload).body!, options(), event => events.push(event))).text()).toBe(payload);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ outcome: 'completed', failureCategory: null,
    usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } });
});

test('diagnostic callback failure cannot strand a completed stream after upstream reset', async () => {
  let pulls = 0, diagnostics = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    if (++pulls === 1) controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
    else controller.error(new Error('upstream reset'));
  } });
  const output = withUncleanCloseTolerance(body, true, () => { diagnostics++; throw new Error('diagnostic failed'); });
  expect(await new Response(output).text()).toBe('data: [DONE]\n\n');
  expect(pulls).toBe(2); expect(diagnostics).toBe(1);
}, 1000);
