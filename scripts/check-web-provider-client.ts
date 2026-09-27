// Opt-in installed Codex check: disposable profiles and an inert model adapter.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { defaultConfig } from "../src/config";
import { installCodexIntegration } from "../src/codex-integration";
import { startServer } from "../src/server";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";

const executable = process.env.CODEX_CLIENT_TEST_EXECUTABLE;
if (!executable) throw new Error("Set CODEX_CLIENT_TEST_EXECUTABLE to the installed Codex CLI");
const directory = mkdtempSync(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "nekodex-web-client-"));
process.env.CODEX_CHATGPT_WEB_HOME = join(directory, "bridge");
process.env.CODEX_HOME = join(directory, "codex");
mkdirSync(process.env.CODEX_HOME);
const config = { ...defaultConfig("browser-only"), port: 0, proAvailable: true,
  extraHighAvailable: true, modelCapabilities: { observedAt: Date.now(), families: { "6": ["low", "medium", "high", "xhigh"] as const } } };
let requests = 0;
const server = startServer(config, { adapterFactory: () => ({ name: "inert-codex-fixture", async runTurn(_parsed, _context, emit) {
  requests++;
  emit({ type: "text_delta", text: "WEB_ONLY_CODEX_CLIENT_OK" });
  emit({ type: "done", stopReason: "stop", endTurn: true });
} }) });
config.port = server.port!;
try {
  const bundled = spawnSync(executable, ["debug", "models", "--bundled"], {
    cwd: directory, env: process.env, encoding: "utf8", timeout: 10_000,
  });
  if (bundled.status !== 0) throw new Error("Installed Codex cannot export its bundled catalog");
  const catalogPath = join(directory, "native-models.json");
  writeFileSync(catalogPath, bundled.stdout);
  installCodexIntegration(config, { providerMode: "web-only", catalogPath });
  const catalog = spawnSync(executable, ["debug", "models"], { cwd: directory,
    env: process.env, encoding: "utf8", timeout: 10_000 });
  if (catalog.status !== 0) throw new Error(`Codex rejected the Web catalog: ${catalog.stderr}`);
  const rows = JSON.parse(catalog.stdout).models as Array<{ slug: string; visibility: string }>;
  if (!rows.length || rows.some(row => !row.slug.startsWith("chatgpt-web/"))) throw new Error("Catalog leaked native models");
  const child = Bun.spawn([executable, "exec", "--skip-git-repo-check", "--json", "-m", "chatgpt-web/gpt-6-astra",
    "Reply with the requested verification marker. Do not use tools."], {
    cwd: directory, env: { ...process.env, OPENAI_API_KEY: "", CODEX_API_KEY: "" }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), 20_000);
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  clearTimeout(timer);
  if (code !== 0 || requests !== 1 || !stdout.includes("WEB_ONLY_CODEX_CLIENT_OK")) {
    throw new Error(`Web client failed: exit=${code}, requests=${requests}, ${stderr.slice(0, 1000)} ${stdout.slice(0, 1000)}`);
  }
  console.log("REAL_CODEX_WEB_ONLY_CATALOG_AND_TURN_OK; no native credential; requests=1");
} finally {
  await server.stop(true); await TurnBroker.forSocket(config.brokerSocketPath).close();
  rmSync(directory, { recursive: true, force: true });
}
