import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// The executable fixture uses a POSIX wrapper; production smoke accepts native executables.
test.skipIf(process.platform === "win32")("catalog smoke preserves all five Web routes with a new native leader and isolates every Codex command", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-catalog-regression-"));
  const inheritedHome = join(root, "inherited-home");
  mkdirSync(inheritedHome);
  const inheritedConfig = join(inheritedHome, "config.toml");
  writeFileSync(inheritedConfig, "# fixture: must remain untouched\n");
  const driver = join(root, "codex-fixture.js");
  const executable = join(root, "codex-fixture");
  const audit = join(root, "commands.jsonl");
  writeFileSync(driver, `
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
const args = process.argv.slice(2);
const home = process.env.CODEX_HOME;
if (!home.includes("codex-chatgpt-web-codex-smoke-") || realpathSync(dirname(home)) !== realpathSync(process.cwd())) throw new Error("Command escaped the smoke profile");
appendFileSync(process.env.CODEX_CATALOG_SMOKE_FIXTURE_LOG, JSON.stringify({ args, home }) + "\\n");
if (args.join(" ") === "debug models --bundled") {
  console.log(JSON.stringify({ models: [{
    slug: "future-native-leader", visibility: "list", supported_in_api: true,
    priority: 1, supported_reasoning_levels: [{ effort: "high" }], multi_agent_version: "v2",
  }] }));
} else if (args.join(" ") === "debug models") {
  const config = Bun.TOML.parse(readFileSync(join(home, "config.toml"), "utf8"));
  const catalog = JSON.parse(readFileSync(config.model_catalog_json, "utf8"));
  if (process.env.CODEX_CATALOG_SMOKE_FIXTURE_DROP_PRO === "1") catalog.models = catalog.models.filter(model => model.slug !== "chatgpt-web/pro");
  console.log(JSON.stringify(catalog));
} else if (args.join(" ") === "features list") {
  console.log("multi_agent stable true\\nmulti_agent_v2 stable false");
} else throw new Error("Unexpected Codex command");
`);
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(executable, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(driver)} "$@"\n`, { mode: 0o700 });
  try {
    for (const dropPro of [false, true]) {
      writeFileSync(audit, "");
      const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../scripts/smoke-codex-catalog.ts"), executable], {
        cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe",
        env: { ...process.env, CODEX_HOME: inheritedHome, CODEX_CATALOG_SMOKE_FIXTURE_LOG: audit,
          CODEX_CATALOG_SMOKE_FIXTURE_DROP_PRO: dropPro ? "1" : "0" },
      });
      const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      if (dropPro) {
        expect(status).toBe(1);
        expect(stderr).toContain("did not preserve the fixed ChatGPT Web model contract");
      } else {
        expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
        expect(stdout.trim()).toBe("NATIVE_CODEX_CATALOG_SMOKE_OK");
      }
      const calls = readFileSync(audit, "utf8").trim().split("\n").map(line => JSON.parse(line) as { args: string[]; home: string });
      expect(calls.map(call => call.args)).toEqual(dropPro
        ? [["debug", "models", "--bundled"], ["debug", "models"]]
        : [["debug", "models", "--bundled"], ["debug", "models"], ["features", "list"]]);
      expect(new Set(calls.map(call => call.home)).size).toBe(1);
      expect(existsSync(dirname(calls[0]!.home))).toBe(false);
      expect(readFileSync(inheritedConfig, "utf8")).toBe("# fixture: must remain untouched\n");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
