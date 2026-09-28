export const CHATGPT_WEB_MODEL_PREFIX = "chatgpt-web/";
export const CHATGPT_WEB_BACKEND_MODEL = "gpt-5.6-sol";
export const CHATGPT_WEB_LUNA_BACKEND_MODEL = "gpt-5.6-luna";

/** A pinned version for automatic Pro turns; omission preserves the existing Web selection. */
export type ChatGptWebProModelVersion = "5.6" | "5.5" | "6";

export function parseChatGptWebProModelVersion(value: unknown): ChatGptWebProModelVersion | undefined {
  if (value === undefined || value === "5.6" || value === "5.5" || value === "6") return value;
  throw new Error("Invalid ChatGPT Pro model version; choose 5.6, 5.5, or 6");
}
/** Internal adapter identity for a turn whose ChatGPT model is selected by the user in the launcher. */
export const CHATGPT_WEB_ZERO_RISK_BACKEND_MODEL = "chatgpt-web-zero-risk";
/** Internal adapter identity for the explicitly enabled, Pro-sized Manual mode context profile. */
export const CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL = "chatgpt-web-zero-risk-pro";

export type ChatGptWebAutomaticBackendModel =
  | typeof CHATGPT_WEB_BACKEND_MODEL
  | typeof CHATGPT_WEB_LUNA_BACKEND_MODEL;
export type ChatGptWebBackendModel =
  | ChatGptWebAutomaticBackendModel
  | ChatGptWebZeroRiskBackendModel;
export type ChatGptWebZeroRiskBackendModel =
  | typeof CHATGPT_WEB_ZERO_RISK_BACKEND_MODEL
  | typeof CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL;

export type ChatGptWebCodexEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type ChatGptWebAdapterEffort = "low" | "medium" | "high" | "xhigh" | "max";
/** A ChatGPT model version as its picker names it, such as "5.6" in "GPT-5.6 Sol". */
export type ChatGptWebModelFamily = string;

const CHATGPT_WEB_MODEL_VERSION = /^\d{1,2}(?:\.\d{1,2})?$/;
// A model name ChatGPT shows next to a version ("Sol" in "GPT-5.6 Sol"). Effort words never qualify.
const CHATGPT_WEB_MODEL_NAME = /^(?!(?:Instant|Light|Medium|High|Extra|Pro|Thinking|Moyen)$)[A-Z][A-Za-z]{1,19}$/;

export function isChatGptWebModelVersion(value: unknown): value is ChatGptWebModelFamily {
  return typeof value === "string" && CHATGPT_WEB_MODEL_VERSION.test(value);
}

export function isChatGptWebModelName(value: unknown): value is string {
  return typeof value === "string" && CHATGPT_WEB_MODEL_NAME.test(value);
}

/** Newest first, comparing each numeric component ("6" > "5.6" > "5.5"). */
export function compareChatGptWebModelVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Measured Plus browser transport windows, including the fixed hidden ChatGPT platform reserve.
 * Codex compacts the visible task at the lower explicit threshold before the next browser turn is
 * compiled. The remaining headroom is owned by ChatGPT's product prompt and Codex Native schemas.
 */
export const CHATGPT_WEB_INSTANT_CONTEXT_WINDOW = 41_000;
export const CHATGPT_WEB_INSTANT_AUTO_COMPACT_TOKEN_LIMIT = 32_000;
/**
 * Manual mode keeps one visible ChatGPT conversation across sequential Codex turns. Its fixed route
 * therefore uses the requested three-turn compaction interval without enabling Bigger Context's
 * automatic multipart transport; the user still pastes exactly one incremental prompt per turn.
 */
export const CHATGPT_WEB_ZERO_RISK_CONTEXT_WINDOW = CHATGPT_WEB_INSTANT_CONTEXT_WINDOW * 3;
export const CHATGPT_WEB_ZERO_RISK_AUTO_COMPACT_TOKEN_LIMIT = CHATGPT_WEB_INSTANT_AUTO_COMPACT_TOKEN_LIMIT * 3;
export const CHATGPT_WEB_MEDIUM_HIGH_CONTEXT_WINDOW = 90_000;
export const CHATGPT_WEB_MEDIUM_HIGH_AUTO_COMPACT_TOKEN_LIMIT = 80_000;
export const CHATGPT_WEB_INSTANT_COMPOSER_CHAR_LIMIT = 211_256;
export const CHATGPT_WEB_MEDIUM_HIGH_COMPOSER_CHAR_LIMIT = 1_048_572;
/** Hidden ChatGPT product prompt and Codex Native schema reserve included in usage estimates. */
export const CHATGPT_WEB_PLATFORM_RESERVE_TOKENS = 8_192;
/** Reserve for each attachment in the final browser message; inert stages carry no images. */
export function chatGptWebImageTokenReserve(detail?: string): number {
  return detail === "original" ? 8_192 : 4_096;
}
/** Pro-account usable browser windows and separately measured one-message boundaries. */
export const CHATGPT_WEB_PRO_AUTO_COMPACT_TOKEN_LIMIT = 95_000;
export const CHATGPT_WEB_PRO_STANDARD_MESSAGE_TOKEN_LIMIT = 103_000;
export const CHATGPT_WEB_PRO_MODEL_MESSAGE_TOKEN_LIMIT = 104_000;
// Browser message maxima are inclusive, while the context preflight treats its ceiling as an
// exclusive upper bound. The extra token preserves the last accepted payload exactly.
export const CHATGPT_WEB_PRO_STANDARD_CONTEXT_WINDOW =
  CHATGPT_WEB_PRO_STANDARD_MESSAGE_TOKEN_LIMIT + CHATGPT_WEB_PLATFORM_RESERVE_TOKENS + 1;
export const CHATGPT_WEB_PRO_MODEL_CONTEXT_WINDOW =
  CHATGPT_WEB_PRO_MODEL_MESSAGE_TOKEN_LIMIT + CHATGPT_WEB_PLATFORM_RESERVE_TOKENS + 1;
/**
 * Manual mode Pro keeps the same three-turn manual conversation budget as the default profile, but
 * sizes each turn from the measured ChatGPT Pro boundary. The launcher cannot verify that the user
 * actually selected Pro, so this profile is exposed only through an explicit user setting.
 */
export const CHATGPT_WEB_ZERO_RISK_PRO_CONTEXT_WINDOW =
  CHATGPT_WEB_PRO_MODEL_CONTEXT_WINDOW * 3;
export const CHATGPT_WEB_ZERO_RISK_PRO_AUTO_COMPACT_TOKEN_LIMIT =
  CHATGPT_WEB_PRO_AUTO_COMPACT_TOKEN_LIMIT * 3;
export const CHATGPT_WEB_PRO_INSTANT_COMPOSER_CHAR_LIMIT = 545_000;
export const CHATGPT_WEB_PRO_REASONING_COMPOSER_CHAR_LIMIT = 500_000;
export const CHATGPT_WEB_PRO_MODEL_COMPOSER_CHAR_LIMIT = 1_635_000;
/**
 * The underlying Luna model owns this context window. ChatGPT Free's much smaller browser request
 * envelope is enforced separately at the browser boundary; rolling checkpoints keep completed
 * history out of later browser requests without asking Codex to compact its canonical history.
 */
export const CHATGPT_WEB_LUNA_CONTEXT_WINDOW = 1_050_000;
export const CHATGPT_WEB_BIGGER_CONTEXT_MULTIPLIER = 3;

export interface ChatGptWebContextLimits {
  contextWindow: number;
  effectiveContextWindowPercent: number;
  autoCompactTokenLimit: number;
}

export interface ChatGptWebTransportLimits {
  browserMessageTokenLimit?: number;
  browserComposerCharLimit?: number;
}

export function isChatGptWebZeroRiskBackendModel(
  model: string,
): model is ChatGptWebZeroRiskBackendModel {
  return model === CHATGPT_WEB_ZERO_RISK_BACKEND_MODEL
    || model === CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL;
}

function contextLimits(
  contextWindow: number,
  autoCompactTokenLimit: number,
): ChatGptWebContextLimits {
  return {
    contextWindow,
    // Codex reports this effective window in its context indicator. Align it with the practical
    // pre-compaction budget instead of exposing an unreachable underlying model window.
    effectiveContextWindowPercent: Math.round((autoCompactTokenLimit / contextWindow) * 100),
    autoCompactTokenLimit,
  };
}

/** Resolve the product limit for the selected visible ChatGPT mode. */
export function resolveChatGptWebContextLimits(
  backendModel: ChatGptWebBackendModel,
  effort: ChatGptWebAdapterEffort,
  capabilities: ChatGptWebAccountCapabilities,
): ChatGptWebContextLimits {
  if (isChatGptWebZeroRiskBackendModel(backendModel)) {
    if (capabilities.experimentalBiggerContext) {
      throw new Error("Manual mode does not support Bigger Context");
    }
    if (backendModel === CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL) {
      return contextLimits(
        CHATGPT_WEB_ZERO_RISK_PRO_CONTEXT_WINDOW,
        CHATGPT_WEB_ZERO_RISK_PRO_AUTO_COMPACT_TOKEN_LIMIT,
      );
    }
    return contextLimits(
      CHATGPT_WEB_ZERO_RISK_CONTEXT_WINDOW,
      CHATGPT_WEB_ZERO_RISK_AUTO_COMPACT_TOKEN_LIMIT,
    );
  }
  if (backendModel === CHATGPT_WEB_LUNA_BACKEND_MODEL) {
    // Luna carries continuity through a private checkpoint on every completed browser turn. Codex
    // internally clamps this field to 90% of the model window, but the reported active usage is the
    // bounded payload actually sent to ChatGPT and therefore stays far below that threshold.
    return contextLimits(CHATGPT_WEB_LUNA_CONTEXT_WINDOW, CHATGPT_WEB_LUNA_CONTEXT_WINDOW);
  }

  let limits: ChatGptWebContextLimits;
  // Extra High availability alone does not establish the larger Pro context envelope.
  if (capabilities.proAvailable) {
    const contextWindow = effort === "max"
      ? CHATGPT_WEB_PRO_MODEL_CONTEXT_WINDOW
      : CHATGPT_WEB_PRO_STANDARD_CONTEXT_WINDOW;
    limits = contextLimits(contextWindow, CHATGPT_WEB_PRO_AUTO_COMPACT_TOKEN_LIMIT);
  } else if (effort === "low") {
    limits = contextLimits(
      CHATGPT_WEB_INSTANT_CONTEXT_WINDOW,
      CHATGPT_WEB_INSTANT_AUTO_COMPACT_TOKEN_LIMIT,
    );
  } else if (effort === "medium" || effort === "high" || (effort === "xhigh" && chatGptExtraHighAvailable(capabilities))) {
    limits = contextLimits(
      CHATGPT_WEB_MEDIUM_HIGH_CONTEXT_WINDOW,
      CHATGPT_WEB_MEDIUM_HIGH_AUTO_COMPACT_TOKEN_LIMIT,
    );
  } else {
    throw new Error(`ChatGPT Plus context limit is not defined for unavailable effort: ${effort}`);
  }
  if (!capabilities.experimentalBiggerContext) return limits;
  return contextLimits(
    limits.contextWindow * CHATGPT_WEB_BIGGER_CONTEXT_MULTIPLIER,
    limits.autoCompactTokenLimit * CHATGPT_WEB_BIGGER_CONTEXT_MULTIPLIER,
  );
}

/** Resolve limits of one visible ChatGPT composer message, independently of model context. */
export function resolveChatGptWebTransportLimits(
  backendModel: ChatGptWebBackendModel,
  effort: ChatGptWebAdapterEffort,
  capabilities: ChatGptWebAccountCapabilities,
): ChatGptWebTransportLimits {
  if (isChatGptWebZeroRiskBackendModel(backendModel)) return {};
  if (backendModel === CHATGPT_WEB_LUNA_BACKEND_MODEL) return {};
  if (!capabilities.proAvailable) {
    if (effort === "low") {
      return { browserComposerCharLimit: CHATGPT_WEB_INSTANT_COMPOSER_CHAR_LIMIT };
    }
    if (effort === "medium" || effort === "high" || (effort === "xhigh" && chatGptExtraHighAvailable(capabilities))) {
      return { browserComposerCharLimit: CHATGPT_WEB_MEDIUM_HIGH_COMPOSER_CHAR_LIMIT };
    }
    throw new Error(`ChatGPT Plus transport limit is not defined for unavailable effort: ${effort}`);
  }
  if (effort === "low") {
    return {
      browserMessageTokenLimit: CHATGPT_WEB_PRO_STANDARD_MESSAGE_TOKEN_LIMIT,
      browserComposerCharLimit: CHATGPT_WEB_PRO_INSTANT_COMPOSER_CHAR_LIMIT,
    };
  }
  if (effort === "max") {
    return {
      browserMessageTokenLimit: CHATGPT_WEB_PRO_MODEL_MESSAGE_TOKEN_LIMIT,
      browserComposerCharLimit: CHATGPT_WEB_PRO_MODEL_COMPOSER_CHAR_LIMIT,
    };
  }
  return {
    browserMessageTokenLimit: CHATGPT_WEB_PRO_STANDARD_MESSAGE_TOKEN_LIMIT,
    browserComposerCharLimit: CHATGPT_WEB_PRO_REASONING_COMPOSER_CHAR_LIMIT,
  };
}

/**
 * Visible text that fits one ordinary input after its hidden reserve and images. This is derived
 * from the existing context contract, not a new measured browser limit or a compaction trigger.
 * Bigger Context expands the transaction, never this per-message budget.
 */
export function resolveChatGptWebMessageTokenBudget(
  backendModel: typeof CHATGPT_WEB_BACKEND_MODEL,
  effort: ChatGptWebAdapterEffort,
  capabilities: ChatGptWebAccountCapabilities,
  imageTokens = 0,
): number {
  const { contextWindow } = resolveChatGptWebContextLimits(
    backendModel, effort, { ...capabilities, experimentalBiggerContext: false },
  );
  const { browserMessageTokenLimit } = resolveChatGptWebTransportLimits(backendModel, effort, capabilities);
  return Math.max(0, Math.min(
    contextWindow - CHATGPT_WEB_PLATFORM_RESERVE_TOKENS - imageTokens - 1,
    browserMessageTokenLimit ?? Infinity,
  ));
}

interface ChatGptWebModelRouteBase {
  slug: string;
  displayName: string;
  description: string;
  codexEffort: ChatGptWebCodexEffort;
  requiresPro: boolean;
  requiresExtraHigh?: boolean;
  /** Omission preserves the immutable effort of existing saved task identities. */
  supportedCodexEfforts?: readonly ChatGptWebCodexEffort[];
}

export interface ChatGptWebAutomaticModelRoute extends ChatGptWebModelRouteBase {
  interactionMode: "automatic";
  backendModel: ChatGptWebAutomaticBackendModel;
  adapterEffort: ChatGptWebAdapterEffort;
  /** Explicit browser family; independent of the shared transport budget. */
  modelFamily?: ChatGptWebModelFamily;
  /** New families are advertised only after that account's picker confirms them. */
  requiresModelObservation?: boolean;
}

export interface ChatGptWebZeroRiskModelRoute extends ChatGptWebModelRouteBase {
  interactionMode: "manual";
  backendModel: ChatGptWebZeroRiskBackendModel;
  /** Technical protocol value only; Manual mode must not use it to choose the ChatGPT model. */
  adapterEffort: "low";
}

export type ChatGptWebModelRoute = ChatGptWebAutomaticModelRoute | ChatGptWebZeroRiskModelRoute;

/** Observed selectability, not a subscription or a promise of remaining quota. */
export interface ChatGptWebModelCapabilities {
  observedAt: number;
  /** Each model version the picker offers, with the thinking levels that actually run it. */
  families: Partial<Record<ChatGptWebModelFamily, readonly ChatGptWebAdapterEffort[]>>;
  /**
   * The name ChatGPT shows with a version ("Sol" for GPT-5.6 Sol). Present, possibly empty, on
   * every observation that read the picker's own model descriptions; absent on older ones.
   */
  names?: Partial<Record<ChatGptWebModelFamily, string>>;
}

const MAX_OBSERVED_FAMILIES = 12;

export function parseChatGptWebModelCapabilities(value: unknown): ChatGptWebModelCapabilities | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid ChatGPT model capabilities");
  const candidate = value as ChatGptWebModelCapabilities;
  if (!Number.isSafeInteger(candidate.observedAt) || candidate.observedAt <= 0
    || !candidate.families || typeof candidate.families !== "object" || Array.isArray(candidate.families)
    || Object.keys(candidate.families).length > MAX_OBSERVED_FAMILIES) {
    throw new Error("Invalid ChatGPT model capability observation");
  }
  const families: ChatGptWebModelCapabilities["families"] = {};
  for (const [family, efforts] of Object.entries(candidate.families)) {
    if (!isChatGptWebModelVersion(family) || !Array.isArray(efforts)
      || efforts.some(effort => !["low", "medium", "high", "xhigh", "max"].includes(effort))
      || new Set(efforts).size !== efforts.length) throw new Error("Invalid ChatGPT model effort capabilities");
    families[family] = [...efforts];
  }
  if (candidate.names === undefined) {
    // Observations before model names were read attributed every Latest level to GPT-6. ChatGPT
    // runs GPT-5.6 Sol below Pro even with Latest selected, so only their Pro level is GPT-6.
    if (families["6"]) families["6"] = families["6"].filter(effort => effort === "max");
    return { observedAt: candidate.observedAt, families };
  }
  if (!candidate.names || typeof candidate.names !== "object" || Array.isArray(candidate.names)) {
    throw new Error("Invalid ChatGPT model names");
  }
  const names: NonNullable<ChatGptWebModelCapabilities["names"]> = {};
  for (const [family, name] of Object.entries(candidate.names)) {
    if (!Object.hasOwn(families, family) || !isChatGptWebModelName(name)) throw new Error("Invalid ChatGPT model names");
    names[family] = name;
  }
  return { observedAt: candidate.observedAt, families, names };
}

/**
 * The picker row that runs a model version: the one row naming that version, else the one
 * unversioned (Latest) row when the version is newer than every named row. Discovery and turn
 * selection share this rule, so an observed family is always selected through the same row.
 */
export function chatGptModelRowForVersion(
  labels: readonly string[],
  version: ChatGptWebModelFamily,
): { index: number; latest: boolean } | undefined {
  const named = labels.map(label => chatGptModelOptionVersion(label)?.version);
  const explicit = named.flatMap((candidate, index) => candidate === version ? [index] : []);
  if (explicit.length === 1) return { index: explicit[0]!, latest: false };
  if (explicit.length > 1) return undefined;
  const unversioned = named.flatMap((candidate, index) => candidate === undefined ? [index] : []);
  if (unversioned.length !== 1) return undefined;
  const newest = named.every(candidate => candidate === undefined || compareChatGptWebModelVersions(version, candidate) < 0);
  return newest ? { index: unversioned[0]!, latest: true } : undefined;
}

/** The version a picker row names, if any. */
export function chatGptModelOptionVersion(label: string): { version: ChatGptWebModelFamily; name?: string } | undefined {
  // ChatGPT may write the hyphen as a non-breaking or other Unicode hyphen ("GPT‑5.6").
  const match = /^\s*GPT[-\u2010-\u2013\s]?(\d{1,2}(?:\.\d{1,2})?)(?![\d.])(?:\s+([A-Z][A-Za-z]{1,19}))?(\s+Pro)?\s*$/i.exec(label)
    ?? /^\s*GPT[-\u2010-\u2013\s]?(\d{1,2}(?:\.\d{1,2})?)(?![\d.])/i.exec(label);
  if (!match) return undefined;
  const name = match[2];
  return { version: match[1]!, ...(isChatGptWebModelName(name) ? { name } : {}) };
}

export interface ChatGptWebAccountCapabilities {
  modelCapabilities?: ChatGptWebModelCapabilities;
  solAvailable: boolean;
  extraHighAvailable?: boolean;
  proAvailable: boolean;
  experimentalBiggerContext?: boolean;
  browserInteractionMode?: "automatic" | "manual";
  zeroRiskProEnabled?: boolean;
}

/** Legacy Pro capability proves the Extra High position; an explicit probe result wins. */
export function chatGptExtraHighAvailable(capabilities: {
  extraHighAvailable?: boolean;
  proAvailable: boolean;
}): boolean {
  return capabilities.extraHighAvailable ?? capabilities.proAvailable;
}

export const CHATGPT_WEB_ZERO_RISK_MODEL_ROUTE: ChatGptWebZeroRiskModelRoute = {
  slug: "chatgpt-web/zero-risk",
  displayName: "ChatGPT Web — Manual mode",
  description: "Manual mode keeps model selection and prompt submission under your control while preserving the native Codex harness.",
  interactionMode: "manual",
  backendModel: CHATGPT_WEB_ZERO_RISK_BACKEND_MODEL,
  codexEffort: "low",
  adapterEffort: "low",
  requiresPro: false,
};

export const CHATGPT_WEB_ZERO_RISK_PRO_MODEL_ROUTE: ChatGptWebZeroRiskModelRoute = {
  slug: "chatgpt-web/zero-risk-pro",
  displayName: "ChatGPT Web — Manual mode Pro",
  description: "Explicit Pro-sized Manual mode context; select ChatGPT Pro manually for every turn.",
  interactionMode: "manual",
  backendModel: CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL,
  codexEffort: "low",
  adapterEffort: "low",
  requiresPro: true,
};

export const CHATGPT_WEB_LUNA_MODEL_ROUTE: ChatGptWebAutomaticModelRoute = {
  slug: "chatgpt-web/luna",
  displayName: "ChatGPT Web — Luna",
  description: "ChatGPT Web Luna for accounts without the Sol model selector.",
  interactionMode: "automatic",
  backendModel: CHATGPT_WEB_LUNA_BACKEND_MODEL,
  codexEffort: "low",
  adapterEffort: "low",
  requiresPro: false,
};

export const CHATGPT_WEB_LUNA_THINK_MODEL_ROUTE: ChatGptWebModelRoute = {
  slug: "chatgpt-web/think",
  displayName: "ChatGPT Web — Think",
  description: "ChatGPT Web Think for Luna-only accounts.",
  interactionMode: "automatic",
  backendModel: CHATGPT_WEB_LUNA_BACKEND_MODEL,
  codexEffort: "low",
  // The backend model remains Luna. This internal adapter effort distinguishes the explicit
  // Think route after Codex has selected its separate catalog row.
  adapterEffort: "medium",
  requiresPro: false,
};

export const CHATGPT_WEB_LUNA_MODEL_ROUTES: readonly ChatGptWebModelRoute[] = [
  CHATGPT_WEB_LUNA_MODEL_ROUTE,
  CHATGPT_WEB_LUNA_THINK_MODEL_ROUTE,
];

/**
 * The selected Codex model is the authoritative ChatGPT browser mode. Codex's signed desktop UI
 * always renders an Effort row, so every routed model advertises exactly one immutable protocol
 * effort. Pro uses Codex's `ultra` protocol value but binds explicitly to ChatGPT Pro (`max`) at
 * the adapter boundary.
 */
export const CHATGPT_WEB_MODEL_ROUTES: readonly ChatGptWebAutomaticModelRoute[] = [
  {
    slug: "chatgpt-web/light",
    displayName: "ChatGPT Web — Instant",
    description: "ChatGPT Web Instant through the native Codex harness.",
    interactionMode: "automatic",
    backendModel: CHATGPT_WEB_BACKEND_MODEL,
    codexEffort: "low",
    adapterEffort: "low",
    requiresPro: false,
  },
  {
    slug: "chatgpt-web/medium",
    displayName: "ChatGPT Web — Medium",
    description: "ChatGPT Web Medium through the native Codex harness.",
    interactionMode: "automatic",
    backendModel: CHATGPT_WEB_BACKEND_MODEL,
    codexEffort: "medium",
    adapterEffort: "medium",
    requiresPro: false,
  },
  {
    slug: "chatgpt-web/high",
    displayName: "ChatGPT Web — High",
    description: "ChatGPT Web High through the native Codex harness.",
    interactionMode: "automatic",
    backendModel: CHATGPT_WEB_BACKEND_MODEL,
    codexEffort: "high",
    adapterEffort: "high",
    requiresPro: false,
  },
  {
    slug: "chatgpt-web/extra-high",
    displayName: "ChatGPT Web — Extra High",
    description: "Account-gated ChatGPT Web Extra High through the native Codex harness.",
    interactionMode: "automatic",
    backendModel: CHATGPT_WEB_BACKEND_MODEL,
    codexEffort: "xhigh",
    adapterEffort: "xhigh",
    requiresPro: false,
    requiresExtraHigh: true,
  },
  {
    slug: "chatgpt-web/pro",
    displayName: "ChatGPT Web — Pro",
    description: "Account-gated ChatGPT Pro through the native Codex harness.",
    interactionMode: "automatic",
    backendModel: CHATGPT_WEB_BACKEND_MODEL,
    codexEffort: "ultra",
    adapterEffort: "max",
    requiresPro: true,
  },
];

/**
 * Advertise explicit model identities while keeping saved fixed-mode tasks resolvable. They mirror
 * ChatGPT's five thinking levels: GPT-5.6 Sol runs Instant, Medium, High and Extra High, and the
 * Pro level runs GPT-5.6 Sol Pro or, where the plan includes it, GPT-6 Pro (powered by GPT-6 Astra).
 */
export const CHATGPT_WEB_NAMED_MODEL_ROUTES: readonly ChatGptWebAutomaticModelRoute[] = [
  {
    slug: "chatgpt-web/gpt-5.6-sol-instant",
    displayName: "GPT-5.6 Sol Instant (Web)",
    description: "GPT-5.6 Sol at ChatGPT's Instant level, with its own context and compaction budget.",
    interactionMode: "automatic", backendModel: CHATGPT_WEB_BACKEND_MODEL, modelFamily: "5.6",
    codexEffort: "low", adapterEffort: "low", supportedCodexEfforts: ["low"], requiresPro: false,
  },
  {
    slug: "chatgpt-web/gpt-5.6-sol",
    displayName: "GPT-5.6 Sol (Web)",
    description: "GPT-5.6 Sol at ChatGPT's Medium, High, or account-supported Extra High thinking level.",
    interactionMode: "automatic", backendModel: CHATGPT_WEB_BACKEND_MODEL, modelFamily: "5.6",
    codexEffort: "high", adapterEffort: "high", supportedCodexEfforts: ["medium", "high", "xhigh"], requiresPro: false,
  },
  {
    slug: "chatgpt-web/gpt-5.6-pro",
    displayName: "GPT-5.6 Sol Pro (Web)",
    description: "GPT-5.6 Sol Pro at ChatGPT's Pro thinking level.",
    interactionMode: "automatic", backendModel: CHATGPT_WEB_BACKEND_MODEL, modelFamily: "5.6",
    codexEffort: "max", adapterEffort: "max", supportedCodexEfforts: ["max"], requiresPro: true,
  },
  {
    slug: "chatgpt-web/gpt-6-pro",
    displayName: "GPT-6 Pro (Web)",
    description: "GPT-6 Pro, powered by GPT-6 Astra, at ChatGPT's Pro thinking level.",
    interactionMode: "automatic", backendModel: CHATGPT_WEB_BACKEND_MODEL, modelFamily: "6",
    codexEffort: "max", adapterEffort: "max", supportedCodexEfforts: ["max"], requiresPro: true,
  },
  {
    slug: "chatgpt-web/gpt-5.6-luna",
    displayName: "GPT-5.6 Luna (Web)",
    description: "ChatGPT Luna for accounts without the Sol selector. Light selects ordinary mode; Medium enables Think.",
    interactionMode: "automatic", backendModel: CHATGPT_WEB_LUNA_BACKEND_MODEL,
    codexEffort: "low", adapterEffort: "low", supportedCodexEfforts: ["low", "medium"], requiresPro: false,
  },
];

/**
 * 6.1.1 advertised "GPT-6 Astra" rows below Pro. ChatGPT runs GPT-5.6 Sol at every level below
 * Pro, including with Latest selected, so those rows only ever reached Sol. Saved tasks keep
 * resolving them as GPT-5.6 Sol; they are never advertised again.
 */
export const CHATGPT_WEB_RETIRED_MODEL_ROUTES: readonly ChatGptWebAutomaticModelRoute[] = [
  {
    slug: "chatgpt-web/gpt-6-astra-instant",
    displayName: "GPT-5.6 Sol Instant (Web)",
    description: "Saved-task alias of GPT-5.6 Sol Instant.",
    interactionMode: "automatic", backendModel: CHATGPT_WEB_BACKEND_MODEL, modelFamily: "5.6",
    codexEffort: "low", adapterEffort: "low", supportedCodexEfforts: ["low"], requiresPro: false,
  },
  {
    slug: "chatgpt-web/gpt-6-astra",
    displayName: "GPT-5.6 Sol (Web)",
    description: "Saved-task alias of GPT-5.6 Sol.",
    interactionMode: "automatic", backendModel: CHATGPT_WEB_BACKEND_MODEL, modelFamily: "5.6",
    codexEffort: "high", adapterEffort: "high", supportedCodexEfforts: ["medium", "high", "xhigh"], requiresPro: false,
  },
];

/** Identities that only saved tasks use: resolvable, and present in Codex catalogs as hidden rows. */
export const CHATGPT_WEB_SAVED_TASK_MODEL_ROUTES: readonly ChatGptWebModelRoute[] = [
  ...CHATGPT_WEB_MODEL_ROUTES,
  ...CHATGPT_WEB_LUNA_MODEL_ROUTES,
  ...CHATGPT_WEB_RETIRED_MODEL_ROUTES,
];

const routesBySlug = new Map(
  [
    CHATGPT_WEB_ZERO_RISK_MODEL_ROUTE,
    CHATGPT_WEB_ZERO_RISK_PRO_MODEL_ROUTE,
    ...CHATGPT_WEB_LUNA_MODEL_ROUTES,
    ...CHATGPT_WEB_MODEL_ROUTES,
    ...CHATGPT_WEB_NAMED_MODEL_ROUTES,
    ...CHATGPT_WEB_RETIRED_MODEL_ROUTES,
  ]
    .map(route => [route.slug, route]),
);

export function isChatGptWebModelSlug(modelId: string): boolean {
  return modelId.startsWith(CHATGPT_WEB_MODEL_PREFIX);
}

/**
 * ChatGPT's five thinking levels become at most three Codex rows per model version, because
 * Codex keeps one context window per row: Instant, the thinking levels, and Pro.
 */
const DISCOVERED_ROUTE_GROUPS = [
  { kind: "pro", efforts: ["max"], preferred: "max", slugSuffix: "-pro", nameSuffix: " Pro", requiresPro: true },
  { kind: "thinking", efforts: ["medium", "high", "xhigh"], preferred: "high", slugSuffix: "", nameSuffix: "", requiresPro: false },
  { kind: "instant", efforts: ["low"], preferred: "low", slugSuffix: "-instant", nameSuffix: " Instant", requiresPro: false },
] as const;

const EFFORT_LEVEL_NAMES: Record<ChatGptWebAdapterEffort, string> = {
  low: "Instant", medium: "Medium", high: "High", xhigh: "Extra High", max: "Pro",
};

/** `chatgpt-web/gpt-<version>[-<name>][-instant]` or `chatgpt-web/gpt-<version>-pro`. */
const DISCOVERED_ROUTE_SLUG = /^chatgpt-web\/gpt-(\d{1,2}(?:\.\d{1,2})?)(?:-(?!(?:instant|pro)(?:-|$))([a-z][a-z0-9]{1,19}))?(-instant|-pro)?$/;

function discoveredRouteSlug(version: string, name: string | undefined, group: typeof DISCOVERED_ROUTE_GROUPS[number]): string {
  // Pro rows are named by version alone, matching the existing GPT-5.6 Pro and GPT-6 Pro identities.
  const namePart = name && group.kind !== "pro" ? `-${name.toLowerCase()}` : "";
  return `${CHATGPT_WEB_MODEL_PREFIX}gpt-${version}${namePart}${group.slugSuffix}`;
}

function levelList(efforts: readonly ChatGptWebAdapterEffort[]): string {
  const names = efforts.map(effort => EFFORT_LEVEL_NAMES[effort]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0]!;
}

/**
 * Codex rows for the models this account's ChatGPT picker offers, generated from the latest
 * observation so new, renamed and retired ChatGPT models need no NEKODEX release.
 */
export function discoveredChatGptWebModelRoutes(
  capabilities: Pick<ChatGptWebAccountCapabilities, "modelCapabilities">,
): ChatGptWebAutomaticModelRoute[] {
  const observed = capabilities.modelCapabilities;
  // Observations without model names predate discovery; their fixed identities stay in effect.
  if (!observed?.names) return [];
  const versions = Object.keys(observed.families).filter(isChatGptWebModelVersion)
    .toSorted(compareChatGptWebModelVersions);
  const routes: ChatGptWebAutomaticModelRoute[] = [];
  for (const version of versions) {
    const available = observed.families[version] ?? [];
    const name = observed.names[version];
    const model = `GPT-${version}${name ? ` ${name}` : ""}`;
    for (const group of DISCOVERED_ROUTE_GROUPS) {
      const efforts = group.efforts.filter(effort => available.includes(effort));
      if (efforts.length === 0) continue;
      const codexEffort = efforts.includes(group.preferred as never) ? group.preferred : efforts[0]!;
      routes.push({
        slug: discoveredRouteSlug(version, name, group),
        displayName: `${model}${group.nameSuffix} (Web)`,
        description: group.kind === "thinking"
          ? `${model} at ChatGPT's ${levelList(efforts)} thinking level, as this account's model picker offers it.`
          : `${model} at ChatGPT's ${EFFORT_LEVEL_NAMES[efforts[0]!]} level, as this account's model picker offers it.`,
        interactionMode: "automatic",
        backendModel: CHATGPT_WEB_BACKEND_MODEL,
        modelFamily: version,
        codexEffort,
        adapterEffort: codexEffort,
        supportedCodexEfforts: efforts,
        requiresPro: group.requiresPro,
      });
    }
  }
  return routes;
}

/** Newest version first, then Pro, the thinking levels and Instant; Luna rows last. */
export function compareChatGptWebModelRoutes(left: ChatGptWebModelRoute, right: ChatGptWebModelRoute): number {
  const rank = (route: ChatGptWebModelRoute) => route.backendModel === CHATGPT_WEB_LUNA_BACKEND_MODEL ? 1 : 0;
  if (rank(left) !== rank(right)) return rank(left) - rank(right);
  const leftVersion = left.interactionMode === "automatic" ? left.modelFamily : undefined;
  const rightVersion = right.interactionMode === "automatic" ? right.modelFamily : undefined;
  if (leftVersion && rightVersion && leftVersion !== rightVersion) return compareChatGptWebModelVersions(leftVersion, rightVersion);
  if (Boolean(leftVersion) !== Boolean(rightVersion)) return leftVersion ? -1 : 1;
  const group = (route: ChatGptWebModelRoute) => {
    const efforts = route.supportedCodexEfforts ?? [route.codexEffort];
    return efforts.some(effort => effort === "max" || effort === "ultra") ? 0 : efforts.includes("low") ? 2 : 1;
  };
  return group(left) - group(right);
}

/** Whether a slug has the shape of a discovered model, including one this account no longer offers. */
export function isDiscoveredChatGptWebModelSlug(modelId: string): boolean {
  return DISCOVERED_ROUTE_SLUG.test(modelId);
}

/** The model version a discovered or named slug selects, without consulting any observation. */
export function chatGptWebModelSlugVersion(modelId: string): ChatGptWebModelFamily | undefined {
  const known = routesBySlug.get(modelId);
  if (known) return known.interactionMode === "automatic" ? known.modelFamily : undefined;
  return DISCOVERED_ROUTE_SLUG.exec(modelId)?.[1];
}

export function availableChatGptWebModelRoutes(
  capabilities: ChatGptWebAccountCapabilities,
): readonly ChatGptWebModelRoute[] {
  if (capabilities.browserInteractionMode === "manual") {
    if (capabilities.experimentalBiggerContext) {
      throw new Error("Manual mode does not support Bigger Context");
    }
    return capabilities.zeroRiskProEnabled
      ? [CHATGPT_WEB_ZERO_RISK_MODEL_ROUTE, CHATGPT_WEB_ZERO_RISK_PRO_MODEL_ROUTE]
      : [CHATGPT_WEB_ZERO_RISK_MODEL_ROUTE];
  }
  // Keep fixed-mode slugs resolvable for saved tasks, but advertise only named Web models.
  if (!capabilities.solAvailable) return CHATGPT_WEB_NAMED_MODEL_ROUTES.filter(
    route => route.backendModel === CHATGPT_WEB_LUNA_BACKEND_MODEL,
  );
  // A picker observation that read model names is authoritative, including when it offers nothing.
  if (capabilities.modelCapabilities?.names) return discoveredChatGptWebModelRoutes(capabilities);
  return CHATGPT_WEB_NAMED_MODEL_ROUTES.filter(route => (
    route.backendModel !== CHATGPT_WEB_LUNA_BACKEND_MODEL
    && (!route.requiresModelObservation || capabilities.modelCapabilities)
    && (route.modelFamily && capabilities.modelCapabilities
      ? chatGptWebRouteEfforts(route, capabilities).length > 0
      : (!route.requiresPro || capabilities.proAvailable)
        && (!route.requiresExtraHigh || chatGptExtraHighAvailable(capabilities)))
  ));
}

export function requireChatGptWebModelRoute(
  modelId: string,
  capabilities: ChatGptWebAccountCapabilities,
  reasoning?: string,
): ChatGptWebModelRoute {
  if (capabilities.browserInteractionMode === "manual" && capabilities.experimentalBiggerContext) {
    throw new Error("Manual mode does not support Bigger Context");
  }
  if (capabilities.browserInteractionMode !== "manual" && capabilities.solAvailable) {
    const discovered = discoveredChatGptWebModelRoutes(capabilities).find(route => route.slug === modelId);
    if (discovered) return resolveRouteEffort(discovered, capabilities, reasoning);
  }
  const route = routesBySlug.get(modelId);
  if (!route) {
    if (capabilities.browserInteractionMode !== "manual" && isDiscoveredChatGptWebModelSlug(modelId)) {
      throw new Error(`${modelId} is not currently offered by this account's ChatGPT model picker; run Repair to refresh capabilities`);
    }
    throw new Error(`ChatGPT web model is not enabled: ${modelId}`);
  }
  if (capabilities.browserInteractionMode === "manual") {
    if (route.interactionMode !== "manual") {
      throw new Error(`${route.displayName} is not available while Manual mode is enabled`);
    }
    if (route === CHATGPT_WEB_ZERO_RISK_PRO_MODEL_ROUTE && !capabilities.zeroRiskProEnabled) {
      throw new Error(`${route.displayName} is not enabled in Manual model settings`);
    }
    return route;
  }
  if (route.interactionMode === "manual") {
    throw new Error(`${route.displayName} is only available while Manual mode is enabled`);
  }
  if (route.backendModel === CHATGPT_WEB_LUNA_BACKEND_MODEL) {
    if (capabilities.solAvailable) {
      throw new Error(`${route.displayName} is only available for Luna-only accounts`);
    }
    return resolveRouteEffort(route, capabilities, reasoning);
  }
  if (!capabilities.solAvailable) {
    throw new Error(`${route.displayName} is not available for this Luna-only account`);
  }
  if (route.requiresModelObservation && !capabilities.modelCapabilities) {
    throw new Error(`${route.displayName} needs a verified model observation; run Repair to refresh capabilities`);
  }
  if (route.modelFamily && capabilities.modelCapabilities
    && chatGptWebRouteEfforts(route, capabilities).length === 0) {
    throw new Error(`${route.displayName} is currently unavailable in this account's model picker; run Repair to refresh capabilities`);
  }
  if (!(route.modelFamily && capabilities.modelCapabilities) && route.requiresPro && !capabilities.proAvailable) {
    throw new Error(`${route.displayName} is not available for this account`);
  }
  if (!(route.modelFamily && capabilities.modelCapabilities) && route.requiresExtraHigh && !chatGptExtraHighAvailable(capabilities)) {
    throw new Error(`${route.displayName} is not available for this account`);
  }
  return resolveRouteEffort(route, capabilities, reasoning);
}

export function chatGptWebRouteEfforts(
  route: ChatGptWebModelRoute,
  capabilities: ChatGptWebAccountCapabilities,
): readonly ChatGptWebCodexEffort[] {
  const observed = route.interactionMode === "automatic" && route.modelFamily && capabilities.modelCapabilities
    ? capabilities.modelCapabilities.families[route.modelFamily] ?? [] : undefined;
  return (route.supportedCodexEfforts ?? [route.codexEffort])
    .filter(effort => observed
      ? observed.includes(effort === "ultra" ? "max" : effort as ChatGptWebAdapterEffort)
      : effort !== "xhigh" || chatGptExtraHighAvailable(capabilities));
}

function resolveRouteEffort(
  route: ChatGptWebModelRoute,
  capabilities: ChatGptWebAccountCapabilities,
  reasoning?: string,
): ChatGptWebModelRoute {
  if (route.interactionMode !== "automatic" || !route.supportedCodexEfforts) return route;
  const available = chatGptWebRouteEfforts(route, capabilities);
  const effort = reasoning ?? (available.includes(route.codexEffort) ? route.codexEffort : available[0]);
  if (!chatGptWebRouteEfforts(route, capabilities).includes(effort as ChatGptWebCodexEffort)) {
    throw new Error(`${route.displayName} does not support effort ${JSON.stringify(effort)} for this account`);
  }
  if (effort === route.codexEffort) return route;
  return { ...route, codexEffort: effort as ChatGptWebCodexEffort, adapterEffort: effort as ChatGptWebAdapterEffort };
}
