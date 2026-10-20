import { expect, test } from "bun:test";
import { formatErrorResponse } from "../src/bridge";
import { waitForWebAdmission } from "../src/server-admission";

function clock() {
  let now = 0;
  return { now: () => now, sleep: async (ms: number) => { now += ms; } };
}

test("a Web request waits while only the tool tunnel is reconnecting, then proceeds", async () => {
  const time = clock();
  let accepting = false;
  const sleeps: number[] = [];
  const admitted = await waitForWebAdmission({ accepting: () => accepting, recoverable: () => true, holdMs: 60_000, pollMs: 1_000,
    now: time.now, sleep: async ms => { sleeps.push(ms); await time.sleep(ms); if (sleeps.length === 5) accepting = true; } });
  expect(admitted).toBe(true);
  expect(sleeps).toHaveLength(5);
});

test("the wait ends at its deadline, on a non-recoverable state or when the client leaves", async () => {
  const time = clock();
  expect(await waitForWebAdmission({ accepting: () => false, recoverable: () => true, holdMs: 5_000, pollMs: 1_000, ...time })).toBe(false);
  expect(time.now()).toBe(5_000);
  let polls = 0;
  expect(await waitForWebAdmission({ accepting: () => false, recoverable: () => false, holdMs: 60_000, pollMs: 1_000,
    sleep: async () => { polls++; } })).toBe(false);
  expect(polls).toBe(0);
  const controller = new AbortController();
  controller.abort();
  expect(await waitForWebAdmission({ accepting: () => false, recoverable: () => true, holdMs: 60_000, pollMs: 1_000,
    signal: controller.signal, sleep: async () => { polls++; } })).toBe(false);
  expect(polls).toBe(0);
});

test("NEKODEX's own unavailability keeps its message instead of the generic capacity code", async () => {
  const explicit = await formatErrorResponse(503, "server_error", "NEKODEX tool tunnel is running but cannot reach OpenAI.", "nekodex_unavailable").json();
  expect(explicit).toEqual({ error: { message: "NEKODEX tool tunnel is running but cannot reach OpenAI.", type: "server_error", code: "nekodex_unavailable" } });
  // A real upstream overload keeps the code Codex uses for retry-after backoff.
  const upstream = await formatErrorResponse(503, "server_error", "Upstream is overloaded").json() as { error: { code: string } };
  expect(upstream.error.code).toBe("server_is_overloaded");
});
