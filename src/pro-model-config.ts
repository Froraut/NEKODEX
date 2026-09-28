import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import {
  loadConfigWithSnapshot,
  saveConfig,
  type AppConfig,
} from "./config";
import {
  parseChatGptWebModelCapabilities,
  parseChatGptWebProModelVersion,
  type ChatGptWebProModelVersion,
} from "./chatgpt-web-models";
import { readCodexSubagentProtocol } from "./codex-integration";
import { readCodexModelContextOverride } from "./codex-integration-document";
import { initialNativeCatalog, pickerCatalogInUse, refreshPickerCatalog } from "./codex-picker-catalog";
import { readLauncherBrowserHostDescriptor } from "./launcher-browser-host";
import { assertServiceIdle } from "./service";

export function authorizeLauncherControl(operation: string): string {
  const descriptorPath = process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR?.trim();
  const supplied = process.env.CODEX_WEB_GPT_LAUNCHER_CONTROL_TOKEN?.trim();
  delete process.env.CODEX_WEB_GPT_LAUNCHER_CONTROL_TOKEN;
  if (!descriptorPath || !supplied) {
    throw new Error(`Launcher-controlled ${operation} requires a live launcher authorization`);
  }
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const expectedBytes = Buffer.from(descriptor.control.token);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    throw new Error(`Launcher-controlled ${operation} authorization is invalid`);
  }
  return descriptorPath;
}

/** Authorize a launcher-controlled config command and load the configuration that launcher owns. */
export async function loadLauncherOwnedConfig(
  operation: string,
  { requireIdle = true }: { requireIdle?: boolean } = {},
): Promise<ReturnType<typeof loadConfigWithSnapshot>> {
  const authorizedDescriptorPath = authorizeLauncherControl(operation);
  const { config, snapshot } = loadConfigWithSnapshot();
  if (config.browserHost !== "launcher" || !config.browserHostDescriptorPath
    || resolve(config.browserHostDescriptorPath) !== resolve(authorizedDescriptorPath)) {
    throw new Error("Launcher authorization does not own this configuration");
  }
  // DEV has no Responses listener and must not consult the production launchd service.
  // The authorized launcher IPC checks its own browser activity before invoking this command.
  if (requireIdle && config.purpose !== "dev-harness") await assertServiceIdle(config);
  return { config, snapshot };
}

function updateProModelVersion(
  config: AppConfig,
  version: ChatGptWebProModelVersion | undefined,
): void {
  if (version === undefined) delete config.proModelVersion;
  else config.proModelVersion = version;
}

export async function runProModelVersionConfigCommand(args: string[]): Promise<void> {
  const action = args.shift();
  const rawVersion = args.shift();
  const launcherControlIndex = args.indexOf("--launcher-control");
  const launcherControl = launcherControlIndex >= 0;
  if (launcherControl) args.splice(launcherControlIndex, 1);
  if (action !== "pro-model-version" || !rawVersion || args.length > 0) {
    throw new Error("Config command must be: config pro-model-version <follow|5.6|6> --launcher-control");
  }
  let version: ChatGptWebProModelVersion | undefined;
  if (rawVersion !== "follow") {
    if (rawVersion === "5.5") throw new Error("Select a current Pro model version in NEKODEX Settings");
    try {
      version = parseChatGptWebProModelVersion(rawVersion);
    } catch {
      throw new Error("Invalid Pro model version; choose follow, 5.6, or 6");
    }
  }
  if (!launcherControl) {
    throw new Error("Pro model configuration must be changed through NEKODEX Settings");
  }
  const { config, snapshot } = await loadLauncherOwnedConfig("Pro model configuration");
  updateProModelVersion(config, version);
  saveConfig(config, snapshot);
  process.stdout.write(`${JSON.stringify({ proModelVersion: version ?? null })}\n`);
}

/** Account evidence from a launcher browser check, as `config model-capabilities` receives it. */
export function parseLauncherCapabilityEvidence(encoded: string): Pick<AppConfig, "solAvailable" | "extraHighAvailable" | "proAvailable" | "modelCapabilities"> {
  if (!/^[A-Za-z0-9_-]{1,16384}$/.test(encoded)) throw new Error("Invalid account capability evidence encoding");
  const value: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid account capability evidence");
  const evidence = value as Record<string, unknown>;
  if (Object.keys(evidence).some(key => !["solAvailable", "extraHighAvailable", "proAvailable", "modelCapabilities"].includes(key))
    || typeof evidence.solAvailable !== "boolean" || typeof evidence.proAvailable !== "boolean"
    || (evidence.extraHighAvailable !== undefined && typeof evidence.extraHighAvailable !== "boolean")) {
    throw new Error("Invalid account capability evidence");
  }
  const extraHighAvailable = evidence.extraHighAvailable ?? evidence.proAvailable;
  if ((evidence.proAvailable || extraHighAvailable) && !evidence.solAvailable
    || (evidence.proAvailable && !extraHighAvailable)) {
    throw new Error("Contradictory account capability evidence");
  }
  const modelCapabilities = parseChatGptWebModelCapabilities(evidence.modelCapabilities);
  return {
    solAvailable: evidence.solAvailable,
    extraHighAvailable: evidence.solAvailable && extraHighAvailable,
    proAvailable: evidence.solAvailable && evidence.proAvailable,
    ...(modelCapabilities ? { modelCapabilities } : {}),
  };
}

/**
 * Save the selected account's latest browser evidence so Codex lists the models its ChatGPT
 * picker offers now. The daemon reads the saved evidence on each request, so this needs no idle
 * window and no restart; the picker catalog is rebuilt at once from the last live native catalog.
 */
export async function runModelCapabilitiesConfigCommand(args: string[]): Promise<void> {
  const action = args.shift();
  const encoded = args.shift();
  const launcherControl = args.at(-1) === "--launcher-control";
  if (launcherControl) args.pop();
  if (action !== "model-capabilities" || !encoded || args.length > 0 || !launcherControl) {
    throw new Error("Config command must be: config model-capabilities <evidence> --launcher-control");
  }
  const evidence = parseLauncherCapabilityEvidence(encoded);
  const { config, snapshot } = await loadLauncherOwnedConfig("account capability refresh", { requireIdle: false });
  if (config.browserInteractionMode === "manual") {
    throw new Error("Manual mode does not use the ChatGPT model picker");
  }
  config.solAvailable = evidence.solAvailable;
  config.extraHighAvailable = evidence.extraHighAvailable;
  config.proAvailable = evidence.proAvailable;
  if (evidence.modelCapabilities) config.modelCapabilities = evidence.modelCapabilities;
  else delete config.modelCapabilities;
  saveConfig(config, snapshot);
  let webModels: number | null = null;
  let pickerChanged = false;
  const native = pickerCatalogInUse() ? initialNativeCatalog() : undefined;
  if (native) {
    try {
      const catalogConfig = { ...config, subagentProtocol: readCodexSubagentProtocol(config.subagentProtocol) };
      const refreshed = refreshPickerCatalog(native, catalogConfig, readCodexModelContextOverride());
      webModels = refreshed?.webModels ?? null;
      pickerChanged = refreshed?.visibleChanged === true;
    } catch (error) {
      // The saved evidence stands; the next catalog request rebuilds the picker from live data.
      process.stderr.write(`Codex picker catalog was not rebuilt: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  // Codex reads the catalog only when it starts, so a changed visible list needs a Codex restart.
  process.stdout.write(`${JSON.stringify({ saved: true, webModels, pickerChanged })}\n`);
}
