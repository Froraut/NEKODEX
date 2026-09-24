import { expect, test } from 'bun:test';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { forwardNativeCodexRequest, type NativeCodexEndpoint } from '../src/native-passthrough';

test('Bun decoded loopback responses survive native forwarding and a downstream HTTP fetch', async () => {
  // A descriptor would enable real telemetry delivery; this fixture must run without one.
  expect(process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR).toBeUndefined();
  const fixtures: Array<{ endpoint: NativeCodexEndpoint; status: number; encoding: string; type: string; body: string }> = [
    { endpoint: 'responses/compact', status: 200, encoding: 'gzip', type: 'application/json',
      body: '{"status":"completed","output":[]}' },
    { endpoint: 'responses', status: 200, encoding: 'br', type: 'text/event-stream',
      body: 'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\ndata: [DONE]\n\n' },
    { endpoint: 'models', status: 503, encoding: 'gzip', type: 'application/json',
      body: '{"error":{"message":"fixture upstream unavailable"}}' },
    { endpoint: 'alpha/search', status: 200, encoding: 'identity', type: 'application/json',
      body: '{"results":[]}' },
  ];
  const observations: Array<{ encoding: string | null; body: string }> = [];
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const fixture = fixtures[Number(new URL(request.url).pathname.slice(1))]!;
    const bytes = fixture.encoding === 'gzip' ? gzipSync(fixture.body)
      : fixture.encoding === 'br' ? brotliCompressSync(fixture.body) : Buffer.from(fixture.body);
    return new Response(bytes, { status: fixture.status, headers: {
      'content-encoding': fixture.encoding, 'content-length': String(bytes.length),
      'content-type': fixture.type, 'x-request-id': 'fixture-only',
    } });
  } });
  const bridge = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const index = Number(new URL(request.url).pathname.slice(1));
    return forwardNativeCodexRequest(request, fixtures[index]!.endpoint, async () => {
      // This is actual Bun fetch over TCP, not a fabricated decoded Response.
      const response = await fetch(new URL(String(index), upstream.url), {
        proxy: '', signal: AbortSignal.timeout(2000),
      });
      observations.push({ encoding: response.headers.get('content-encoding'), body: await response.clone().text() });
      return response;
    });
  } });
  try {
    for (const [index, fixture] of fixtures.entries()) {
      const response = await fetch(new URL(String(index), bridge.url), {
        method: fixture.endpoint === 'models' ? 'GET' : 'POST',
        headers: { authorization: 'Bearer fixture-only', 'content-type': 'application/json' },
        ...(fixture.endpoint === 'models' ? {} : { body: '{"model":"gpt-5","input":[]}' }),
        proxy: '', signal: AbortSignal.timeout(2000),
      });
      expect(response.status).toBe(fixture.status);
      expect(response.headers.get('content-encoding')).toBeNull();
      expect(response.headers.get('content-type')).toBe(fixture.type);
      expect(response.headers.get('x-request-id')).toBe('fixture-only');
      expect(await response.text()).toBe(fixture.body);
      expect(observations[index]).toEqual({ encoding: fixture.encoding, body: fixture.body });
    }
  } finally {
    bridge.stop(true);
    upstream.stop(true);
  }
}, 10000);
