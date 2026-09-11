import { expect, test } from "bun:test";
import { defaultConfig } from "../src/config";
import { startServer } from "../src/server";

// Deliberately fail inside a fake adapter: reaching it is the trust-boundary observation,
// without opening a browser, contacting an account, or persisting conversation state.
async function withFixture(run: (fixture: {
  endpoint: string;
  calls: () => number;
  controlToken: string;
}) => Promise<void>): Promise<void> {
  const config = { ...defaultConfig("browser-only"), port: 0 };
  let calls = 0;
  const server = startServer(config, {
    adapterFactory: () => ({
      name: "http-security-fixture",
      async runTurn() {
        calls += 1;
        throw new Error("isolated HTTP security fixture reached");
      },
    }),
  });
  try {
    await run({
      endpoint: `http://127.0.0.1:${server.port}`,
      calls: () => calls,
      controlToken: config.controlToken,
    });
  } finally {
    await server.stop(true);
  }
}

function turn(headers: HeadersInit): RequestInit {
  return {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "chatgpt-web/high",
      stream: false,
      input: [{ role: "user", content: "isolated security fixture" }],
    }),
  };
}

test("rejects browser cross-origin requests before the ChatGPT adapter is invoked", async () => {
  await withFixture(async ({ endpoint, calls }) => {
    for (const origin of ["https://untrusted.example", "null", "http://localhost:1"]) {
      const response = await fetch(`${endpoint}/v1/responses`, turn({
        origin,
        "content-type": "text/plain",
      }));
      await response.text();
      expect(response.status).toBe(403);
      expect(calls()).toBe(0);
    }
  });
});

test("rejects rebinding Host values on both responses and health endpoints", async () => {
  await withFixture(async ({ endpoint, calls }) => {
    const port = new URL(endpoint).port;
    for (const host of [`untrusted.example:${port}`, `127.0.0.1.untrusted.example:${port}`, "127.0.0.1:1"]) {
      const response = await fetch(`${endpoint}/v1/responses`, turn({
        host,
        "content-type": "application/json",
      }));
      await response.text();
      expect(response.status).toBe(403);
      const health = await fetch(`${endpoint}/healthz`, { headers: { host } });
      await health.text();
      expect(health.status).toBe(403);
      expect(calls()).toBe(0);
    }
  });
});

test("rejects browser-safelisted body types on JSON API routes", async () => {
  await withFixture(async ({ endpoint, calls }) => {
    for (const path of ["/v1/responses", "/v1/responses/compact", "/v1/alpha/search"]) {
      for (const mediaType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=test"]) {
        const response = await fetch(`${endpoint}${path}`, turn({ "content-type": mediaType }));
        await response.text();
        expect(response.status).toBe(415);
        expect(calls()).toBe(0);
      }
    }
  });
});

test("accepts native no-Origin JSON and exact same-origin requests", async () => {
  await withFixture(async ({ endpoint, calls }) => {
    const requests: HeadersInit[] = [
      { "content-type": "application/json" },
      { "content-type": "application/json; charset=utf-8", origin: endpoint },
    ];
    for (const headers of requests) {
      const response = await fetch(`${endpoint}/v1/responses`, turn(headers));
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain("isolated HTTP security fixture reached");
    }
    expect(calls()).toBe(2);
    const host = `localhost:${new URL(endpoint).port}`;
    const health = await fetch(`${endpoint}/healthz`, { headers: { host } });
    expect(health.status).toBe(200);
    await health.text();
  });
});

test("rejects cross-site fetch metadata without Origin and preserves admin bearer auth", async () => {
  await withFixture(async ({ endpoint, calls, controlToken }) => {
    const response = await fetch(`${endpoint}/v1/responses`, turn({
      "content-type": "application/json",
      "sec-fetch-site": "cross-site",
    }));
    await response.text();
    expect(response.status).toBe(403);
    expect(calls()).toBe(0);

    const unauthorized = await fetch(`${endpoint}/admin/drain`, { method: "POST" });
    await unauthorized.text();
    expect(unauthorized.status).toBe(401);
    const authorized = await fetch(`${endpoint}/admin/drain`, {
      method: "POST",
      headers: { authorization: `Bearer ${controlToken}` },
    });
    await authorized.text();
    expect(authorized.status).toBe(200);
  });
});
