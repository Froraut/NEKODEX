import { expect, test } from "bun:test";
import { forwardNativeCodexRequest } from "../src/native-passthrough";

test("native forwarding never replays POST redirects and strips connection-scoped headers both ways", async () => {
  let forwarded: Request | undefined;
  const response = await forwardNativeCodexRequest(new Request(
    "http://127.0.0.1:17841/v1/alpha/search",
    {
      method: "POST",
      headers: {
        authorization: "Bearer fixture-token",
        "content-type": "application/json",
        connection: "keep-alive, x-local-hop",
        "proxy-connection": "keep-alive",
        "x-local-hop": "must-not-leave-loopback",
        "x-end-to-end": "preserved",
      },
      body: JSON.stringify({ query: "fixture" }),
    },
  ), "alpha/search", async request => {
    forwarded = request;
    return new Response("redirected", {
      status: 307,
      headers: {
        location: "https://example.invalid/redirect-target",
        connection: "x-upstream-hop",
        "x-upstream-hop": "must-not-reach-client",
        "x-end-to-end-response": "preserved",
      },
    });
  });

  expect(forwarded).toBeDefined();
  expect(forwarded!.redirect).toBe("manual");
  expect(forwarded!.headers.get("connection")).toBeNull();
  expect(forwarded!.headers.get("proxy-connection")).toBeNull();
  expect(forwarded!.headers.get("x-local-hop")).toBeNull();
  expect(forwarded!.headers.get("x-end-to-end")).toBe("preserved");
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("https://example.invalid/redirect-target");
  expect(response.headers.get("connection")).toBeNull();
  expect(response.headers.get("x-upstream-hop")).toBeNull();
  expect(response.headers.get("x-end-to-end-response")).toBe("preserved");
});

test("missing native authentication cancels an unread upload before failing closed", async () => {
  let cancelled = false;
  const request = new Request("http://127.0.0.1:17841/v1/alpha/search", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
      },
      cancel() {
        cancelled = true;
      },
    }),
  });

  const response = await forwardNativeCodexRequest(request, "alpha/search");
  expect(response.status).toBe(401);
  expect((await response.json()).error.message).toContain("requires the incoming Bearer authorization");
  await Bun.sleep(0);
  expect(cancelled).toBe(true);
});

test("a configured background route remains authoritative without a launcher descriptor path", () => {
  const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"] as const;
  const childEnvironment: Record<string, string | undefined> = {
    ...process.env,
    CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY: "http://127.0.0.1:48124",
  };
  delete childEnvironment.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
  delete childEnvironment.CODEX_CHATGPT_WEB_NATIVE_PROXY;
  for (const key of proxyKeys) delete childEnvironment[key];

  // native-network intentionally snapshots the launcher-provided fallback at module startup.
  // This file imports native-passthrough (and therefore native-network) above, so a query-string
  // import is not an isolation boundary in Bun 1.4. Run the fixture in a clean module process whose
  // environment is established before the first import, matching the daemon's real startup order.
  const moduleUrl = new URL("../src/native-network.ts", import.meta.url).href;
  const fixture = `
    const calls = [];
    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({ url: request.url, proxy: init?.proxy });
      return new Response("ok");
    };
    const network = await import(${JSON.stringify(moduleUrl)});
    const ready = network.nativeNetworkBackgroundReady();
    const response = await network.fetchNativeCodex(new Request(
      "https://chatgpt.com/backend-api/codex/responses",
      { method: "POST", body: "{}" },
    ));
    process.stdout.write(JSON.stringify({ ready, status: response.status, calls }));
  `;
  const child = Bun.spawnSync([process.execPath, "-e", fixture], {
    env: childEnvironment,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (child.exitCode !== 0) {
    throw new Error(`isolated native-network fixture failed: ${child.stderr.toString()}`);
  }
  const result = JSON.parse(child.stdout.toString()) as {
    ready: boolean;
    status: number;
    calls: Array<{ url: string; proxy?: string }>;
  };
  expect(result.ready).toBe(true);
  expect(result.status).toBe(200);
  expect(result.calls).toEqual([{
    url: "https://chatgpt.com/backend-api/codex/responses",
    proxy: "http://127.0.0.1:48124",
  }]);
});
