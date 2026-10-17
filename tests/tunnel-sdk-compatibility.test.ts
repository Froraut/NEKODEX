import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { AppConfig } from "../src/config";
import { connectTunnel, installTunnelClient, snapshotTunnelClientInstallation, TUNNEL_VERSION, tunnelClientInstallAction } from "../src/tunnel";
import { tunnelServiceDefinition } from "../src/tunnel-service";

const require = createRequire(import.meta.url);
const { RuntimeSupervisor } = require("../launcher/electron/runtime-supervisor.cjs");

function configAt(root: string, binaryPath: string): AppConfig {
  return { mode: "full", browserInteractionMode: "automatic", runtimeCommand: ["unused-runtime"],
    brokerSocketPath: join(root, "broker.sock"), tunnel: { binaryPath, profileDir: root,
      profileName: "saved-profile", alias: "saved-alias", tunnelId: `tunnel_${"a".repeat(32)}`,
      runtimeKeyFile: join(root, "saved-key") } } as AppConfig;
}

test("SDK 0.0.16 accepts the previously pinned .12 without admitting unknown upgrades", () => {
  expect(TUNNEL_VERSION).toBe("0.0.16");
  expect(tunnelClientInstallAction("0.0.16")).toBe("reuse");
  expect(tunnelClientInstallAction("0.0.12")).toBe("upgrade");
  expect(tunnelClientInstallAction("0.0.10")).toBe("upgrade");
  expect(() => tunnelClientInstallAction("0.0.15")).toThrow("not a trusted upgrade source");
});

test("untrusted release checksum bytes fail before any installation write", async () => {
  const root = mkdtempSync(join(tmpdir(), "nekodex-sdk-integrity-"));
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const previousFetch = globalThis.fetch;
  process.env.CODEX_CHATGPT_WEB_HOME = root;
  const requests: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    requests.push(String(url));
    return new Response("untrusted release bytes");
  }) as typeof fetch;
  try {
    await expect(installTunnelClient()).rejects.toThrow("checksum manifest does not match the pinned release");
    expect(requests.every(url => url.startsWith("https://github.com/openai/tunnel-client/releases/download/v0.0.16/"))).toBe(true);
    expect(snapshotTunnelClientInstallation()).toEqual({ binary: {}, manifest: {} });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("CLI, launchd and desktop startup carry initialized handshake while preserving control environment", async () => {
  const root = mkdtempSync(join(tmpdir(), "nekodex-sdk-handshake-"));
  const binary = join(root, "tunnel-fixture");
  const receipt = join(root, "receipt.json");
  const previousFlag = process.env.MCP_STDIO_SEND_INITIALIZED_NOTIFICATION;
  process.env.MCP_STDIO_SEND_INITIALIZED_NOTIFICATION = "false";
  writeFileSync(binary, `#!${process.execPath}\nconst fs=require('node:fs'); const result={running:true,healthy:true,flag:process.env.MCP_STDIO_SEND_INITIALIZED_NOTIFICATION,proxy:process.env.HTTPS_PROXY,argv:process.argv.slice(2)};fs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify(result)); console.log(JSON.stringify(result));\n`, { mode: 0o700 });
  const config = configAt(root, binary);
  try {
    connectTunnel(config);
    const cli = JSON.parse(readFileSync(receipt, "utf8"));
    expect(cli.flag).toBe("true");
    expect(cli.argv).toContain("saved-alias");
    expect(cli.argv).toContain("saved-profile");
    expect(tunnelServiceDefinition(config)).toContain("<key>MCP_STDIO_SEND_INITIALIZED_NOTIFICATION</key>\n    <string>true</string>");
    const supervisor = new RuntimeSupervisor({ coreHome: root,
      tunnelProxyEnvironmentProvider: async () => ({ HTTPS_PROXY: "http://127.0.0.1:9999" }) });
    const recovery = new AbortController();
    const started = await supervisor.runTunnelCommand(config, ["runtimes", "connect"], 3_000, "fixture start", recovery.signal);
    expect(JSON.parse(started.stdout)).toMatchObject({ flag: "true", proxy: "http://127.0.0.1:9999" });
    const control = await supervisor.runTunnelCommand(config, ["runtimes", "cleanup", "--json"], 3_000, "fixture control", recovery.signal);
    expect(JSON.parse(control.stdout)).toMatchObject({ flag: "false", proxy: "http://127.0.0.1:9999" });
    recovery.abort();
    await expect(supervisor.runTunnelCommand(config, ["runtimes", "connect"], 3_000, "cancelled fixture", recovery.signal)).rejects.toThrow("cancelled");
  } finally {
    if (previousFlag === undefined) delete process.env.MCP_STDIO_SEND_INITIALIZED_NOTIFICATION;
    else process.env.MCP_STDIO_SEND_INITIALIZED_NOTIFICATION = previousFlag;
    rmSync(root, { recursive: true, force: true });
  }
}, 10_000);
