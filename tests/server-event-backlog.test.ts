import { expect, test } from "bun:test";
import type { ProviderAdapter } from "../src/adapters/base";
import { defaultConfig } from "../src/config";
import { responseRequest } from "../src/server";

function request(stream: boolean): Request {
  return new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "chatgpt-web/high", stream, input: "Queue regression fixture" }),
  });
}

test("an already cancelled request never starts its adapter", async () => {
  const abort = new AbortController();
  abort.abort(new Error("fixture cancelled before dispatch"));
  let runs = 0;
  const response = await responseRequest(new Request(request(false), { signal: abort.signal }),
    defaultConfig("browser-only"), () => ({
      name: "must-not-start",
      async runTurn() { runs += 1; },
    }), { rememberState: false });
  expect(runs).toBe(0);
  expect(response.status).toBe(400);
  expect((await response.json() as { error: { message: string } }).error.message).toContain("fixture cancelled before dispatch");
});

test("cancellation immediately before adapter dispatch cannot create a new owner", async () => {
  const abort = new AbortController();
  let runs = 0;
  const response = await responseRequest(new Request(request(false), { signal: abort.signal }),
    defaultConfig("browser-only"), () => {
      abort.abort(new Error("fixture cancelled at dispatch"));
      return { name: "must-not-start", async runTurn() { runs += 1; } };
    }, { rememberState: false });
  expect(runs).toBe(0);
  expect((await response.json() as { status: string }).status).toBe("failed");
});

test("non-stream responses drain events while the adapter runs", async () => {
  const total = 10_050;
  const adapter: ProviderAdapter = {
    name: "long-response-fixture",
    async runTurn(_parsed, _incoming, emit) {
      for (let index = 0; index < total; index += 1) {
        emit({ type: "text_delta", text: "x" });
        if (index % 128 === 0) await Bun.sleep(1);
      }
      emit({ type: "done", endTurn: true });
    },
  };
  const response = await responseRequest(request(false), defaultConfig("browser-only"), () => adapter, {
    rememberState: false,
  });
  const body = await response.json() as { status: string; output: Array<{ content: Array<{ text: string }> }> };
  expect(body.status).toBe("completed");
  expect(body.output[0]!.content[0]!.text).toBe("x".repeat(total));
});

for (const stream of [false, true]) test(`${stream ? "streaming" : "non-stream"} backlog overflow aborts and returns a structured failure`, async () => {
  let observedAbort = false;
  let escapedCallbackError: unknown;
  const adapter: ProviderAdapter = {
    name: "saturated-response-fixture",
    async runTurn(_parsed, incoming, emit) {
      incoming.abortSignal?.addEventListener("abort", () => { observedAbort = true; }, { once: true });
      // Match the production heartbeat/helper callbacks, which execute outside runTurn's
      // promise stack. A thrown queue push must never become an uncaught process error.
      await new Promise<void>(resolve => setTimeout(() => {
        try {
          for (let index = 0; index < 10_010; index += 1) emit({ type: "text_delta", text: "x" });
          emit({ type: "done", endTurn: true });
        } catch (error) {
          escapedCallbackError = error;
        } finally {
          resolve();
        }
      }, 0));
    },
  };
  const response = await responseRequest(request(stream), defaultConfig("browser-only"), () => adapter, {
    rememberState: false,
  });
  if (stream) {
    const body = await response.text();
    expect(body.match(/event: response.failed\n/g)).toHaveLength(1);
    expect(body).toContain("Adapter event backlog exceeded");
    expect(body).not.toContain("event: response.completed\n");
    expect(body.match(/data: \[DONE\]/g)).toHaveLength(1);
  } else {
    const body = await response.json() as { status: string; error: { message: string } };
    expect(body.status).toBe("failed");
    expect(body.error.message).toContain("Adapter event backlog exceeded");
  }
  expect(observedAbort).toBe(true);
  expect(escapedCallbackError).toBeUndefined();
});
