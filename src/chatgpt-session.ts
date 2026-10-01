import type { Locator, Page } from "playwright-core";
import { stabilizeEffortSlider } from "./adapters/chatgpt-web/effort-stabilization";
import {
  chatGptModelOptionVersion,
  chatGptModelRowForVersion,
  compareChatGptWebModelVersions,
  isChatGptWebModelName,
  type ChatGptWebAccountCapabilities,
  type ChatGptWebModelFamily,
  type ChatGptWebModelCapabilities,
  type ChatGptWebAdapterEffort,
} from "./chatgpt-web-models";

export const CHATGPT_TEMPORARY_CHAT_URL = "https://chatgpt.com/?temporary-chat=true";
export const CHATGPT_SAVED_CHAT_URL = "https://chatgpt.com/";

export function chatGptNewChatUrl(useSavedChats = false): string {
  return useSavedChats ? CHATGPT_SAVED_CHAT_URL : CHATGPT_TEMPORARY_CHAT_URL;
}
export const CHATGPT_COMPOSER_SELECTOR = [
  '[data-testid="prompt-textarea"]',
  "#prompt-textarea",
  '[contenteditable="true"][data-lexical-editor="true"]',
  // ProseMirror may omit the legacy id/Lexical marker. Scope its fallback to
  // the message form rather than matching unrelated editable controls.
  'form:has([data-testid="send-button"]) .ProseMirror[contenteditable="true"]',
  'form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"][role="textbox"]',
].join(", ");
export const CHATGPT_EFFORT_CONTROL_SELECTOR = [
  'button[aria-haspopup="menu"][data-tone="neutral"]',
  'button[data-testid="model-switcher-dropdown-button"][aria-haspopup="menu"]',
  'button[data-codex-intelligence-trigger="true"][data-composer-navigation-target="reasoning"][aria-haspopup="menu"]',
].join(", ");
export const CHATGPT_EFFORT_MENU_SELECTOR = [
  '[data-testid="composer-intelligence-picker-content"]:has([role="menuitemradio"], [data-model-reasoning-effort-slider])',
  '[role="menu"]:has([role="menuitemradio"], [data-model-reasoning-effort-slider])',
  '[role="group"]:has([role="menuitemradio"], [data-model-reasoning-effort-slider])',
  '[role="menu"]:has([data-model-picker-power-slider])',
].join(", ");
export const CHATGPT_EFFORT_ITEM_SELECTOR = '[role="menuitemradio"]';
export const CHATGPT_EFFORT_SLIDER_CONTAINER_SELECTOR = '[data-model-reasoning-effort-slider], [data-model-picker-power-slider]';
export const CHATGPT_EFFORT_SLIDER_MAX_OPTIONS = 5;
const CHATGPT_MODAL_GATE_SELECTOR = '[role="dialog"], [role="alertdialog"]';
const CHATGPT_EXTRA_HIGH_OFFSET = 3;
const CHATGPT_EXTRA_HIGH_GATE_SETTLE_MS = 500;
/** Resolve only inside the verified composer's form; multiple submitters are an error. */
export const CHATGPT_SEND_BUTTON_SELECTOR = '[data-testid="send-button"], button[type="submit"]';
export const CHATGPT_STOP_BUTTON_SELECTOR = '[data-testid="stop-button"], form[data-chatgpt-composer] button[type="button"][aria-label="Stop"], form[data-chatgpt-composer] button[type="button"][aria-label="Arrêter"]';
// The new footer is shared with user messages. Response extraction additionally requires
// this control to FOLLOW the last assistant answer, excluding the user's earlier footer.
export const CHATGPT_COMPLETION_ACTION_SELECTOR = 'button[data-testid="copy-turn-action-button"], [data-turn-key] .turn-action-controls button';
export const CHATGPT_ASSISTANT_TURN_SELECTOR = [
  '[data-testid^="conversation-turn-"][data-turn="assistant"]:not([data-turn-key] *)',
  '[data-testid^="conversation-turn-"][data-message-author-role="assistant"]:not([data-turn-key] *)',
  '[data-testid^="conversation-turn-"]:has([data-message-author-role="assistant"]):not([data-turn-key] *)',
  '[data-turn-key]:has([data-conversation-role="assistant"], [data-chatgpt-agent-turn-start])',
].join(", ");
export const CHATGPT_USER_TURN_SELECTOR = [
  '[data-testid^="conversation-turn-"][data-turn="user"]:not([data-turn-key] *)',
  '[data-testid^="conversation-turn-"][data-message-author-role="user"]:not([data-turn-key] *)',
  '[data-testid^="conversation-turn-"]:has([data-message-author-role="user"]):not([data-turn-key] *)',
  '[data-turn-key]:has([data-user-message-bubble])',
].join(", ");

/** The new renderer groups both roles under the user's stable turn key. */
export function chatGptAssistantTurnSelector(identity: string): string {
  const prefix = "group:assistant:";
  return identity.startsWith(prefix)
    ? `[data-turn-key=${JSON.stringify(identity.slice(prefix.length))}]:has([data-conversation-role="assistant"], [data-chatgpt-agent-turn-start])`
    : `[data-turn-id=${JSON.stringify(identity)}]`;
}

export interface ChatGptEffortSliderState {
  min: number;
  max: number;
  value: number;
}

export interface ChatGptEffortActivation {
  method: "already-open" | "click" | "pointerdown";
  menu: Locator;
  sliderContainer: Locator;
  slider: Locator;
  /** Set by model selection: the checked row is the unversioned Latest row. */
  latestModelRow?: boolean;
}

export function chatGptEffortSlider(page: Page): { sliderContainer: Locator; slider: Locator } {
  const sliderContainer = page.locator(CHATGPT_EFFORT_SLIDER_CONTAINER_SELECTOR).filter({ visible: true });
  // The current picker keeps ARIA values on a zero-width, aria-hidden semantic input.
  // Its visible container proves the active surface; the input proves the effort range.
  return { sliderContainer, slider: sliderContainer.locator('[role="slider"]') };
}

function effortMenuSelectorForId(menuId: string): string {
  return `[id=${JSON.stringify(menuId)}]`;
}

export async function chatGptEffortMenuForControl(page: Page, control: Locator): Promise<Locator> {
  const menuId = await control.getAttribute("aria-controls").catch(() => null);
  if (menuId) return page.locator(effortMenuSelectorForId(menuId));
  const controlId = await control.getAttribute("id").catch(() => null);
  if (controlId) return page.locator(`[role="menu"][aria-labelledby~=${JSON.stringify(controlId)}]`).filter({ visible: true });
  return page.locator(CHATGPT_EFFORT_MENU_SELECTOR).filter({ visible: true });
}

async function visibleEffortSurface(
  page: Page,
  control: Locator,
): Promise<Omit<ChatGptEffortActivation, "method"> | undefined> {
  // The exit animation keeps a closed menu's slider visible after Escape. Read the
  // owner state first: selecting that outgoing range races its removal from the DOM.
  const expanded = await control.getAttribute("aria-expanded").catch(() => null);
  const state = await control.getAttribute("data-state").catch(() => null);
  if (expanded === "false" || state === "closed") return undefined;
  const menu = await chatGptEffortMenuForControl(page, control);
  const surface = chatGptEffortSlider(page);
  if (await menu.isVisible().catch(() => false) || await surface.sliderContainer.isVisible().catch(() => false)) {
    return { menu, ...surface };
  }
  return undefined;
}

async function waitForEffortSurface(
  page: Page,
  control: Locator,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Omit<ChatGptEffortActivation, "method"> | undefined> {
  const deadline = Date.now() + timeoutMs;
  do {
    signal?.throwIfAborted();
    const surface = await visibleEffortSurface(page, control);
    if (surface) return surface;
    if (Date.now() >= deadline) return undefined;
    await waitForChatGptProbeSettle(50, signal);
  } while (true);
}

async function clearGhostEffortState(page: Page, control: Locator): Promise<void> {
  const expanded = await control.getAttribute("aria-expanded").catch(() => null);
  const state = await control.getAttribute("data-state").catch(() => null);
  if (expanded === "true" || state === "open") {
    await page.keyboard.press("Escape").catch(() => {});
  }
}

export async function activateChatGptEffortMenu(
  page: Page,
  control: Locator,
  options: { settleMs?: number; abortSignal?: AbortSignal } = {},
): Promise<ChatGptEffortActivation> {
  options.abortSignal?.throwIfAborted();
  const openSurface = await visibleEffortSurface(page, control);
  if (openSurface) return { method: "already-open", ...openSurface };

  const settleMs = options.settleMs ?? 3_000;
  await clearGhostEffortState(page, control);
  let clicked = false;
  try {
    await control.click({
      force: true,
      timeout: Math.max(1, settleMs),
      ...(options.abortSignal ? { signal: options.abortSignal } : {}),
    });
    clicked = true;
  } catch (error) {
    // Hidden Electron surfaces can reject physical clicks during a viewport transition.
    // Only that specific failure uses the existing primary-pointer activation below.
    if (!(error instanceof Error) || !/outside of the viewport/i.test(error.message)) throw error;
  }
  const clickedSurface = clicked
    ? await waitForEffortSurface(page, control, settleMs, options.abortSignal)
    : undefined;
  if (clickedSurface) return { method: "click", ...clickedSurface };

  await clearGhostEffortState(page, control);
  await control.dispatchEvent("pointerdown", {
    button: 0,
    buttons: 1,
    pointerType: "mouse",
    isPrimary: true,
  }, options.abortSignal ? { signal: options.abortSignal } : undefined);
  const pointerSurface = await waitForEffortSurface(page, control, settleMs, options.abortSignal);
  if (pointerSurface) return { method: "pointerdown", ...pointerSurface };
  throw new Error(
    "ChatGPT effort control did not expose its owned menu or structural slider after click and primary pointerdown",
  );
}

async function waitForChatGptProbeSettle(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (!signal) {
    await new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds));
    return;
  }
  const ownedSignal = signal;
  await new Promise<void>((resolveSleep, rejectSleep) => {
    const timer = setTimeout(done, milliseconds);
    function done(): void {
      ownedSignal.removeEventListener("abort", aborted);
      resolveSleep();
    }
    function aborted(): void {
      clearTimeout(timer);
      ownedSignal.removeEventListener("abort", aborted);
      rejectSleep(ownedSignal.reason ?? new DOMException("ChatGPT capability probe aborted", "AbortError"));
    }
    ownedSignal.addEventListener("abort", aborted, { once: true });
    if (ownedSignal.aborted) aborted();
  });
}

async function hasVisibleChatGptModalGate(page: Page): Promise<boolean> {
  return await page.locator(CHATGPT_MODAL_GATE_SELECTOR).filter({ visible: true }).last()
    .isVisible();
}

async function waitForChatGptModalGate(
  page: Page,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    signal?.throwIfAborted();
    if (await hasVisibleChatGptModalGate(page)) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await waitForChatGptProbeSettle(Math.min(50, remaining), signal);
  } while (true);
}

async function waitForNoChatGptModalGate(
  page: Page,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  do {
    signal?.throwIfAborted();
    if (!await hasVisibleChatGptModalGate(page)) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error("ChatGPT Extra High capability probe could not dismiss its newly opened modal gate");
    }
    await waitForChatGptProbeSettle(Math.min(50, remaining), signal);
  } while (true);
}

async function readChatGptEffortSliderState(
  slider: Locator,
  signal?: AbortSignal,
): Promise<ChatGptEffortSliderState | undefined> {
  const options = signal ? { timeout: 1_000, signal } : { timeout: 1_000 };
  return parseChatGptEffortSliderState(
    await slider.getAttribute("aria-valuemin", options),
    await slider.getAttribute("aria-valuemax", options),
    await slider.getAttribute("aria-valuenow", options),
  );
}

async function closeOwnedChatGptEffortMenu(
  page: Page,
  control: Locator,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!await visibleEffortSurface(page, control)) return;
  if (await hasVisibleChatGptModalGate(page)) {
    throw new Error("ChatGPT capability probe found a modal while closing its effort menu");
  }
  signal?.throwIfAborted();
  await page.keyboard.press("Escape");
  const deadline = Date.now() + timeoutMs;
  while (await visibleEffortSurface(page, control)) {
    signal?.throwIfAborted();
    if (await hasVisibleChatGptModalGate(page)) {
      throw new Error("ChatGPT capability probe found a modal while closing its effort menu");
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("ChatGPT capability probe could not restore the closed effort-menu state");
    await waitForChatGptProbeSettle(Math.min(50, remaining), signal);
  }
}

async function restoreChatGptEffortMenuState(
  page: Page,
  control: Locator,
  originallyOpen: boolean,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const current = await visibleEffortSurface(page, control);
  if (originallyOpen) {
    if (!current) await activateChatGptEffortMenu(page, control, { settleMs: timeoutMs, abortSignal: signal });
    return;
  }
  if (current) await closeOwnedChatGptEffortMenu(page, control, timeoutMs, signal);
}

class ChatGptExtraHighGateDetected extends Error {
  constructor() {
    super("ChatGPT opened a modal gate after Extra High was selected");
    this.name = "ChatGptExtraHighGateDetected";
  }
}

async function setChatGptEffortValue(
  page: Page,
  slider: Locator,
  target: number,
  signal: AbortSignal,
  detectModalGate: boolean,
): Promise<void> {
  const sliderControl = slider.locator("xpath=ancestor::*[@role='menuitem'][1]");
  await stabilizeEffortSlider({
    target,
    signal,
    read: async options => {
      if (detectModalGate && await hasVisibleChatGptModalGate(page)) throw new ChatGptExtraHighGateDetected();
      return await readChatGptEffortSliderState(slider, options.signal);
    },
    press: (key, options) => sliderControl.press(key, options),
  });
}

async function dismissOwnedChatGptModalGate(
  page: Page,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!await hasVisibleChatGptModalGate(page)) return;
  signal?.throwIfAborted();
  // The transaction refuses to start with any visible dialog, so Escape here can
  // only address the modal that appeared after this probe changed the slider.
  await page.keyboard.press("Escape");
  await waitForNoChatGptModalGate(page, timeoutMs, signal);
}

async function probeChatGptExtraHighCapability(
  page: Page,
  control: Locator,
  activation: ChatGptEffortActivation,
  originalState: ChatGptEffortSliderState,
  originallyOpen: boolean,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<boolean> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(new Error("ChatGPT Extra High capability probe timed out")),
    timeoutMs,
  );
  const signal = abortSignal
    ? AbortSignal.any([abortSignal, timeoutController.signal])
    : timeoutController.signal;
  let selectionMayHaveChanged = false;
  let gateDetected = false;
  let capability: boolean | undefined;
  let primaryError: unknown;
  try {
    const target = originalState.min + CHATGPT_EXTRA_HIGH_OFFSET;
    let active = activation;
    if (originalState.value === target) {
      selectionMayHaveChanged = true;
      await setChatGptEffortValue(page, active.slider, Math.max(originalState.min, target - 1), signal, false);
      if (await hasVisibleChatGptModalGate(page)) {
        throw new Error("ChatGPT capability probe became ambiguous before Extra High was selected");
      }
    }
    selectionMayHaveChanged = true;
    try {
      await setChatGptEffortValue(page, active.slider, target, signal, true);
      gateDetected = await waitForChatGptModalGate(page, CHATGPT_EXTRA_HIGH_GATE_SETTLE_MS, signal);
    } catch (error) {
      if (error instanceof ChatGptExtraHighGateDetected || await hasVisibleChatGptModalGate(page)) {
        gateDetected = true;
      } else {
        throw error;
      }
    }
    if (gateDetected) {
      capability = false;
    } else {
      await closeOwnedChatGptEffortMenu(page, control, timeoutMs, signal);
      active = await activateChatGptEffortMenu(page, control, { settleMs: timeoutMs, abortSignal: signal });
      const persisted = await readChatGptEffortSliderState(active.slider, signal);
      if (!persisted
        || persisted.min !== originalState.min
        || persisted.max !== originalState.max
        || persisted.value !== target) {
        throw new Error("ChatGPT Extra High capability is unknown because the selected value did not persist");
      }
      capability = true;
    }
  } catch (error) {
    primaryError = error;
  } finally {
    clearTimeout(timeout);
  }

  let cleanupError: unknown;
  const cleanupController = new AbortController();
  const cleanupTimeout = setTimeout(
    () => cleanupController.abort(new Error("ChatGPT Extra High capability cleanup timed out")),
    Math.max(1_000, timeoutMs),
  );
  try {
    const cleanupSignal = cleanupController.signal;
    if (gateDetected) await dismissOwnedChatGptModalGate(page, timeoutMs, cleanupSignal);
    if (selectionMayHaveChanged) {
      const restoreActivation = await activateChatGptEffortMenu(page, control, {
        settleMs: timeoutMs,
        abortSignal: cleanupSignal,
      });
      const restoreRange = await readChatGptEffortSliderState(restoreActivation.slider, cleanupSignal);
      if (!restoreRange || restoreRange.min !== originalState.min || restoreRange.max !== originalState.max) {
        throw new Error("ChatGPT capability probe could not recover the original effort range");
      }
      await setChatGptEffortValue(page, restoreActivation.slider, originalState.value, cleanupSignal, false);
      if (await hasVisibleChatGptModalGate(page)) {
        const restoredOwnedGate = gateDetected
          && originalState.value === originalState.min + CHATGPT_EXTRA_HIGH_OFFSET;
        if (!restoredOwnedGate) {
          throw new Error("ChatGPT capability cleanup found an unrelated or ambiguous modal while restoring effort");
        }
        // Re-selecting an originally active gated Extra High value can reproduce
        // the same transaction-owned modal; only that exact case may dismiss it.
        await dismissOwnedChatGptModalGate(page, timeoutMs, cleanupSignal);
      }
      await closeOwnedChatGptEffortMenu(page, control, timeoutMs, cleanupSignal);
      const confirmation = await activateChatGptEffortMenu(page, control, {
        settleMs: timeoutMs,
        abortSignal: cleanupSignal,
      });
      const restored = await readChatGptEffortSliderState(confirmation.slider, cleanupSignal);
      if (!restored
        || restored.min !== originalState.min
        || restored.max !== originalState.max
        || restored.value !== originalState.value) {
        throw new Error("ChatGPT capability probe could not verify the restored effort value");
      }
    }
    await restoreChatGptEffortMenuState(page, control, originallyOpen, timeoutMs, cleanupSignal);
  } catch (error) {
    cleanupError = error;
  } finally {
    clearTimeout(cleanupTimeout);
  }
  if (primaryError && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      "ChatGPT Extra High capability probe failed and could not restore its original state",
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  if (capability === undefined) {
    throw new Error("ChatGPT Extra High capability probe completed without a verified result");
  }
  return capability;
}

function safeIntegerAttribute(value: string | null): number | undefined {
  if (value === null || !/^-?\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function parseChatGptEffortSliderState(
  rawMin: string | null,
  rawMax: string | null,
  rawValue: string | null,
): ChatGptEffortSliderState | undefined {
  const min = safeIntegerAttribute(rawMin);
  const max = safeIntegerAttribute(rawMax);
  const value = safeIntegerAttribute(rawValue);
  if (min === undefined || max === undefined || value === undefined) return undefined;
  const optionCount = max - min + 1;
  if (optionCount < 1 || optionCount > CHATGPT_EFFORT_SLIDER_MAX_OPTIONS) return undefined;
  if (value < min || value > max) return undefined;
  return { min, max, value };
}

/** Read the range and lock ticks from one rendered revision while the picker hydrates. */
export async function readChatGptEffortSnapshot(
  sliderContainer: Locator,
  timeoutMs = 1_000,
): Promise<ChatGptEffortSliderState & { available?: boolean[] }> {
  const deadline = Date.now() + timeoutMs;
  do {
    const snapshot = await sliderContainer.evaluate(container => {
      const sliders = container.querySelectorAll('[role="slider"]');
      const slider = sliders.length === 1 ? sliders[0] : undefined;
      const power = container.hasAttribute("data-model-picker-power-slider")
        && Boolean(container.querySelector('[data-orientation="horizontal"][aria-disabled="false"]'));
      return {
        powerPicker: container.hasAttribute("data-model-picker-power-slider"),
        min: slider?.getAttribute("aria-valuemin") ?? null,
        max: slider?.getAttribute("aria-valuemax") ?? null,
        value: slider?.getAttribute("aria-valuenow") ?? null,
        locks: Array.from(container.querySelectorAll(power ? "[data-selected]" : "[data-locked][data-selected]"), tick =>
          tick.getAttribute("data-locked") ?? (power ? "false" : null)),
      };
    });
    const state = parseChatGptEffortSliderState(snapshot.min, snapshot.max, snapshot.value);
    if (!state) throw new Error("ChatGPT effort slider exposed an invalid ARIA range");
    if (snapshot.locks.length === 0 && !snapshot.powerPicker) return state;
    if (snapshot.locks.length === state.max - state.min + 1
      && snapshot.locks.every(lock => lock === "true" || lock === "false")) {
      return { ...state, available: snapshot.locks.map(lock => lock === "false") };
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (true);
  throw new Error("ChatGPT effort availability could not be verified from its slider ticks");
}

const CHATGPT_EFFORT_WORDS = "Instantané|Instant|Medium|Moyen|Extra High|Très élevé|High|Élevée?|Elevée?|即时|中|极高|高|Pro";
// A model name ("Sol") may sit between the version and the effort, but an effort word never is one.
const CHATGPT_DESCRIBED_MODEL_NAME = "(?!(?:Instant|Medium|Moyen|Extra|High|Pro|Très)\\b)[A-Z][A-Za-z]{1,19}";
const CHATGPT_VERSIONED_STATE = new RegExp(
  `^(?:GPT[-\\u2010-\\u2013\\s]?)?(\\d{1,2}(?:\\.\\d{1,2})?)(?:\\s+(${CHATGPT_DESCRIBED_MODEL_NAME}))?\\s+(${CHATGPT_EFFORT_WORDS})(?=\\s*(?:[,，]|$))`, "i",
);
const CHATGPT_EFFORT_WORD_VALUES: Record<ChatGptWebAdapterEffort, readonly string[]> = {
  low: ["instant", "instantané", "即时"], medium: ["medium", "moyen", "中"],
  high: ["high", "élevé", "élevée", "elevé", "elevée", "高"], xhigh: ["extra high", "très élevé", "极高"], max: ["pro"],
};

export interface ChatGptDescribedModelState {
  version: ChatGptWebModelFamily;
  name?: string;
  effort?: ChatGptWebAdapterEffort;
}

/** The model version (and name) one slider description states, as in "5.6 Sol High, 3 of 5.". */
export function parseChatGptDescribedModelState(description: string): ChatGptDescribedModelState | undefined {
  const match = CHATGPT_VERSIONED_STATE.exec(description.replace(/\s+/g, " ").trim());
  if (!match) return undefined;
  const word = match[3]!.toLowerCase();
  const effort = (Object.keys(CHATGPT_EFFORT_WORD_VALUES) as ChatGptWebAdapterEffort[])
    .find(candidate => CHATGPT_EFFORT_WORD_VALUES[candidate].includes(word));
  const name = match[2] && isChatGptWebModelName(match[2]) ? match[2] : undefined;
  return { version: match[1]!, ...(name ? { name } : {}), ...(effort ? { effort } : {}) };
}

/**
 * Verify version and effort in one owned accessibility description, without reading a page.
 * With `anyVersion`, the described state must name some version at the expected effort: a Latest
 * row can run an older model at lower levels, which multipart stages of a pinned turn use.
 */
export function chatGptModelStateMatches(
  descriptions: readonly string[],
  version: ChatGptWebModelFamily,
  requirePro: boolean,
  expectedEffort?: "low" | "medium" | "high" | "xhigh" | "max",
  anyVersion = false,
): boolean {
  // Parse all owned state descriptions before checking the requested family. Selecting just
  // one matching description would conceal a contradictory live model/effort description.
  const states = descriptions.flatMap(description => {
    const state = parseChatGptDescribedModelState(description);
    return state ? [state] : [];
  });
  return states.length > 0 && states.every(state => {
    if (!anyVersion && state.version !== version) return false;
    return expectedEffort ? state.effort === expectedEffort : !requirePro || state.effort === "max";
  });
}

/** Only valid alongside a checked family radio and the exact verified slider position. */
export function chatGptUnversionedEffortMatches(descriptions: readonly string[], effort: ChatGptWebAdapterEffort): boolean {
  if (descriptions.some(text => /^(?:GPT[-\s]?)?\d+(?:\.\d+)?\s/i.test(text.trim()))) return false;
  const labels: Record<ChatGptWebAdapterEffort, RegExp> = {
    low: /^(?:Instant|Instantané)$/i, medium: /^(?:Medium|Moyen)$/i,
    high: /^(?:High|Élevée?|Elevée?)$/i, xhigh: /^(?:Extra High|Très élevé)$/i, max: /^Pro$/i,
  };
  const states = descriptions.map(text => /^(.*?),\s*([1-5])\s+(?:of|sur)\s+([1-5])\.$/i.exec(text.trim())).filter(Boolean);
  const index = ["low", "medium", "high", "xhigh", "max"].indexOf(effort) + 1;
  return states.length === 1 && labels[effort].test(states[0]![1]!)
    && Number(states[0]![2]) === index && Number(states[0]![3]) >= index;
}

async function waitForChatGptModelPickerView(
  view: Locator, expected: "simple" | "advanced", timeoutMs: number, signal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    signal?.throwIfAborted();
    if (await view.getAttribute("data-model-picker-view", { timeout: 500 }).catch(() => null) === expected) return true;
    await waitForChatGptProbeSettle(50, signal);
  } while (Date.now() < deadline);
  return false;
}

// Background surfaces are drawn offscreen and produce no animation frames, so Playwright's
// stability check never completes there. Menu targets are verified before each forced click.
async function expandChatGptModelPicker(activation: ChatGptEffortActivation, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const powerView = activation.menu.locator("[data-model-picker-view]");
  const count = await powerView.count();
  if (count > 1) throw new Error("ChatGPT model picker is ambiguous");
  if (count === 1) {
    const view = await powerView.getAttribute("data-model-picker-view");
    if (view === "advanced") return;
    if (view !== "simple") throw new Error("ChatGPT model picker view is unknown");
    const toggle = powerView.locator('[data-model-picker-view-toggle="true"][aria-hidden="false"]');
    if (await toggle.count() !== 1) throw new Error("ChatGPT model picker toggle is ambiguous");
    await toggle.click({ force: true, timeout: 5_000, signal });
    // A forced click can land during the menu's entry transition without effect. The model rows
    // render only in the advanced view, so require that view instead of assuming the click worked.
    if (await waitForChatGptModelPickerView(powerView, "advanced", 1_500, signal)) return;
    await toggle.dispatchEvent("click", undefined, { timeout: 2_000, ...(signal ? { signal } : {}) });
    if (await waitForChatGptModelPickerView(powerView, "advanced", 1_500, signal)) return;
    throw new Error("ChatGPT model picker did not open its model list");
  }
  const trigger = activation.menu.getByLabel(/^(?:Select model|Choose model|Sélectionner le modèle|Choisir le modèle|选择模型|モデルを選択)$/);
  if (await trigger.count() === 1 && await trigger.getAttribute("aria-expanded") === "false") {
    await trigger.click({ force: true, timeout: 5_000, signal });
  }
}

/**
 * ChatGPT can re-render the picker while a freshly loaded page finishes its model bootstrap, which
 * detaches the open menu under the click. Reopen the menu and retry instead of failing the check.
 */
async function expandChatGptModelPickerWithReopen(
  page: Page, control: Locator, activation: ChatGptEffortActivation, signal?: AbortSignal,
): Promise<ChatGptEffortActivation> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await expandChatGptModelPicker(activation, signal);
      return activation;
    } catch (error) {
      signal?.throwIfAborted();
      if (attempt >= 2) throw error;
      await closeOwnedChatGptEffortMenu(page, control, 5_000, signal).catch(() => {});
      await waitForChatGptProbeSettle(750, signal);
      activation = await activateChatGptEffortMenu(page, control, { abortSignal: signal });
    }
  }
}

interface ChatGptModelRowSnapshot {
  label: string;
  checked: boolean;
  disabled: boolean;
}

function chatGptModelRows(menu: Locator): Locator {
  return menu.getByRole("menuitemradio", { includeHidden: true });
}

/** Model rows render lazily; an empty result means the list is not attached yet. */
async function readChatGptModelRows(menu: Locator): Promise<ChatGptModelRowSnapshot[]> {
  return chatGptModelRows(menu).evaluateAll(rows => rows.map(row => ({
    label: (row.getAttribute("aria-label") ?? row.textContent ?? "").replace(/\s+/g, " ").trim(),
    checked: row.getAttribute("aria-checked") === "true",
    disabled: row.getAttribute("aria-disabled") === "true",
  })));
}

type ChatGptModelRowTarget =
  | { kind: "version"; version: ChatGptWebModelFamily }
  | { kind: "label"; label: string };

function describeChatGptModelRowTarget(target: ChatGptModelRowTarget): string {
  return target.kind === "version" ? `model family ${target.version}` : `model row ${JSON.stringify(target.label)}`;
}

/** The row for a target among attached rows, or undefined while the list is not attached. */
async function resolveChatGptModelRow(
  menu: Locator,
  target: ChatGptModelRowTarget,
): Promise<{ option: Locator; row: ChatGptModelRowSnapshot; latest: boolean } | undefined> {
  const rows = await readChatGptModelRows(menu);
  if (rows.length === 0) return undefined;
  const labels = rows.map(row => row.label);
  let choice: { index: number; latest: boolean } | undefined;
  if (target.kind === "version") {
    choice = chatGptModelRowForVersion(labels, target.version);
  } else {
    const matches = labels.flatMap((label, index) => label === target.label ? [index] : []);
    if (matches.length === 1) choice = { index: matches[0]!, latest: !chatGptModelOptionVersion(target.label) };
  }
  if (!choice) throw new Error(`ChatGPT ${describeChatGptModelRowTarget(target)} is unavailable or ambiguous in the model picker`);
  return { option: chatGptModelRows(menu).nth(choice.index), row: rows[choice.index]!, latest: choice.latest };
}

async function waitForChatGptModelRows(menu: Locator, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  return chatGptModelRows(menu).first().waitFor({ state: "attached", timeout: timeoutMs, ...(signal ? { signal } : {}) })
    .then(() => true, error => {
      signal?.throwIfAborted();
      if (error instanceof Error && error.name === "TimeoutError") return false;
      throw error;
    });
}

async function assertSelectedChatGptModelRow(
  page: Page, control: Locator, activation: ChatGptEffortActivation,
  target: ChatGptModelRowTarget, signal?: AbortSignal,
): Promise<ChatGptEffortActivation> {
  signal?.throwIfAborted();
  const current = await resolveChatGptModelRow(activation.menu, target).catch(() => undefined);
  const pickerView = activation.menu.locator("[data-model-picker-view]");
  const modelListOpen = await pickerView.count() === 1
    && await pickerView.getAttribute("data-model-picker-view") === "advanced";
  // The advanced view can retain a geometrically visible but inert slider.
  // Its selected radio proves the family, not a keyboard-ready effort control.
  if (current?.row.checked && !modelListOpen && await activation.sliderContainer.isVisible().catch(() => false)) {
    return { ...activation, latestModelRow: current.latest };
  }
  activation = await expandChatGptModelPickerWithReopen(page, control, activation, signal);
  await waitForChatGptModelRows(activation.menu, 3_000, signal);
  const selected = await resolveChatGptModelRow(activation.menu, target);
  if (!selected?.row.checked) {
    throw new Error(`ChatGPT did not retain ${describeChatGptModelRowTarget(target)}`);
  }
  // The model list keeps the power slider mounted under an inert ancestor.
  // Clicking the verified selected row returns to the editable effort view.
  await selected.option.click({ force: true, timeout: 5_000, signal });
  activation = await activateChatGptEffortMenu(page, control, { abortSignal: signal });
  const returnedView = activation.menu.locator("[data-model-picker-view]");
  if ((await returnedView.count() !== 1
    || await returnedView.getAttribute("data-model-picker-view") !== "advanced")
    && await activation.sliderContainer.isVisible().catch(() => false)) {
    return { ...activation, latestModelRow: selected.latest };
  }
  await closeOwnedChatGptEffortMenu(page, control, 5_000, signal);
  // Lazy rows require the advanced view, which has no reliable way back. Let its
  // outgoing surface detach/hide before reopening; owner state can close first.
  await activation.menu.waitFor({ state: "hidden", timeout: 5_000, ...(signal ? { signal } : {}) });
  signal?.throwIfAborted();
  return { ...await activateChatGptEffortMenu(page, control, { abortSignal: signal }), latestModelRow: selected.latest };
}

async function selectChatGptModelRow(
  page: Page, control: Locator, activation: ChatGptEffortActivation,
  target: ChatGptModelRowTarget, signal?: AbortSignal,
): Promise<ChatGptEffortActivation> {
  signal?.throwIfAborted();
  const current = await resolveChatGptModelRow(activation.menu, target).catch(() => undefined);
  if (current?.row.checked) {
    return assertSelectedChatGptModelRow(page, control, activation, target, signal);
  }
  activation = await expandChatGptModelPickerWithReopen(page, control, activation, signal);
  await waitForChatGptModelRows(activation.menu, 3_000, signal);
  const selected = await resolveChatGptModelRow(activation.menu, target);
  if (!selected || selected.row.disabled) {
    throw new Error(`ChatGPT ${describeChatGptModelRowTarget(target)} is unavailable`);
  }
  await selected.option.click({ force: true, timeout: 5_000, signal });
  // Family selection returns to the owned effort surface. Escape/reopen here
  // lets delayed exit cleanup remove the slider we are about to use.
  activation = await activateChatGptEffortMenu(page, control, { abortSignal: signal });
  return assertSelectedChatGptModelRow(page, control, activation, target, signal);
}

/** Inspect lazy model rows, then return to the effort view without selecting a model. */
export async function assertSelectedChatGptModelFamily(
  page: Page, control: Locator, activation: ChatGptEffortActivation,
  version: ChatGptWebModelFamily, signal?: AbortSignal,
): Promise<ChatGptEffortActivation> {
  return assertSelectedChatGptModelRow(page, control, activation, { kind: "version", version }, signal);
}

/** Family selection is shared by capability discovery and actual turn preparation. */
export async function selectChatGptModelFamily(
  page: Page, control: Locator, activation: ChatGptEffortActivation,
  version: ChatGptWebModelFamily, signal?: AbortSignal,
): Promise<ChatGptEffortActivation> {
  return selectChatGptModelRow(page, control, activation, { kind: "version", version }, signal);
}

/** The live descriptions ChatGPT attaches to the effort control ("5.6 Sol High, 3 of 5."). */
export async function readChatGptEffortDescriptions(page: Page, slider: Locator, timeoutMs = 1_000): Promise<string[]> {
  // The numeric slider is aria-hidden. Its keyboard menuitem owns the live spoken
  // version/effort through aria-describedby, not aria-valuetext on the slider.
  const keyboardControl = slider.locator("xpath=ancestor::*[@role='menuitem'][1]");
  const ids = (await keyboardControl.getAttribute("aria-describedby", { timeout: timeoutMs }))?.trim().split(/\s+/).filter(Boolean) ?? [];
  return page.evaluate(
    references => references.map(id => document.getElementById(id)?.textContent?.trim() ?? "").filter(Boolean),
    ids,
  );
}

/** The 1-based position a description announces ("3 of 5", "3 sur 5", "第 3 项"), if any. */
function describedChatGptEffortPosition(descriptions: readonly string[]): number | undefined {
  for (const text of descriptions) {
    const match = /(\d)\s*(?:of|sur)\s*\d/i.exec(text) ?? /第\s*(\d)\s*项/.exec(text);
    if (match) return Number(match[1]);
  }
  return undefined;
}

/** What one slider position runs; null when ChatGPT describes only the effort, not the model. */
async function readDescribedChatGptModelState(
  page: Page, slider: Locator, index: number, effort: ChatGptWebAdapterEffort, signal?: AbortSignal,
): Promise<ChatGptDescribedModelState | null> {
  const started = Date.now();
  for (;;) {
    signal?.throwIfAborted();
    const descriptions = await readChatGptEffortDescriptions(page, slider);
    const states = descriptions.flatMap(text => {
      const state = parseChatGptDescribedModelState(text);
      return state ? [state] : [];
    });
    const position = describedChatGptEffortPosition(descriptions);
    const settled = position === index + 1 || (position === undefined && states.some(state => state.effort === effort));
    if (settled) {
      if (states.length === 0) return null;
      const versions = new Set(states.map(state => state.version));
      if (versions.size !== 1) throw new Error("ChatGPT described contradictory model versions for one effort");
      return states.find(state => state.name) ?? states[0]!;
    }
    // A description with neither a position nor a model cannot show when it settles; after a
    // short render window it is simply unversioned, which leaves the row label to decide.
    if (position === undefined && states.length === 0 && Date.now() - started >= 250) return null;
    if (Date.now() - started >= 1_500) throw new Error("ChatGPT effort description did not settle on the inspected position");
    await waitForChatGptProbeSettle(50, signal);
  }
}

export interface ChatGptModelRowObservation {
  label: string;
  /** The model each unlocked position runs; null when its description names no version. */
  positions: Partial<Record<ChatGptWebAdapterEffort, ChatGptDescribedModelState | null>>;
}

const CHATGPT_EFFORT_ORDER: readonly ChatGptWebAdapterEffort[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * Turn per-row observations into model families. A position counts for a version only on the row
 * that turn selection would use for that version, so the Latest row's lower levels (which ChatGPT
 * describes as GPT-5.6 Sol) never become a separate GPT-6 model.
 */
export function aggregateChatGptModelObservation(
  rows: readonly ChatGptModelRowObservation[],
  observedAt = Date.now(),
): ChatGptWebModelCapabilities {
  const labels = rows.map(row => row.label);
  const attributed = rows.map(row => {
    const named = chatGptModelOptionVersion(row.label);
    const positions = new Map<ChatGptWebAdapterEffort, { version?: string; name?: string }>();
    for (const effort of CHATGPT_EFFORT_ORDER) {
      if (!Object.hasOwn(row.positions, effort)) continue;
      const described = row.positions[effort];
      if (described) {
        positions.set(effort, { version: described.version,
          name: described.name ?? (named?.version === described.version ? named.name : undefined) });
      } else {
        positions.set(effort, named ? { version: named.version, name: named.name } : {});
      }
    }
    return positions;
  });
  // When a Latest row's Pro level names no version, the earlier compatibility rule applies: it is
  // GPT-6 Pro. ChatGPT runs GPT-5.6 Sol at its lower levels.
  rows.forEach((row, index) => {
    const positions = attributed[index]!;
    if (chatGptModelOptionVersion(row.label) || !positions.has("max") || positions.get("max")!.version) return;
    if (!labels.some(label => chatGptModelOptionVersion(label)?.version === "6")) positions.set("max", { version: "6" });
  });
  const versions = new Set<string>();
  for (const positions of attributed) for (const position of positions.values()) if (position.version) versions.add(position.version);
  for (const label of labels) {
    const named = chatGptModelOptionVersion(label);
    if (named) versions.add(named.version);
  }
  const families: ChatGptWebModelCapabilities["families"] = {};
  const names: NonNullable<ChatGptWebModelCapabilities["names"]> = {};
  for (const version of [...versions].toSorted(compareChatGptWebModelVersions)) {
    const choice = chatGptModelRowForVersion(labels, version);
    if (!choice) continue;
    const positions = attributed[choice.index]!;
    const efforts = CHATGPT_EFFORT_ORDER.filter(effort => positions.get(effort)?.version === version);
    // A named row with nothing selectable stays listed as an empty family, which reports the model
    // as currently unavailable rather than unknown.
    if (efforts.length === 0 && choice.latest) continue;
    families[version] = efforts;
    const name = efforts.map(effort => positions.get(effort)?.name).find(Boolean)
      ?? (choice.latest ? undefined : chatGptModelOptionVersion(labels[choice.index]!)?.name);
    if (name) names[version] = name;
  }
  return { observedAt, families, names };
}

async function detectChatGptModelCapabilities(
  page: Page, control: Locator, activation: ChatGptEffortActivation,
  signal?: AbortSignal,
): Promise<ChatGptWebModelCapabilities | undefined> {
  const originalState = await readChatGptEffortSnapshot(activation.sliderContainer);
  const initialView = activation.menu.locator("[data-model-picker-view]");
  const originalView = await initialView.count() === 1 ? await initialView.getAttribute("data-model-picker-view") : null;
  let original: string | undefined;
  let primaryError: unknown;
  let capabilities: ChatGptWebModelCapabilities | undefined;
  const probe = new AbortController();
  const probeSignal = signal ? AbortSignal.any([signal, probe.signal]) : probe.signal;
  try {
    activation = await expandChatGptModelPickerWithReopen(page, control, activation, signal);
    const powerPicker = await activation.menu.locator("[data-model-picker-view]").count() > 0;
    // The power picker always lists model rows. A list that does not attach in time is an
    // incomplete inspection, not evidence that the account offers no models.
    if (!await waitForChatGptModelRows(activation.menu, 3_000, signal) && powerPicker) {
      throw new Error("ChatGPT model picker rows did not appear");
    }
    const rows = await readChatGptModelRows(activation.menu);
    if (rows.length) {
      const checked = rows.filter(row => row.checked);
      if (checked.length !== 1) throw new Error("ChatGPT selected model row could not be verified");
      if (new Set(rows.map(row => row.label)).size !== rows.length || rows.some(row => !row.label)) {
        throw new Error("ChatGPT model picker rows are ambiguous");
      }
      original = checked[0]!.label;
      const observed: ChatGptModelRowObservation[] = [];
      let legacy = false;
      for (const row of rows) {
        signal?.throwIfAborted();
        if (row.disabled) { observed.push({ label: row.label, positions: {} }); continue; }
        activation = await activateChatGptEffortMenu(page, control, { abortSignal: signal });
        activation = await selectChatGptModelRow(page, control, activation, { kind: "label", label: row.label }, signal);
        const state = await readChatGptEffortSnapshot(activation.sliderContainer);
        if (!state.available) {
          // Legacy selectors have no per-position lock evidence. Preserve their existing
          // account probe; do not manufacture a family-specific entitlement from its range.
          legacy = true;
          break;
        }
        const positions: ChatGptModelRowObservation["positions"] = {};
        for (const [index, effort] of CHATGPT_EFFORT_ORDER.entries()) {
          if (state.available[index] !== true) continue;
          // Only unlocked positions are visited, so no upgrade dialog is expected; one fails closed.
          await setChatGptEffortValue(page, activation.slider, state.min + index, probeSignal, true);
          positions[effort] = await readDescribedChatGptModelState(page, activation.slider, index, effort, signal);
        }
        // Leave each visited row at the level it had, in case ChatGPT remembers it per model.
        await setChatGptEffortValue(page, activation.slider, state.value, probeSignal, true);
        observed.push({ label: row.label, positions });
      }
      if (!legacy) capabilities = aggregateChatGptModelObservation(observed);
    }
  } catch (error) { primaryError = error; }
  // Cleanup has its own bound so cancellation cannot leave a changed model/effort behind.
  const cleanup = new AbortController();
  const timer = setTimeout(() => cleanup.abort(new Error("ChatGPT model capability restoration timed out")), 15_000);
  try {
    await dismissOwnedChatGptModalGate(page, 5_000, cleanup.signal);
    activation = await activateChatGptEffortMenu(page, control, { abortSignal: cleanup.signal });
    if (original) {
      activation = await selectChatGptModelRow(page, control, activation, { kind: "label", label: original }, cleanup.signal);
      const state = await readChatGptEffortSnapshot(activation.sliderContainer);
      if (state.min !== originalState.min) throw new Error("ChatGPT original effort range changed during inspection");
      if (state.value !== originalState.value) {
        await setChatGptEffortValue(page, activation.slider, originalState.value, cleanup.signal, true);
      }
    }
    if (originalView === "simple") {
      const view = activation.menu.locator("[data-model-picker-view]");
      if (await view.getAttribute("data-model-picker-view").catch(() => null) === "advanced") {
        // The advanced view has no reliable way back, and ChatGPT reopens the picker in its
        // simple view. Closing restores the original presentation without another click.
        await closeOwnedChatGptEffortMenu(page, control, 5_000, cleanup.signal);
      }
    }
  } catch (error) {
    const causes = (primaryError ? [primaryError, error] : [error])
      .map(cause => (cause instanceof Error ? cause.message : String(cause)).split("\n")[0]).join("; ");
    throw new AggregateError(primaryError ? [primaryError, error] : [error],
      `ChatGPT model capability inspection could not restore the original picker: ${causes}`.slice(0, 600));
  } finally { clearTimeout(timer); probe.abort(); }
  if (primaryError) throw primaryError;
  return capabilities;
}

async function anyVisible(locator: Locator): Promise<boolean> {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) return true;
  }
  return false;
}

export async function assertAuthenticatedChatGptPage(page: Page): Promise<void> {
  const composer = page.locator(
    CHATGPT_COMPOSER_SELECTOR,
  );
  if (!await anyVisible(composer)) {
    throw new Error("ChatGPT authentication could not be verified: no visible composer is present");
  }
}

export async function assertTemporaryChatPage(page: Page): Promise<void> {
  await assertNewChatPage(page);
}

export async function assertNewChatPage(page: Page, useSavedChats = false): Promise<void> {
  const url = new URL(page.url());
  const expected = new URL(chatGptNewChatUrl(useSavedChats));
  if (url.origin !== expected.origin || url.pathname !== expected.pathname
    || (url.searchParams.get("temporary-chat") === "true") === useSavedChats) {
    throw new Error(`ChatGPT left the requested new ${useSavedChats ? "saved" : "Temporary"} Chat surface (${page.url()})`);
  }
}

export async function detectChatGptAccountCapabilities(
  page: Page,
  options: { selectorTimeoutMs?: number; stableAbsenceMs?: number; abortSignal?: AbortSignal } = {},
): Promise<ChatGptWebAccountCapabilities> {
  const composers = page.locator(CHATGPT_COMPOSER_SELECTOR).filter({ visible: true });
  const composer = composers;
  const composerForm = composer.locator("xpath=ancestor::form[1]");
  const effortButton = composerForm.locator(CHATGPT_EFFORT_CONTROL_SELECTOR).filter({ visible: true });
  const deadline = Date.now() + (options.selectorTimeoutMs ?? 30_000);
  const stableAbsenceMs = options.stableAbsenceMs ?? 3_000;
  let absenceSince: number | undefined;
  let presenceObservations = 0;
  while (true) {
    options.abortSignal?.throwIfAborted();
    const effortVisible = await effortButton.isVisible();
    if (effortVisible) {
      presenceObservations += 1;
      absenceSince = undefined;
      if (presenceObservations >= 2) break;
      await waitForChatGptProbeSettle(100, options.abortSignal);
      continue;
    }
    presenceObservations = 0;
    const composerReady = await composers.count().then(count => count === 1).catch(() => false);
    const formReady = await composerForm.count().then(count => count === 1).catch(() => false);
    const documentReady = await page.evaluate(() => document.readyState === "complete").catch(() => false);
    if (composerReady && formReady && documentReady) {
      absenceSince ??= Date.now();
    } else {
      absenceSince = undefined;
    }
    if (Date.now() >= deadline) {
      if (absenceSince !== undefined && Date.now() - absenceSince >= stableAbsenceMs) {
        return { solAvailable: false, extraHighAvailable: false, proAvailable: false };
      }
      throw new Error("ChatGPT account capability probe did not reach a stable composer state");
    }
    await waitForChatGptProbeSettle(100, options.abortSignal);
  }
  if (await hasVisibleChatGptModalGate(page)) {
    throw new Error(
      "ChatGPT Extra High capability is unknown because a dialog was already visible before the probe",
    );
  }
  let activation: ChatGptEffortActivation | undefined;
  let probeRestoredState = false;
  let capabilities: ChatGptWebAccountCapabilities | undefined;
  let primaryError: unknown;
  try {
    // Use the same owned-menu activation as task turns. Enter can leave Radix's
    // expanded state set without mounting the slider after an application update.
    activation = await activateChatGptEffortMenu(page, effortButton, {
      settleMs: options.selectorTimeoutMs ?? 3_000,
      abortSignal: options.abortSignal,
    });
    const { sliderContainer, slider } = activation;
    const originallyOpen = activation.method === "already-open";
    const timeout = options.selectorTimeoutMs ?? 15_000;
    // Model radio rows can hydrate before the effort control. They carry no evidence
    // of the account's reasoning range, so an absent slider must fail, not cache false.
    await sliderContainer.waitFor({
      state: "visible",
      timeout,
      ...(options.abortSignal ? { signal: options.abortSignal } : {}),
    });
    await slider.waitFor({
      state: "attached",
      timeout,
      ...(options.abortSignal ? { signal: options.abortSignal } : {}),
    });
    const state = await readChatGptEffortSnapshot(sliderContainer);
    const positions = state.max - state.min + 1;
    if (![3, 4, 5].includes(positions)) {
      throw new Error("ChatGPT effort slider exposed an unsupported reasoning range; run Repair after updating the launcher");
    }
    const available = state.available;
    if (available) {
      // Upsell positions remain inside the ARIA range. Their lock state is stronger
      // evidence than counting positions or probing a different effort.
      capabilities = { solAvailable: true, extraHighAvailable: available[3] === true,
        proAvailable: available[4] === true };
      const modelCapabilities = await detectChatGptModelCapabilities(page, effortButton, activation, options.abortSignal);
      if (modelCapabilities) {
        const efforts = Object.values(modelCapabilities.families).flat();
        capabilities = { solAvailable: true, extraHighAvailable: efforts.includes("xhigh"),
          proAvailable: efforts.includes("max"), modelCapabilities };
      }
    } else if (positions === 3) {
      capabilities = { solAvailable: true, extraHighAvailable: false, proAvailable: false };
    } else {
      probeRestoredState = true;
      const extraHighAvailable = await probeChatGptExtraHighCapability(
        page,
        effortButton,
        activation,
        state,
        originallyOpen,
        timeout,
        options.abortSignal,
      );
      capabilities = {
        solAvailable: true,
        extraHighAvailable,
        proAvailable: extraHighAvailable && positions === 5,
      };
    }
  } catch (error) {
    primaryError = error;
  }
  let cleanupError: unknown;
  if (activation && !probeRestoredState) {
    const cleanupController = new AbortController();
    const timeout = options.selectorTimeoutMs ?? 15_000;
    const cleanupTimer = setTimeout(
      () => cleanupController.abort(new Error("ChatGPT capability cleanup timed out")),
      timeout,
    );
    try {
      await restoreChatGptEffortMenuState(
        page,
        effortButton,
        activation.method === "already-open",
        timeout,
        cleanupController.signal,
      );
    } catch (error) {
      cleanupError = error;
    } finally {
      clearTimeout(cleanupTimer);
    }
  }
  if (primaryError && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      "ChatGPT capability detection failed and could not restore its original menu state",
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  if (!capabilities) throw new Error("ChatGPT capability detection completed without a verified result");
  return capabilities;
}
