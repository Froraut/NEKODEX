import { expect, test } from "bun:test";

test("bootstrap fallback serves responses but only explicit global transport permits background readiness", async () => {
  const environmentProxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"] as const;
  const previousEnvironmentProxies = new Map(environmentProxyKeys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  const previousDescriptor = process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
  const previousFallback = process.env.CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY;
  const previousExplicit = process.env.CODEX_CHATGPT_WEB_NATIVE_PROXY;
  process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR = `/tmp/nekodex-missing-descriptor-${process.pid}`;
  process.env.CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY = "http://127.0.0.1:48123";
  delete process.env.CODEX_CHATGPT_WEB_NATIVE_PROXY;
  for (const key of environmentProxyKeys) delete process.env[key];
  const calls: Array<{ url: string; proxy?: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit & { proxy?: string }) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push({ url: request.url, proxy: init?.proxy });
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  try {
    const network = await import(new URL("../src/native-network.ts?background-fallback-test", import.meta.url).href);
    expect(network.nativeNetworkBackgroundReady()).toBe(false);
    const response = await network.fetchNativeCodex(
      new Request("https://chatgpt.com/backend-api/codex/responses", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(200);
    expect(calls).toEqual([{
      url: "https://chatgpt.com/backend-api/codex/responses",
      proxy: "http://127.0.0.1:48123",
    }]);
    // A working exact-URL fallback still cannot promise all endpoints after GUI quit.
    expect(network.nativeNetworkBackgroundReady()).toBe(false);
    process.env.CODEX_CHATGPT_WEB_NATIVE_PROXY = "http://127.0.0.1:48124";
    expect(network.nativeNetworkBackgroundReady()).toBe(true);
    process.env.CODEX_CHATGPT_WEB_NATIVE_PROXY = "socks5://127.0.0.1:48124";
    process.env.HTTPS_PROXY = "http://127.0.0.1:48125";
    expect(network.nativeNetworkBackgroundReady()).toBe(false);
    delete process.env.CODEX_CHATGPT_WEB_NATIVE_PROXY;
    expect(network.nativeNetworkBackgroundReady()).toBe(true);
    delete process.env.HTTPS_PROXY;
    expect(network.nativeNetworkBackgroundReady()).toBe(false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDescriptor === undefined) delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
    else process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR = previousDescriptor;
    if (previousFallback === undefined) delete process.env.CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY;
    else process.env.CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY = previousFallback;
    if (previousExplicit === undefined) delete process.env.CODEX_CHATGPT_WEB_NATIVE_PROXY;
    else process.env.CODEX_CHATGPT_WEB_NATIVE_PROXY = previousExplicit;
    for (const [key, value] of previousEnvironmentProxies) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
