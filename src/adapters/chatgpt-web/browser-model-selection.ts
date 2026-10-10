import type { Page, Locator } from "playwright-core";
import type { ChatGptWebModelMode } from "./model";
import type { ChatGptWebModelFamily } from "../../chatgpt-web-models";
import { ChatGptWebAdapterError } from "./adapter-error";
import { stabilizeEffortSlider } from "./effort-stabilization";
import { chatGptProUsageLimitTooltip } from "./pro-retry-hint";
import { CHATGPT_COMPOSER_SELECTOR, CHATGPT_EFFORT_CONTROL_SELECTOR, activateChatGptEffortMenu, readChatGptEffortSnapshot, readChatGptEffortDescriptions, chatGptModelStateMatches, chatGptUnversionedEffortMatches, parseChatGptDescribedModelState, selectChatGptModelFamily, assertSelectedChatGptModelFamily } from "../../chatgpt-session";
import { CHATGPT_COMPOSER_DOCUMENT_END_KEY, throwIfPromptAttachmentAborted, withBrowserTurnAbort, browserStageAbortSignal } from "./browser-operation-support";

interface ModelSelectionDependencies {
  activeComposer(page: Page, timeoutMs?: number, signal?: AbortSignal): Promise<Locator>;
  settleChatGptUi(): Promise<void>;
  withChatGptBrowserObservationTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T>;
  chatGptRateLimitDialog(page: Page): Locator;
  chatGptExpiredSessionAlert(page: Page): Locator;
  throwIfChatGptRateLimitDialog(page: Page): Promise<void>;
  throwIfChatGptSessionFailureAlert(page: Page): Promise<void>;
  throwIfChatGptSubmissionDialog(page: Page): Promise<void>;
  throwIfChatGptEffortCapabilityDialog(page: Page, mode: Pick<ChatGptWebModelMode, "displayLabel">, signal?: AbortSignal): Promise<void>;
}

const CHATGPT_MODEL_CONTROL_UNAVAILABLE_MESSAGE = "ChatGPT model controls are unavailable. Reload ChatGPT and retry the task.";

function chatGptModelControlUnavailableError(diagnostic: string): Error {
  return new Error(CHATGPT_MODEL_CONTROL_UNAVAILABLE_MESSAGE, { cause: new Error(diagnostic) });
}

function chatGptModelControlUnavailableAdapterError(diagnostic: string, userVisibleDetail?: string): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    CHATGPT_MODEL_CONTROL_UNAVAILABLE_MESSAGE + (userVisibleDetail ? ` ${userVisibleDetail}` : ""),
    {
      status: 502,
      errorType: "server_error",
      code: "upstream_server_error",
      retryable: false,
      cause: new Error(diagnostic),
    },
  );
}

export function chatGptProUnavailableAdapterError(
  diagnostic: string,
  userVisibleDetail?: string,
): ChatGptWebAdapterError {
  const explicitRetryDate = userVisibleDetail?.startsWith("Try again after ") === true;
  const message = userVisibleDetail
    ? `ChatGPT Pro is currently unavailable. ChatGPT: ${userVisibleDetail} No lower-effort fallback was used.`
    : "ChatGPT Pro is currently unavailable in the model picker. This can happen when its usage limit is reached "
      + "or the account capability changes. Wait for Pro to reappear, then retry or run Repair. "
      + "No lower-effort fallback was used.";
  return new ChatGptWebAdapterError(message, {
    // A linked explicit retry date establishes a temporary allowance limit. A missing Pro row by
    // itself cannot distinguish that from an entitlement/capability change, so keep it a conflict.
    status: explicitRetryDate ? 429 : 409,
    errorType: explicitRetryDate ? "rate_limit_error" : "invalid_request_error",
    code: "chatgpt_pro_unavailable",
    retryable: false,
    cause: new Error(diagnostic),
  });
}

function chatGptPinnedModelError(version: ChatGptWebModelFamily, cause?: unknown): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    `ChatGPT model version ${version} could not be selected and verified. The pending prompt was not sent; check that this version is available in ChatGPT.`,
    { status: 400, errorType: "invalid_request_error", code: "model_version_unavailable", retryable: false, cause },
  );
}

/**
 * A pinned version is proven at the effort it was requested for. Lower multipart stages of the
 * same turn stay on the same checked row; on the unversioned Latest row ChatGPT may run an older
 * model at those levels (GPT-5.6 Sol below GPT-6 Pro), so only the effort is proven there.
 */
function stageMayRunOtherVersion(
  activation: { latestModelRow?: boolean },
  mode: Pick<ChatGptWebModelMode, "effort" | "modelVersionEffort">,
): boolean {
  return activation.latestModelRow === true && mode.modelVersionEffort !== undefined && mode.modelVersionEffort !== mode.effort;
}

async function assertChatGptSelectedModelVersion(
  page: Page,
  slider: Locator,
  version: ChatGptWebModelFamily,
  requirePro = false,
  expectedEffort?: ChatGptWebModelMode["effort"],
  settleMs = 0,
  anyVersion = false,
): Promise<void> {
  const deadline = Date.now() + settleMs;
  for (;;) {
    const descriptions = await readChatGptEffortDescriptions(page, slider);
    // "Latest" is not a version. Its slider must still prove the pinned version at the pinned
    // effort; a future Latest version fails closed. Version and Pro must come from the same
    // described state node: unrelated instructions mentioning Pro are not proof.
    if (chatGptModelStateMatches(descriptions, version, requirePro, expectedEffort, anyVersion)
      || (expectedEffort && chatGptUnversionedEffortMatches(descriptions, expectedEffort))) return;
    if (Date.now() >= deadline) break;
    await new Promise(resolveSettle => setTimeout(resolveSettle, 50));
  }
  throw chatGptPinnedModelError(version);
}

export async function setChatGptThinkMode(
  composerForm: Locator,
  enabled: boolean,
  captureDiagnostic?: (checkpoint: string) => Promise<void>,
  abortSignal?: AbortSignal,
): Promise<void> {
  throwIfPromptAttachmentAborted(abortSignal);
  const controls = composerForm
    .getByRole("button", { name: /^(?:Think|Analyser)$/, exact: true })
    .filter({ visible: true });
  const count = await controls.count();
  if (count === 0 && !enabled) {
    await captureDiagnostic?.("luna-default-confirmed");
    return;
  }
  if (count > 1) throw new Error(`ChatGPT exposed ${count} visible Think controls`);
  const control = controls.first();
  const actionOptions = { signal: abortSignal, timeout: 10_000 };
  let pressed = count === 1 ? await control.getAttribute("aria-pressed", actionOptions) : null;
  if (count === 1 && pressed !== "true" && pressed !== "false") {
    throw new Error("ChatGPT Think control has no semantic pressed state");
  }
  const target = enabled ? "true" : "false";
  if (pressed !== target) {
    const composer = composerForm.locator(CHATGPT_COMPOSER_SELECTOR).filter({ visible: true }).first();
    const composerState = () => composer.evaluate(element => {
      const copy = element.cloneNode(true) as HTMLElement;
      const pills = [...copy.querySelectorAll('[data-id^="plugin:"][data-keyword]')];
      const connectors = pills.map(pill => pill.getAttribute("data-keyword")).sort();
      for (const pill of pills) pill.remove();
      const text = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
        ? element.value : copy.textContent ?? "";
      return { text: text.trim(), connectors };
    }, undefined, actionOptions);
    const before = await composerState();
    if (before.text) throw new Error("ChatGPT Think selection requires an empty prompt draft");
    await composer.focus(actionOptions);
    await composer.press(CHATGPT_COMPOSER_DOCUMENT_END_KEY, actionOptions);
    await composer.pressSequentially("/think", { ...actionOptions, delay: 25 });
    await captureDiagnostic?.("think-slash-triggered");
    // The command popup shares menu-item classes with sidebar history. Count only this popup.
    const popup = composerForm.page().locator('.popover[aria-busy="false"]').filter({ visible: true });
    const rows = popup.locator('.__menu-item[tabindex="0"]').filter({ visible: true });
    await rows.first().waitFor({ state: "visible", timeout: 5_000, signal: abortSignal });
    if (await popup.count() !== 1 || await rows.count() !== 1) {
      throw new Error("ChatGPT Think slash menu must expose exactly one command option");
    }
    const row = rows.first();
    if (await row.getAttribute("data-highlighted", actionOptions) === null) {
      await composer.press("ArrowDown", actionOptions);
    }
    if (await row.getAttribute("data-highlighted", actionOptions) === null) {
      throw new Error("ChatGPT Think slash option is not highlighted");
    }
    await captureDiagnostic?.("think-slash-menu-ready");
    throwIfPromptAttachmentAborted(abortSignal);
    await composer.press("Enter", actionOptions);
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      throwIfPromptAttachmentAborted(abortSignal);
      const currentCount = await controls.count();
      if (currentCount > 1) throw new Error(`ChatGPT exposed ${currentCount} visible Think controls`);
      pressed = currentCount === 1 ? await control.getAttribute("aria-pressed", actionOptions) : null;
      if (pressed === target) break;
      if (currentCount === 1 && pressed !== "true" && pressed !== "false") {
        throw new Error("ChatGPT Think control lost its semantic pressed state");
      }
      await withBrowserTurnAbort(new Promise(resolveSleep => setTimeout(resolveSleep, 100)), abortSignal);
    }
    if (pressed !== target) {
      throw new Error(`ChatGPT did not ${enabled ? "enable" : "disable"} Think mode`);
    }
    const after = await composerState();
    if (after.text || JSON.stringify(after.connectors) !== JSON.stringify(before.connectors)) {
      throw new Error("ChatGPT Think slash selection did not preserve the empty draft and selected connectors");
    }
  }
  await captureDiagnostic?.(enabled ? "think-enabled" : "think-disabled");
}

export class ChatGptModelSelectionController {
  constructor(private readonly dependencies: ModelSelectionDependencies) {}
  private readonly effortSelections = new WeakMap<Page, { label: string; url: string; effort: ChatGptWebModelMode["effort"] }>();
  private readonly observedProVersions = new WeakMap<Page, ChatGptWebModelFamily>();
  private readonly validatedPinnedVersions = new WeakMap<Page, ChatGptWebModelFamily>();

  private async observeSelectedProVersion(page: Page, slider: Locator): Promise<void> {
    this.observedProVersions.delete(page);
    try {
      const descriptions = await this.dependencies.withChatGptBrowserObservationTimeout(readChatGptEffortDescriptions(page, slider), 1_000);
      const versions = new Set(descriptions.flatMap(text => {
        const state = parseChatGptDescribedModelState(text);
        return state?.effort === "max" ? [state.version] : [];
      }));
      if (versions.size === 1 && chatGptModelStateMatches(descriptions, [...versions][0]!, true, "max")) {
        this.observedProVersions.set(page, [...versions][0]!);
      }
    } catch { /* Missing or ambiguous live metadata stays unknown; telemetry cannot fail a turn. */ }
  }

  /**
   * Closing the picker commits its label and restores the composer asynchronously; a fixed settle
   * can read a menu that is still closing. Wait (bounded) on the same control; the caller's
   * assertEffortSurface still verifies the exact selection afterwards.
   */
  private async awaitEffortMenuClosed(page: Page): Promise<void> {
    await this.dependencies.settleChatGptUi();
    const deadline = Date.now() + 3_000;
    for (;;) {
      const composer = await this.dependencies.activeComposer(page, 1_000).catch(() => undefined);
      const controls = composer?.locator("xpath=ancestor::form[1]").locator(CHATGPT_EFFORT_CONTROL_SELECTOR).filter({ visible: true });
      if (composer && controls && await controls.count().catch(() => 0) === 1
        && await controls.first().getAttribute("aria-expanded").catch(() => null) === "false"
        && await composer.isEditable().catch(() => false)) return;
      if (Date.now() >= deadline) return;
      await new Promise(resolveSleep => setTimeout(resolveSleep, 50));
    }
  }

  private async assertEffortSurface(page: Page, effort: ChatGptWebModelMode["effort"]): Promise<void> {
    const selected = this.effortSelections.get(page);
    const composer = await this.dependencies.activeComposer(page);
    const controls = composer.locator("xpath=ancestor::form[1]").locator(CHATGPT_EFFORT_CONTROL_SELECTOR).filter({ visible: true });
    if (!selected || selected.effort !== effort || selected.url !== page.url() || !selected.label
      || await controls.count() !== 1 || (await controls.first().innerText()).trim() !== selected.label
      || await controls.first().getAttribute("aria-expanded") !== "false" || !await composer.isEditable()) {
      throw chatGptModelControlUnavailableAdapterError("ChatGPT did not retain the selected effort on its ready composer; the message was not submitted");
    }
  }

  setThinkMode(composerForm: Locator, enabled: boolean, diagnostic?: (checkpoint: string) => Promise<void>, signal?: AbortSignal): Promise<void> {
    return setChatGptThinkMode(composerForm, enabled, diagnostic, signal);
  }

  async select(
    page: Page,
    mode: ChatGptWebModelMode,
    captureDiagnostic?: (checkpoint: string) => Promise<void>,
    stageModelVersion?: ChatGptWebModelFamily,
    abortSignal?: AbortSignal,
  ): Promise<ChatGptWebModelMode> {
    throwIfPromptAttachmentAborted(abortSignal);
    const composer = await this.dependencies.activeComposer(page, 30_000, abortSignal);
    const composerForm = composer.locator("xpath=ancestor::form[1]");
    const uiEffortIndex = mode.uiEffortIndex;
    if (uiEffortIndex === null) {
      await this.dependencies.settleChatGptUi();
      await this.dependencies.throwIfChatGptRateLimitDialog(page);
      const visibleControls = composerForm.locator(CHATGPT_EFFORT_CONTROL_SELECTOR).filter({ visible: true });
      if (await visibleControls.count() > 0) {
        throw chatGptModelControlUnavailableError(
          "ChatGPT Luna was selected from a Luna-only capability probe, but the account now exposes a model selector; rerun setup",
        );
      }
      // Enable Think during prompt attachment, after fresh connector selection. Ordinary Luna
      // still clears a previous Think selection here; retained Think is checked on every attach.
      if (!mode.thinkEnabled) await this.setThinkMode(composerForm, false, captureDiagnostic, abortSignal);
      return mode;
    }
    const currentEffort = composerForm.locator(CHATGPT_EFFORT_CONTROL_SELECTOR).filter({ visible: true });
    const effortWaitAbort = new AbortController();
    const effortWaitSignal = browserStageAbortSignal(effortWaitAbort.signal, abortSignal);
    try {
      const ready = await Promise.race([
        currentEffort.waitFor({ state: "visible", timeout: 70_000, signal: effortWaitSignal }).then(() => "effort" as const),
        this.dependencies.chatGptExpiredSessionAlert(page).waitFor({ state: "visible", timeout: 70_000, signal: effortWaitSignal }).then(() => "session-expired" as const),
      ]);
      if (ready === "session-expired") await this.dependencies.throwIfChatGptSessionFailureAlert(page);
    } catch (error) {
      if (abortSignal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
      if (error instanceof ChatGptWebAdapterError) throw error;
      await this.dependencies.throwIfChatGptSessionFailureAlert(page);
      throw chatGptModelControlUnavailableError(
        "ChatGPT rendered the composer but its model/effort control did not become ready",
      );
    } finally {
      effortWaitAbort.abort();
    }
    await this.dependencies.settleChatGptUi();
    await this.dependencies.throwIfChatGptRateLimitDialog(page);
    await captureDiagnostic?.("effort-control-ready");
    await this.dependencies.throwIfChatGptRateLimitDialog(page);
    let activation = await activateChatGptEffortMenu(page, currentEffort);
    // Multipart preparation uses a lower effort, but must stay on the parent's pinned version.
    const modelVersion = stageModelVersion ?? mode.modelVersion;
    if (modelVersion) {
      try {
        activation = await selectChatGptModelFamily(page, currentEffort, activation, modelVersion, abortSignal);
      } catch (error) {
        throw chatGptPinnedModelError(modelVersion, error);
      }
    }
    if (activation.method === "pointerdown") {
      await captureDiagnostic?.("effort-menu-pointerdown-fallback");
    }
    await captureDiagnostic?.("effort-menu-open-requested");
    const effortSlider = activation.slider;
    const sliderContainer = activation.sliderContainer;
    const waitAbort = new AbortController();
    const waitSignal = browserStageAbortSignal(waitAbort.signal, abortSignal);
    try {
      const ready = await Promise.race([
        sliderContainer.waitFor({ state: "visible", timeout: 70_000, signal: waitSignal })
          .then(() => effortSlider.waitFor({ state: "attached", timeout: 70_000, signal: waitSignal }))
          .then(() => "slider" as const),
        this.dependencies.chatGptRateLimitDialog(page).waitFor({ state: "visible", timeout: 70_000, signal: waitSignal }).then(() => "rate-limit" as const),
        this.dependencies.chatGptExpiredSessionAlert(page).waitFor({ state: "visible", timeout: 70_000, signal: waitSignal }).then(() => "session-expired" as const),
      ]);
      if (ready === "rate-limit") await this.dependencies.throwIfChatGptRateLimitDialog(page);
      if (ready === "session-expired") await this.dependencies.throwIfChatGptSessionFailureAlert(page);
      await captureDiagnostic?.("effort-slider-visible");
    } catch (error) {
      if (abortSignal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
      if (error instanceof ChatGptWebAdapterError) throw error;
      await this.dependencies.throwIfChatGptRateLimitDialog(page);
      await this.dependencies.throwIfChatGptSessionFailureAlert(page);
      throw chatGptModelControlUnavailableAdapterError(
        `ChatGPT effort slider did not become ready for item index ${uiEffortIndex}`,
      );
    } finally {
      waitAbort.abort();
    }
    const sliderState = await readChatGptEffortSnapshot(sliderContainer)
      .catch(error => { throw chatGptModelControlUnavailableAdapterError(String(error)); });
    const targetValue = sliderState.min + uiEffortIndex;
    if (targetValue > sliderState.max) {
      const proMayBeLimited = uiEffortIndex === 4 && sliderState.min === 0 && sliderState.max === 3;
      const proRetryHint = proMayBeLimited ? await chatGptProUsageLimitTooltip(activation.menu) : undefined;
      if (proMayBeLimited) {
        throw chatGptProUnavailableAdapterError(
          `ChatGPT effort slider does not expose Pro item index ${uiEffortIndex}`
          + ` (min=${sliderState.min}; max=${sliderState.max})`,
          proRetryHint,
        );
      }
      throw chatGptModelControlUnavailableAdapterError(
        `ChatGPT effort slider does not expose item index ${uiEffortIndex}`
        + ` (min=${sliderState.min}; max=${sliderState.max})`,
        proRetryHint,
      );
    }
    const availability = sliderState.available;
    if (availability && !availability[uiEffortIndex]) {
      throw new ChatGptWebAdapterError(
        `ChatGPT locks ${mode.displayLabel} behind an upgrade. The message was not sent. Choose an available effort and run Repair to refresh the account capabilities.`,
        { status: 400, errorType: "invalid_request_error", code: "chatgpt_effort_locked", retryable: false },
      );
    }
    const sliderControl = effortSlider.locator("xpath=ancestor::*[@role='menuitem'][1]");
    // Establish that any blocking dialog observed after the keypress was caused by this selection,
    // rather than misclassifying an unrelated dialog that was already present on the page.
    throwIfPromptAttachmentAborted(abortSignal);
    await this.dependencies.throwIfChatGptSubmissionDialog(page);
    throwIfPromptAttachmentAborted(abortSignal);
    try {
      await stabilizeEffortSlider({
        target: targetValue,
        signal: abortSignal,
        read: async options => {
          await this.dependencies.throwIfChatGptRateLimitDialog(page);
          options.signal.throwIfAborted();
          const state = await readChatGptEffortSnapshot(sliderContainer);
          if (state.min !== sliderState.min || (state.available && !state.available[uiEffortIndex])) {
            throw new Error("ChatGPT changed the requested effort range or availability during selection");
          }
          return state;
        },
        press: (key, options) => sliderControl.press(key, options),
      });
      await this.dependencies.settleChatGptUi();
      await this.dependencies.throwIfChatGptSessionFailureAlert(page);
      await this.dependencies.throwIfChatGptRateLimitDialog(page);
      await this.dependencies.throwIfChatGptEffortCapabilityDialog(page, mode, abortSignal);
    } catch (error) {
      if (abortSignal?.aborted || error instanceof ChatGptWebAdapterError) throw error;
      // A capability modal can replace or detach the slider before stabilization finishes. Preserve
      // known session/cooldown classifications, then classify the remaining newly triggered dialog.
      await this.dependencies.throwIfChatGptSessionFailureAlert(page);
      await this.dependencies.throwIfChatGptRateLimitDialog(page);
      await this.dependencies.throwIfChatGptEffortCapabilityDialog(page, mode, abortSignal);
      throw chatGptModelControlUnavailableError(
        error instanceof Error ? error.message : "ChatGPT effort selection failed",
      );
    }
    if (modelVersion) {
      activation = await assertSelectedChatGptModelFamily(page, currentEffort, activation, modelVersion, abortSignal);
      await assertChatGptSelectedModelVersion(page, effortSlider, modelVersion, mode.effort === "max", mode.effort, 1_000,
        stageMayRunOtherVersion(activation, mode));
    }
    await captureDiagnostic?.("effort-selected");
    await page.keyboard.press("Escape");
    await this.awaitEffortMenuClosed(page);
    this.effortSelections.set(page, { label: (await currentEffort.innerText()).trim(), url: page.url(), effort: mode.effort });
    await this.assertEffortSurface(page, mode.effort);
    let confirmation = await activateChatGptEffortMenu(page, currentEffort);
    try {
      const confirmed = await readChatGptEffortSnapshot(confirmation.sliderContainer);
      if (confirmed.min !== sliderState.min || confirmed.value !== targetValue
        || (confirmed.available && !confirmed.available[uiEffortIndex])) {
        throw chatGptModelControlUnavailableAdapterError("ChatGPT did not persist the requested effort after closing its menu");
      }
      if (modelVersion) {
        confirmation = await assertSelectedChatGptModelFamily(page, currentEffort, confirmation, modelVersion, abortSignal);
        await assertChatGptSelectedModelVersion(page, confirmation.slider, modelVersion, mode.effort === "max", mode.effort, 1_000,
          stageMayRunOtherVersion(confirmation, mode));
      }
    } finally { await page.keyboard.press("Escape"); }
    await this.awaitEffortMenuClosed(page);
    await this.assertEffortSurface(page, mode.effort);
    return mode;
  }

  async verifyBeforeSend(page: Page, composer: Locator, expectedMode: Pick<ChatGptWebModelMode, "modelVersion" | "modelVersionEffort" | "effort" | "uiEffortIndex" | "thinkEnabled">, abortSignal?: AbortSignal): Promise<void> {
    if (expectedMode && expectedMode.uiEffortIndex !== null) {
      await this.assertEffortSurface(page, expectedMode.effort);
      // Connector attachment, file handling or a user action can reset the picker after selection.
      // Recheck immediately before the irreversible send, without choosing a fallback model.
      const control = composer.locator("xpath=ancestor::form[1]").locator(CHATGPT_EFFORT_CONTROL_SELECTOR).last();
      let verificationError: ChatGptWebAdapterError | undefined;
      try {
        let activation = await activateChatGptEffortMenu(page, control);
        if (expectedMode.modelVersion) {
          activation = await assertSelectedChatGptModelFamily(page, control, activation, expectedMode.modelVersion, abortSignal);
          await assertChatGptSelectedModelVersion(page, activation.slider, expectedMode.modelVersion, expectedMode.effort === "max", expectedMode.effort,
            0, stageMayRunOtherVersion(activation, expectedMode));
          this.validatedPinnedVersions.set(page, expectedMode.modelVersion);
        } else {
          this.validatedPinnedVersions.delete(page);
        }
        const state = await readChatGptEffortSnapshot(activation.sliderContainer);
        if (expectedMode.uiEffortIndex === null || state.value !== state.min + expectedMode.uiEffortIndex
          || (state.available && !state.available[expectedMode.uiEffortIndex])) {
          throw chatGptModelControlUnavailableAdapterError("ChatGPT changed the requested effort before submission");
        }
        if (expectedMode.effort === "max") await this.observeSelectedProVersion(page, activation.slider);
        else this.observedProVersions.delete(page);
      } catch (error) {
        verificationError = expectedMode.modelVersion ? chatGptPinnedModelError(expectedMode.modelVersion, error)
          : error instanceof ChatGptWebAdapterError ? error : chatGptModelControlUnavailableAdapterError("ChatGPT effort could not be verified before submission");
        throw verificationError;
      } finally {
        try {
          await page.keyboard.press("Escape");
        } catch (cleanupError) {
          // Preserve a safety-relevant model mismatch instead of replacing it with cleanup noise.
          // After successful verification, however, a menu that cannot be closed still fails closed.
          if (!verificationError) throw cleanupError;
        }
      }
      await this.awaitEffortMenuClosed(page);
      await this.assertEffortSurface(page, expectedMode.effort);
      if (abortSignal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
    } else if (expectedMode) {
      // Files or a user interaction can change Luna/Think after prompt preparation.
      // Only observe here: /think repair would require clearing the prepared draft.
      const composerForm = composer.locator("xpath=ancestor::form[1]");
      if (await composerForm.locator(CHATGPT_EFFORT_CONTROL_SELECTOR).filter({ visible: true }).count() > 0) {
        throw chatGptModelControlUnavailableAdapterError(
          "ChatGPT Luna now exposes a model selector before submission; rerun setup",
        );
      }
      const controls = composerForm.getByRole("button", { name: /^(?:Think|Analyser)$/, exact: true }).filter({ visible: true });
      const count = await controls.count();
      if (!(count === 0 && !expectedMode.thinkEnabled)) {
        if (count !== 1) {
          throw chatGptModelControlUnavailableAdapterError("ChatGPT Think control is missing or ambiguous before submission");
        }
        const pressed = await controls.getAttribute("aria-pressed");
        if (pressed !== (expectedMode.thinkEnabled ? "true" : "false")) {
          throw chatGptModelControlUnavailableAdapterError("ChatGPT changed the requested Luna/Think mode before submission");
        }
      }
    }
  }
  acceptedUsage(page?: Page): { modelVersion: ChatGptWebModelFamily | "unknown"; modelVersionSource: "observed" | "pinned" | "unknown" } {
    const selected = page && this.effortSelections.get(page);
    if (selected && page) selected.url = page.url();
    const observed = page ? this.observedProVersions.get(page) : undefined;
    const pinned = page ? this.validatedPinnedVersions.get(page) : undefined;
    return { modelVersion: observed ?? pinned ?? "unknown", modelVersionSource: observed ? "observed" : pinned ? "pinned" : "unknown" };
  }
}
