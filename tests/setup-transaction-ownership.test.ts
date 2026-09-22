// Run this module in its own Bun process: boundary mocks deliberately replace OS/provider operations.
import { expect, test, mock } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as config from "../src/config";
import * as tunnel from "../src/tunnel";
import { restoreFileSnapshot, snapshotFile } from "../src/codex-integration-shared";

let finalCommit: () => void = () => { throw new Error("FINAL_COMMIT_FAULT"); };
let status: "stopped" | "running" | "unknown" = "running";
let reachedConnect = false;
let stops = 0;
let installedClient = "";
let profilePath = "";
let statusProbes = 0;
const absentService = () => ({ installed: false, loaded: false, supported: true });
mock.module("../src/service", () => ({ getServiceStatus: absentService, assertServiceIdle: async () => {},
  installService: () => { throw new Error("unexpected service install"); }, restartService: () => { throw new Error("unexpected restart"); },
  uninstallService: () => { throw new Error("unexpected uninstall"); }, removeLegacyRuntimeArtifacts: () => {} }));
mock.module("../src/tunnel-service", () => ({ getTunnelServiceStatus: absentService,
  installTunnelService: () => { throw new Error("unexpected service install"); }, restartTunnelService: () => {},
  stopTunnelService: () => {}, uninstallTunnelService: () => {}, tunnelServiceDefinitionMatches: () => false }));
mock.module("../src/launcher-browser-host", () => ({ inspectLauncherBrowserHost: async () => ({ solAvailable: false, extraHighAvailable: false, proAvailable: false }) }));
mock.module("../src/codex-integration", () => ({ preflightCodexIntegration: () => {},
  readCodexSubagentProtocol: () => "compatibility-v1", installCodexIntegration: () => finalCommit() }));
mock.module("../src/tunnel", () => ({ ...tunnel, installTunnelClient: async (_before: unknown, onInstalled: Function) => {
  installedClient = join(config.getConfigDir(), "bin", process.platform === "win32" ? "tunnel-client.exe" : "tunnel-client");
  config.atomicWriteFile(installedClient, "fixture-client", { mode: 0o700 });
  onInstalled(tunnel.snapshotTunnelClientInstallation());
  return installedClient;
} }));
mock.module("../src/process", () => ({ runChecked: () => { throw new Error("unexpected process"); },
  runCommand: (binary: string, args: string[]) => {
    expect(binary).toBe(installedClient);
    if (args[1] === "connect") {
      const key = args[args.indexOf("--runtime-api-key") + 1]!.slice(5);
      expect(readFileSync(key, "utf8")).toBe("fixture-key");
      expect(readFileSync(binary, "utf8")).toBe("fixture-client");
      profilePath = join(args[args.indexOf("--profile-dir") + 1]!, `${args[args.indexOf("--profile") + 1]}.yaml`);
      config.atomicWriteFile(profilePath, "candidate-profile");
      reachedConnect = true;
      return { status: 0, stdout: JSON.stringify({ running: true, healthy: false, ready: false, remote_error: "CONNECT_BOUNDARY_FAULT" }), stderr: "" };
    }
    if (args[1] === "status") {
      statusProbes++;
      expect(reachedConnect).toBe(true);
      expect(args[2]).toBe(profilePath.split("/").pop()!.replace(/\.yaml$/, ""));
      return { status: status === "unknown" ? 1 : 0, stdout: JSON.stringify({ process_running: status !== "stopped", runtime_state: status }), stderr: "" };
    }
    if (args[1] === "stop") { stops++; throw new Error("must not stop an unowned alias"); }
    throw new Error(`unexpected command ${args.join(" ")}`);
  } }));
const { setup, setupDevProfile } = await import("../src/setup");

async function isolated(body: () => Promise<void>) {
  const prior = process.env.CODEX_CHATGPT_WEB_HOME;
  const home = mkdtempSync(join(tmpdir(), "nekodex-setup-ownership-"));
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  try { await body(); } finally {
    if (prior === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = prior;
    rmSync(home, { recursive: true, force: true });
  }
}
const base = { acknowledgedUnofficial: true, browserHostDescriptorPath: "/fixture/descriptor", port: 58971 };

test("actual production setup final-commit failure restores owned config but preserves same-byte external inode/mode edits", async () => {
  for (const change of ["owned", "inode", "mode"] as const) await isolated(async () => {
    const before = config.defaultConfig();
    before.browserHost = "launcher";
    before.browserHostDescriptorPath = base.browserHostDescriptorPath;
    before.acknowledgedUnofficialAt = "2026-09-22T00:00:00Z";
    config.saveConfig(before);
    const original = readFileSync(config.getConfigPath());
    let candidate: ReturnType<typeof snapshotFile> | undefined;
    finalCommit = () => {
      candidate = snapshotFile(config.getConfigPath());
      expect(candidate.data!.equals(original)).toBe(false); // actual save reached before fault
      if (change === "inode") {
        const replacement = `${config.getConfigPath()}.external`;
        writeFileSync(replacement, candidate.data!, { mode: 0o400 });
        renameSync(replacement, config.getConfigPath());
      } else if (change === "mode") chmodSync(config.getConfigPath(), 0o400);
      throw new Error("FINAL_COMMIT_FAULT");
    };
    let message = "";
    try { await setup({ ...base, mode: "browser-only" }); } catch (e) { message = String(e); }
    expect(candidate).toBeDefined();
    expect(message).toContain("FINAL_COMMIT_FAULT");
    if (change === "owned") {
      expect(readFileSync(config.getConfigPath()).equals(original)).toBe(true);
      expect(message).not.toContain("rollback also failed");
    } else {
      expect(readFileSync(config.getConfigPath()).equals(candidate!.data!)).toBe(true);
      expect(lstatSync(config.getConfigPath()).mode & 0o777).toBe(0o400);
      expect(message).toContain("preserving the concurrent edit");
      if (change === "inode") expect(lstatSync(config.getConfigPath()).ino).not.toBe(candidate!.identity!.ino);
    }
  });
});

for (const caller of ["production", "development"] as const) test(`actual ${caller} first Full setup preserves dependencies after unhealthy connect until exact alias is confirmed stopped`, async () => {
  for (status of ["running", "unknown", "stopped"] as const) await isolated(async () => {
    reachedConnect = false; stops = 0; statusProbes = 0; profilePath = "";
    const options = { ...base, mode: "full" as const, browserInteractionMode: "manual" as const,
      tunnelId: `tunnel_${"a".repeat(32)}`, runtimeKeyValue: "fixture-key" };
    let message = "";
    try { await (caller === "production" ? setup(options) : setupDevProfile(options)); } catch (e) { message = String(e); }
    expect(reachedConnect).toBe(true);
    expect(statusProbes).toBe(1);
    expect(message).toContain("CONNECT_BOUNDARY_FAULT");
    expect(stops).toBe(0);
    expect(readFileSync(profilePath, "utf8")).toBe("candidate-profile");
    const retained = status !== "stopped";
    expect(existsSync(installedClient)).toBe(retained);
    expect(existsSync(tunnel.managedRuntimeKeyPath("manual"))).toBe(retained);
    if (retained) expect(message).toContain("manual recovery");
  });
});


test("writer receipts preserve BOM and refuse same-byte key/client replacements or mode edits", async () => {
  await isolated(async () => {
    const path = config.getConfigPath();
    const initial = config.defaultConfig();
    config.atomicWriteFile(path, `\uFEFF${JSON.stringify(initial)}\n`);
    const before = snapshotFile(path);
    const receipt = config.saveConfig({ ...initial, port: 58972 }, before);
    expect(receipt.identity).toEqual(snapshotFile(path).identity);
    expect(receipt.mode).toBe(0o600);
    expect(readFileSync(path, "utf8").startsWith("\uFEFF")).toBe(true);
    restoreFileSnapshot(before, { expectedCurrent: receipt });
    expect(readFileSync(path).equals(before.data!)).toBe(true);
    expect(() => config.saveConfig(initial, receipt)).toThrow("preserving the external edit");

    const keyPath = tunnel.managedRuntimeKeyPath("manual");
    const keyBefore = snapshotFile(keyPath);
    let keyReceipt: ReturnType<typeof snapshotFile> | undefined;
    tunnel.installRuntimeKeyBytes("key", "manual", (_bytes, owned) => { keyReceipt = owned; }, keyBefore);
    expect(keyReceipt!.identity).toEqual(snapshotFile(keyPath).identity);
    chmodSync(keyPath, 0o400);
    expect(() => restoreFileSnapshot(keyBefore, { expectedCurrent: keyReceipt })).toThrow("preserving the external edit");
    expect(() => tunnel.installRuntimeKeyBytes("new-key", "manual", undefined, keyReceipt)).toThrow("preserving the external edit");
    expect(readFileSync(keyPath, "utf8")).toBe("key");
    expect(lstatSync(keyPath).mode & 0o777).toBe(0o400);

    const clientBefore = tunnel.snapshotTunnelClientInstallation();
    const client = join(config.getConfigDir(), "bin", process.platform === "win32" ? "tunnel-client.exe" : "tunnel-client");
    const manifest = join(config.getConfigDir(), "bin", "tunnel-client-manifest.json");
    config.atomicWriteFile(client, "client", { mode: 0o700 });
    config.atomicWriteFile(manifest, "manifest");
    const clientOwned = tunnel.snapshotTunnelClientInstallation();
    writeFileSync(`${client}.replacement`, "client", { mode: 0o700 });
    renameSync(`${client}.replacement`, client);
    expect(() => tunnel.restoreTunnelClientInstallation(clientBefore, clientOwned)).toThrow("preserving the concurrent edit");
    expect(readFileSync(client, "utf8")).toBe("client");
    const externalClient = tunnel.snapshotTunnelClientInstallation();
    chmodSync(manifest, 0o400);
    expect(() => tunnel.restoreTunnelClientInstallation(clientBefore, externalClient)).toThrow("preserving the concurrent edit");
    expect(lstatSync(manifest).mode & 0o777).toBe(0o400);
  });
});
