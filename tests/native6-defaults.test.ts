import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, loadConfig, resolveInteractionConnectorIdentities, saveConfig } from "../src/config";
import { mcpCommand } from "../src/tunnel";

test("native6: new Full defaults and retained Native5 keep distinct MCP schemas", () => {
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const home = mkdtempSync(join(tmpdir(), "nekodex-native6-config-"));
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  try {
    const current = defaultConfig("full");
    // A durable runtime invocation avoids binding this fixture to the test entry point.
    current.runtimeCommand = [process.platform === "win32" ? process.execPath : "/usr/bin/env", join(import.meta.dir, "../src/cli.ts")];
    current.tunnel = { binaryPath: join(home, "tunnel-client"), tunnelId: "tunnel_" + "a".repeat(32), runtimeKeyFile: join(home, "key"), profileDir: home, profileName: "fixture", alias: "fixture" };
    expect(current.appName).toBe("Codex Native6");
    expect(current.experimentalAsyncToolOperations).toBe(true);
    saveConfig(current);
    expect(loadConfig().appName).toBe("Codex Native6");
    expect(mcpCommand(current)).toContain("--native6");
    const retained = { ...current, ...resolveInteractionConnectorIdentities("automatic", "production", true, "Codex Native5") };
    saveConfig(retained);
    expect(loadConfig().appName).toBe("Codex Native5");
    expect(mcpCommand(retained)).toContain("--async-tool-operations");
    expect(mcpCommand(retained)).not.toContain("--native6");
    const compatible = { ...current, ...resolveInteractionConnectorIdentities("automatic", "production", false), experimentalAsyncToolOperations: false };
    saveConfig(compatible);
    expect(loadConfig().appName).toBe("Codex Native4");
    expect(mcpCommand(compatible)).not.toContain("--async-tool-operations");
    expect(defaultConfig("browser-only").experimentalAsyncToolOperations).toBe(false);
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});

test("native6: Manual transport retains the separate Automatic identity", () => {
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const home = mkdtempSync(join(tmpdir(), "nekodex-native6-manual-"));
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  try {
    const current = defaultConfig("full");
    Object.assign(current, resolveInteractionConnectorIdentities("manual", "production", false, "Codex Native5"));
    current.experimentalAsyncToolOperations = false;
    current.browserInteractionMode = "manual";
    current.browserHost = "launcher";
    current.browserHostDescriptorPath = join(home, "descriptor.json");
    current.runtimeCommand = [process.platform === "win32" ? process.execPath : "/usr/bin/env", "bun"];
    current.tunnel = { binaryPath: join(home, "tunnel"), tunnelId: "tunnel_" + "b".repeat(32), runtimeKeyFile: join(home, "key"), profileDir: home, profileName: "manual", alias: "manual" };
    saveConfig(current);
    const retained = loadConfig();
    expect(retained.appName).toBe("Codex Zero Risk4");
    expect(retained.automaticAppName).toBe("Codex Native5");
    expect(mcpCommand(retained)).not.toContain("--native6");
    expect(mcpCommand(retained)).not.toContain("--async-tool-operations");
    expect(resolveInteractionConnectorIdentities("automatic", "production", true, retained.automaticAppName).appName).toBe("Codex Native5");
    expect(resolveInteractionConnectorIdentities("manual", "development", false, "Codex Native6 DEV").automaticAppName).toBe("Codex Native6 DEV");
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});
