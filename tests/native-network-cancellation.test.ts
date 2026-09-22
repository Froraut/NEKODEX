import { test, expect, spyOn } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAUNCHER_BROWSER_IDLE_URL } from '../src/launcher-browser-host';

for (const rejected of [false, true]) test(`cold route wait isolates caller cancellation (${rejected ? 'rejected' : 'resolved'} refresh)`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nekodex-native-cancel-'));
  const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy',
    'CODEX_CHATGPT_WEB_NATIVE_PROXY', 'CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY', 'CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR'];
  const saved = keys.map(key => [key, process.env[key]] as const);
  const descriptor = join(dir, 'launcher-browser.json');
  writeFileSync(descriptor, JSON.stringify({ version: 3, kind: 'codex-web-gpt-launcher', profile: 'production', pid: process.pid,
    endpoint: 'http://127.0.0.1:48125', control: { endpoint: 'http://127.0.0.1:48125', token: 't'.repeat(48) },
    helper: { executable: process.execPath, script: import.meta.path }, partition: 'persist:codex-web-gpt-chatgpt',
    idleUrl: LAUNCHER_BROWSER_IDLE_URL, surfaceId: 's'.repeat(32), surfaceTargets: {}, createdAt: new Date().toISOString(),
  }), { mode: 0o600 });
  for (const key of keys) delete process.env[key];
  process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR = descriptor;
  const control = Promise.withResolvers<Response>();
  let controls = 0;
  let controlSignal: AbortSignal | null | undefined;
  const dispatches: string[] = [];
  const mockFetch: typeof fetch = Object.assign(async (...[input, init]: Parameters<typeof fetch>): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith('http://127.0.0.1:48125')) {
      controls++;
      controlSignal = init?.signal;
      return control.promise;
    }
    if (!(input instanceof Request)) throw new Error('Expected native request');
    dispatches.push(input.headers.get('x-waiter')!);
    return new Response('native reply');
  }, { preconnect: globalThis.fetch.preconnect });
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(mockFetch);
  const abort = new AbortController();
  const request = (id: string, signal?: AbortSignal) => new Request(`https://chatgpt.com/backend-api/codex/responses?fixture=${rejected}`, {
    method: 'POST', body: '{}', headers: { 'x-waiter': id }, signal,
  });
  const a = request('a', abort.signal);
  const b = request('b');
  const removedA = spyOn(a.signal, 'removeEventListener');
  const removedB = spyOn(b.signal, 'removeEventListener');
  try {
    const { fetchNativeCodex } = await import(new URL(`../src/native-network.ts?cancel=${rejected}`, import.meta.url).href);
    const first = fetchNativeCodex(a);
    const second = fetchNativeCodex(b);
    // Both calls have synchronously reached resolve(); the shared control boundary is still pending.
    expect(controls).toBe(1);
    expect(controlSignal).toBeDefined();
    expect(dispatches).toEqual([]);
    const reason = new Error('caller cancelled');
    abort.abort(reason);
    // This must finish before control.resolve: a timeout catches the original latency defect.
    expect(await first.catch((error: unknown) => error)).toBe(reason);
    expect(controlSignal!.aborted).toBe(false);
    expect(removedA.mock.calls.some(([event]) => event === 'abort')).toBe(true);
    control.resolve(rejected ? new Response('', { status: 403 }) : Response.json({ proxy: '' }));
    if (rejected) {
      await expect(second).rejects.toThrow('HTTP 403');
      await expect(fetchNativeCodex(request('c'))).rejects.toThrow('HTTP 403');
      expect(dispatches).toEqual([]);
    } else {
      expect(await (await second).text()).toBe('native reply');
      expect(dispatches).toEqual(['b']);
    }
    expect(removedB.mock.calls.some(([event]) => event === 'abort')).toBe(true);
    expect(controls).toBe(1);
  } finally {
    control.resolve(Response.json({ proxy: '' }));
    fetchSpy.mockRestore();
    removedA.mockRestore();
    removedB.mockRestore();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}, 2000);
