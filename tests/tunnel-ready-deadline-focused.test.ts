import { expect, test } from "bun:test";
import type { AppConfig } from "../src/config";
import { waitForTunnelReady, type TunnelRuntimeStatus } from "../src/tunnel";

const config = { mode: "full", tunnel: {} } as AppConfig;
const pending: TunnelRuntimeStatus = {
  ok: false,
  processRunning: true,
  healthy: true,
  ready: false,
  state: "healthy",
  detail: "pending",
};
const ready: TunnelRuntimeStatus = {
  ok: true,
  processRunning: true,
  healthy: true,
  ready: true,
  state: "ready",
  detail: "ready",
};

test("tunnel readiness gives each probe only the remaining deadline budget", async () => {
  let now = 0;
  const probeTimeouts: number[] = [];
  const waits: number[] = [];
  const result = await waitForTunnelReady(config, 1_500, undefined, {
    now: () => now,
    probe: (_config, _signal, timeoutMs) => {
      probeTimeouts.push(timeoutMs);
      now += 200;
      return probeTimeouts.length === 2 ? ready : pending;
    },
    wait: async delayMs => {
      waits.push(delayMs);
      now += delayMs;
    },
  });

  expect(result).toBe(ready);
  expect(probeTimeouts).toEqual([1_500, 300]);
  expect(waits).toEqual([1_000]);
});

test("zero or exhausted readiness budgets do not start another probe", async () => {
  let probes = 0;
  const zero = await waitForTunnelReady(config, 0, undefined, {
    now: () => 10,
    probe: () => { probes += 1; return ready; },
  });
  expect(zero.ok).toBe(false);
  expect(zero.detail).toContain("deadline elapsed");
  expect(probes).toBe(0);

  let now = 0;
  const exhausted = await waitForTunnelReady(config, 100, undefined, {
    now: () => now,
    probe: () => { probes += 1; now = 90; return pending; },
    wait: async delayMs => { now += delayMs; },
  });
  expect(exhausted).toBe(pending);
  expect(probes).toBe(1);
});

test("tunnel readiness preserves AbortSignal cancellation between probes", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled by owner");
  await expect(waitForTunnelReady(config, 1_000, controller.signal, {
    now: () => 0,
    probe: () => pending,
    wait: async () => { controller.abort(reason); },
  })).rejects.toBe(reason);
});
