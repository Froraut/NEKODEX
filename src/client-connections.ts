import { loadConfigForSetup } from "./config";
import { inspectCodexIntegration, installCodexIntegration } from "./codex-integration";
import { pickerCatalogInUse } from "./codex-picker-catalog";
import { inspectClaudeIntegration, installClaudeIntegration, removeClaudeIntegration } from "./claude-integration";
import { localApiKey, localApiStatus, setLocalApiAccess } from "./local-api-access";

export function clientConnectionsStatus() {
  const config = loadConfigForSetup();
  const provider = (() => {
    try {
      const value = inspectCodexIntegration();
      const journal = value.journal?.version === 11 ? value.journal : undefined;
      return { installed: value.installed, active: value.active,
        mode: journal?.webProvider ? "web-only" : "mixed",
        picker: journal?.webProvider ? "unavailable" : journal?.pickerCatalog && pickerCatalogInUse() ? "on" : "off",
        issue: value.errors.length ? value.errors.join("; ") : null };
    } catch (error) { return { installed: false, active: false, mode: "mixed", picker: "off", issue: error instanceof Error ? error.message : "Codex configuration unavailable" }; }
  })();
  const claude = (() => {
    try { return inspectClaudeIntegration(); }
    catch (error) { return { installed: false, ready: false, model: null, issue: error instanceof Error ? error.message : "Claude configuration unavailable" }; }
  })();
  return { api: { ...localApiStatus(), baseUrl: `http://${config.host}:${config.port}/v1` },
    claude, provider };
}

/** Small private launcher protocol; no key is returned by status or configuration actions. */
export function clientConnectionsCommand(args: string[]) {
  try {
    const action = args.shift() ?? "status";
    if (args.length) throw new Error("Unexpected connection arguments");
    if (action === "api-enable" || action === "api-disable") setLocalApiAccess(action === "api-enable");
    else if (action === "api-rotate") setLocalApiAccess(localApiStatus().enabled, true);
    else if (action === "claude-connect") installClaudeIntegration(loadConfigForSetup());
    else if (action === "claude-disconnect") removeClaudeIntegration();
    else if (action === "provider-mixed" || action === "provider-web-only"
      || action === "provider-picker-on" || action === "provider-picker-off") {
      const status = inspectCodexIntegration();
      if (!status.active || !status.installed || status.errors.length) throw new Error("Connect the Codex route before changing provider mode");
      if ((action === "provider-picker-on" || action === "provider-picker-off")
        && status.journal?.version === 11 && status.journal.webProvider) {
        throw new Error("Web-only mode owns the Codex model list. Choose Native and Web models first");
      }
      installCodexIntegration(loadConfigForSetup(), action === "provider-picker-on" || action === "provider-picker-off"
        ? { providerMode: "mixed", pickerCatalog: action === "provider-picker-on" }
        : { providerMode: action === "provider-web-only" ? "web-only" : "mixed" });
    } else if (action === "api-key") {
      const key = localApiKey();
      if (!key) throw new Error("Local API access is disabled");
      process.stdout.write(JSON.stringify({ ok: true, key }) + "\n"); return;
    } else if (action !== "status") throw new Error("Unknown client connection action");
    process.stdout.write(JSON.stringify({ ok: true, value: clientConnectionsStatus() }) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Client connection operation failed" }) + "\n");
  }
}
