import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, loadConfig, type AppConfig } from "../src/config";
import { meaningfulRuntimeChange, transitionSetupConfig, type SetupTransitionContext } from "../src/setup-policy";

const { nativeBackgroundRoute, validateConfig } = require("../launcher/electron/runtime-config-contract.cjs");
const { RuntimeSupervisor } = require("../launcher/electron/runtime-supervisor.cjs");

const KEY = "CODEX_CHATGPT_WEB_NATIVE_BACKGROUND_ROUTE";
const VALID = ["DIRECT", "http://127.0.0.1:7890", "https://proxy.example:8443"];
const INVALID = ["", "direct", " DIRECT", "http://127.0.0.1:7890/", "socks5://127.0.0.1:7890",
  "http://user:pass@127.0.0.1:7890", "http://127.0.0.1:7890?x=1", 7890, null];

const directories: string[] = [];
const savedEnv = { home: process.env.CODEX_CHATGPT_WEB_HOME, route: process.env[KEY] };
function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "nekodex-background-route-"));
  directories.push(directory);
  return directory;
}
function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
afterEach(() => {
  restore("CODEX_CHATGPT_WEB_HOME", savedEnv.home);
  restore(KEY, savedEnv.route);
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function launcherConfig(descriptorPath: string, extra: Record<string, unknown> = {}) {
  return {
    version: 3, mode: "browser-only", releaseVersion: "6.1.31-nekodex.1",
    browserHost: "launcher", browserHostDescriptorPath: descriptorPath,
    host: "127.0.0.1", port: 17841, controlToken: "a".repeat(43), contextWindow: 256_000,
    appName: "Codex", chromeExecutablePath: "/chrome", storageStatePath: "/state.json",
    brokerSocketPath: "/tmp/broker.sock", headed: true, solAvailable: true, proAvailable: false,
    autoApproveToolCalls: false, runtimeCommand: ["/bun", "cli.ts"], ...extra,
  };
}

describe("persisted native background route", () => {
  test("the launcher contract accepts only DIRECT or an exact HTTP(S) origin", () => {
    for (const value of VALID) expect(nativeBackgroundRoute(value)).toBe(value);
    for (const value of INVALID) expect(() => nativeBackgroundRoute(value)).toThrow("nativeBackgroundRoute");
    const descriptor = "/tmp/descriptor.json";
    expect(validateConfig(launcherConfig(descriptor), descriptor, "darwin").nativeBackgroundRoute).toBeUndefined();
    expect(validateConfig(launcherConfig(descriptor, { nativeBackgroundRoute: "DIRECT" }), descriptor, "darwin")
      .nativeBackgroundRoute).toBe("DIRECT");
    expect(() => validateConfig(launcherConfig(descriptor, { nativeBackgroundRoute: "direct" }), descriptor, "darwin"))
      .toThrow("nativeBackgroundRoute");
  });

  test("setup keeps, sets and clears the choice and restarts the daemon when it changes", () => {
    const context: SetupTransitionContext = {
      defaults: defaultConfig("browser-only"), profile: "production", version: "6.1.31-nekodex.1",
      runtimeCommand: ["/bun", "cli.ts"], brokerEndpoint: "/tmp/broker.sock", acknowledgementTime: "2026-10-17T00:00:00.000Z",
    };
    const existing: AppConfig = {
      ...defaultConfig("browser-only"), acknowledgedUnofficialAt: context.acknowledgementTime, nativeBackgroundRoute: "DIRECT",
    };
    const kept = transitionSetupConfig(existing, { mode: "browser-only" }, context);
    expect(kept.nativeBackgroundRoute).toBe("DIRECT");
    const proxied = transitionSetupConfig(existing, { mode: "browser-only", nativeBackgroundRoute: "http://127.0.0.1:7890" }, context);
    expect(proxied.nativeBackgroundRoute).toBe("http://127.0.0.1:7890");
    expect(meaningfulRuntimeChange(kept, proxied)).toBe(true);
    const cleared = transitionSetupConfig(existing, { mode: "browser-only", nativeBackgroundRoute: null }, context);
    expect("nativeBackgroundRoute" in cleared).toBe(false);
    expect(() => transitionSetupConfig(existing, { mode: "browser-only", nativeBackgroundRoute: "direct" }, context))
      .toThrow("Native background route");
  });

  test("the saved configuration round-trips the route and rejects an invalid one", () => {
    process.env.CODEX_CHATGPT_WEB_HOME = tempDir();
    const path = join(process.env.CODEX_CHATGPT_WEB_HOME, "config.json");
    writeFileSync(path, JSON.stringify({ ...defaultConfig("browser-only"), nativeBackgroundRoute: "DIRECT" }));
    expect(loadConfig().nativeBackgroundRoute).toBe("DIRECT");
    writeFileSync(path, JSON.stringify({ ...defaultConfig("browser-only"), nativeBackgroundRoute: "http://127.0.0.1:7890/" }));
    expect(() => loadConfig()).toThrow("Invalid nativeBackgroundRoute");
  });

  async function daemonRoute(route: string | undefined): Promise<string> {
    const coreHome = tempDir();
    const lines: string[] = [];
    const logger = { info: (event: string, data?: { line?: string }) => {
      if (event === "runtime.daemon_stdout" && data?.line) lines.push(data.line);
    }, warn() {}, error() {} };
    const supervisor = new RuntimeSupervisor({
      app: { getVersion: () => "6.1.31-nekodex.1" }, logger, sourceRoot: coreHome, coreHome,
      browserDescriptorPath: join(coreHome, "descriptor.json"), launcherProfile: "development",
    });
    const child = supervisor.spawnChild("daemon", {
      executable: process.execPath,
      args: ["-e", `console.log("route=" + (process.env.${KEY} ?? "<unset>"))`],
      cwd: coreHome, env: {}, nativeBackgroundRoute: route,
    });
    await new Promise(resolve => child.once("exit", resolve));
    await new Promise(resolve => setTimeout(resolve, 50));
    return lines.find(line => line.startsWith("route=")) ?? "<no output>";
  }

  test("the daemon receives the saved route unless an explicit environment value wins", async () => {
    delete process.env[KEY];
    expect(await daemonRoute(undefined)).toBe("route=<unset>");
    expect(await daemonRoute("DIRECT")).toBe("route=DIRECT");
    process.env[KEY] = "http://127.0.0.1:7890";
    expect(await daemonRoute("DIRECT")).toBe("route=http://127.0.0.1:7890");
  }, 30_000);
});
