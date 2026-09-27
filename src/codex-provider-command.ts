// Adapted from Evanlau1798/codex-chatgpt-web a6f9656f (MIT).
import { loadConfig } from "./config";
import { inspectCodexIntegration, installCodexIntegration } from "./codex-integration";

export function codexProviderCommand(args: string[]): void {
  const action = args.shift() ?? "status";
  let catalogPath: string | undefined;
  if (args[0] === "--catalog" && args[1] && !args[1].startsWith("--")) {
    args.shift(); catalogPath = args.shift();
  }
  if (args.length || !["status", "mixed", "web-only", "picker-on", "picker-off"].includes(action)
    || (catalogPath && action !== "web-only")) {
    throw new Error("Usage: codex-chatgpt-web provider <status|mixed|web-only|picker-on|picker-off> [--catalog PATH]");
  }
  const status = inspectCodexIntegration();
  if (status.errors.length) throw new Error(status.errors.join("; "));
  if (action === "status") {
    const journal = status.journal?.version === 11 ? status.journal : undefined;
    process.stdout.write(JSON.stringify({installed:status.installed,active:status.active,
      providerMode:journal?.webProvider ? "web-only" : "mixed",
      pickerCatalog:journal?.webProvider ? "unavailable" : journal?.pickerCatalog ? "on" : "off"},null,2)+"\n");
    return;
  }
  if (!status.installed || !status.active) throw new Error("Connect the Codex integration before changing provider mode");
  const config = loadConfig();
  if (config.purpose === "dev-harness") throw new Error("The isolated DEV harness has no Codex integration to configure");
  if (action === "picker-on" || action === "picker-off") {
    installCodexIntegration(config,{providerMode:"mixed",pickerCatalog:action === "picker-on"});
    process.stdout.write(JSON.stringify({providerMode:"mixed",pickerCatalog:action === "picker-on" ? "on" : "off",codexRestartRequired:true},null,2)+"\n");
    process.stderr.write("Fully restart Codex to reload its model list.\n");
    return;
  }
  installCodexIntegration(config,{providerMode:action as "mixed"|"web-only",catalogPath});
  process.stdout.write(JSON.stringify({providerMode:action,codexRestartRequired:true},null,2)+"\n");
  process.stderr.write(action === "web-only"
    ? "Fully restart Codex. Web-only mode uses ChatGPT Web limits; native Codex models and account features are unavailable.\n"
    : "Fully restart Codex to restore the mixed native/Web provider.\n");
}
