import type { Locator, Page } from "playwright-core";
import { stabilizeEffortSlider } from "./adapters/chatgpt-web/effort-stabilization";
import { chatGptModelOptionName, type ChatGptWebAccountCapabilities, type ChatGptWebProModelVersion, type ChatGptWebModelCapabilities, type ChatGptWebAdapterEffort } from "./chatgpt-web-models";

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

/** Verify version and effort in one owned accessibility description, without reading a page. */
export function chatGptModelStateMatches(
  descriptions: readonly string[],
  version: ChatGptWebProModelVersion,
  requirePro: boolean,
  expectedEffort?: "low" | "medium" | "high" | "xhigh" | "max",
): boolean {
  // Parse all owned state descriptions before checking the requested family. Selecting just
  // one matching description would conceal a contradictory live model/effort description.
  const prefix = /^(?:GPT[-\s]?)?(\d+(?:\.\d+)?)(?:\s+(Sol|Astra))?\s+(Instantané|Instant|Medium|Moyen|Extra High|Très élevé|High|Élevée?|Elevée?|即时|中|极高|高|Pro)(?=\s*(?:[,，]|$))/i;
  const states = descriptions.flatMap(description => {
    const match = prefix.exec(description.replace(/\s+/g, " ").trim());
    return match ? [{ version: match[1]!, family: match[2]?.toLowerCase(), effort: match[3]!.toLowerCase() }] : [];
  });
  const efforts = { low: ["instant", "instantané", "即时"], medium: ["medium", "moyen", "中"], high: ["high", "élevé", "élevée", "elevé", "elevée", "高"], xhigh: ["extra high", "très élevé", "极高"], max: ["pro"] };
  return states.length > 0 && states.every(state => {
    if (state.version !== version) return false;
    if (state.family && state.family !== (version === "5.6" ? "sol" : version === "6" ? "astra" : undefined)) return false;
    return expectedEffort ? efforts[expectedEffort].includes(state.effort) : !requirePro || state.effort === "pro";
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
    return;
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

/** Inspect lazy model rows, then return to the effort view without selecting a model. */
export async function assertSelectedChatGptModelFamily(
  page: Page, control: Locator, activation: ChatGptEffortActivation,
  version: ChatGptWebProModelVersion, signal?: AbortSignal,
): Promise<ChatGptEffortActivation> {
  const option = () => activation.menu.getByRole("menuitemradio", { name: chatGptModelOptionName(version), exact: true, includeHidden: true });
  if (await option().count() === 1 && await option().getAttribute("aria-checked") === "true"
    && await activation.sliderContainer.isVisible().catch(() => false)) return activation;
  activation = await expandChatGptModelPickerWithReopen(page, control, activation, signal);
  await option().waitFor({ state: "attached", timeout: 3_000, signal });
  if (await option().count() !== 1 || await option().getAttribute("aria-checked") !== "true") {
    throw new Error(`ChatGPT did not retain model family ${version}`);
  }
  await closeOwnedChatGptEffortMenu(page, control, 5_000, signal);
  return activateChatGptEffortMenu(page, control, { abortSignal: signal });
}

/** Family selection is shared by capability discovery and actual turn preparation. */
export async function selectChatGptModelFamily(
  page: Page, control: Locator, activation: ChatGptEffortActivation,
  version: ChatGptWebProModelVersion, signal?: AbortSignal,
): Promise<ChatGptEffortActivation> {
  const option = () => activation.menu.getByRole("menuitemradio", {
    name: chatGptModelOptionName(version), exact: true, includeHidden: true,
  });
  signal?.throwIfAborted();
  if (await option().count() === 1 && await option().getAttribute("aria-checked") === "true") {
    if (await activation.sliderContainer.isVisible().catch(() => false)) return activation;
    await closeOwnedChatGptEffortMenu(page, control, 5_000, signal);
    return activateChatGptEffortMenu(page, control, { abortSignal: signal });
  }
  activation = await expandChatGptModelPickerWithReopen(page, control, activation, signal);
  await option().waitFor({ state: "attached", timeout: 3_000, signal });
  if (await option().count() !== 1 || await option().getAttribute("aria-disabled") === "true") {
    throw new Error(`ChatGPT model family ${version} is unavailable`);
  }
  await option().click({ force: true, timeout: 5_000, signal });
  await closeOwnedChatGptEffortMenu(page, control, 5_000, signal);
  activation = await activateChatGptEffortMenu(page, control, { abortSignal: signal });
  return assertSelectedChatGptModelFamily(page, control, activation, version, signal);
}

async function detectChatGptModelCapabilities(
  page: Page, control: Locator, activation: ChatGptEffortActivation,
  signal?: AbortSignal,
): Promise<ChatGptWebModelCapabilities | undefined> {
  const originalState = await readChatGptEffortSnapshot(activation.sliderContainer);
  const initialView = activation.menu.locator("[data-model-picker-view]");
  const originalView = await initialView.count() === 1 ? await initialView.getAttribute("data-model-picker-view") : null;
  let original: ChatGptWebProModelVersion | undefined;
  let primaryError: unknown;
  let capabilities: ChatGptWebModelCapabilities | undefined;
  try {
    activation = await expandChatGptModelPickerWithReopen(page, control, activation, signal);
    const present: ChatGptWebProModelVersion[] = [];
    for (const family of ["5.5", "5.6", "6"] as const) {
      const option = activation.menu.getByRole("menuitemradio", { name: chatGptModelOptionName(family), exact: true, includeHidden: true });
      const count = await option.count();
      if (count > 1) throw new Error("ChatGPT model capability radios are ambiguous");
      if (!count) continue;
      present.push(family);
      if (await option.getAttribute("aria-checked") === "true") {
        if (original) throw new Error("ChatGPT selected more than one model family");
        original = family;
      }
    }
    if (present.length) {
      if (!original) throw new Error("ChatGPT selected model family could not be verified");
      capabilities = { observedAt: Date.now(), families: {} };
      const efforts: ChatGptWebAdapterEffort[] = ["low", "medium", "high", "xhigh", "max"];
      for (const family of present) {
        signal?.throwIfAborted();
        activation = await activateChatGptEffortMenu(page, control, { abortSignal: signal });
        activation = await expandChatGptModelPickerWithReopen(page, control, activation, signal);
        const option = activation.menu.getByRole("menuitemradio", { name: chatGptModelOptionName(family), exact: true, includeHidden: true });
        await option.waitFor({ state: "attached", timeout: 3_000, signal });
        if (await option.getAttribute("aria-disabled") === "true") { capabilities.families[family] = []; continue; }
        activation = await selectChatGptModelFamily(page, control, activation, family, signal);
        const state = await readChatGptEffortSnapshot(activation.sliderContainer);
        if (!state.available) {
          // Legacy selectors have no per-position lock evidence. Preserve their existing
          // account probe; do not manufacture a family-specific entitlement from its range.
          capabilities = undefined;
          break;
        }
        capabilities.families[family] = efforts.filter((_, index) => state.available![index] === true);
      }
    }
  } catch (error) { primaryError = error; }
  // Cleanup has its own bound so cancellation cannot leave a changed model/effort behind.
  const cleanup = new AbortController();
  const timer = setTimeout(() => cleanup.abort(new Error("ChatGPT model capability restoration timed out")), 15_000);
  try {
    activation = await activateChatGptEffortMenu(page, control, { abortSignal: cleanup.signal });
    if (original) {
      activation = await selectChatGptModelFamily(page, control, activation, original, cleanup.signal);
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
  } finally { clearTimeout(timer); }
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
