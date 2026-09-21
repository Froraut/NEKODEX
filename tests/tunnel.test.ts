import { describe, expect, test } from "bun:test";
import {
  TUNNEL_VERSION,
  parseTunnelStatus,
  removeTunnelInstallFile,
  tunnelClientInstallAction,
  tunnelCommandOutput,
  tunnelConnectLaunchError,
} from "../src/tunnel";

test("pins the fixed tunnel-client and migrates only the previously shipped version", () => {
  expect(TUNNEL_VERSION).toBe("0.0.12");
  expect(tunnelClientInstallAction("0.0.12")).toBe("reuse");
  expect(tunnelClientInstallAction("0.0.10")).toBe("upgrade");
  expect(() => tunnelClientInstallAction("0.0.11")).toThrow("not a trusted upgrade source");
  expect(() => tunnelClientInstallAction("9.9.9")).toThrow("not a trusted upgrade source");
});

test("Windows tunnel install cleanup retries transient file locks with bounded backoff", async () => {
  const waits: number[] = [];
  let attempts = 0;
  await removeTunnelInstallFile("staged.exe", {
    platform: "win32",
    remove() {
      attempts += 1;
      if (attempts < 4) throw Object.assign(new Error("locked"), { code: "EBUSY" });
    },
    wait: async delay => { waits.push(delay); },
    retryDelaysMs: [10, 20, 30, 40],
  });
  expect(attempts).toBe(4);
  expect(waits).toEqual([10, 20, 30]);
});

describe("tunnel status boundary", () => {
  test("requires the managed runtime process, health, and readiness together", () => {
    expect(parseTunnelStatus(JSON.stringify({
      entries: [{ alias: "ours", runtime_state: "ready" }, { alias: "other", runtime_state: "stopped" }],
    }), "ours")).toEqual({
      ok: true,
      processRunning: true,
      healthy: true,
      ready: true,
      state: "ready",
      detail: "process_running=true healthy=true ready=true",
    });
    expect(parseTunnelStatus(JSON.stringify({
      entries: [{ alias: "other", runtime_state: "ready" }],
    }), "ours")).toMatchObject({ ok: false, processRunning: false, healthy: false, ready: false, state: "stopped" });
  });

  test("redacts tunnel ids and keys from safe diagnostics", () => {
    const result = parseTunnelStatus(
      "failed tunnel_0123456789abcdef0123456789abcdef with sk-secretsecretsecret",
      "ours",
      1,
    );
    expect(result.detail).toBe("failed [tunnel-id] with [redacted-key]");
    expect(result.detail).not.toContain("0123456789abcdef");
  });

  test("surfaces and redacts an immediate managed-runtime launch failure", () => {
    const detail = tunnelConnectLaunchError(JSON.stringify({
      running: false,
      healthy: false,
      ready: false,
      exit_code: 1,
      launch_diagnostics: {
        log_tail: "403 for tunnel_0123456789abcdef0123456789abcdef using sk-secretsecretsecret",
      },
    }));

    expect(detail).toBe(
      "running=false; healthy=false; ready=false; exit_code=1; runtime_log=403 for [tunnel-id] using [redacted-key]",
    );
  });

  test("accepts a healthy managed launch while setup waits for control-plane readiness", () => {
    expect(tunnelConnectLaunchError(JSON.stringify({
      running: true,
      healthy: true,
      ready: true,
    }))).toBeUndefined();

    expect(tunnelConnectLaunchError(JSON.stringify({
      running: true,
      healthy: true,
      ready: false,
    }))).toBeUndefined();

    expect(tunnelConnectLaunchError(JSON.stringify({
      running: true,
      healthy: false,
      ready: false,
    }))).toContain("running=true; healthy=false; ready=false");

    expect(tunnelConnectLaunchError("not json")).toBe("tunnel-client returned non-JSON connect output");
  });

  test("rejects duplicate local inventory aliases instead of treating one as ready", () => {
    const result = parseTunnelStatus(JSON.stringify({
      entries: [{ alias: "ours", runtime_state: "ready" }, { alias: "ours", runtime_state: "ready" }],
    }), "ours");

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("duplicate aliases");
  });

  test("status diagnostics do not discard stderr when a failed command also wrote stdout", () => {
    expect(tunnelCommandOutput({
      status: 1,
      stdout: '{"partial":true}',
      stderr: "runtime process exited with status 1",
    })).toBe('runtime process exited with status 1\n{"partial":true}');
    expect(tunnelCommandOutput({
      status: 0,
      stdout: '{"ready":true}',
      stderr: "non-fatal warning",
    })).toBe('{"ready":true}');
  });
});
