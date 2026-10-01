import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, getConfigPath } from "../src/config";
import { installCodexIntegration, setCodexSubagentProtocol, inspectCodexIntegration } from "../src/codex-integration";
import { getCodexJournalPath } from "../src/codex-integration-shared";

const originalCodexHome = process.env.CODEX_HOME;
const originalRuntimeHome = process.env.CODEX_CHATGPT_WEB_HOME;
const root = mkdtempSync(join(tmpdir(), "nekodex-protocol-switch-"));
try {
  for (const shape of ["scalar", "inline", "table", "changed-route"] as const) {
    process.env.CODEX_HOME = join(root, shape, "codex");
    process.env.CODEX_CHATGPT_WEB_HOME = join(root, shape, "runtime");
    mkdirSync(process.env.CODEX_HOME, { recursive: true });
    const path = join(process.env.CODEX_HOME, "config.toml");
    writeFileSync(path, [
      'model = "gpt-6.1-sol"', "[agents]", "max_concurrent_threads_per_session = 16",
      "[features]", "analytics_plan_history = true", "instant_interrupt = true",
      ...(shape === "inline" ? ["multi_agent_v2 = { enabled = false, default_wait_timeout_ms = 500 }"]
        : shape === "table" ? ["[features.multi_agent_v2]", "enabled = false", "default_wait_timeout_ms = 500"]
        : ["multi_agent_v2 = false"]), "",
    ].join("\n"));
    const config = defaultConfig("full");
    installCodexIntegration(config, { pickerCatalog: false });
    const edited = readFileSync(path, "utf8").replace(
      shape === "table" ? /^enabled = false.*$/m : /^multi_agent_v2 = .*$/m,
      shape === "table" ? "enabled = true # user trial"
        : shape === "inline" ? "multi_agent_v2 = { enabled = true, default_wait_timeout_ms = 500 } # user trial"
        : "multi_agent_v2 = true # user trial",
    );
    writeFileSync(path, shape === "changed-route"
      ? edited.replace('openai_base_url = "http://127.0.0.1:17841/v1"', 'openai_base_url = "http://127.0.0.1:19999/v1"')
      : edited);
    const snapshotPaths = [path, getCodexJournalPath(), getConfigPath()];
    const before = snapshotPaths.map(file => existsSync(file) ? readFileSync(file, "utf8") : undefined);
    // Ordinary repair must still refuse newer feature edits. Only the explicit native switch releases V1.
    assert.throws(() => installCodexIntegration(config, { pickerCatalog: false }), /changed after setup/);
    if (shape === "changed-route") {
      assert.throws(() => setCodexSubagentProtocol(config, "native"), /openai_base_url changed/);
      assert.deepEqual(snapshotPaths.map(file => existsSync(file) ? readFileSync(file, "utf8") : undefined), before);
      continue;
    }
    setCodexSubagentProtocol(config, "native");
    const current = readFileSync(path, "utf8");
    assert.ok(current.includes(shape === "table" ? "enabled = true # user trial"
      : shape === "inline" ? "multi_agent_v2 = { enabled = true, default_wait_timeout_ms = 500 } # user trial"
      : "multi_agent_v2 = true # user trial"));
    const parsed = Bun.TOML.parse(current) as { features: Record<string, unknown>; agents: Record<string, unknown>; openai_base_url: string };
    assert.equal(parsed.features.analytics_plan_history, true);
    assert.equal(parsed.features.instant_interrupt, true);
    assert.equal(parsed.agents.max_concurrent_threads_per_session, 16);
    assert.equal(parsed.openai_base_url, "http://127.0.0.1:17841/v1");
    assert.equal(JSON.parse(readFileSync(getConfigPath(), "utf8")).subagentProtocol, "native");
    const status = inspectCodexIntegration();
    assert.equal(status.active, true);
    assert.deepEqual(status.errors, []);
    assert.equal(status.journal?.version === 11 && status.journal.installed.subagent_protocol, "native");
  }
  console.log("CODEX_NATIVE_PROTOCOL_SWITCH_OK scalar inline table newer-route-preserved");
} finally {
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;
  if (originalRuntimeHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
  else process.env.CODEX_CHATGPT_WEB_HOME = originalRuntimeHome;
  rmSync(root, { recursive: true, force: true });
}
