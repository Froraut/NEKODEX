import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { RuntimeHost } = require("../launcher/electron/runtime.cjs");
const { RuntimeSupervisor } = require("../launcher/electron/runtime-supervisor.cjs");
const { AccountTunnelSupervisor, AccountTunnelPeer } = require("../launcher/electron/account-tunnel-supervisor.cjs");
const store = require("../launcher/electron/account-tunnels.cjs");

function fixture(releaseVersion = "6.1.31-nekodex.1", mode = "full", accountTunnelMode = true) {
  const root = mkdtempSync(join(tmpdir(), "nekodex-peer-patch-"));
  const configPath = join(root, "config.json"), binaryPath = join(root, "fixture-client");
  writeFileSync(binaryPath, "inert client placeholder");
  writeFileSync(configPath, JSON.stringify({ releaseVersion, mode, accountTunnelMode, browserHost: "launcher",
    browserInteractionMode: "automatic", automaticAppName: "Codex Native6", manualAppName: "Codex Zero Risk4",
    tunnel: { binaryPath }, accountTunnels: [] }));
  const read = () => JSON.parse(readFileSync(configPath, "utf8"));
  const logger = { info() {}, warn() {}, error() {} };
  const app = { getVersion: () => "6.1.32-nekodex.1", getPath: () => root };
  const supervisor = new RuntimeSupervisor({ app, logger, coreHome: root });
  supervisor.readConfig = read; supervisor.readSetupConfig = read;
  supervisor.publishAccountTunnelCapabilities = () => {};
  const starts: string[] = [], stops: string[] = [], versions: string[] = [];
  supervisor.stopForSetup = async () => { throw new Error("core must not stop"); };
  supervisor.startIfConfigured = async () => { throw new Error("core must not restart"); };
  supervisor.accountTunnelSupervisor = new AccountTunnelSupervisor({ readConfig: read, logger,
    peerFactory: (binding: any) => ({ binding, runtimeStatus: "unconfigured", tunnel: null, tunnelMonitorFailures: 0,
      recoveryTasks: new Set(), restartTimers: {}, tunnelControlControllers: new Map(),
      async startIfConfigured() {
        const peerConfig = AccountTunnelPeer.prototype.readConfig.call(this);
        versions.push(peerConfig.releaseVersion); starts.push(binding.accountId);
        this.runtimeStatus = "ready"; this.tunnel = { pid: 12345, exitCode: null, signalCode: null };
        return { status: "ready" };
      }, async shutdown() { stops.push(binding.accountId); this.tunnel = null; this.runtimeStatus = "stopped"; },
    }),
  }, () => {});
  const host = new RuntimeHost({ app, logger, coreHome: root, codexHome: join(root, "codex"), supervisor });
  return { root, configPath, read, host, supervisor, starts, stops, versions };
}
const firstId = `tunnel_${"a".repeat(32)}`;
const other = "00000000-0000-4000-8000-000000000002";

test("new patch launcher restores saved peer and adds another without stopping committed core or other peer", async () => {
  const f = fixture();
  try {
    const seed = store.prepareAccountTunnel({ coreHome: f.root, configPath: f.configPath,
      accountId: "default", tunnelId: firstId, runtimeKey: "synthetic-private-runtime-key" });
    store.commitAccountTunnel(seed);
    const keyPath = f.read().accountTunnels[0].tunnel.runtimeKeyFile;
    const core = { pid: 54321 }; f.supervisor.daemon = core;
    expect(await f.host.configureAccountTunnel("default", { tunnelId: firstId, reuseSavedCredentials: true })).toEqual({ ok: true, saved: true, ready: true });
    const peer = [...f.supervisor.accountTunnelSupervisor.peers.values()][0];
    expect(await f.host.configureAccountTunnel(other, { tunnelId: `tunnel_${"b".repeat(32)}`, runtimeKey: "second-synthetic-runtime-key" })).toEqual({ ok: true, saved: true, ready: true });
    expect(f.supervisor.daemon).toBe(core);
    expect([...f.supervisor.accountTunnelSupervisor.peers.values()][0]).toBe(peer);
    expect(f.starts).toEqual(["default", other]);
    // Restoration releases only its own placeholder peer; adding the other
    // account never stops the now-ready default peer.
    expect(f.stops).toEqual(["default"]);
    expect(f.versions).toEqual(["6.1.31-nekodex.1", "6.1.31-nekodex.1"]);
    expect(f.read().releaseVersion).toBe("6.1.31-nekodex.1");
    expect(f.read().accountTunnels[0].tunnel.runtimeKeyFile).toBe(keyPath);
    expect(readFileSync(keyPath, "utf8")).toBe("synthetic-private-runtime-key");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("pending cross-family, channel, downgrade and mode transitions remain fenced before writes", async () => {
  for (const [version, mode, accountMode] of [
    ["6.0.31-nekodex.1", "full", true], ["6.1.31-nekodex.2", "full", true],
    ["6.1.33-nekodex.1", "full", true], ["6.1.31-nekodex.1", "browser-only", true],
    ["6.1.31-nekodex.1", "full", false],
  ] as const) {
    const f = fixture(version, mode, accountMode);
    try {
      const before = readFileSync(f.configPath);
      await expect(f.host.configureAccountTunnel("default", { tunnelId: firstId, runtimeKey: "synthetic-private-runtime-key" })).rejects.toThrow("managed runtime upgrade");
      expect(readFileSync(f.configPath)).toEqual(before);
      expect(f.starts).toEqual([]); expect(f.stops).toEqual([]);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});
