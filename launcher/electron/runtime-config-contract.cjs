const path = require("node:path");

function absolutePath(value, platform = process.platform) {
  return platform === "win32" ? path.win32.isAbsolute(value) : path.isAbsolute(value);
}

function pathIdentity(value, platform = process.platform) {
  const normalized = platform === "win32" ? path.win32.resolve(value) : path.resolve(value);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function windowsPipeEndpoint(value) {
  return /^\\\\\.\\pipe\\[A-Za-z0-9._-]+$/.test(value);
}

function validateConfig(config, descriptorPath, platform = process.platform, launcherProfile = "production") {
  if (!config || config.version !== 3) throw new Error("Runtime configuration is missing or unsupported");
  if (launcherProfile === "development") {
    if (config.purpose !== "dev-harness") {
      throw new Error("DEV launcher refuses a configuration that is not marked dev-harness");
    }
  } else if (config.purpose !== undefined) {
    throw new Error("Production launcher refuses a DEV harness configuration");
  }
  if (config.solAvailable === undefined) config = { ...config, solAvailable: true };
  if (config.browserInteractionMode === undefined) {
    config.browserInteractionMode = "automatic";
  }
  if (config.mode !== "browser-only" && config.mode !== "full") {
    throw new Error("Runtime configuration has an invalid mode");
  }
  if (config.browserInteractionMode !== "automatic" && config.browserInteractionMode !== "manual") {
    throw new Error("Runtime configuration has an invalid browser interaction mode");
  }
  if (config.subagentProtocol !== undefined
    && config.subagentProtocol !== "compatibility-v1"
    && config.subagentProtocol !== "native") {
    throw new Error("Runtime configuration has an invalid subagent protocol");
  }
  if (typeof config.releaseVersion !== "string" || !config.releaseVersion.trim()) {
    throw new Error("Runtime configuration has no release version");
  }
  if (config.browserHost !== "launcher") throw new Error("Runtime configuration is not owned by the launcher");
  if (!absolutePath(config.browserHostDescriptorPath || "", platform)
    || pathIdentity(config.browserHostDescriptorPath || "", platform) !== pathIdentity(descriptorPath, platform)) {
    throw new Error("Runtime configuration points to a different launcher browser host");
  }
  if (config.host !== "127.0.0.1"
    || !Number.isInteger(config.port)
    || config.port < 1
    || config.port > 65_535) {
    throw new Error("Runtime configuration has an invalid loopback endpoint");
  }
  if (typeof config.controlToken !== "string" || !/^[A-Za-z0-9_-]{40,}$/.test(config.controlToken)) {
    throw new Error("Runtime configuration has an invalid lifecycle control token");
  }
  if (!Number.isSafeInteger(config.contextWindow) || config.contextWindow <= 0) {
    throw new Error("Runtime configuration has an invalid context window");
  }
  if (typeof config.appName !== "string" || !config.appName.trim() || config.appName.length > 80) {
    throw new Error("Runtime configuration has an invalid connector name");
  }
  for (const key of ["chromeExecutablePath", "storageStatePath", "brokerSocketPath"]) {
    if (typeof config[key] !== "string" || !config[key].trim()) {
      throw new Error(`Runtime configuration is missing ${key}`);
    }
  }
  if (platform === "win32") {
    if (!windowsPipeEndpoint(config.brokerSocketPath)) {
      throw new Error("Runtime configuration has an invalid Windows broker pipe");
    }
  } else if (!absolutePath(config.brokerSocketPath, platform) || windowsPipeEndpoint(config.brokerSocketPath)) {
    throw new Error("Runtime configuration has an invalid Unix broker socket");
  }
  for (const key of ["headed", "solAvailable", "proAvailable", "autoApproveToolCalls"]) {
    if (typeof config[key] !== "boolean") {
      throw new Error(`Runtime configuration has an invalid ${key}`);
    }
  }
  if (config.experimentalBiggerContext !== undefined
    && typeof config.experimentalBiggerContext !== "boolean") {
    throw new Error("Runtime configuration has an invalid experimentalBiggerContext");
  }
  if (config.useSavedChats !== undefined && typeof config.useSavedChats !== "boolean") {
    throw new Error("Runtime configuration has an invalid useSavedChats");
  }
  if (config.useSavedChats === undefined) config.useSavedChats = false;
  if (config.compactionModel !== undefined
    && config.compactionModel !== "extra-high"
    && config.compactionModel !== "5.6-pro"
    && config.compactionModel !== "5.5-pro") {
    throw new Error("Runtime configuration has an invalid compactionModel");
  }
  if (config.proModelVersion !== undefined
    && config.proModelVersion !== "5.6"
    && config.proModelVersion !== "5.5"
    && config.proModelVersion !== "6") {
    throw new Error("Runtime configuration has an invalid proModelVersion");
  }
  if (config.stallTimeoutSec !== undefined
    && (!Number.isFinite(config.stallTimeoutSec) || config.stallTimeoutSec <= 0)) {
    throw new Error("Runtime configuration has an invalid stallTimeoutSec");
  }
  if (config.proAvailable && !config.solAvailable) {
    throw new Error("Runtime configuration cannot enable Pro without Sol");
  }
  if (!Array.isArray(config.runtimeCommand)
    || config.runtimeCommand.length === 0
    || config.runtimeCommand.some(part => typeof part !== "string" || !part.trim())) {
    throw new Error("Runtime configuration has an invalid runtime command");
  }
  const validateTunnel = (tunnel, label) => {
    if (!tunnel || typeof tunnel !== "object") {
      throw new Error(`Full mode is missing ${label}`);
    }
    for (const key of ["binaryPath", "tunnelId", "runtimeKeyFile", "profileDir", "profileName", "alias"]) {
      if (typeof tunnel[key] !== "string" || !tunnel[key].trim()) {
        throw new Error(`Full mode is missing ${label}.${key}`);
      }
    }
    if (!/^tunnel_[a-f0-9]{32}$/.test(tunnel.tunnelId)) {
      throw new Error(`Full mode has an invalid ${label} id`);
    }
    for (const key of ["profileName", "alias"]) {
      if (!/^[A-Za-z0-9._-]+$/.test(tunnel[key])) {
        throw new Error(`Full mode has an invalid ${label}.${key}`);
      }
    }
    for (const key of ["binaryPath", "runtimeKeyFile", "profileDir"]) {
      if (!absolutePath(tunnel[key], platform)) {
        throw new Error(`Full mode requires an absolute ${label}.${key}`);
      }
    }
  };
  if (config.mode === "full") {
    validateTunnel(config.tunnel, "tunnel");
    if (config.automaticTunnel !== undefined) validateTunnel(config.automaticTunnel, "automaticTunnel");
    if (config.manualTunnel !== undefined) validateTunnel(config.manualTunnel, "manualTunnel");
    if (config.automaticTunnel && config.manualTunnel
      && config.automaticTunnel.tunnelId === config.manualTunnel.tunnelId) {
      throw new Error("Automatic and Manual mode tunnel IDs must differ");
    }
    const activeTunnel = config.browserInteractionMode === "manual"
      ? config.manualTunnel
      : config.automaticTunnel;
    if ((config.automaticTunnel || config.manualTunnel) && !activeTunnel) {
      throw new Error("Active browser interaction mode has no tunnel configuration");
    }
    if (activeTunnel && JSON.stringify(activeTunnel) !== JSON.stringify(config.tunnel)) {
      throw new Error("Active browser interaction mode does not match the active tunnel");
    }
  }
  return config;
}

// Setup accepts legacy mode spelling; it does not authorize runtime startup.
function normalizeSetupConfig(config, launcherProfile = "production") {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Runtime configuration is not an object");
  }
  if (launcherProfile === "development") {
    if (config.purpose !== "dev-harness") {
      throw new Error("DEV launcher refuses a configuration that is not marked dev-harness");
    }
  } else if (config.purpose !== undefined) {
    throw new Error("Production launcher refuses a DEV harness configuration");
  }
  const mode = config.mode === "pro-only" ? "browser-only" : config.mode;
  if (mode !== "browser-only" && mode !== "full") {
    throw new Error("Runtime configuration has an invalid setup mode");
  }
  return { ...config, mode };
}

module.exports = { absolutePath, validateConfig, normalizeSetupConfig };
