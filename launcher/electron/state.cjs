const fs = require("node:fs");
const languages = require("./languages.json");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 420;
const SESSION_REFRESH_REMINDER_INTERVAL_MS = 48 * 60 * 60 * 1000;
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
  browserInteractionMode: "automatic",
  experimentalBiggerContext: false,
  pendingBiggerContext: null,
  contextChangeApplying: false,
  contextChangeError: null,
  zeroRiskProEnabled: false,
  browserSmokePassed: false,
  browserSmokeVersion: null,
  sidebarOpen: true,
  sidebarWidth: 252,
  mcpGuideStep: 0,
  sessionRefreshReminderAt: null,
});

function nextSessionRefreshReminderAt(now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error("Session refresh reminder time must be finite");
  return new Date(now + SESSION_REFRESH_REMINDER_INTERVAL_MS).toISOString();
}

function proofInvalidationPatch(kind) {
  return kind === "account" ? ACCOUNT_PROOF_INVALIDATION : MCP_PROOF_INVALIDATION;
}

function readState(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || parsed.version !== 1) return { ...DEFAULT_STATE };
    const state = { ...DEFAULT_STATE, ...parsed };
    state.contextChangeApplying = false;
    if (typeof state.pendingBiggerContext !== "boolean") state.pendingBiggerContext = null;
    if (typeof state.contextChangeError !== "string") state.contextChangeError = null;
    if (state.coreSetupComplete === true && state.codexPickerConfirmed !== true) state.codexRestartRequired = true;
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
      "experimentalBiggerContext",
      "zeroRiskProEnabled",
      "browserSmokePassed",
      "sidebarOpen",
    ]) {
      if (typeof state[key] !== "boolean") state[key] = DEFAULT_STATE[key];
    }
    if (state.browserInteractionMode !== "automatic" && state.browserInteractionMode !== "manual") {
      state.browserInteractionMode = DEFAULT_STATE.browserInteractionMode;
    }
    if (state.coreSetupComplete !== true) {
      if (state.onboardingComplete !== true) state.browserInteractionMode = "automatic";
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
    if (state.sessionRefreshReminderAt !== null
      && (typeof state.sessionRefreshReminderAt !== "string"
        || !Number.isFinite(Date.parse(state.sessionRefreshReminderAt)))) {
      state.sessionRefreshReminderAt = DEFAULT_STATE.sessionRefreshReminderAt;
    }
    for (const key of [
      "coreSetupComplete",
      "codexCatalogVerified",
      "codexPickerConfirmed",
      "mcpSetupComplete",
      "mcpRuntimeInstalled",
      "codexRestartRequired",
    ]) {
      if (state[key] !== undefined && typeof state[key] !== "boolean") delete state[key];
    }
    if (state.coreSetupComplete === false) {
      state.codexCatalogVerified = false;
      state.codexPickerConfirmed = false;
      state.mcpSetupComplete = false;
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
        || !Number.isFinite(Date.parse(state.setupVerifiedAt))
        || typeof state.setupRuntimeIdentity !== "string")) {
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
        ...(modeChanged ? proofInvalidationPatch("account") : {}),
        version: 1,
      };
      if (next.coreSetupComplete === false) {
        next.codexCatalogVerified = false;
        next.codexPickerConfirmed = false;
        next.mcpSetupComplete = false;
      } else if (patch.codexCatalogVerified === false) {
        next.codexPickerConfirmed = false;
      }
      return persist(next);
    },
    invalidateAccountProof() {
      return persist({
        ...state,
        ...proofInvalidationPatch("account"),
        version: 1,
      });
    },
  };
}

module.exports = {
  ACCOUNT_PROOF_INVALIDATION,
  MCP_PROOF_INVALIDATION,
  SESSION_REFRESH_REMINDER_INTERVAL_MS,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  createStateStore,
  nextSessionRefreshReminderAt,
  validateSidebarState,
};
