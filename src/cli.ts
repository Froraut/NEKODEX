#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { existsSync, rmSync } from "node:fs";
import { isAbsolute } from "node:path";
import { stdin, stdout } from "node:process";
import { captureSystemBrowserLoginToFile, checkBrowserEngine, loginToChatGpt } from "./browser-login";
import { createPasskeyLoginControl } from "./passkey-login-control";
import { createExistingChromeLoginControl } from "./existing-chrome-login-control";
import { captureExistingChromeLoginToFile, ExistingChromeLoginError } from "./existing-chrome-login";
import { defaultConfig, getConfigDir, getConfigPath, loadConfig, loadConfigForSetup } from "./config";
import {
  inspectLauncherBrowserHost,
  inspectLauncherBrowserHostLiveness,
} from "./launcher-browser-host";
import {
  activateCodexIntegration,
  deactivateCodexIntegration,
  inspectCodexIntegration,
  readCodexSubagentProtocol,
  setCodexSubagentProtocol,
  uninstallCodexIntegration,
} from "./codex-integration";
import { formatDoctorReport, runDoctor } from "./doctor";
import { runChatGptMcpMain } from "./adapters/chatgpt-web/mcp-main";
import { runCommand } from "./process";
import { startServer } from "./server";
import { assertServiceIdle, cancelActiveTurns, getServiceStatus, installService, interruptActiveTurn, restartService, startService, stopService, uninstallService } from "./service";
import { existingFullSetupCredentials, preflightSetup, setup, type SetupOptions } from "./setup";
import { installRuntimeKeyBytes, managedRuntimeKeyPath, stopTunnel, tunnelStatus, waitForTunnelReady } from "./tunnel";
import { getTunnelServiceStatus, restartTunnelService, startTunnelService, stopTunnelService, uninstallTunnelService } from "./tunnel-service";
import { VERSION } from "./version";
import { runDevCommand } from "./dev-chat/cli";
import { runCompactionModelConfigCommand } from "./compaction-model-config";
import { authorizeLauncherControl, runProModelVersionConfigCommand } from "./pro-model-config";
import { readCodexRouteDiagnostics } from "./route-diagnostics";

const HELP = `codex-chatgpt-web ${VERSION}

Focused ChatGPT web-backed models for the native Codex harness.

Usage:
  codex-chatgpt-web setup --browser-only [options]
  codex-chatgpt-web setup --full --tunnel-id ID --runtime-key-file PATH [options]
  codex-chatgpt-web login
  codex-chatgpt-web doctor [--json]
  codex-chatgpt-web compaction-checkpoints list
  codex-chatgpt-web compaction-checkpoints show ID --binding HASH
  codex-chatgpt-web route <status|connect|disconnect|diagnostics> [--profile NAME]
  codex-chatgpt-web subagents <status|compatibility-v1|native>
  codex-chatgpt-web config pro-model-version <follow|5.6|5.5|6> --launcher-control
  codex-chatgpt-web config compaction-model <follow|extra-high|5.6-pro|5.5-pro> --launcher-control
  codex-chatgpt-web browser check
  codex-chatgpt-web dev launcher
  codex-chatgpt-web dev status [--json]
  codex-chatgpt-web dev setup <--browser-only|--full> [options]
  codex-chatgpt-web dev chat NAME [--model MODEL] [MESSAGE]
  codex-chatgpt-web dev list
  codex-chatgpt-web serve
  codex-chatgpt-web mcp [--broker-socket PATH]
  codex-chatgpt-web service <status|install|start|restart|stop|cancel-turns>
  codex-chatgpt-web tunnel <status|start|restart|stop|key-import>
  codex-chatgpt-web open <tunnels|runtime-keys|connectors>
  codex-chatgpt-web uninstall --yes

Setup options:
  --browser-only               Account-eligible Web models, full context/images, no local tools or tunnel
  --full                       Account-eligible Web models with tools through the configured connector
  --automatic-browser-interaction
                               Send prompts and read ChatGPT state through browser automation (default)
  --zero-risk-browser-interaction
                               Full mode: select, paste, and send in the launcher yourself
  --zero-risk-pro              Manual mode: also install the explicit Pro-sized model row
  --zero-risk-default          Manual mode: install only the default model row
  --port NUMBER                Loopback Responses port (default: 17841)
  --chrome PATH                Google Chrome/Chromium executable used for account login
  --browser-host-descriptor PATH
                               Use the embedded launcher browser described by this owner-only file
  --refresh-account-capabilities
                               Re-read the authenticated account's available Web models
  --tunnel-id ID               Existing OpenAI tunnel id (full mode)
  --runtime-key-file PATH      File containing a Tunnels Read+Use runtime key
  --replace-codex-route        Reversibly replace existing Responses or Voice route settings
  --subagent-protocol MODE     compatibility-v1 (default) or native (advanced)
  --restart-service            Explicitly restart this project's daemon after an update
  --login                      Refresh the stored ChatGPT login even if one exists
  --auto-approve-tool-calls    Opt in to per-call browser clicks on "Allow once" prompts
  --async-tool-operations      Select Codex Native6 (default for new Automatic Full setups)
  --synchronous-tool-operations
                               Use the Codex Native4 synchronous compatibility schema
  --bigger-context             Enable experimental adaptive 1/2/3-message context
  --skill-attachments         Experimental selected skills as text attachments
  --inline-skills             Keep selected skills inline (default)
  --fresh-conversation         Start each automatic turn with complete context in a new chat
  --retained-conversation      Reuse the current conversation (default)
  --saved-chats                Keep task conversations in ChatGPT history
  --temporary-chats            Use Temporary Chat for task conversations (default)
  --allow-web-subagents        Allow delegation from ChatGPT Web tasks
  --no-web-subagents           Disable Web delegation; native models are unchanged
  --standard-context           Disable experimental multi-message context
  --acknowledge-unofficial     Accept the one-time unofficial-browser-automation notice

Global:
  --home PATH                  Override ~/.codex-chatgpt-web
  -h, --help
  -v, --version
`;

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

async function confirm(question: string): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) return false;
  const reader = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await reader.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    reader.close();
  }
}

async function prompt(question: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) return "";
  const reader = createInterface({ input: stdin, output: stdout });
  try { return (await reader.question(question)).trim(); }
  finally { reader.close(); }
}

async function secretPrompt(question: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) return "";
  stdout.write(question);
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const reader = createInterface({ input: stdin, output: muted, terminal: true });
  try { return (await reader.question("")).trim(); }
  finally {
    reader.close();
    stdout.write("\n");
  }
}

function assertNoArgs(args: string[]): void {
  if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);
}

async function loginCommand(args: string[]): Promise<void> {
  const launcherControl = takeFlag(args, "--launcher-control");
  const existingChrome = takeFlag(args, "--existing-chrome");
  const consentUserProfile = takeFlag(args, "--consent-user-profile");
  const selectedChromeDiscovery = takeFlag(args, "--selected-chrome-discovery");
  const selectedChromeProfileClaim = takeFlag(args, "--selected-chrome-profile-claim");
  if (selectedChromeDiscovery && (!existingChrome || !launcherControl || !consentUserProfile)) {
    throw new Error("Selected Chrome discovery requires the owned launcher consent route");
  }
  if (selectedChromeProfileClaim && (!existingChrome || !launcherControl || !consentUserProfile)) {
    throw new Error("Selected Chrome profile claim requires the owned launcher consent route");
  }
  if ((existingChrome || consentUserProfile || selectedChromeProfileClaim) && !launcherControl) {
    throw new Error("Existing Chrome import requires explicit consent in the launcher");
  }
  if (!launcherControl) {
    assertNoArgs(args);
    const config = loadConfig();
    if (config.browserHost === "launcher") {
      throw new Error("ChatGPT login is owned by the launcher; open NEKODEX and use its Sign in step");
    }
    const result = await loginToChatGpt(config);
    stdout.write(`ChatGPT login stored at ${result.storageStatePath}\n`);
    return;
  }

  const loginBrowser = takeOption(args, "--login-browser") ?? "chrome";
  if (loginBrowser !== "chrome" && loginBrowser !== "firefox") throw new Error("Login browser must be chrome or firefox");
  if (existingChrome && loginBrowser !== "chrome") throw new Error("Existing Chrome import cannot use Firefox");
  const chromeExecutablePath = takeOption(args, "--chrome");
  const storageStatePath = takeOption(args, "--storage-state");
  assertNoArgs(args);
  if (existingChrome) {
    try { authorizeLauncherControl("existing Chrome login"); } catch {
      stdout.write('@codex-chrome-import-error:{"version":1,"code":"launcher-authorization-failed"}\n');
      throw new Error("The launcher could not authorize its private Chrome import helper");
    }
    if (!consentUserProfile || chromeExecutablePath || !storageStatePath || !isAbsolute(storageStatePath)) {
      throw new Error("Existing Chrome import requires explicit profile consent and an absolute --storage-state path");
    }
    const control = createExistingChromeLoginControl(undefined, { selectedDiscovery: selectedChromeDiscovery,
      selectedProfileClaim: selectedChromeProfileClaim });
    try {
      await captureExistingChromeLoginToFile({ ...defaultConfig(), storageStatePath }, {
        consent: true, signal: control.signal,
        ...(selectedChromeDiscovery ? { discoveryData: control.discoveryData! } : {}),
        ...(selectedChromeProfileClaim ? { profileClaim: control.profileClaim! } : {}),
        onProgress: progress => stdout.write(`@codex-chrome-import:${JSON.stringify(progress)}\n`),
      });
    } catch (error) {
      const code = error instanceof ExistingChromeLoginError ? error.code : "import-failed";
      stdout.write(`@codex-chrome-import-error:${JSON.stringify({ version: 1, code })}\n`);
      throw error instanceof ExistingChromeLoginError ? error : new Error("Existing Chrome sign-in could not be imported");
    } finally { control.close(); }
    stdout.write("Existing Chrome session captured for Launcher verification.\n");
    return;
  }
  if (consentUserProfile) throw new Error("Profile consent is only valid for existing Chrome import");
  authorizeLauncherControl("passkey login");
  if (process.platform !== "darwin") throw new Error("Passkey sign-in is currently supported only on macOS");
  if (!chromeExecutablePath || !isAbsolute(chromeExecutablePath)) {
    throw new Error("Launcher passkey sign-in requires --chrome with an absolute path");
  }
  if (!storageStatePath || !isAbsolute(storageStatePath)) {
    throw new Error("Launcher passkey sign-in requires --storage-state with an absolute path");
  }
  const control = createPasskeyLoginControl();
  try {
    await captureSystemBrowserLoginToFile({
      ...defaultConfig(),
      chromeExecutablePath,
      storageStatePath,
    }, { browser: loginBrowser, continuation: control.continuation, signal: control.signal, onBrowserReady: control.onBrowserReady });
  } finally {
    control.close();
  }
  stdout.write("Passkey session captured for Launcher verification.\n");
}

async function setupCommand(args: string[]): Promise<void> {
  const preflightOnly = takeFlag(args, "--preflight-only");
  const browserOnly = takeFlag(args, "--browser-only");
  const full = takeFlag(args, "--full");
  if (browserOnly === full) throw new Error("Choose exactly one setup mode: --browser-only or --full");
  const portRaw = takeOption(args, "--port");
  let acknowledged = takeFlag(args, "--acknowledge-unofficial");
  const options: SetupOptions = {
    mode: full ? "full" : "browser-only",
    ...(portRaw ? { port: Number(portRaw) } : {}),
  };
  const automaticBrowserInteraction = takeFlag(args, "--automatic-browser-interaction");
  const manualBrowserInteraction = takeFlag(args, "--zero-risk-browser-interaction");
  if (automaticBrowserInteraction && manualBrowserInteraction) {
    throw new Error(
      "Choose at most one browser interaction mode: --automatic-browser-interaction or --zero-risk-browser-interaction",
    );
  }
  if (automaticBrowserInteraction || manualBrowserInteraction) {
    options.browserInteractionMode = manualBrowserInteraction ? "manual" : "automatic";
  }
  const asyncToolOperations = takeFlag(args, "--async-tool-operations");
  const synchronousToolOperations = takeFlag(args, "--synchronous-tool-operations");
  if (asyncToolOperations && synchronousToolOperations) {
    throw new Error("Choose --async-tool-operations or --synchronous-tool-operations");
  }
  if (asyncToolOperations || synchronousToolOperations) {
    options.experimentalAsyncToolOperations = asyncToolOperations;
  }
  const subagentProtocol = takeOption(args, "--subagent-protocol");
  if (subagentProtocol !== undefined) {
    if (subagentProtocol !== "compatibility-v1" && subagentProtocol !== "native") {
      throw new Error("--subagent-protocol must be compatibility-v1 or native");
    }
    options.subagentProtocol = subagentProtocol;
  }
  const tunnelId = takeOption(args, "--tunnel-id");
  const runtimeKeyFile = takeOption(args, "--runtime-key-file");
  const chrome = takeOption(args, "--chrome");
  const browserHostDescriptorPath = takeOption(args, "--browser-host-descriptor");
  if (chrome) options.chromeExecutablePath = chrome;
  if (browserHostDescriptorPath) options.browserHostDescriptorPath = browserHostDescriptorPath;
  options.refreshAccountCapabilities = takeFlag(args, "--refresh-account-capabilities");
  if (tunnelId) options.tunnelId = tunnelId;
  if (runtimeKeyFile) options.runtimeKeyFile = runtimeKeyFile;
  options.forceLogin = takeFlag(args, "--login");
  options.autoApproveToolCalls = takeFlag(args, "--auto-approve-tool-calls");
  const freshConversation = takeFlag(args, "--fresh-conversation");
  const retainedConversation = takeFlag(args, "--retained-conversation");
  if (freshConversation && retainedConversation) throw new Error("Choose fresh or retained conversations");
  if (freshConversation || retainedConversation) options.experimentalFreshConversationPerTurn = freshConversation;
  const savedChats = takeFlag(args, "--saved-chats");
  const temporaryChats = takeFlag(args, "--temporary-chats");
  if (savedChats && temporaryChats) throw new Error("Choose --saved-chats or --temporary-chats");
  if (savedChats || temporaryChats) options.useSavedChats = savedChats;
  const allowWebSubagents = takeFlag(args, "--allow-web-subagents");
  const noWebSubagents = takeFlag(args, "--no-web-subagents");
  if (allowWebSubagents && noWebSubagents) throw new Error("Choose one Web subagent setting");
  if (allowWebSubagents || noWebSubagents) options.allowWebSubagents = allowWebSubagents;
  const skillAttachments = takeFlag(args, "--skill-attachments");
  const inlineSkills = takeFlag(args, "--inline-skills");
  if (skillAttachments && inlineSkills) throw new Error("Choose --skill-attachments or --inline-skills");
  const biggerContext = takeFlag(args, "--bigger-context");
  const standardContext = takeFlag(args, "--standard-context");
  if (biggerContext && standardContext) {
    throw new Error("Choose at most one context mode: --bigger-context or --standard-context");
  }
  if (biggerContext || standardContext) options.experimentalBiggerContext = biggerContext;
  if (skillAttachments || inlineSkills) options.experimentalSkillAttachments = skillAttachments;
  const zeroRiskPro = takeFlag(args, "--zero-risk-pro");
  const zeroRiskDefault = takeFlag(args, "--zero-risk-default");
  if (zeroRiskPro && zeroRiskDefault) {
    throw new Error("Choose at most one Manual model profile: --zero-risk-pro or --zero-risk-default");
  }
  if (zeroRiskPro || zeroRiskDefault) options.zeroRiskProEnabled = zeroRiskPro;
  options.replaceCodexRoute = takeFlag(args, "--replace-codex-route");
  options.restartService = takeFlag(args, "--restart-service");
  assertNoArgs(args);

  if (!acknowledged) {
    stdout.write(
      "This is independent, unofficial software. It automates your ChatGPT web session, can break when the UI changes, "
      + "and must not be used to evade usage limits or access controls.\n",
    );
    acknowledged = await confirm("Continue and store this acknowledgement?");
  }
  if (!acknowledged) throw new Error("Setup cancelled: acknowledgement was not provided");
  options.acknowledgedUnofficial = true;

  if (preflightOnly) {
    preflightSetup(options);
    stdout.write("Setup preflight complete.\n");
    return;
  }

  const existing = existsSync(getConfigPath()) ? loadConfigForSetup() : undefined;
  const interactionMode = options.browserInteractionMode ?? existing?.browserInteractionMode ?? "automatic";
  const reusableCredentials = existingFullSetupCredentials(existing, interactionMode);
  const needsTunnelId = !options.tunnelId && !reusableCredentials.tunnelId;
  const needsRuntimeKey = !options.runtimeKeyFile
    && !reusableCredentials.runtimeKey
    && !existsSync(managedRuntimeKeyPath(interactionMode));

  if (full && (needsTunnelId || needsRuntimeKey) && stdin.isTTY) {
    stdout.write("Full mode needs an OpenAI tunnel and a runtime key with Tunnels Read + Use.\n");
    stdout.write("Tunnels: https://platform.openai.com/settings/organization/tunnels\n");
    stdout.write("Runtime keys: https://platform.openai.com/settings/organization/api-keys\n");
    if (needsTunnelId) options.tunnelId = await prompt("Tunnel id: ");
    if (needsRuntimeKey) {
      options.runtimeKeyValue = await secretPrompt("Runtime key (hidden): ");
    }
  }

  const result = await setup(options);
  stdout.write(`Setup complete: ${result.mode}\n`);
  stdout.write(`Config: ${result.configPath}\n`);
  stdout.write(result.experimentalAsyncToolOperations
    ? `Tool operations: asynchronous (experimental; connector ${JSON.stringify(result.connectorName)})\n`
    : `Tool operations: synchronous (connector ${JSON.stringify(result.connectorName)})\n`);
  if (result.connectorVerificationReset) {
    stdout.write("Connector verification reset: verify the newly selected connector identity before tool use.\n");
  }
  for (const warning of result.warnings ?? []) stdout.write(`Setup warning: ${warning}\n`);
  if (result.connectorSetupRequired) {
    const connectorName = result.connectorName;
    stdout.write(
      `Attach the tunnel to a newly created ChatGPT connector named ${JSON.stringify(connectorName)}. `
      + "Keep the previous connector available for rollback; do not rename or refresh it.\n",
    );
    stdout.write("Open: https://chatgpt.com/#settings/Plugins\n");
  }
  stdout.write("Restart the Codex app once so its native model catalog refreshes through the installed route.\n");
}

async function doctorCommand(args: string[]): Promise<void> {
  const json = takeFlag(args, "--json");
  assertNoArgs(args);
  const report = await runDoctor();
  stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatDoctorReport(report));
  if (!report.ok) process.exitCode = 1;
}

async function compactionCheckpointsCommand(args: string[]): Promise<void> {
  const action = args.shift();
  if (action !== "list" && action !== "show") {
    throw new Error("Compaction checkpoints supports read-only list or show; no automatic resume or replay");
  }
  if (action === "list") {
    assertNoArgs(args);
    const { CompactionCheckpointStore } = await import("./adapters/chatgpt-web/compaction-checkpoint-store");
    const checkpoints = new CompactionCheckpointStore().listDiagnostics();
    stdout.write(`${JSON.stringify({ checkpoints, automaticResume: false }, null, 2)}\n`);
    return;
  }
  const id = args.shift();
  const binding = takeOption(args, "--binding");
  assertNoArgs(args);
  if (!id || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) {
    throw new Error("Invalid checkpoint id; use the exact UUID from list");
  }
  if (!binding || !/^[a-f0-9]{64}$/.test(binding)) {
    throw new Error("An exact checkpoint --binding HASH from list is required");
  }
  const { CompactionCheckpointStore } = await import("./adapters/chatgpt-web/compaction-checkpoint-store");
  const store = new CompactionCheckpointStore();
  const expected = { id, binding };
  const checkpoint = store.readDiagnostic(expected);
  if (!checkpoint) throw new Error("Checkpoint unavailable, expired, invalid, or binding mismatch");
  const summary = store.readSummary(expected);
  // JSON escapes terminal control characters in provider-authored text. This explicit read
  // never feeds a summary to the model or reconstructs a broker capability.
  stdout.write(`${JSON.stringify({ checkpoint, ...(summary === undefined ? {} : { summary }), automaticResume: false }, null, 2)}\n`);
}

async function routeCommand(args: string[]): Promise<void> {
  const action = args.shift() ?? "status";
  if (action === "diagnostics") {
    const profile = takeOption(args, "--profile");
    assertNoArgs(args);
    stdout.write(`${JSON.stringify(readCodexRouteDiagnostics({ profile }), null, 2)}\n`);
    return;
  }
  assertNoArgs(args);
  const result = action === "status"
    ? (() => {
        const status = inspectCodexIntegration();
        return {
          installed: status.installed,
          active: status.active,
          ...(status.routeUrl ? { routeUrl: status.routeUrl } : {}),
          errors: status.errors,
        };
      })()
    : action === "connect"
      ? activateCodexIntegration()
      : action === "disconnect"
        ? deactivateCodexIntegration()
        : undefined;
  if (!result) throw new Error(`Unknown route action: ${action}`);
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if ("changed" in result && result.changed) {
    process.stderr.write("Fully quit Codex, including background processes, and reopen it to reload the route.\n");
  }
}

async function subagentsCommand(args: string[]): Promise<void> {
  const action = args.shift() ?? "status";
  assertNoArgs(args);
  const config = loadConfig();
  if (config.purpose === "dev-harness") {
    throw new Error("The isolated DEV harness has no Codex subagent protocol to configure");
  }
  if (action === "status") {
    const integration = inspectCodexIntegration();
    stdout.write(`${JSON.stringify({
      protocol: readCodexSubagentProtocol(config.subagentProtocol),
      installed: integration.installed,
      active: integration.active,
    }, null, 2)}\n`);
    return;
  }
  if (action !== "compatibility-v1" && action !== "native") {
    throw new Error("Subagent protocol must be one of: status, compatibility-v1, native");
  }
  const journal = setCodexSubagentProtocol(config, action);
  stdout.write(`${JSON.stringify({
    protocol: journal.installed.subagent_protocol,
    codexRestartRequired: true,
    launcherRestartRequired: true,
  }, null, 2)}\n`);
}

async function serviceCommand(args: string[]): Promise<void> {
  const action = args.shift() ?? "status";
  assertNoArgs(args);
  const config = action === "status" ? undefined : loadConfig();
  if (action === "cancel-turns") {
    stdout.write(`${JSON.stringify(await cancelActiveTurns(config!), null, 2)}\n`);
    return;
  }
  const status = action === "status" ? getServiceStatus()
    : action === "install" ? installService(config!)
      : action === "start" ? startService()
        : action === "restart" ? await restartService(config!)
          : action === "stop" ? await stopService(config!)
            : undefined;
  if (!status) throw new Error(`Unknown service action: ${action}`);
  stdout.write(`${JSON.stringify(status, null, 2)}\n`);
}

async function interruptHookCommand(args: string[]): Promise<void> {
  assertNoArgs(args);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 32 * 1024) throw new Error("Codex Interrupt hook payload is too large");
    chunks.push(buffer);
  }
  let payload: { hook_event_name?: unknown; session_id?: unknown; turn_id?: unknown };
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Codex Interrupt hook payload is not valid JSON");
  }
  const threadId = typeof payload.session_id === "string" ? payload.session_id.trim() : "";
  const turnId = typeof payload.turn_id === "string" ? payload.turn_id.trim() : "";
  if (payload.hook_event_name !== "Interrupt"
    || !/^[A-Za-z0-9_-]{6,128}$/.test(threadId)
    || !/^[A-Za-z0-9_-]{6,128}$/.test(turnId)) {
    throw new Error("Codex Interrupt hook payload has no valid session_id or turn_id");
  }
  await interruptActiveTurn(loadConfig(), { threadId, turnId });
}

async function tunnelCommand(args: string[]): Promise<void> {
  const action = args.shift() ?? "status";
  assertNoArgs(args);
  if (action === "key-import") {
    const key = await secretPrompt("Runtime key (hidden): ");
    if (!key) throw new Error("A non-empty runtime key is required");
    const config = loadConfig();
    installRuntimeKeyBytes(key, config.browserInteractionMode);
    stdout.write(`Runtime key stored privately at ${managedRuntimeKeyPath(config.browserInteractionMode)}\n`);
    return;
  }
  const config = loadConfig();
  if (action === "start") startTunnelService();
  else if (action === "restart") {
    await assertServiceIdle(config);
    await restartTunnelService();
  }
  else if (action === "stop") {
    await assertServiceIdle(config);
    await stopTunnelService();
    stopTunnel(config);
  }
  else if (action !== "status") throw new Error(`Unknown tunnel action: ${action}`);
  let status: ReturnType<typeof tunnelStatus>;
  try {
    status = action === "start" || action === "restart"
      ? await waitForTunnelReady(config)
      : tunnelStatus(config);
  } catch (error) {
    status = {
      ok: false,
      processRunning: false,
      healthy: false,
      ready: false,
      detail: `Tunnel status probe failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  let service: ReturnType<typeof getTunnelServiceStatus> & { error?: string };
  let serviceProbeFailed = false;
  try {
    service = getTunnelServiceStatus();
  } catch (error) {
    serviceProbeFailed = true;
    service = {
      supported: true,
      installed: false,
      loaded: false,
      running: false,
      label: "unavailable",
      error: `Tunnel service status probe failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  stdout.write(`${JSON.stringify({ service, runtime: status }, null, 2)}\n`);
  if (action === "status") {
    if (!status.ok || (config.browserHost !== "launcher" && (serviceProbeFailed || !service.running))) {
      process.exitCode = 1;
    }
  } else if (action !== "stop" && (!service.running || !status.ok)) process.exitCode = 1;
}

async function openCommand(args: string[]): Promise<void> {
  const target = args.shift();
  assertNoArgs(args);
  const urls: Record<string, string> = {
    tunnels: "https://platform.openai.com/settings/organization/tunnels",
    "runtime-keys": "https://platform.openai.com/settings/organization/api-keys",
    connectors: "https://chatgpt.com/#settings/Plugins",
  };
  const url = target ? urls[target] : undefined;
  if (!url) throw new Error("Choose one of: tunnels, runtime-keys, connectors");
  if (process.platform === "darwin") {
    const result = runCommand("open", [url]);
    if (result.status !== 0) throw new Error(result.stderr.trim() || `Could not open ${url}`);
  } else {
    stdout.write(`${url}\n`);
  }
}

async function uninstallCommand(args: string[]): Promise<void> {
  const yes = takeFlag(args, "--yes");
  const keepData = takeFlag(args, "--keep-data");
  const launcherControl = takeFlag(args, "--launcher-control");
  assertNoArgs(args);
  if (launcherControl) authorizeLauncherControl("uninstall");
  if (!yes && !await confirm("Restore Codex config, stop services, and remove this installation?")) {
    throw new Error("Uninstall cancelled");
  }
  // Teardown must remain possible before a cached connector identity is migrated. This loader
  // validates the existing ownership/tunnel fields and migrates only the in-memory target name.
  const config = existsSync(getConfigPath()) ? loadConfigForSetup() : undefined;
  if (config?.browserHost === "launcher" && !launcherControl) {
    throw new Error(
      "Launcher-owned integration must be removed from NEKODEX Settings so the active runtime can be drained safely.",
    );
  }
  if (!config && process.platform === "darwin" && getServiceStatus().installed) {
    throw new Error("Service exists but configuration is missing; refusing an unverifiable uninstall");
  }
  const launcherRuntimeStopped = config?.browserHost === "launcher" && launcherControl;
  if (config && process.platform === "darwin" && !launcherRuntimeStopped) await assertServiceIdle(config);
  if (config?.mode === "full" && !launcherRuntimeStopped) {
    if (process.platform === "darwin") await uninstallTunnelService();
    stopTunnel(config);
  }
  if (config && process.platform === "darwin" && !launcherRuntimeStopped) await uninstallService(config);
  uninstallCodexIntegration();
  if (!keepData) rmSync(getConfigDir(), { recursive: true, force: true });
  stdout.write(keepData ? "Uninstalled; private application data was preserved.\n" : "Uninstalled and removed private application data.\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const home = takeOption(args, "--home");
  if (home) process.env.CODEX_CHATGPT_WEB_HOME = home;
  if (takeFlag(args, "--help") || takeFlag(args, "-h")) {
    stdout.write(HELP);
    return;
  }
  if (takeFlag(args, "--version") || takeFlag(args, "-v")) {
    stdout.write(`${VERSION}\n`);
    return;
  }
  const command = args.shift() ?? "help";
  if (command === "dev" && home) {
    throw new Error("--home does not apply to DEV mode; use CODEX_WEB_GPT_DEV_HOME for an explicit isolated DEV profile");
  }
  if (command === "help") stdout.write(HELP);
  else if (command === "setup") await setupCommand(args);
  else if (command === "login") await loginCommand(args);
  else if (command === "doctor" || command === "status") await doctorCommand(args);
  else if (command === "compaction-checkpoints") await compactionCheckpointsCommand(args);
  else if (command === "route") await routeCommand(args);
  else if (command === "subagents") await subagentsCommand(args);
  else if (command === "config") {
    if (args[0] === "compaction-model") await runCompactionModelConfigCommand(args);
    else await runProModelVersionConfigCommand(args);
  }
  else if (command === "browser") {
    const action = args.shift();
    assertNoArgs(args);
    if (action !== "check") throw new Error("Browser command must be: browser check");
    const config = loadConfig();
    if (config.browserHost === "launcher") {
      if (config.browserInteractionMode === "manual") {
        await inspectLauncherBrowserHostLiveness(config.browserHostDescriptorPath!);
        stdout.write("The launcher browser is reachable; ChatGPT DOM inspection is intentionally disabled in Manual mode.\n");
      } else {
        await inspectLauncherBrowserHost(config.browserHostDescriptorPath!);
        stdout.write("Playwright can reach the authenticated ChatGPT surface embedded in the launcher.\n");
      }
    } else {
      await checkBrowserEngine(config);
      stdout.write("Playwright can launch the configured Chrome executable.\n");
    }
  } else if (command === "serve") {
    assertNoArgs(args);
    const config = loadConfig();
    const server = startServer(config, {
      readProModelVersion: () => loadConfig().proModelVersion,
      readCompactionModel: () => loadConfig().compactionModel,
    });
    stdout.write(`codex-chatgpt-web ${VERSION} listening on http://${config.host}:${server.port}/v1 (${config.mode})\n`);
    await new Promise<void>(() => {});
  } else if (command === "dev") await runDevCommand(args);
  else if (command === "mcp") await runChatGptMcpMain(args);
  else if (command === "service") await serviceCommand(args);
  else if (command === "hook") {
    const action = args.shift();
    if (action !== "interrupt") throw new Error("Hook command must be: hook interrupt");
    await interruptHookCommand(args);
  }
  else if (command === "tunnel") await tunnelCommand(args);
  else if (command === "open") await openCommand(args);
  else if (command === "uninstall") await uninstallCommand(args);
  else throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

main().catch(error => {
  process.stderr.write(`codex-chatgpt-web: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
