import { createInterface } from "node:readline/promises";
import { existsSync } from "node:fs";
import { stdin, stdout } from "node:process";
import {
  DEV_CHATGPT_ASYNC_CONNECTOR_NAME,
  DEV_CHATGPT_CONNECTOR_NAME,
  ZERO_RISK_CHATGPT_CONNECTOR_NAME,
  loadConfig,
} from "../config";
import {
  inspectLauncherBrowserHost,
  inspectLauncherBrowserHostLiveness,
  readLauncherBrowserHostDescriptor,
} from "../launcher-browser-host";
import { setupDevProfile } from "../setup";
import { tunnelStatus } from "../tunnel";
import {
  createLauncherDevAdapter,
  DevChatDriver,
  DEV_CHAT_TOOLS,
  type DevChatEvent,
  type DevContextStatus,
} from "./driver";
import {
  createDevContextFiller,
  DEV_CHAT_MODELS,
  DevChatStore,
  type DevChatModel,
  type DevChatState,
} from "./session";
import { startDevChatTransport } from "./transport";
import {
  activateDevProfileEnvironment,
  launchDevProfile,
  readDevChatExperimentalFeatures,
  resolveDevProfilePaths,
} from "./profile";
import { DEV_CONFIG_PURPOSE, DEV_LAUNCHER_PROFILE } from "./constants";
import { runCompactionModelConfigCommand } from "../compaction-model-config";
import { runProModelVersionConfigCommand } from "../pro-model-config";

const DEV_HELP = `Codex Web GPT DEV chat

Usage:
  codex-chatgpt-web dev launcher
  codex-chatgpt-web dev status [--json]
  codex-chatgpt-web dev config pro-model-version <follow|5.6|5.5|6> --launcher-control
  codex-chatgpt-web dev setup --browser-only [--automatic-browser-interaction] [--saved-chats|--temporary-chats]
  codex-chatgpt-web dev setup --full --tunnel-id ID --runtime-key-file PATH [--automatic-browser-interaction|--zero-risk-browser-interaction] [--saved-chats|--temporary-chats]
  codex-chatgpt-web dev chat NAME [--model MODEL] [MESSAGE]
  codex-chatgpt-web dev list

Repository shortcut:
  bun run dev:launcher
  bun run dev:chat NAME "message"
  bun run dev:chat NAME

DEV setup chat storage:
  --saved-chats        Keep DEV conversations in ChatGPT history
  --temporary-chats    Use Temporary Chat (default)

Interactive commands:
  /status              Show estimated next-turn context occupancy
  /fill TOKENS         Append deterministic inert context without opening ChatGPT
  /send-fill TOKENS    Send deterministic inert text through the live browser now
  /compact             Run the real browser compaction path now
  /model MODEL         Select zero-risk, luna, think, light, medium, high, extra-high, pro, or a named GPT route
  /reset yes           Clear this named DEV chat and create a new thread identity
  /help                Show this command list
  /exit                Exit

Experimental settings:
  Bigger Context       Enable in Settings; adapts context across 1, 2, or 3 messages
  Async tool operations Automatic Full mode; new setups use Codex Native6 DEV
`;

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function color(code: number, text: string): string {
  return stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text;
}

const bold = (text: string) => color(1, text);
const dim = (text: string) => color(2, text);
const cyan = (text: string) => color(36, text);
const yellow = (text: string) => color(33, text);

function compactJson(value: unknown, limit = 2_000): string {
  const encoded = JSON.stringify(value);
  if (encoded.length <= limit) return encoded;
  return `${encoded.slice(0, limit)}… (${encoded.length.toLocaleString("en-US")} chars)`;
}

type DeclaredDevToolKind = "function" | "custom";

function declaredDevTools(): Map<string, DeclaredDevToolKind> {
  const declared = new Map<string, DeclaredDevToolKind>();
  for (const tool of DEV_CHAT_TOOLS) {
    if (tool.type === "function" && typeof tool.name === "string") {
      declared.set(tool.name, "function");
      continue;
    }
    if (tool.type === "custom" && typeof tool.name === "string") {
      declared.set(tool.name, "custom");
      continue;
    }
    if (tool.type !== "namespace" || typeof tool.name !== "string" || !Array.isArray(tool.tools)) continue;
    for (const nested of tool.tools) {
      if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
      const nestedTool = nested as Record<string, unknown>;
      if (nestedTool.type !== "function" || typeof nestedTool.name !== "string") continue;
      declared.set(`${tool.name}__${nestedTool.name}`, "function");
    }
  }
  return declared;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateDeclaredDevTool(name: string, input: unknown, mode: "browser-only" | "full"): void {
  if (mode !== "full") throw new Error(`DEV browser-only response attempted outer tool ${JSON.stringify(name)}`);
  const kind = declaredDevTools().get(name);
  if (!kind) throw new Error(`DEV response requested undeclared tool ${JSON.stringify(name)}`);
  if (kind === "custom") {
    if (typeof input !== "string") throw new Error(`DEV custom tool ${JSON.stringify(name)} requires string input`);
    return;
  }
  if (!isRecord(input)) throw new Error(`DEV function tool ${JSON.stringify(name)} requires a JSON object`);
  if (name !== "mcp__dev_simulator__large_context_payload") return;
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes("segment") || !keys.includes("target_tokens")) {
    throw new Error("DEV large context payload received malformed arguments");
  }
  if (!Number.isInteger(input.segment) || ![1, 2, 3].includes(input.segment as number)) {
    throw new Error("DEV large context payload segment must be 1, 2, or 3");
  }
  if (!Number.isInteger(input.target_tokens) || (input.target_tokens as number) < 1_000 || (input.target_tokens as number) > 95_000) {
    throw new Error("DEV large context payload target_tokens must be an integer from 1,000 to 95,000");
  }
}

function collectCallIds(value: unknown, ids: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectCallIds(item, ids);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.call_id === "string" && value.call_id.length > 0) ids.add(value.call_id);
  for (const child of Object.values(value)) collectCallIds(child, ids);
}

function guardedDevEventEmitter(
  state: DevChatState,
  mode: "browser-only" | "full",
  emit: (event: DevChatEvent) => void,
): (event: DevChatEvent) => void {
  const seenCallIds = new Set<string>();
  collectCallIds(state.input, seenCallIds);
  const pendingNames: string[] = [];
  return event => {
    if (event.type === "tool_call") {
      validateDeclaredDevTool(event.name, event.input, mode);
      pendingNames.push(event.name);
    } else if (event.type === "tool_result") {
      const callId = event.receipt.call_id;
      if (typeof callId !== "string" || callId.length === 0) {
        throw new Error(`DEV simulated receipt for ${JSON.stringify(event.name)} has no call_id`);
      }
      if (seenCallIds.has(callId)) {
        throw new Error(`DEV response reused duplicate call_id ${JSON.stringify(callId)}`);
      }
      const pendingName = pendingNames.shift();
      if (pendingName !== event.name) {
        throw new Error(`DEV simulated receipt tool ${JSON.stringify(event.name)} does not match its call`);
      }
      if (event.receipt.simulated !== true || event.receipt.side_effects_performed !== false) {
        throw new Error(`DEV tool ${JSON.stringify(event.name)} returned a non-simulated receipt`);
      }
      seenCallIds.add(callId);
    }
    emit(event);
  };
}

function modelFromCli(value: string | undefined): DevChatModel | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  const slug = normalized.startsWith("chatgpt-web/") ? normalized : `chatgpt-web/${normalized}`;
  if (!(DEV_CHAT_MODELS as readonly string[]).includes(slug)) {
    throw new Error(`Unknown DEV model ${JSON.stringify(value)}; choose zero-risk, luna, think, light, medium, high, extra-high, pro, gpt-5.6-luna, gpt-5.6-sol-instant, gpt-5.6-sol, gpt-5.6-pro, or gpt-6-pro`);
  }
  return slug as DevChatModel;
}

function statusLine(status: DevContextStatus): string {
  const main = `${status.inputTokens.toLocaleString("en-US")} / ${status.autoCompactTokenLimit.toLocaleString("en-US")} tokens (${status.percent}%)`;
  const transport = status.browserInputTokenLimit
    ? ` · Luna browser request budget ${status.browserInputTokenLimit.toLocaleString("en-US")}`
    : "";
  return `${main} · ${status.inputItems} history items${transport}`;
}

class EventRenderer {
  private channel: "reasoning" | "commentary" | "text" | undefined;

  write(event: DevChatEvent): void {
    if (event.type === "reasoning" || event.type === "commentary" || event.type === "text") {
      if (this.channel !== event.type) {
        if (this.channel) stdout.write("\n");
        const label = event.type === "text" ? "assistant" : event.type;
        stdout.write(`${event.type === "text" ? cyan(label) : dim(label)}> `);
        this.channel = event.type;
      }
      stdout.write(event.text);
      return;
    }
    this.endChannel();
    if (event.type === "tool_call") {
      stdout.write(`${yellow("tool")}> ${event.name} ${compactJson(event.input)}\n`);
    } else if (event.type === "tool_result") {
      stdout.write(`${dim("simulated")}> ${event.name} ${compactJson(event.receipt)}\n`);
    } else if (event.type === "compaction_start") {
      stdout.write(`${yellow("compact")}> ${event.reason} browser compaction started (${event.inputItems} input items)\n`);
    } else {
      stdout.write(`${yellow("compact")}> ${event.reason} browser compaction completed (${event.inputItems} replacement items)\n`);
    }
  }

  finish(): void {
    this.endChannel();
  }

  private endChannel(): void {
    if (!this.channel) return;
    stdout.write("\n");
    this.channel = undefined;
  }
}

function printHeader(
  state: DevChatState,
  created: boolean,
  status: DevContextStatus,
  mode: "browser-only" | "full",
  biggerContext: boolean,
  useSavedChats: boolean,
): void {
  stdout.write(`${bold("Codex Web GPT DEV")} · ${created ? "created" : "continued"} chat ${cyan(state.name)}\n`);
  stdout.write(`model ${state.model} · ${useSavedChats ? "saved ChatGPT chats" : "temporary ChatGPT chats"} · ${mode === "full" ? "tools explicitly simulated" : "browser-only, no outer tools"} · live launcher browser\n`);
  stdout.write(`context ${statusLine(status)}\n`);
  if (biggerContext) {
    stdout.write(`${yellow("Bigger Context experimental")} · adaptive 1/2/3-message context · same-agent compaction handoff · elevated rate-limit/cooldown risk\n`);
  }
  stdout.write(`${dim("Codex route is untouched. No Responses port is bound, replaced, stopped, or restarted.")}\n`);
}

async function assertLauncherReady(config: ReturnType<typeof loadConfig>): Promise<void> {
  if (config.purpose !== DEV_CONFIG_PURPOSE) {
    throw new Error("DEV chat requires a configuration created inside the isolated DEV profile");
  }
  if (config.browserHost !== "launcher" || !config.browserHostDescriptorPath) {
    throw new Error("DEV chat requires the isolated desktop launcher; run bun run dev:launcher first");
  }
  if (config.browserInteractionMode === "manual") {
    await inspectLauncherBrowserHostLiveness(config.browserHostDescriptorPath, {
      expectedProfile: DEV_LAUNCHER_PROFILE,
    });
  } else {
    await inspectLauncherBrowserHost(config.browserHostDescriptorPath, {
      expectedProfile: DEV_LAUNCHER_PROFILE,
    });
  }
}

async function executeMessage(
  driver: DevChatDriver,
  state: DevChatState,
  message: string,
  signal?: AbortSignal,
): Promise<void> {
  const renderer = new EventRenderer();
  const emit = guardedDevEventEmitter(state, driver.config.mode, event => renderer.write(event));
  try {
    const result = await driver.send(state, message, emit, signal);
    renderer.finish();
    stdout.write(`${dim(`usage ${result.usage.inputTokens.toLocaleString("en-US")} input + ${result.usage.outputTokens.toLocaleString("en-US")} output · context ${statusLine(result.status)}`)}\n`);
  } catch (error) {
    renderer.finish();
    throw error;
  }
}

async function interactive(driver: DevChatDriver, state: DevChatState): Promise<void> {
  stdout.write(`${dim("Type a message or /help. Ctrl-C or Ctrl-D exits.")}\n`);
  const reader = createInterface({ input: stdin, output: stdout });
  let activeAbortController: AbortController | undefined;
  reader.on("SIGINT", () => {
    if (activeAbortController) activeAbortController.abort();
    else reader.close();
  });
  try {
    for (;;) {
      let line: string;
      try { line = await reader.question(`${cyan(state.name)}> `); }
      catch { break; }
      const value = line.trim();
      if (!value) continue;
      try {
        if (!value.startsWith("/")) {
          const controller = new AbortController();
          activeAbortController = controller;
          try { await executeMessage(driver, state, value, controller.signal); }
          finally { if (activeAbortController === controller) activeAbortController = undefined; }
          continue;
        }
        const [command, argument, ...rest] = value.slice(1).split(/\s+/);
        if (command === "exit" || command === "quit") break;
        if (command === "help") {
          if (argument) throw new Error("Usage: /help");
          stdout.write(DEV_HELP);
        } else if (command === "status") {
          if (argument) throw new Error("Usage: /status");
          stdout.write(`context ${statusLine(driver.status(state))}\n`);
        } else if (command === "fill") {
          if (rest.length > 0) throw new Error("Usage: /fill TOKENS");
          const tokens = Number(argument);
          const result = driver.fill(state, tokens);
          stdout.write(`added ${result.addedTokens.toLocaleString("en-US")} measured synthetic tokens · context ${statusLine(result.status)}\n`);
        } else if (command === "send-fill") {
          if (rest.length > 0) throw new Error("Usage: /send-fill TOKENS");
          const filler = createDevContextFiller(Number(argument));
          stdout.write(`sending ${filler.tokens.toLocaleString("en-US")} measured synthetic tokens through the live browser\n`);
          const controller = new AbortController();
          activeAbortController = controller;
          try { await executeMessage(driver, state, filler.text, controller.signal); }
          finally { if (activeAbortController === controller) activeAbortController = undefined; }
        } else if (command === "compact") {
          if (argument) throw new Error("Usage: /compact");
          const renderer = new EventRenderer();
          try {
            const status = await driver.compact(state, event => renderer.write(event));
            renderer.finish();
            stdout.write(`context ${statusLine(status)}\n`);
          } catch (error) {
            renderer.finish();
            throw error;
          }
        } else if (command === "model") {
          const model = modelFromCli(argument);
          if (!model || rest.length > 0) throw new Error("Usage: /model MODEL");
          driver.setModel(state, model);
          stdout.write(`model ${state.model} · context ${statusLine(driver.status(state))}\n`);
        } else if (command === "reset") {
          if (argument !== "yes" || rest.length > 0) {
            stdout.write("Use /reset yes to clear this DEV chat.\n");
            continue;
          }
          driver.reset(state);
          stdout.write(`reset ${state.name}; new empty DEV thread created\n`);
        } else {
          stdout.write(`Unknown DEV command /${command}. Use /help.\n`);
        }
      } catch (error) {
        stdout.write(`${color(31, "error")}> ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  } finally {
    reader.close();
  }
}

export async function runDevCommand(args: string[]): Promise<void> {
  const action = args.shift() ?? "help";
  const paths = resolveDevProfilePaths();
  if (action === "help") {
    if (args.length > 0) throw new Error(`Unknown DEV arguments: ${args.join(" ")}`);
    stdout.write(DEV_HELP);
    return;
  }
  if (action === "list") {
    activateDevProfileEnvironment(paths);
    const store = new DevChatStore(paths.chatsPath);
    if (args.length > 0) throw new Error(`Unknown DEV arguments: ${args.join(" ")}`);
    const chats = store.list();
    if (chats.length === 0) {
      stdout.write("No named DEV chats yet.\n");
      return;
    }
    for (const chat of chats) {
      stdout.write(`${chat.name}\t${chat.model}\tturns=${chat.turns}\tcompactions=${chat.compactions}\titems=${chat.inputItems}\t${chat.updatedAt}\n`);
    }
    return;
  }
  if (action === "launcher") {
    if (args.length > 0) throw new Error(`Unknown DEV launcher arguments: ${args.join(" ")}`);
    const launched = await launchDevProfile(paths);
    stdout.write(
      `${launched.alreadyRunning ? "Opened" : "Started"} isolated DEV launcher`
      + ` (pid ${launched.descriptor.pid})\n`
      + `DEV home: ${paths.home}\n`
      + `ChatGPT session: ${paths.launcherUserData}\n`,
    );
    return;
  }
  if (action === "status") {
    activateDevProfileEnvironment(paths);
    const json = takeFlag(args, "--json");
    if (args.length > 0) throw new Error(`Unknown DEV status arguments: ${args.join(" ")}`);
    let launcher: { running: boolean; pid?: number; profile?: string; error?: string } = { running: false };
    try {
      const descriptor = readLauncherBrowserHostDescriptor(paths.descriptorPath);
      launcher = { running: true, pid: descriptor.pid, profile: descriptor.profile };
      if (descriptor.profile !== DEV_LAUNCHER_PROFILE) {
        launcher = { running: false, error: `descriptor belongs to ${descriptor.profile}` };
      }
    } catch (error) {
      launcher = { running: false, error: error instanceof Error ? error.message : String(error) };
    }
    let config: { configured: boolean; mode?: string; purpose?: string; error?: string } = { configured: false };
    let mcpRuntime: { required: boolean; ready: boolean; detail?: string } = { required: false, ready: false };
    if (existsSync(paths.configPath)) {
      try {
        const loaded = loadConfig();
        config = { configured: true, mode: loaded.mode, purpose: loaded.purpose };
        if (loaded.mode === "full") {
          mcpRuntime = { required: true, ready: false };
          try {
            const inspected = tunnelStatus(loaded);
            mcpRuntime = { required: true, ready: inspected.ok && inspected.ready, detail: inspected.detail };
          } catch (error) {
            mcpRuntime = {
              required: true,
              ready: false,
              detail: `status probe failed: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        }
      } catch (error) {
        config = { configured: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    let features: ReturnType<typeof readDevChatExperimentalFeatures> & { error?: string } = { biggerContext: false };
    try {
      features = readDevChatExperimentalFeatures(paths);
    } catch (error) {
      features = {
        biggerContext: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const status = { paths, launcher, config, mcpRuntime, features };
    if (json) stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    else {
      stdout.write(`DEV home: ${paths.home}\n`);
      stdout.write(`launcher: ${launcher.running ? `running (pid ${launcher.pid})` : `not ready${launcher.error ? ` · ${launcher.error}` : ""}`}\n`);
      stdout.write(`config: ${config.configured ? `${config.mode} (${config.purpose})` : `not ready${config.error ? ` · ${config.error}` : ""}`}\n`);
      stdout.write(`MCP runtime: ${mcpRuntime.required ? (mcpRuntime.ready ? "ready" : `not ready${mcpRuntime.detail ? ` · ${mcpRuntime.detail}` : ""}`) : "not required"}\n`);
      stdout.write(`Bigger Context: ${features.error ? `unavailable · ${features.error}` : features.biggerContext ? "enabled (experimental, adaptive 1/2/3 messages; same-agent compaction handoff)" : "disabled"}\n`);
      stdout.write("Codex route: isolated and unused\nResponses listener: not started\n");
    }
    return;
  }
  if (action === "config") {
    activateDevProfileEnvironment(paths);
    if (args[0] === "compaction-model") await runCompactionModelConfigCommand(args);
    else await runProModelVersionConfigCommand(args);
    return;
  }
  if (action === "setup") {
    activateDevProfileEnvironment(paths);
    const browserOnly = takeFlag(args, "--browser-only");
    const full = takeFlag(args, "--full");
    if (browserOnly === full) throw new Error("Choose exactly one DEV setup mode: --browser-only or --full");
    const tunnelId = takeOption(args, "--tunnel-id");
    const runtimeKeyFile = takeOption(args, "--runtime-key-file");
    const descriptorPath = takeOption(args, "--browser-host-descriptor") ?? paths.descriptorPath;
    const acknowledgedUnofficial = takeFlag(args, "--acknowledge-unofficial");
    const refreshAccountCapabilities = takeFlag(args, "--refresh-account-capabilities");
    const automaticBrowserInteraction = takeFlag(args, "--automatic-browser-interaction");
    const manualBrowserInteraction = takeFlag(args, "--zero-risk-browser-interaction");
    if (automaticBrowserInteraction && manualBrowserInteraction) {
      throw new Error("Choose at most one browser interaction mode");
    }
    const savedChats = takeFlag(args, "--saved-chats");
    const temporaryChats = takeFlag(args, "--temporary-chats");
    if (savedChats && temporaryChats) throw new Error("Choose --saved-chats or --temporary-chats");
    const asyncToolOperations = takeFlag(args, "--async-tool-operations");
    const synchronousToolOperations = takeFlag(args, "--synchronous-tool-operations");
    if (asyncToolOperations && synchronousToolOperations) {
      throw new Error("Choose --async-tool-operations or --synchronous-tool-operations");
    }
    const biggerContext = takeFlag(args, "--bigger-context");
    const standardContext = takeFlag(args, "--standard-context");
    if (biggerContext && standardContext) {
      throw new Error("Choose at most one context mode: --bigger-context or --standard-context");
    }
    if (args.length > 0) throw new Error(`Unknown DEV setup arguments: ${args.join(" ")}`);
    const result = await setupDevProfile({
      mode: full ? "full" : "browser-only",
      browserHostDescriptorPath: descriptorPath,
      refreshAccountCapabilities,
      acknowledgedUnofficial,
      ...(automaticBrowserInteraction || manualBrowserInteraction
        ? { browserInteractionMode: manualBrowserInteraction ? "manual" : "automatic" }
        : {}),
      ...(biggerContext || standardContext ? { experimentalBiggerContext: biggerContext } : {}),
      ...(asyncToolOperations || synchronousToolOperations
        ? { experimentalAsyncToolOperations: asyncToolOperations }
        : {}),
      ...(savedChats || temporaryChats ? { useSavedChats: savedChats } : {}),
      ...(tunnelId ? { tunnelId } : {}),
      ...(runtimeKeyFile ? { runtimeKeyFile } : {}),
    });
    stdout.write(
      `Isolated DEV profile configured (${result.mode}) at ${result.configPath}.\n`
      + (result.experimentalAsyncToolOperations
        ? `Tool operations: asynchronous (experimental; connector ${JSON.stringify(result.connectorName)}).\n`
        : `Tool operations: synchronous (connector ${JSON.stringify(result.connectorName)}).\n`)
      + (result.connectorVerificationReset
        ? "Connector verification reset: verify the newly selected DEV connector identity before tool use.\n"
        : "")
      + "No Codex route, Responses listener, or system service was installed."
      + " In Full mode, the DEV launcher owns the isolated MCP tunnel.\n",
    );
    return;
  }
  if (action !== "chat") throw new Error(`Unknown DEV action: ${action}\n\n${DEV_HELP}`);

  activateDevProfileEnvironment(paths);
  const store = new DevChatStore(paths.chatsPath);
  const requestedModel = modelFromCli(takeOption(args, "--model"));
  const name = args.shift();
  if (!name) throw new Error(`DEV chat name is required\n\n${DEV_HELP}`);
  const message = args.join(" ").trim();
  if (!existsSync(paths.configPath)) {
    throw new Error(
      "DEV profile is not configured. In the window labelled DEV: sign in, run the browser smoke test,"
      + " and initialize the DEV profile. Complete optional MCP setup only for simulated tool rounds.",
    );
  }
  const config = loadConfig();
  const expectedConnector = config.browserInteractionMode === "manual"
    ? ZERO_RISK_CHATGPT_CONNECTOR_NAME
    : config.automaticAppName;
  if (config.mode === "full" && config.appName !== expectedConnector) {
    throw new Error("DEV connector identity is outdated. Refresh the DEV profile in the launcher before starting a named chat");
  }
  const runtimeStateRoot = paths.runtimePath;
  const features = readDevChatExperimentalFeatures(paths);
  await assertLauncherReady(config);
  const transport = config.mode === "full"
    ? await startDevChatTransport(config, paths.runtimePath)
    : undefined;
  let driver: DevChatDriver | undefined;
  let primaryFailure: unknown;
  let operationFailed = false;
  try {
    const runtimeConfig = transport?.config ?? config;
    const runtime = createLauncherDevAdapter(
      runtimeConfig,
      runtimeStateRoot,
      {
        ...(transport ? { broker: transport.broker } : {}),
      },
    );
    driver = new DevChatDriver(runtimeConfig, store, runtime.adapterFactory, process.cwd(), features);
    const opened = driver.open(name, requestedModel);
    if (requestedModel && opened.state.model !== requestedModel) {
      driver.setModel(opened.state, requestedModel);
    }
    printHeader(opened.state, opened.created, driver.status(opened.state), runtimeConfig.mode,
      features.biggerContext, runtimeConfig.useSavedChats);
    if (message) await executeMessage(driver, opened.state, message);
    else await interactive(driver, opened.state);
  } catch (error) {
    operationFailed = true;
    primaryFailure = error;
    throw error;
  } finally {
    const results = await Promise.allSettled([
      Promise.resolve().then(() => driver?.close()),
      Promise.resolve().then(() => transport?.close()),
    ]);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) {
      throw new AggregateError(
        [...(operationFailed ? [primaryFailure] : []), ...failures.map(result => result.reason)],
        operationFailed ? "DEV chat failed and cleanup also failed" : "DEV chat cleanup failed",
      );
    }
  }
}
