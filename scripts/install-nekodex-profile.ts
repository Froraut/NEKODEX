import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getCodexConfigPath } from "../src/codex-integration-shared";
import { loadConfig } from "../src/config";
import { augmentNativeModelCatalog } from "../src/model-catalog";

// Run after NEKODEX setup and a native Codex model-catalog refresh.
// This creates an opt-in task profile; it never changes the default model.
const codexHome = dirname(getCodexConfigPath());
const config = loadConfig();
const cachePath = join(codexHome, "models_cache.json");
if (!existsSync(cachePath)) throw new Error("Open Codex once to populate its native model catalog, then retry.");
const catalog = augmentNativeModelCatalog(JSON.parse(readFileSync(cachePath, "utf8")), config);
const models = (catalog.models as Array<Record<string, unknown>>).filter(model => String(model.slug).startsWith("chatgpt-web/"));
const medium = models.find(model => model.slug === "chatgpt-web/medium");
if (!medium) throw new Error("ChatGPT Web Medium is unavailable in the configured account.");
const catalogPath = join(codexHome, "nekodex-models.json");
const profilePath = join(codexHome, "nekodex.config.toml");
const backup = join(codexHome, "backups", `nekodex-profile-${Date.now()}`);
if ([catalogPath, profilePath].some(existsSync)) {
  mkdirSync(backup, { recursive: true, mode: 0o700 });
  if (existsSync(catalogPath)) copyFileSync(catalogPath, join(backup, "nekodex-models.json"));
  if (existsSync(profilePath)) copyFileSync(profilePath, join(backup, "nekodex.config.toml"));
}
writeFileSync(catalogPath, JSON.stringify({ models }, null, 2) + "\n", { mode: 0o600 });
writeFileSync(profilePath, [
  "# NEKODEX: opt-in ChatGPT Web task profile.",
  'model = "chatgpt-web/medium"',
  'model_provider = "openai"',
  'model_reasoning_effort = "medium"',
  `openai_base_url = ${JSON.stringify(`http://${config.host}:${config.port}/v1`)}`,
  `model_catalog_json = ${JSON.stringify(catalogPath)}`,
  `model_context_window = ${medium.context_window}`,
  "",
].join("\n"), { mode: 0o600 });
console.log(`NEKODEX profile installed: ${profilePath}`);
console.log("Start a Web task with: codex --profile nekodex");
