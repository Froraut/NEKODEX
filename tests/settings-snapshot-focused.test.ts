// Isolated process: replace launcher authorization and idle boundaries only.
import { expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultConfig, getConfigPath, saveConfig } from "../src/config";
let onIdle: () => void = () => {};
mock.module("../src/service", () => ({ assertServiceIdle: async () => { onIdle(); } }));
mock.module("../src/launcher-browser-host", () => ({ readLauncherBrowserHostDescriptor: () => ({ control: { token: "fixture-control-token" } }) }));
const { runProModelVersionConfigCommand } = await import("../src/pro-model-config");
const { runCompactionModelConfigCommand } = await import("../src/compaction-model-config");

for (const kind of ["pro", "compaction"] as const) {
  test(`${kind} settings preserve concurrent bytes after reaching authorized idle boundary`, async () => {
    const keys = ["CODEX_CHATGPT_WEB_HOME", "CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR", "CODEX_WEB_GPT_LAUNCHER_CONTROL_TOKEN"] as const;
    const prior = keys.map(key => process.env[key]);
    const home = mkdtempSync(join(tmpdir(), "settings-snapshot-"));
    process.env.CODEX_CHATGPT_WEB_HOME = home;
    process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR = "/fixture/descriptor";
    process.env.CODEX_WEB_GPT_LAUNCHER_CONTROL_TOKEN = "fixture-control-token";
    try {
      const original = { ...defaultConfig(), browserHost: "launcher" as const, browserHostDescriptorPath: "/fixture/descriptor" };
      saveConfig(original);
      const external = JSON.stringify({ ...original, allowWebSubagents: true });
      let reachedIdle = false;
      onIdle = () => { reachedIdle = true; writeFileSync(getConfigPath(), external); };
      const command = kind === "pro"
        ? runProModelVersionConfigCommand(["pro-model-version", "6", "--launcher-control"])
        : runCompactionModelConfigCommand(["compaction-model", "extra-high", "--launcher-control"]);
      await expect(command).rejects.toThrow("preserving the external edit");
      expect(reachedIdle).toBe(true);
      expect(readFileSync(getConfigPath(), "utf8")).toBe(external);
    } finally {
      keys.forEach((key, i) => { if (prior[i] === undefined) delete process.env[key]; else process.env[key] = prior[i]; });
      onIdle = () => {};
      rmSync(home, { recursive: true, force: true });
    }
  });
}
