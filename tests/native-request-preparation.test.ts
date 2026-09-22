import { test, expect } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { prepareNativeRequestBody } from '../src/native-request-preparation';
import { forwardNativeCodexRequest } from '../src/native-passthrough';

test('decoded local metadata does not replace encoded compact bytes or encoding headers', async () => {
  const raw = gzipSync('{ "model": "gpt-5", "input": [] }');
  const response = await forwardNativeCodexRequest(new Request('http://localhost/v1/responses/compact', {
    method: 'POST', headers: { authorization: 'Bearer fixture', 'content-encoding': 'gzip' }, body: raw,
  }), 'responses/compact', async request => {
    expect(new Uint8Array(await request.arrayBuffer())).toEqual(new Uint8Array(raw));
    expect(request.headers.get('content-encoding')).toBe('gzip');
    expect(request.redirect).toBe('manual');
    return new Response('{}');
  }, { model: 'gpt-5', input: [], metadata: { local_only: 'ownership' } });
  await response.text();
});

test('image preparation preserves opaque multipart bytes despite unrelated decoded metadata', async () => {
  const bytes = new Uint8Array([0, 255, 13, 10, 128, 1]);
  const result = await prepareNativeRequestBody(new Request('http://localhost/v1/images/edits', {
    method: 'POST', body: bytes,
  }), 'images/edits', { previous_response_id: 'local_ignored', input: [] });
  expect(result.kind).toBe('original');
  if (result.kind !== 'original') throw new Error('Expected original image bytes');
  expect(result.body).toEqual(bytes);
  expect(result.model).toBeUndefined();
  expect(result.compactionRequest).toBe(false);
});

test('retained local owner mismatch rejects before dispatch while unknown native IDs preserve bytes', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { rememberResponseState, flushResponseState } = await import('../src/responses/state');
  const { createResponseContinuationScopeFromBody } = await import('../src/responses/continuation-owner');
  const home = mkdtempSync(join(tmpdir(), 'native-preparation-owner-'));
  const previous = process.env.CODEX_CHATGPT_WEB_HOME;
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  try {
    const owned = { prompt_cache_key: 'native-preparation-owner-a', input: ['question'] };
    const scope = createResponseContinuationScopeFromBody(owned);
    expect(scope).toBeDefined();
    expect(rememberResponseState(owned, { id: 'resp_native_preparation_local', output: ['answer'] }, { scope }).status).toBe('retained');
    const body = JSON.stringify({ prompt_cache_key: 'native-preparation-owner-b', previous_response_id: 'resp_native_preparation_local', input: ['next'] });
    let dispatches = 0;
    const response = await forwardNativeCodexRequest(new Request('http://localhost/v1/responses', {
      method: 'POST', headers: { authorization: 'Bearer fixture' }, body,
    }), 'responses', async () => { dispatches++; return new Response('unexpected'); });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'local_continuation_owner_mismatch' } });
    expect(dispatches).toBe(0);
    const unknown = body.replace('resp_native_preparation_local', 'resp_unknown_native');
    const result = await prepareNativeRequestBody(new Request('http://localhost/v1/responses', { method: 'POST', body: unknown }), 'responses');
    expect(result.kind).toBe('original');
    if (result.kind !== 'original') throw new Error('Expected native continuation bytes');
    expect(new TextDecoder().decode(result.body)).toBe(unknown);
  } finally {
    flushResponseState();
    if (previous === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
});
