import { expect, test, spyOn } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAUNCHER_BROWSER_IDLE_URL } from '../src/launcher-browser-host';
import { NativeRouteCache } from '../src/native-route-cache';

const responses = 'https://chatgpt.com/backend-api/codex/responses';
const compact = `${responses}/compact`;

test('detached native transport preserves exact routes and rejection across descriptor loss', async () => {
  // Bun can reuse the environment-snapshotted module despite import query strings.
  // Give this fixture its own process when run alongside other native-network tests.
  if (process.env.NEKODEX_EXACT_URL_FIXTURE !== '1') {
    const child = Bun.spawnSync([process.execPath, 'test', import.meta.path, '--test-name-pattern',
      'detached native transport', '--timeout', '5000'], {
      env: {...process.env, NEKODEX_EXACT_URL_FIXTURE: '1'}, timeout: 8000,
    });
    expect({exitCode: child.exitCode, stderr: child.exitCode ? child.stderr.toString() : ''})
      .toEqual({exitCode: 0, stderr: ''});
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'nekodex-exact-url-'));
  const descriptor = join(dir, 'descriptor.json');
  const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy',
    'CODEX_CHATGPT_WEB_NATIVE_PROXY', 'CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY', 'CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR'];
  const saved = keys.map(key => [key, process.env[key]] as const);
  const originalFetch = globalThis.fetch;
  let now = 1000;
  const clock = spyOn(performance, 'now').mockImplementation(() => now);
  const calls: Array<{url: string; proxy?: string}> = [];
  const controls: string[] = [];
  let reject = false;
  try {
    for (const key of keys) delete process.env[key];
    process.env.CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY = 'DIRECT';
    process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR = descriptor;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit & {proxy?: string}) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === 'http://127.0.0.1:48125/v1/network/resolve-proxy') {
        const target = JSON.parse(String(init?.body)).url;
        controls.push(target);
        return reject ? new Response('', {status: 403})
          : Response.json({proxy: target === compact ? 'http://127.0.0.1:48124' : ''});
      }
      calls.push({url, proxy: init?.proxy});
      return new Response('native reply');
    }) as typeof fetch;
    const network = await import(new URL('../src/native-network.ts?exact-url', import.meta.url).href);
    const send = (url: string) => network.fetchNativeCodex(new Request(url));
    // A real ENOENT descriptor boundary: bootstrap authorizes exactly responses, including DIRECT.
    expect(await (await send(responses)).text()).toBe('native reply');
    expect(calls).toEqual([{url: responses, proxy: ''}]);
    await expect(send(compact)).rejects.toThrow('route is unavailable');
    await expect(send(`${responses}?variant=1`)).rejects.toThrow('route is unavailable');
    delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
    await expect(send(compact)).rejects.toThrow('route is unavailable');
    expect(calls.length).toBe(1);
    process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR = descriptor;
    const descriptorBytes = JSON.stringify({version: 3, kind: 'codex-web-gpt-launcher', profile: 'production', pid: process.pid,
      endpoint: 'http://127.0.0.1:48125', control: {endpoint: 'http://127.0.0.1:48125', token: 't'.repeat(48)},
      helper: {executable: process.execPath, script: import.meta.path}, partition: 'persist:codex-web-gpt-chatgpt',
      idleUrl: LAUNCHER_BROWSER_IDLE_URL, surfaceId: 's'.repeat(32), surfaceTargets: {}, createdAt: new Date().toISOString()});
    writeFileSync(descriptor, descriptorBytes, {mode: 0o600});
    await send(compact);
    // Prove validation/control resolution and provider boundary were reached before losing descriptor.
    expect(controls).toEqual([compact]);
    expect(calls.at(-1)).toEqual({url: compact, proxy: 'http://127.0.0.1:48124'});
    unlinkSync(descriptor);
    await send(compact);
    expect(calls.at(-1)).toEqual({url: compact, proxy: 'http://127.0.0.1:48124'});
    // Recreate the same valid descriptor for a policy rejection of both previously usable routes.
    writeFileSync(descriptor, descriptorBytes, {mode: 0o600});
    now += 31_000;
    reject = true;
    await send(compact);
    await send(responses);
    await Bun.sleep(0);
    expect(controls).toEqual([compact, compact, responses]);
    unlinkSync(descriptor);
    const beforeBlocked = calls.length;
    await expect(send(compact)).rejects.toThrow('HTTP 403');
    await expect(send(responses)).rejects.toThrow('HTTP 403');
    expect(network.nativeNetworkBackgroundReady()).toBe(false);
    delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
    await expect(send(compact)).rejects.toThrow('HTTP 403');
    expect(calls.length).toBe(beforeBlocked);
    // Explicit global overrides remain intentionally global, even for an unknown URL.
    process.env.CODEX_CHATGPT_WEB_NATIVE_PROXY = 'http://127.0.0.1:48126';
    await send(`${responses}?explicit=1`);
    expect(calls.at(-1)?.proxy).toBe('http://127.0.0.1:48126');
    delete process.env.CODEX_CHATGPT_WEB_NATIVE_PROXY;
    process.env.HTTPS_PROXY = 'http://127.0.0.1:48127';
    await send(`${responses}?environment=1`);
    expect(calls.at(-1)?.proxy).toBeUndefined();
  } finally {
    clock.mockRestore();
    globalThis.fetch = originalFetch;
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(dir, {recursive: true, force: true});
  }
});

test('detached cache access keeps exact identity, bounded lease and blocked state', async () => {
  let now = 0;
  const routes = new NativeRouteCache(() => now);
  routes.seed(responses, '');
  expect(routes.cached(responses)).toBe('');
  expect(routes.cached(compact)).toBeUndefined();
  expect(routes.cached(`${responses}?q=1`)).toBeUndefined();
  now = 300_000;
  expect(routes.cached(responses)).toBeUndefined();
  await expect(routes.resolve(responses, async () => {throw new Error('policy rejected');}, () => false)).rejects.toThrow('policy rejected');
  routes.seed(responses, 'http://127.0.0.1:48123');
  expect(() => routes.cached(responses)).toThrow('policy rejected');
});
