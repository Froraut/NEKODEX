import type { AppConfig, BrowserInteractionMode, RuntimeMode, SubagentProtocol } from "./config";
import { resolveInteractionConnectorIdentities, ZERO_RISK_CHATGPT_CONNECTOR_NAME } from "./config-policy";

export interface SetupOptions {
  mode: RuntimeMode;
  browserInteractionMode?: BrowserInteractionMode;
  subagentProtocol?: SubagentProtocol;
  port?: number;
  chromeExecutablePath?: string;
  browserHostDescriptorPath?: string;
  refreshAccountCapabilities?: boolean;
  forceLogin?: boolean;
  autoApproveToolCalls?: boolean;
  experimentalBiggerContext?: boolean;
  experimentalSkillAttachments?: boolean;
  allowWebSubagents?: boolean;
  experimentalFreshConversationPerTurn?: boolean;
  experimentalAsyncToolOperations?: boolean;
  zeroRiskProEnabled?: boolean;
  replaceCodexRoute?: boolean;
  restartService?: boolean;
  acknowledgedUnofficial?: boolean;
  tunnelId?: string;
  runtimeKeyFile?: string;
  runtimeKeyValue?: string;
}

export interface SetupTransitionContext {
  defaults: AppConfig;
  profile: "production" | "development";
  version: string;
  runtimeCommand: string[];
  brokerEndpoint: string;
  acknowledgementTime: string;
}

/** Pure transition: callers supply environment and perform all probes and mutations. */
export function transitionSetupConfig(existing: AppConfig | undefined, options: SetupOptions, context: SetupTransitionContext): AppConfig {
  const config = structuredClone(existing ?? context.defaults);
  config.mode = options.mode;
  if (options.browserInteractionMode) config.browserInteractionMode = options.browserInteractionMode;
  if (options.experimentalAsyncToolOperations !== undefined) {
    config.experimentalAsyncToolOperations = options.experimentalAsyncToolOperations;
  }
  // Changing to a non-tool mode disables async transport; an explicit incompatible request still fails.
  if (options.experimentalAsyncToolOperations === undefined
    && (config.mode !== "full" || config.browserInteractionMode !== "automatic")) {
    config.experimentalAsyncToolOperations = false;
  }
  if (options.experimentalAsyncToolOperations === undefined && existing?.browserInteractionMode === "manual"
    && config.mode === "full" && config.browserInteractionMode === "automatic") {
    config.experimentalAsyncToolOperations = /^(Codex Native5|Codex Native6)( DEV)?$/.test(existing.automaticAppName);
  }
  // A first Full setup defaults to Native6. Ordinary updates preserve an established schema.
  if (options.experimentalAsyncToolOperations === undefined && config.mode === "full"
    && config.browserInteractionMode === "automatic" && (!existing || existing.mode !== "full")) {
    config.experimentalAsyncToolOperations = true;
  }
  if (config.experimentalAsyncToolOperations
    && (config.mode !== "full" || config.browserInteractionMode !== "automatic")) {
    throw new Error(
      "Async tool operations require automatic Full mode; pass --synchronous-tool-operations before switching mode",
    );
  }
  Object.assign(config, resolveInteractionConnectorIdentities(
    config.browserInteractionMode,
    context.profile,
    config.experimentalAsyncToolOperations,
    options.experimentalAsyncToolOperations === undefined ? existing?.automaticAppName ?? config.automaticAppName : undefined,
  ));
  if (options.subagentProtocol) config.subagentProtocol = options.subagentProtocol;
  config.releaseVersion = context.version;
  config.runtimeCommand = [...context.runtimeCommand];
  if (options.port !== undefined) {
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) throw new Error("--port must be an integer from 1 to 65535");
    config.port = options.port;
  }
  if (options.chromeExecutablePath) config.chromeExecutablePath = options.chromeExecutablePath;
  if (options.browserHostDescriptorPath) {
    config.browserHost = "launcher";
    config.browserHostDescriptorPath = options.browserHostDescriptorPath;
    config.brokerSocketPath = context.brokerEndpoint;
  } else if (options.chromeExecutablePath) {
    config.browserHost = "managed-chrome";
    delete config.browserHostDescriptorPath;
  }
  if (options.autoApproveToolCalls !== undefined) config.autoApproveToolCalls = options.autoApproveToolCalls;
  if (options.experimentalFreshConversationPerTurn !== undefined) {
    config.experimentalFreshConversationPerTurn = options.experimentalFreshConversationPerTurn;
  }
  if (options.allowWebSubagents !== undefined) config.allowWebSubagents = options.allowWebSubagents;
  if (options.experimentalSkillAttachments !== undefined) {
    config.experimentalSkillAttachments = options.experimentalSkillAttachments;
  }
  if (options.experimentalBiggerContext !== undefined) {
    config.experimentalBiggerContext = options.experimentalBiggerContext;
  }
  if (options.zeroRiskProEnabled !== undefined) {
    if (config.browserInteractionMode !== "manual") {
      throw new Error("Manual mode Pro can be configured only with --zero-risk-browser-interaction");
    }
    config.zeroRiskProEnabled = options.zeroRiskProEnabled;
  }
  if (config.browserInteractionMode === "manual") {
    if (options.refreshAccountCapabilities) {
      throw new Error("Manual mode cannot refresh account capabilities");
    }
    if (options.forceLogin) {
      throw new Error("Manual mode uses the launcher's existing ChatGPT session; --login is unavailable");
    }
    if (options.experimentalSkillAttachments === true) {
      throw new Error("Manual mode does not support Skills as files");
    }
    if (options.experimentalBiggerContext === true) {
      throw new Error("Manual mode does not support Bigger Context");
    }
    if (config.mode !== "full") {
      throw new Error(`Manual mode requires --full so ${ZERO_RISK_CHATGPT_CONNECTOR_NAME} can signal start, tools, and completion`);
    }
    if (config.browserHost !== "launcher") {
      throw new Error("Manual mode requires the Launcher; pass --browser-host-descriptor from the running Launcher");
    }
    config.experimentalBiggerContext = false;
    config.experimentalSkillAttachments = false;
    config.experimentalFreshConversationPerTurn = false;
    config.solAvailable = false;
    config.extraHighAvailable = false;
    config.proAvailable = false;
  }
  if (options.acknowledgedUnofficial) config.acknowledgedUnofficialAt = context.acknowledgementTime;
  if (!config.acknowledgedUnofficialAt) {
    throw new Error("Setup requires explicit acknowledgement that this is unofficial browser automation. Pass --acknowledge-unofficial.");
  }
  return config;
}

/** Pro/compaction preferences are sampled dynamically and do not require restart. */
export function setupRuntimeProjection(config: AppConfig) {
  return {
    mode: config.mode,
    subagentProtocol: config.subagentProtocol,
    releaseVersion: config.releaseVersion,
    host: config.host,
    port: config.port,
    contextWindow: config.contextWindow,
    appName: config.appName,
    automaticAppName: config.automaticAppName,
    manualAppName: config.manualAppName,
    browserHost: config.browserHost,
    browserInteractionMode: config.browserInteractionMode,
    browserHostDescriptorPath: config.browserHostDescriptorPath,
    chromeExecutablePath: config.chromeExecutablePath,
    storageStatePath: config.storageStatePath,
    brokerSocketPath: config.brokerSocketPath,
    headed: config.headed,
    solAvailable: config.solAvailable,
    extraHighAvailable: config.extraHighAvailable,
    proAvailable: config.proAvailable,
    experimentalBiggerContext: config.experimentalBiggerContext,
    allowWebSubagents: config.allowWebSubagents,
    experimentalSkillAttachments: config.experimentalSkillAttachments,
    experimentalFreshConversationPerTurn: config.experimentalFreshConversationPerTurn,
    experimentalAsyncToolOperations: config.experimentalAsyncToolOperations,
    zeroRiskProEnabled: config.zeroRiskProEnabled,
    autoApproveToolCalls: config.autoApproveToolCalls,
    controlToken: config.controlToken,
    runtimeCommand: config.runtimeCommand,
    tunnel: config.tunnel,
    automaticTunnel: config.automaticTunnel,
    manualTunnel: config.manualTunnel,
  };
}

export function meaningfulRuntimeChange(before: AppConfig, after: AppConfig): boolean {
  return JSON.stringify(setupRuntimeProjection(before)) !== JSON.stringify(setupRuntimeProjection(after));
}
