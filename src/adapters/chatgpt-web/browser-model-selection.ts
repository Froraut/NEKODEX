import type { Page, Locator } from "playwright-core";
import type { ChatGptWebModelMode } from "./model";
import type { ChatGptWebProModelVersion } from "../../chatgpt-web-models";
import { ChatGptWebAdapterError } from "./adapter-error";
import { stabilizeEffortSlider } from "./effort-stabilization";
import { chatGptProUsageLimitTooltip } from "./pro-retry-hint";
import { CHATGPT_COMPOSER_SELECTOR, CHATGPT_EFFORT_CONTROL_SELECTOR, activateChatGptEffortMenu, parseChatGptEffortSliderState, readChatGptEffortAvailability, chatGptModelStateMatches } from "../../chatgpt-session";
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

function chatGptPinnedModelError(version: ChatGptWebProModelVersion, cause?: unknown): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    `ChatGPT Pro model version ${version} could not be selected and verified. The pending prompt was not sent; check that this version is available in ChatGPT.`,
    { status: 400, errorType: "invalid_request_error", code: "model_version_unavailable", retryable: false, cause },
  );
}

function chatGptProModelOptionName(version: ChatGptWebProModelVersion): RegExp {
  if (version === "5.6") return /^GPT[-\s]?5\.6\s+Sol(?:\s+Pro)?$/i;
  if (version === "5.5") return /^GPT[-\s]?5\.5(?:\s+Pro)?$/i;
  return /^(?:Latest|Le plus récent|最新|최신|GPT[-\s]?6(?:\s+Astra)?(?:\s+Pro)?)$/i;
}

async function assertSelectedModelRadio(menu: Locator, version: ChatGptWebProModelVersion): Promise<void> {
  const option = menu.getByRole("menuitemradio", {
    name: chatGptProModelOptionName(version), exact: true, includeHidden: true,
  });
  if (await option.count() !== 1 || await option.getAttribute("aria-checked") !== "true") {
    throw chatGptPinnedModelError(version);
  }
}


async function assertChatGptSelectedModelVersion(
  page: Page,
  slider: Locator,
  version: ChatGptWebProModelVersion,
  requirePro = false,
  expectedEffort?: ChatGptWebModelMode["effort"],
  settleMs = 0,
): Promise<void> {
  // The numeric slider is aria-hidden. Its keyboard menuitem owns the live spoken
  // version/effort through aria-describedby, not aria-valuetext on the slider.
  const deadline = Date.now() + settleMs;
  for (;;) {
    const keyboardControl = slider.locator("xpath=ancestor::*[@role='menuitem'][1]");
    const descriptionIds = (await keyboardControl.getAttribute("aria-describedby"))?.trim().split(/\s+/).filter(Boolean) ?? [];
    const descriptions = await page.evaluate(
      ids => ids
        .map(id => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean),
      descriptionIds,
    );
    // "Latest" is not a version. Its slider must still prove 6; a future 7 fails closed.
    // Version and Pro must come from the same described state node: unrelated instructions
    // mentioning Pro are not proof that the selected effort is actually Pro.
    // Latest uses 5.6 for its lower efforts and 6 for Pro. The checked radio
    // is verified separately, so 5.6 in this description alone is not family proof.
    const describedVersion = version === "6" && expectedEffort !== "max" ? "5.6" : version;
    if (chatGptModelStateMatches(descriptions, describedVersion, requirePro, expectedEffort)) return;
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
    .getByRole("button", { name: "Think", exact: true })
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
  private readonly observedProVersions = new WeakMap<Page, ChatGptWebProModelVersion>();
  private readonly validatedPinnedVersions = new WeakMap<Page, ChatGptWebProModelVersion>();

  private async observeSelectedProVersion(page: Page, slider: Locator): Promise<void> {
    this.observedProVersions.delete(page);
    try {
      const control = slider.locator("xpath=ancestor::*[@role='menuitem'][1]");
      const ids = (await control.getAttribute("aria-describedby", { timeout: 1_000 }))?.trim().split(/\s+/).filter(Boolean) ?? [];
      const descriptions = await this.dependencies.withChatGptBrowserObservationTimeout(page.evaluate(ids => ids.map(id => document.getElementById(id)?.textContent?.trim() ?? "").filter(Boolean), ids), 1_000);
      const matches = (["5.5", "5.6", "6"] as const).filter(version => chatGptModelStateMatches(descriptions, version, true, "max"));
      if (matches.length === 1) this.observedProVersions.set(page, matches[0]!);
    } catch { /* Missing or ambiguous live metadata stays unknown; telemetry cannot fail a turn. */ }
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
    stageModelVersion?: ChatGptWebProModelVersion,
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
        const modelName = chatGptProModelOptionName(modelVersion);
        let option = activation.menu.getByRole("menuitemradio", { name: modelName, exact: true, includeHidden: true });
        const optionCount = await option.count();
        if (optionCount > 1) throw chatGptPinnedModelError(modelVersion);
        const familyPinned = optionCount === 1 && await option.getAttribute("aria-checked") === "true";
        if (!familyPinned) {
          // The power picker keeps its model rows in an explicit advanced view.
          const powerView = activation.menu.locator("[data-model-picker-view]");
          const powerViews = await powerView.count();
          if (powerViews > 1) throw chatGptPinnedModelError(modelVersion);
          if (powerViews === 1) {
            const view = await powerView.getAttribute("data-model-picker-view");
            if (view === "simple") {
              const toggle = powerView.locator('[data-model-picker-view-toggle="true"][aria-hidden="false"]');
              if (await toggle.count() !== 1) throw chatGptPinnedModelError(modelVersion);
              await toggle.click({ timeout: 5_000 });
            } else if (view !== "advanced") throw chatGptPinnedModelError(modelVersion);
          } else {
            const modelTrigger = activation.menu.getByLabel(/^(?:Select model|Choose model|选择模型|モデルを選択)$/);
            // Advanced rows can retain geometry while their owning submenu is collapsed/inert.
            const collapsed = await modelTrigger.count() === 1 && await modelTrigger.getAttribute("aria-expanded") === "false";
            if (collapsed || !await option.isVisible().catch(() => false)) await modelTrigger.click({ timeout: 5_000 });
          }
          await option.waitFor({ state: "visible", timeout: 5_000 });
          await option.click({ timeout: 5_000 });
          await page.keyboard.press("Escape");
          activation = await activateChatGptEffortMenu(page, currentEffort);
          option = activation.menu.getByRole("menuitemradio", { name: modelName, exact: true, includeHidden: true });
          const deadline = Date.now() + 1_000;
          for (;;) {
            const count = await option.count();
            if (count > 1) throw chatGptPinnedModelError(modelVersion);
            if (count === 1 && await option.getAttribute("aria-checked") === "true") break;
            if (Date.now() >= deadline) throw chatGptPinnedModelError(modelVersion);
            await new Promise(resolveSettle => setTimeout(resolveSettle, 50));
          }
        }
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
    const readOptions = { timeout: 1_000, signal: abortSignal };
    const sliderState = parseChatGptEffortSliderState(
      await effortSlider.getAttribute("aria-valuemin", readOptions),
      await effortSlider.getAttribute("aria-valuemax", readOptions),
      await effortSlider.getAttribute("aria-valuenow", readOptions),
    );
    if (!sliderState) {
      throw chatGptModelControlUnavailableAdapterError(
        "ChatGPT effort slider exposed an invalid ARIA range",
      );
    }
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
    const availability = await readChatGptEffortAvailability(sliderContainer, sliderState)
      .catch(error => { throw chatGptModelControlUnavailableAdapterError(String(error)); });
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
          return parseChatGptEffortSliderState(
            await effortSlider.getAttribute("aria-valuemin", options),
            await effortSlider.getAttribute("aria-valuemax", options),
            await effortSlider.getAttribute("aria-valuenow", options),
          );
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
      await assertSelectedModelRadio(activation.menu, modelVersion);
      await assertChatGptSelectedModelVersion(page, effortSlider, modelVersion, mode.effort === "max", mode.effort, 1_000);
    }
    await captureDiagnostic?.("effort-selected");
    await page.keyboard.press("Escape");
    await this.dependencies.settleChatGptUi();
    this.effortSelections.set(page, { label: (await currentEffort.innerText()).trim(), url: page.url(), effort: mode.effort });
    await this.assertEffortSurface(page, mode.effort);
    const confirmation = await activateChatGptEffortMenu(page, currentEffort);
    try {
      const confirmed = parseChatGptEffortSliderState(
        await confirmation.slider.getAttribute("aria-valuemin", readOptions),
        await confirmation.slider.getAttribute("aria-valuemax", readOptions),
        await confirmation.slider.getAttribute("aria-valuenow", readOptions),
      );
      if (!confirmed || confirmed.min !== sliderState.min || confirmed.max !== sliderState.max || confirmed.value !== targetValue) {
        throw chatGptModelControlUnavailableAdapterError("ChatGPT did not persist the requested effort after closing its menu");
      }
      if (modelVersion) {
        await assertSelectedModelRadio(confirmation.menu, modelVersion);
        await assertChatGptSelectedModelVersion(page, confirmation.slider, modelVersion, mode.effort === "max", mode.effort, 1_000);
      }
    } finally { await page.keyboard.press("Escape"); }
    await this.dependencies.settleChatGptUi();
    await this.assertEffortSurface(page, mode.effort);
    return mode;
  }

  async verifyBeforeSend(page: Page, composer: Locator, expectedMode: Pick<ChatGptWebModelMode, "modelVersion" | "effort" | "uiEffortIndex" | "thinkEnabled">, abortSignal?: AbortSignal): Promise<void> {
    if (expectedMode && expectedMode.uiEffortIndex !== null) {
      await this.assertEffortSurface(page, expectedMode.effort);
      // Connector attachment, file handling or a user action can reset the picker after selection.
      // Recheck immediately before the irreversible send, without choosing a fallback model.
      const control = composer.locator("xpath=ancestor::form[1]").locator(CHATGPT_EFFORT_CONTROL_SELECTOR).last();
      let verificationError: ChatGptWebAdapterError | undefined;
      try {
        const { menu, slider } = await activateChatGptEffortMenu(page, control);
        if (expectedMode.modelVersion) {
          await assertSelectedModelRadio(menu, expectedMode.modelVersion);
          await assertChatGptSelectedModelVersion(page, slider, expectedMode.modelVersion, expectedMode.effort === "max", expectedMode.effort);
          this.validatedPinnedVersions.set(page, expectedMode.modelVersion);
        } else {
          this.validatedPinnedVersions.delete(page);
        }
        const state = parseChatGptEffortSliderState(
          await slider.getAttribute("aria-valuemin"), await slider.getAttribute("aria-valuemax"),
          await slider.getAttribute("aria-valuenow"),
        );
        if (!state || expectedMode.uiEffortIndex === null || state.value !== state.min + expectedMode.uiEffortIndex) {
          throw chatGptModelControlUnavailableAdapterError("ChatGPT changed the requested effort before submission");
        }
        if (expectedMode.effort === "max") await this.observeSelectedProVersion(page, slider);
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
      await this.dependencies.settleChatGptUi();
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
      const controls = composerForm.getByRole("button", { name: "Think", exact: true }).filter({ visible: true });
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
  acceptedUsage(page?: Page): { modelVersion: ChatGptWebProModelVersion | "unknown"; modelVersionSource: "observed" | "pinned" | "unknown" } {
    const selected = page && this.effortSelections.get(page);
    if (selected && page) selected.url = page.url();
    const observed = page ? this.observedProVersions.get(page) : undefined;
    const pinned = page ? this.validatedPinnedVersions.get(page) : undefined;
    return { modelVersion: observed ?? pinned ?? "unknown", modelVersionSource: observed ? "observed" : pinned ? "pinned" : "unknown" };
  }
}
