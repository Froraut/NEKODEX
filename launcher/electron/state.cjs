const fs = require("node:fs");
const languages = require("./languages.json");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 420;
const MCP_PROOF_INVALIDATION = Object.freeze({
  mcpSetupComplete: false,
  setupContract: null,
  setupIdentityHash: null,
  setupVerifiedAt: null,
  setupRuntimeIdentity: null,
});
const ACCOUNT_PROOF_INVALIDATION = Object.freeze({
  ...MCP_PROOF_INVALIDATION,
  browserSmokePassed: false,
  browserSmokeVersion: null,
  setupIdentityHash: null,
  setupVerifiedAt: null,
  pickerVerifiedAt: null,
});

const DEFAULT_STATE = Object.freeze({
  version: 1,
  language: null,
  onboardingComplete: false,
  githubOpened: false,
  xOpened: false,
  autoStart: false,
  keepRunningOnClose: true,
  showBrowserDuringTurns: true,
  showNetworkIssueNotice: true,
  manualSubmitTimeoutSec: 120,
  passkeyBrowser: "chrome",
  browserInteractionMode: "automatic",
  experimentalAsyncToolOperations: false,
  experimentalBiggerContext: false,
  experimentalSkillAttachments: false,
  allowWebSubagents: false,
  experimentalFreshConversationPerTurn: false,
  useSavedChats: false,
  pendingBiggerContext: null,
  contextChangeApplying: false,
  contextChangeError: null,
  zeroRiskProEnabled: false,
  browserSmokePassed: false,
  browserSmokeVersion: null,
  sidebarOpen: true,
  sidebarWidth: 252,
  mcpGuideStep: 0,
  appearance: "dark",
});
const APPEARANCES = Object.freeze(["system", "dark", "light"]);

function isAppearance(value) {
  return typeof value === "string" && APPEARANCES.includes(value);
}

function validateAppearance(value) {
  if (!isAppearance(value)) throw new Error("Appearance must be System, Dark or Light");
  return value;
}

// "system" follows the operating system; everything else is an explicit launcher theme.
function resolveAppearance(appearance, systemPrefersDark) {
  if (appearance === "light" || appearance === "dark") return appearance;
  if (appearance === "system") return systemPrefersDark ? "dark" : "light";
  return DEFAULT_STATE.appearance;
}

function readState(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || parsed.version !== 1) return { ...DEFAULT_STATE };
    const state = { ...DEFAULT_STATE, ...parsed };
    state.contextChangeApplying = false;
    if (!["chrome", "firefox"].includes(state.passkeyBrowser)) state.passkeyBrowser = "chrome";
    if (!Number.isInteger(state.manualSubmitTimeoutSec) || state.manualSubmitTimeoutSec < 30 || state.manualSubmitTimeoutSec > 600) {
      state.manualSubmitTimeoutSec = DEFAULT_STATE.manualSubmitTimeoutSec;
    }
    if (typeof state.pendingBiggerContext !== "boolean") state.pendingBiggerContext = null;
    if (typeof state.contextChangeError !== "string") state.contextChangeError = null;
    delete state.bridgeEnabled;
    if (state.language !== null && (typeof state.language !== "string" || !Object.hasOwn(languages, state.language))) {
      state.language = DEFAULT_STATE.language;
    }
    for (const key of [
      "onboardingComplete",
      "githubOpened",
      "xOpened",
      "autoStart",
      "keepRunningOnClose",
      "showBrowserDuringTurns",
      "showNetworkIssueNotice",
      "experimentalAsyncToolOperations",
      "experimentalBiggerContext",
      "experimentalSkillAttachments",
      "allowWebSubagents",
      "experimentalFreshConversationPerTurn",
      "useSavedChats",
      "zeroRiskProEnabled",
      "browserSmokePassed",
      "sidebarOpen",
    ]) {
      if (typeof state[key] !== "boolean") state[key] = DEFAULT_STATE[key];
    }
    if (!isAppearance(state.appearance)) state.appearance = DEFAULT_STATE.appearance;
    if (state.browserInteractionMode !== "automatic" && state.browserInteractionMode !== "manual") {
      state.browserInteractionMode = DEFAULT_STATE.browserInteractionMode;
    }
    if (state.browserInteractionMode === "manual" || state.coreSetupComplete === false) {
      state.pendingBiggerContext = null;
      state.contextChangeError = null;
    }
    if (state.coreSetupComplete !== true) {
      if (state.onboardingComplete !== true) state.browserInteractionMode = "automatic";
      state.experimentalAsyncToolOperations = false;
      state.zeroRiskProEnabled = false;
    }
    if (state.browserSmokeVersion !== null
      && (typeof state.browserSmokeVersion !== "string" || state.browserSmokeVersion.length > 128)) {
      state.browserSmokeVersion = DEFAULT_STATE.browserSmokeVersion;
    }
    if (!Number.isFinite(state.sidebarWidth)
      || state.sidebarWidth < SIDEBAR_MIN_WIDTH
      || state.sidebarWidth > SIDEBAR_MAX_WIDTH) {
      state.sidebarWidth = DEFAULT_STATE.sidebarWidth;
    }
    if (!Number.isInteger(state.mcpGuideStep) || state.mcpGuideStep < 0 || state.mcpGuideStep > 2) {
      state.mcpGuideStep = DEFAULT_STATE.mcpGuideStep;
    }
    delete state.sessionRefreshReminderAt;
    for (const key of [
      "coreSetupComplete",
      "codexCatalogVerified",
      "codexPickerConfirmed",
      "mcpSetupComplete",
      "mcpRuntimeInstalled",
      "codexRestartRequired",
      "runtimeMigrationPending",
      "launcherRestartRequired",
    ]) {
      if (state[key] !== undefined && typeof state[key] !== "boolean") delete state[key];
    }
    // A received catalog and a user's picker confirmation are separate facts.
    // Older launchers recreated the refresh flag on every launch until the user
    // confirmed the picker. A pending restart (a changed model list) stays until
    // the user confirms the picker, which also clears it.
    if (state.coreSetupComplete === true && state.codexCatalogVerified === true && state.codexPickerConfirmed === true) {
      state.codexRestartRequired = false;
    }
    if (state.codexPickerContract !== undefined && state.codexPickerContract !== null
      && (typeof state.codexPickerContract !== "string" || !/^[a-f0-9]{64}$/.test(state.codexPickerContract))) {
      delete state.codexPickerContract;
    }
    if (state.coreSetupComplete === false) {
      state.codexCatalogVerified = false;
      state.codexPickerConfirmed = false;
      state.codexPickerContract = null;
      state.mcpSetupComplete = false;
    }
    if (state.setupConnectorName != null
      && (typeof state.setupConnectorName !== "string" || !state.setupConnectorName.trim() || state.setupConnectorName.length > 80)) {
      delete state.setupConnectorName;
    }
    if (!Number.isSafeInteger(state.setupContract) || state.setupContract < 1) delete state.setupContract;
    if (typeof state.setupIdentityHash !== "string" || !/^[a-f0-9]{64}$/.test(state.setupIdentityHash)) delete state.setupIdentityHash;
    for (const key of ["setupVerifiedAt", "pickerVerifiedAt"]) {
      if (typeof state[key] !== "string" || !Number.isFinite(Date.parse(state[key]))) delete state[key];
    }
    if (typeof state.setupRuntimeIdentity !== "string" || !/^\d+:\d+:\d+$/.test(state.setupRuntimeIdentity)) {
      delete state.setupRuntimeIdentity;
    }
    if (state.mcpSetupComplete === true
      && (!Number.isSafeInteger(state.setupContract)
        || state.setupContract < 1
        || typeof state.setupIdentityHash !== "string"
        || !/^[a-f0-9]{64}$/.test(state.setupIdentityHash)
        || typeof state.setupVerifiedAt !== "string"
        || !Number.isFinite(Date.parse(state.setupVerifiedAt)))) {
      Object.assign(state, MCP_PROOF_INVALIDATION);
    }
    return state;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(filePath, state) {
  writePrivateFileAtomic(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

function validateSidebarState(value) {
  if (!value || typeof value !== "object" || typeof value.open !== "boolean") {
    throw new Error("Sidebar state is invalid");
  }
  if (!Number.isFinite(value.width) || value.width < SIDEBAR_MIN_WIDTH || value.width > SIDEBAR_MAX_WIDTH) {
    throw new Error(`Sidebar width must be between ${SIDEBAR_MIN_WIDTH} and ${SIDEBAR_MAX_WIDTH}`);
  }
  return { sidebarOpen: value.open, sidebarWidth: Math.round(value.width) };
}

function createStateStore(filePath) {
  let state = readState(filePath);
  function persist(next) {
    writeState(filePath, next);
    state = next;
    return structuredClone(next);
  }
  return {
    read() {
      return structuredClone(state);
    },
    update(patch) {
      const modeChanged = Object.prototype.hasOwnProperty.call(patch, "browserInteractionMode")
        && patch.browserInteractionMode !== state.browserInteractionMode;
      const next = {
        ...state,
        ...patch,
        ...(modeChanged ? ACCOUNT_PROOF_INVALIDATION : {}),
        version: 1,
      };
      if (next.coreSetupComplete === false) {
        next.codexCatalogVerified = false;
        next.codexPickerConfirmed = false;
        next.codexPickerContract = null;
        next.mcpSetupComplete = false;
        next.experimentalAsyncToolOperations = false;
      } else if (patch.codexCatalogVerified === false) {
        next.codexPickerConfirmed = false;
      }
      // The restart request changes only explicitly: a served catalog request is not proof of
      // what the Codex picker loaded, and confirming the picker clears it.
      if (next.browserInteractionMode === "manual" || next.coreSetupComplete === false) {
        next.pendingBiggerContext = null;
        next.contextChangeError = null;
        next.contextChangeApplying = false;
      }
      return persist(next);
    },
  };
}

module.exports = {
  ACCOUNT_PROOF_INVALIDATION,
  APPEARANCES,
  MCP_PROOF_INVALIDATION,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  createStateStore,
  resolveAppearance,
  validateAppearance,
  validateSidebarState,
};
