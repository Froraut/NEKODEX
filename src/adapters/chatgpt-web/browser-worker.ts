import { assertChatGptWebInputWithinLimits, assertChatGptWebMultipartInputWithinLimits, resolveChatGptWebMultipartStagingMode } from "./browser-input-policy";
export { assertChatGptWebInputWithinLimits, assertChatGptWebMultipartInputWithinLimits, resolveChatGptWebMultipartStagingMode } from "./browser-input-policy";
import { CHATGPT_DOM_REVISION_ATTRIBUTES } from "./browser-dom-revision";
import { CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS, CHATGPT_BROWSER_OBSERVATION_PROBE_TIMEOUT_MS, ChatGptBrowserObservationTimeoutError, CHATGPT_UI_SETTLE_MS, CHATGPT_SEND_ENABLE_GRACE_MS, settleChatGptUi, withChatGptBrowserObservationTimeout } from "./browser-operation-support";
export { CHATGPT_UI_SETTLE_MS, CHATGPT_SEND_ENABLE_GRACE_MS, CHATGPT_BROWSER_OBSERVATION_PROBE_TIMEOUT_MS, ChatGptBrowserObservationTimeoutError, withChatGptBrowserObservationTimeout } from "./browser-operation-support";
import { chatGptConnectorUnavailableError, ChatGptPersistentBrowserStateError, ensureChatGptPersonalizedConnectorAccess, clearChatGptPersonalizationComposer } from "./browser-personalization";
export { ensureChatGptPersonalizedConnectorAccess, type ChatGptPersonalizationPreflight } from "./browser-personalization";
import { ChatGptVisibleTraceTracker } from "./browser-visible-trace";
export { ChatGptVisibleTraceTracker, isChatGptTraceControl, stripChatGptTraceControlSuffix, type ChatGptVisibleTraceBlock, type ChatGptVisibleTraceEvent } from "./browser-visible-trace";
import { ChatGptBrowserDiagnostics, stalledTurnDiagnostic, redactChatGptUiDiagnostic } from "./browser-diagnostics";
export { redactChatGptUiDiagnostic, sanitizeChatGptBrowserDiagnosticState, browserDiagnosticCheckpoint } from "./browser-diagnostics";
import { submissionDomState, type ChatGptSubmissionDomCache, type ChatGptSubmissionDomState } from "./browser-submission-dom";
import { absentResponseDomSnapshot, responseDomSnapshot, type ChatGptResponseDomCache, type ChatGptResponseDomSnapshot } from "./browser-response-dom";
import { assertChatGptPromptAttachments, chatGptPromptFilePayloads } from "./attachment-payloads";
export { chatGptImageFilePayloads, chatGptDocumentFilePayloads, chatGptPromptFilePayloads } from "./attachment-payloads";
import { ChatGptModelSelectionController } from "./browser-model-selection";
export { chatGptProUnavailableAdapterError, setChatGptThinkMode } from "./browser-model-selection";
import { CHATGPT_RESPONSE_DOM_GRACE_MS, CHATGPT_MULTIPART_RESPONSE_DOM_GRACE_MS, CHATGPT_COMPLETION_ACTION_GRACE_MS, ChatGptCompletionTracker, ChatGptTurnDomHealthTracker, chatGptExternalProgressSuppressesDomHealth } from "./browser-response-policy";
export { CHATGPT_RESPONSE_DOM_GRACE_MS, CHATGPT_MULTIPART_RESPONSE_DOM_GRACE_MS, CHATGPT_EMPTY_RESPONSE_GRACE_MS, CHATGPT_COMPLETION_ACTION_GRACE_MS, CHATGPT_COMPLETION_SETTLE_MS, chatGptTurnIsComplete, ChatGptCompletionTracker, ChatGptTurnDomHealthTracker, CHATGPT_EXTERNAL_PROGRESS_STALL_CEILING_MS, CHATGPT_EXTERNAL_PROGRESS_CLOCK_SKEW_MS, chatGptExternalProgressSuppressesDomHealth } from "./browser-response-policy";
import { CHATGPT_COMPOSER_DOCUMENT_END_KEY, CHATGPT_COMPOSER_SELECT_ALL_KEY, throwIfPromptAttachmentAborted, withBrowserTurnAbort, browserStageAbortSignal } from "./browser-operation-support";
export { CHATGPT_COMPOSER_DOCUMENT_END_KEY, CHATGPT_COMPOSER_SELECT_ALL_KEY } from "./browser-operation-support";
import { canRetryOwnedPageRebind } from "./browser-lifecycle-safety";
import { parseChatGptWebCompactionExecution, type ChatGptWebCompactionExecution } from "../../chatgpt-web-compaction-policy";
import { skillFileTokens } from "./skill-attachments";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Request, type Response } from "playwright-core";
import {
  atomicWriteFile,
  CHATGPT_CONNECTOR_NAME,
  defaultChromeExecutable,
  DEV_CHATGPT_CONNECTOR_NAME,
  expandUserPath,
  getConfigDir,
  currentChatGptConnectorName,
  isLegacyChatGptConnectorName,
  legacyChatGptConnectorMigrationMessage,
  LEGACY_CHATGPT_CONNECTOR_NAMES,
} from "../../config";
import { estimateTokens } from "../../lib/token-estimate";
import type { CodexProviderConfig } from "../../types";
import {
  ChatGptMarkdownBuffer,
  ChatGptMarkdownConsistencyError,
} from "./markdown";
import {
  CHATGPT_WEB_LUNA_MODEL_ID,
  CHATGPT_WEB_MODEL_ID,
  resolveChatGptWebModelMode,
  type ChatGptWebCapabilities,
  type ChatGptWebModelMode,
} from "./model";
import {
  compiledChatGptWebMaxMessageChars,
  estimateChatGptWebImageTokens,
  estimateCompiledChatGptWebMessageTokens,
} from "./input-tokens";
import {
  formatChatGptWebMultipartCommit,
  formatChatGptWebMultipartStage,
  type CompiledChatGptWebPrompt,
  type ChatGptWebMultipartStage,
} from "./prompt";
import { estimateCompiledChatGptWebInputTokens } from "./input-tokens";
import {
  assertAuthenticatedChatGptPage,
  assertTemporaryChatPage,
  CHATGPT_ASSISTANT_TURN_SELECTOR,
  CHATGPT_COMPOSER_SELECTOR,
  CHATGPT_STOP_BUTTON_SELECTOR,
  CHATGPT_TEMPORARY_CHAT_URL,
  CHATGPT_USER_TURN_SELECTOR,
  detectChatGptAccountCapabilities,
} from "../../chatgpt-session";
import {
  loginVerificationMarkerPath,
  sanitizeBrowserLoginStorageState,
  writeBrowserLoginVerificationMarker,
} from "../../browser-login";
import {
  connectLauncherBrowserHost,
  cancelLauncherArtifactDownload,
  launcherArtifactTaskDirectory,
  registerLauncherArtifactDownload,
  waitForLauncherArtifactDownload,
  LauncherBrowserTurnCancelledError,
  LauncherAccountCooldownError,
  LauncherRetainedConversationUnavailableError,
  LAUNCHER_TURN_HEARTBEAT_INTERVAL_MS,
  LAUNCHER_TURN_HEARTBEAT_TIMEOUT_MS,
  notifyLauncherTurn,
} from "../../launcher-browser-host";
import {
  type ChatGptWebProModelVersion,
} from "../../chatgpt-web-models";
import { LauncherBrowserHelperClient } from "./launcher-helper-client";
import { acquireChatGptResponseArtifacts, chatGptArtifactMarkdown } from "./artifacts";
import { MAX_CHATGPT_BROWSER_TABS, MAX_CHATGPT_OUTSTANDING_TURNS } from "./concurrency";
import {
  ChatGptCompactionHandoffAccepted,
  ChatGptWebAdapterError,
  chatGptSubmittedProviderFailure,
  chatGptBrowserTabClosedError,
  chatGptRetainedConversationUnavailableError,
  chatGptStoppedThinkingError,
} from "./adapter-error";
import {
  ChatGptLunaCheckpointStream,
  type CapturedChatGptLunaCheckpoint,
} from "./rolling-checkpoint";
import {
  chatGptExternalProgressIsLive,
  chatGptExternalToolCallsAreInFlight,
} from "./turn-progress";
import type {
  ChatGptTurnProgressReader,
} from "./turn-progress";

export { MAX_CHATGPT_BROWSER_TABS } from "./concurrency";

const workers = new Map<string, ChatGptBrowserWorker>();

export async function closeChatGptBrowserWorkers(): Promise<void> {
  const active = [...workers.values()];
  workers.clear();
  const results = await Promise.allSettled(active.map(worker => worker.close()));
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map(result => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} ChatGPT browser worker(s) failed to close`);
  }
}

export const CHATGPT_TOOL_CONFIRMATION_TIMEOUT_MS = 60_000;
export const MAX_CHATGPT_CONNECTOR_TRIGGER_ATTEMPTS = 3;
const CHATGPT_CONNECTOR_MENTION_QUERY = "@codex";
const CHATGPT_SMOKE_TEXT = "Reply with exactly: CODEX WEB GPT READY";
const CHATGPT_SMOKE_EXPECTED = "CODEX WEB GPT READY";
class ChatGptConnectorCatalogStaleError extends Error {
  constructor(
    readonly appName: string,
    readonly triggerAttempts: number,
  ) {
    super(`ChatGPT connector catalog is missing ${JSON.stringify(appName)}`);
    this.name = "ChatGptConnectorCatalogStaleError";
  }
}

interface ChatGptConnectorAttemptBudget {
  triggerAttempts: number;
}

export class ChatGptPromptAttachmentIntegrityError extends ChatGptWebAdapterError {
  constructor(message: string, cause?: unknown) {
    super(message, {
      status: 502,
      errorType: "server_error",
      code: "prompt_attachment_integrity",
      retryable: false,
      cause,
    });
    this.name = "ChatGptPromptAttachmentIntegrityError";
  }
}

const chatGptRateLimitDialog = (page: Page): Locator => page.locator('[role="dialog"]')
  .filter({ hasText: /Too many requests|太多要求|太多请求|リクエストが多すぎます|요청이 너무 많습니다|요청을 너무 빠르게 보내고 있습니다/i })
  .filter({ hasText: /making requests too quickly|過於頻繁|过于频繁|リクエストの頻度が高すぎます|요청을 너무 빠르게 보내고 있습니다/i })
  .last();

export async function throwIfChatGptRateLimitDialog(page: Page): Promise<void> {
  const dialog = chatGptRateLimitDialog(page);
  if (!await dialog.isVisible().catch(() => false)) return;

  const acknowledge = dialog.getByRole("button", { name: /^(Got it|知道了|了解|알겠습니다)$/ }).last();
  if (await acknowledge.isVisible().catch(() => false)) {
    try {
      await acknowledge.press("Enter");
    } catch (error) {
      throw new ChatGptWebAdapterError(
        `ChatGPT rate limit: too many requests, and the dialog could not be dismissed (${error instanceof Error ? error.message : String(error)}). Try again in a few minutes.`,
        { status: 429, errorType: "rate_limit_error", code: "rate_limit_exceeded", retryable: false },
      );
    }
  }
  throw new ChatGptWebAdapterError(
    "ChatGPT rate limit: too many requests. Try again in a few minutes.",
    { status: 429, errorType: "rate_limit_error", code: "rate_limit_exceeded", retryable: false },
  );
}

export async function throwIfChatGptSubmissionDialog(page: Page): Promise<void> {
  const dialogs = page.locator('[role="dialog"], [role="alertdialog"]').filter({ visible: true });
  if (await dialogs.count() === 0) return;
  throw new ChatGptWebAdapterError(
    "ChatGPT is showing a dialog that blocks submission. Review it in NEKODEX, then retry the task.",
    { status: 409, errorType: "invalid_request_error", code: "chatgpt_submission_dialog", retryable: false },
  );
}

export async function throwIfChatGptEffortCapabilityDialog(
  page: Page,
  mode: Pick<ChatGptWebModelMode, "displayLabel">,
  abortSignal?: AbortSignal,
): Promise<void> {
  throwIfPromptAttachmentAborted(abortSignal);
  const dialogs = page.locator('[role="dialog"], [role="alertdialog"]').filter({ visible: true });
  const count = await dialogs.count();
  throwIfPromptAttachmentAborted(abortSignal);
  if (count === 0) return;
  throw new ChatGptWebAdapterError(
    `ChatGPT blocked the requested ${mode.displayLabel} effort with an account-capability dialog. `
    + "The pending prompt was not sent. Run Repair to refresh account capabilities or choose an effort the account exposes. "
    + "No lower-effort fallback was used.",
    {
      status: 403,
      errorType: "permission_error",
      code: "model_effort_unavailable",
      retryable: false,
      cause: new Error(`ChatGPT exposed ${count} blocking dialog(s) immediately after effort selection`),
    },
  );
}

const chatGptTemporaryChatOnboardingDialog = (page: Page): Locator => page
  .locator('[role="dialog"]')
  .filter({ hasText: "Not in history" })
  .filter({ hasText: "No model training" })
  .filter({ hasText: "Memory off" })
  .last();

export async function dismissChatGptTemporaryChatOnboarding(page: Page): Promise<boolean> {
  const dialog = chatGptTemporaryChatOnboardingDialog(page);
  if (!await dialog.isVisible().catch(() => false)) return false;
  const continueButton = dialog.getByRole("button", { name: "Continue", exact: true }).last();
  if (!await continueButton.isVisible().catch(() => false)) {
    throw new Error("ChatGPT Temporary Chat onboarding is visible without its Continue action");
  }
  await continueButton.click({ force: true });
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  return true;
}

type ChatGptTextScope = Pick<Locator, "getByText" | "getByTestId">;

const chatGptSubscriptionFailureAlert = (page: Page): Locator => page
  .locator('[role="alert"]')
  .filter({ hasText: /Failed to load subscription/i })
  .last();

const chatGptExpiredSessionAlert = (page: Page): Locator => page
  .locator('[role="alert"], [role="dialog"]')
  .filter({ hasText: /Your session has expired|你的工作階段已過期|您的工作階段已過期|你的会话已过期|您的会话已过期/i })
  .last();

export async function throwIfChatGptSessionFailureAlert(page: Page): Promise<void> {
  const safetyAlert = page.locator('[role="alert"], [role="dialog"], [role="alertdialog"]')
    .filter({ hasText: /Suspicious activity detected/i })
    .filter({ hasText: /someone else.*using your ChatGPT account/i }).last();
  if (await safetyAlert.isVisible().catch(() => false)) {
    throw new ChatGptWebAdapterError("ChatGPT reported suspicious account activity. Automation is paused; review the account before explicitly resuming in Accounts.", {
      status: 403, errorType: "permission_error", code: "account_safety_stop", retryable: false,
    });
  }
  if (await chatGptExpiredSessionAlert(page).isVisible().catch(() => false)) {
    throw new ChatGptWebAdapterError(
      "The ChatGPT session has expired. Sign in again in NEKODEX.",
      { status: 401, errorType: "authentication_error", code: "chatgpt_session_expired", retryable: false },
    );
  }
  if (!await chatGptSubscriptionFailureAlert(page).isVisible().catch(() => false)) return;
  throw new ChatGptWebAdapterError(
    "ChatGPT could not load the account subscription. Reload ChatGPT inside the launcher and retry; sign out only if the error persists.",
    { status: 503, errorType: "server_error", code: "chatgpt_subscription_unavailable", retryable: true },
  );
}

const chatGptTerminalErrorAlert = (scope: ChatGptTextScope): Locator => scope
  .getByText(/Something went wrong[\s\S]*help\.openai\.com/i)
  .last();

const chatGptThinkingFailedAlert = (scope: ChatGptTextScope): Locator => scope
  // Exact collapsed status only, with its optional textual disclosure chevron. Substrings in
  // answers or quoted diagnostics are ordinary content.
  .getByText(/^Thinking failed(?:\s*[>›])?\s*$/i)
  .last();

// The current UI renders message_length_exceeds_limit as an ordinary response error.
// Observe only browser-issued submissions from this owned page after Send is activated;
// an old response, another tab, or a background endpoint cannot classify this turn.
export class ChatGptSubmissionRejectionObserver {
  private page?: Page;
  private readonly requests = new Set<Request>();
  private checks: Array<Promise<ChatGptWebAdapterError | undefined>> = [];

  private readonly onRequest = (request: Request): void => {
    if (!this.page || request.method() !== "POST"
      || request.url() !== "https://chatgpt.com/backend-api/f/conversation") return;
    try { if (request.frame() !== this.page.mainFrame()) return; } catch { return; }
    this.requests.add(request);
  };

  private readonly onResponse = (response: Response): void => {
    if (!this.requests.delete(response.request()) || response.status() !== 413
      || !response.headers()["content-type"]?.includes("application/json")) return;
    this.checks.push(withChatGptBrowserObservationTimeout(response.json(), 3_000)
      .then(body => body?.detail?.code === "message_length_exceeds_limit"
        ? new ChatGptWebAdapterError(
          "ChatGPT rejected this message because it exceeds the selected mode's input-size limit. Compact the task before retrying.",
          { status: 400, errorType: "invalid_request_error", code: "context_length_exceeded", retryable: false },
        ) : undefined)
      // Unreadable or unfamiliar responses do not establish a size rejection. The normal
      // bound-response DOM error remains authoritative in that case.
      .catch(() => undefined));
  };

  begin(page: Page): void {
    this.dispose();
    this.checks = [];
    this.page = page;
    page.on("request", this.onRequest);
    page.on("response", this.onResponse);
  }

  async failure(): Promise<ChatGptWebAdapterError | undefined> {
    return (await Promise.all(this.checks)).find(error => error !== undefined);
  }

  dispose(): void {
    this.page?.off("request", this.onRequest);
    this.page?.off("response", this.onResponse);
    this.page = undefined;
    this.requests.clear();
  }
}

export async function throwIfChatGptTerminalErrorAlert(scope: ChatGptTextScope): Promise<void> {
  if (await chatGptThinkingFailedAlert(scope).isVisible().catch(() => false)) {
    throw new ChatGptWebAdapterError(
      "ChatGPT ended the turn with 'Thinking failed'. Retry the turn.",
      { status: 502, errorType: "server_error", code: "upstream_server_error", retryable: true },
    );
  }
  if (await scope.getByTestId("regenerate-thread-error-button").last().isVisible().catch(() => false)) {
    throw new ChatGptWebAdapterError(
      "ChatGPT displayed an error for this response. Check the ChatGPT tab for the exact error, then retry the turn.",
      { status: 502, errorType: "server_error", code: "upstream_server_error", retryable: true },
    );
  }
  if (!await chatGptTerminalErrorAlert(scope).isVisible().catch(() => false)) return;
  throw new ChatGptWebAdapterError(
    "ChatGPT ended the turn with 'Something went wrong'. Retry the turn.",
    { status: 502, errorType: "server_error", code: "upstream_server_error", retryable: true },
  );
}

export async function resolveChatGptToolConfirmation(
  page: Page,
  appName: string,
  autoApprove: boolean,
  signal?: AbortSignal,
  timeoutMs = CHATGPT_TOOL_CONFIRMATION_TIMEOUT_MS,
  onVisible?: () => Promise<void>,
): Promise<boolean> {
  const dialog = page.locator('[role="dialog"], [data-testid="tool-approval-card"]')
    .filter({ hasText: `Allow ChatGPT to use ${appName}?` })
    .last();
  if (!await dialog.isVisible().catch(() => false)) return false;
  await onVisible?.();

  if (autoApprove) {
    // ChatGPT exposes either "Allow once" or the shorter "Allow" for the
    // current one-shot approval. Keep the matcher anchored so persistent
    // actions such as "Always allow" cannot match.
    const allowCurrentAction = dialog
      .getByRole("button", { name: /^Allow(?: once)?$/ })
      .last();
    await allowCurrentAction.waitFor({ state: "visible", timeout: 10_000 });
    await allowCurrentAction.press("Enter");
    return true;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
    if (!await dialog.isVisible().catch(() => false)) return true;
    await new Promise(resolveSleep => setTimeout(resolveSleep, Math.min(100, Math.max(1, deadline - Date.now()))));
  }

  if (!await dialog.isVisible().catch(() => false)) return true;
  const deny = dialog.getByRole("button", { name: "Deny", exact: true }).last();
  await deny.waitFor({ state: "visible", timeout: 5_000 });
  await deny.press("Enter");
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  return true;
}

export const browserStageTimeouts = {
  browserPage: 60_000,
  temporaryChatPreparation: 150_000,
  effortSelection: 120_000,
  promptAttachment: 60_000,
  fileAttachment: 120_000,
  send: 20_000,
  // A Bigger Context stage posts a much larger payload onto a conversation that already holds the
  // earlier parts. This budget covers ChatGPT accepting the submission, not just the click.
  multipartStageSend: 180_000,
  // Staging asks for one transaction-bound acknowledgement, not an open-ended model answer.
  multipartStageAcknowledgement: CHATGPT_MULTIPART_RESPONSE_DOM_GRACE_MS,
} as const;

/**
 * Detects that this process was suspended (system sleep) by watching for gaps in a steady tick.
 * On Apple Silicon the monotonic clock keeps advancing through sleep, so elapsed time alone cannot
 * distinguish "the stage really took 15 minutes" from "the machine slept for 14 of them" — and a
 * stage budget charged for slept time cancels turns that never got their budget awake.
 */
export class ChatGptSuspensionClock {
  private suspendedTotalMs = 0;
  private lastTickAt: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly tickIntervalMs = 1_000,
    private readonly gapThresholdMs = 5_000,
  ) {
    this.lastTickAt = Date.now();
  }

  start(): void {
    if (this.timer) return;
    this.lastTickAt = Date.now();
    this.timer = setInterval(() => this.tick(Date.now()), this.tickIntervalMs);
    this.timer.unref?.();
  }

  /** Exposed for tests; production ticks come from the interval above. */
  tick(now: number): void {
    const gap = now - this.lastTickAt;
    this.lastTickAt = now;
    if (gap >= this.gapThresholdMs) this.suspendedTotalMs += gap - this.tickIntervalMs;
  }

  suspendedMs(): number {
    return this.suspendedTotalMs;
  }
}

export const chatGptSuspensionClock = new ChatGptSuspensionClock();

/**
 * How much of a stage budget remains once slept time is refunded. Zero means the stage really
 * consumed its budget while awake and the timeout stands.
 */
export function remainingStageBudgetMs(
  timeoutMs: number,
  elapsedMs: number,
  suspendedMs: number,
): number {
  const awakeMs = elapsedMs - suspendedMs;
  if (awakeMs >= timeoutMs) return 0;
  return Math.max(250, timeoutMs - awakeMs);
}

export const MAX_CHATGPT_BROWSER_PAGE_REBINDS = 2;

export function isConfirmedLauncherCdpDisconnect(
  error: unknown,
  connection: Pick<Browser, "isConnected"> | undefined,
  signal?: AbortSignal,
): boolean {
  if (signal?.aborted || !connection || connection.isConnected()) return false;
  if (error instanceof LauncherBrowserTurnCancelledError) return false;
  if (error instanceof DOMException && error.name === "AbortError") return false;
  if (error instanceof ChatGptWebAdapterError && error.code === "client_cancelled") return false;
  return error instanceof Error;
}

export async function connectAfterClosingBrowserConnection<T>(
  previousConnection: Pick<Browser, "close"> | undefined,
  connect: () => Promise<T>,
): Promise<T> {
  if (previousConnection) await previousConnection.close();
  return connect();
}

export const CHATGPT_MIN_OPERATIONAL_VIEWPORT = Object.freeze({ width: 320, height: 240 });

async function waitForOperationalChatGptViewport(page: Page, signal?: AbortSignal): Promise<void> {
  try {
    await withBrowserTurnAbort(page.waitForFunction(
      ({ width, height }) => innerWidth >= width && innerHeight >= height,
      CHATGPT_MIN_OPERATIONAL_VIEWPORT,
      { polling: 50, timeout: 10_000 },
    ), signal);
  } catch (error) {
    if (signal?.aborted) throw new DOMException("ChatGPT browser page acquisition aborted", "AbortError");
    throw new Error(
      `ChatGPT browser surface did not expose an operational viewport: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export interface BrowserTurn {
  requestedModel?: string;
  accountRoutingKey?: string;
  traceId: string;
  modelId: string;
  reasoning?: string;
  capabilities: ChatGptWebCapabilities;
  prepare: () => Promise<CompiledChatGptWebPrompt & { release: () => void }>;
  prepareResume?: () => Promise<CompiledChatGptWebPrompt & { release: () => void }>;
  /** Select the Codex Native connector without advertising the ordinary turn tool environment. */
  nativeConnector?: boolean;
  retainConversation?: boolean;
  requireRetainedConversation?: boolean;
  conversationKey?: string;
  onPreparedSelected?: (reused: boolean) => void | Promise<void>;
  abortSignal?: AbortSignal;
  onHeartbeat?: () => void;
  /** Send activation is the ambiguity boundary after which a fresh surface must not replay this prompt. */
  onSendActivated?: () => void | Promise<void>;
  /** Observed current-submission receipt/activity; not proof of model understanding or completion. */
  onSubmitted?: () => void | Promise<void>;
  /** Private to the launcher worker. Durable UI evidence; never a provider completion signal. */
  onTaskProgress?: (phase: 'sending-context' | 'context-accepted' | 'sending' | 'accepted' | 'responding' | 'waiting-tools') => Promise<void>;
  /** One inert Bigger Context stage completed its exact acknowledgement boundary. */
  onMultipartStageAcknowledged?: (stageIndex: number) => void | Promise<void>;
  /** Visible ChatGPT reasoning-summary step titles only; never hidden chain-of-thought. */
  onReasoningSummary?: (text: string, continuation?: boolean) => void;
  /** Stable visible ChatGPT prose between status/tool rows. */
  onCommentary?: (text: string, continuation?: boolean) => void;
  /** Append-only, structurally stable Markdown chunks. */
  onTextDelta: (delta: string) => void;
  /** Proven current-turn MCP activity; never response content or completion. */
  externalProgress?: ChatGptTurnProgressReader;
  /** Require the Native5 completion-fence reason protocol from the launcher helper. */
  asyncToolOperations?: boolean;
  /** Atomically fences browser completion against concurrent MCP claims in the turn broker. */
  completionFence?: {
    begin(): Promise<ChatGptCompletionFenceStart>;
    commit(revision: number): Promise<boolean>;
  };
  /** Allow one clean pre-submit composer retry for isolated history compaction only. */
  compaction?: boolean;
  /** An explicitly selected, read-only summary execution (never an ordinary work turn). */
  compactionExecution?: ChatGptWebCompactionExecution;
  /** Require and remove the private Luna checkpoint tail from the visible Markdown stream. */
  captureLunaCheckpoint?: boolean;
  onLunaCheckpoint?: (captured: CapturedChatGptLunaCheckpoint) => void;
}

export type ChatGptCompletionFenceStart =
  | { revision: number }
  | { blockedReason: "active_work" | "unacknowledged_async_result"; blockedCount: number };

interface ChatGptSubmissionBaseline {
  userTurns: Locator;
  responseTurns: Locator;
  initialTurnIdentities: readonly string[];
  initialGenerationRunning?: boolean;
  acknowledgedStages?: readonly string[];
  domCache: ChatGptSubmissionDomCache;
}

interface ChatGptSubmissionObservationRecovery {
  page: Page;
  baseline: ChatGptSubmissionBaseline;
}

type ChatGptObservationRecovery = (
  attempt: number,
  cause: Error,
  baseline: ChatGptSubmissionBaseline,
  abortSignal?: AbortSignal,
) => Promise<ChatGptSubmissionObservationRecovery>;

type ChatGptObservationRecoverability = (error: unknown) => boolean;

interface ChatGptAssistantTurnBinding {
  identity: string;
  locator: Locator;
  acceptedTurnIdentities: readonly string[];
}

export interface ResolvedBrowserConfig {
  appName: string;
  browserHost: "managed-chrome" | "launcher";
  browserHostDescriptorPath?: string;
  browserHelperScriptPath?: string;
  browserDiagnosticsPath?: string;
  storageStatePath: string;
  chromeExecutablePath: string;
  turnTimeoutMs?: number;
  headed: boolean;
  autoApproveToolCalls: boolean;
}

export type ChatGptSubmissionEvidence = "user_turn" | "assistant_turn" | "generation_running" | "mcp_tool_call";

export function chatGptSubmissionEvidence(state: {
  initialTurnIdentities: readonly string[];
  userIdentities: readonly string[];
  responseIdentities: readonly string[];
  generationRunning: boolean;
}): ChatGptSubmissionEvidence | undefined {
  if (chatGptNewTurnIdentity(state.initialTurnIdentities, state.userIdentities)) return "user_turn";
  if (chatGptNewTurnIdentity(state.initialTurnIdentities, state.responseIdentities)) return "assistant_turn";
  if (state.generationRunning) return "generation_running";
  return undefined;
}

export type ChatGptConnectorAttachmentMode = "none" | "mention" | "retained";

/** A launcher lease may reuse a connector only after proving that exact retained surface is bound. */
export function chatGptConnectorAttachmentMode(
  localTools: boolean,
  reuseConversation: boolean,
): ChatGptConnectorAttachmentMode {
  if (!localTools) return "none";
  return reuseConversation ? "retained" : "mention";
}

export function chatGptStagedBaselineIdentities(
  initial: readonly string[],
  acknowledgedStages: readonly string[] = [],
  observed: readonly { identity: string; text: string }[] = [],
): readonly string[] {
  if (!acknowledgedStages.length) return initial;
  const identities = new Set(initial);
  for (const acknowledgement of acknowledgedStages) {
    const matching = observed.filter(turn => turn.text === acknowledgement);
    if (matching.length > 1) throw new Error("ChatGPT exposed duplicate acknowledged context stages");
    if (matching[0]) identities.add(matching[0].identity);
  }
  return [...identities];
}

export function chatGptNewTurnIdentity(
  initial: readonly string[],
  current: readonly string[],
): string | undefined {
  const previous = new Set(initial);
  const added = current.filter(identity => !previous.has(identity));
  if (added.length > 1) {
    throw new Error(`ChatGPT exposed ${added.length} new conversation turns for one submitted message`);
  }
  return added[0];
}

export function chatGptReboundTurnIdentity(
  initial: readonly string[],
  boundIdentity: string,
  current: readonly string[],
): string | undefined {
  if (current.includes(boundIdentity)) return boundIdentity;
  return chatGptNewTurnIdentity(initial, current);
}

/**
 * Consecutive internal observation faults tolerated before a turn is abandoned.
 *
 * An internal observation fault is not evidence that the upstream turn failed. The loop
 * re-observes within a consecutive budget; any successful observation resets that budget, and
 * exhausting it fails closed with the original fault as the cause.
 */
export const MAX_CHATGPT_INTERNAL_OBSERVATION_FAULTS = 8;

export function resolveBrowserConfig(provider: CodexProviderConfig): ResolvedBrowserConfig {
  const configured = provider.chatgptWeb ?? {};
  const appName = configured.appName?.trim() || CHATGPT_CONNECTOR_NAME;
  const browserHost = configured.browserHost ?? "managed-chrome";
  const browserHostDescriptorPath = configured.browserHostDescriptorPath?.trim();
  const browserHelperScriptPath = configured.browserHelperScriptPath?.trim();
  const browserDiagnosticsPath = resolve(expandUserPath(
    configured.browserDiagnosticsPath?.trim() || join(getConfigDir(), "diagnostics", "browser-turns"),
  ));
  const turnTimeoutMs = configured.turnTimeoutMs;
  if (browserHost === "launcher" && !browserHostDescriptorPath) {
    throw new Error("Launcher browser host requires chatgptWeb.browserHostDescriptorPath");
  }
  if (browserHelperScriptPath && browserHost !== "launcher") {
    throw new Error("Explicit browser helper script requires a launcher host");
  }
  const resolvedBrowserHelperScriptPath = browserHelperScriptPath
    ? resolve(expandUserPath(browserHelperScriptPath))
    : undefined;
  if (resolvedBrowserHelperScriptPath && !existsSync(resolvedBrowserHelperScriptPath)) {
    throw new Error(`Explicit browser helper script does not exist: ${resolvedBrowserHelperScriptPath}`);
  }
  if (turnTimeoutMs !== undefined
    && (!Number.isFinite(turnTimeoutMs) || turnTimeoutMs <= 0)) {
    throw new Error("ChatGPT Web turnTimeoutMs must be a positive finite number");
  }
  if (isLegacyChatGptConnectorName(appName)) {
    throw new Error(legacyChatGptConnectorMigrationMessage(appName));
  }
  return {
    appName,
    browserHost,
    ...(browserHostDescriptorPath ? { browserHostDescriptorPath: resolve(expandUserPath(browserHostDescriptorPath)) } : {}),
    ...(resolvedBrowserHelperScriptPath ? { browserHelperScriptPath: resolvedBrowserHelperScriptPath } : {}),
    browserDiagnosticsPath,
    storageStatePath: resolve(expandUserPath(configured.storageStatePath?.trim() || join(getConfigDir(), "browser", "storage-state.json"))),
    chromeExecutablePath: resolve(expandUserPath(configured.chromeExecutablePath?.trim() || defaultChromeExecutable())),
    ...(turnTimeoutMs !== undefined ? { turnTimeoutMs } : {}),
    headed: configured.headed !== false,
    autoApproveToolCalls: configured.autoApproveToolCalls === true,
  };
}

/**
 * Insert `value` at the caret of an already-resolved ChatGPT composer, returning whether the edit
 * was applied. Runs inside the page, so it may reference only globals and its two arguments.
 *
 * Effort selection closes a menu immediately before a staged part is attached, and focus is still
 * settling when this runs: the composer can be the active element while the caret has not yet been
 * placed inside it, or focus can still be on the menu that just closed. Reading that as a rejected
 * edit failed whole turns roughly a tenth of a second after the effort menu closed, so the caret is
 * placed explicitly instead of assumed. An existing collapsed caret inside the composer is left
 * exactly where the user put it; only a missing or foreign one is replaced, and always with a
 * position inside this composer, so an insert can never land in another element.
 */
export function insertPlainTextIntoComposer(element: HTMLElement, value: string): boolean {
  // Re-check in the document that will receive the text: a retained lease can outlive navigation.
  if (window.location.origin !== "https://chatgpt.com" || element.ownerDocument !== document) {
    throw new Error("Cannot insert a ChatGPT prompt into a foreign document");
  }
  if (document.activeElement !== element) element.focus();
  if (document.activeElement !== element) return false;
  const selection = window.getSelection();
  if (!selection) return false;
  const alreadyPlaced = selection.isCollapsed
    && selection.anchorNode !== null
    && element.contains(selection.anchorNode);
  if (!alreadyPlaced) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  if (
    !selection.isCollapsed
    || !selection.anchorNode
    || !element.contains(selection.anchorNode)
  ) {
    return false;
  }
  // Keep transport text literal. Rich HTML insertion may normalize newlines or
  // whitespace while ChatGPT imports the fragment into its editor. Equal length
  // is not sufficient: the caller still requires complete exact readback.
  return document.execCommand("insertText", false, value);
}

export class ChatGptBrowserWorker {
  private modelSelection?: ChatGptModelSelectionController;

  private modelSelectionController(): ChatGptModelSelectionController {
    return this.modelSelection ??= new ChatGptModelSelectionController({
      activeComposer: (page, timeoutMs, signal) => this.activeComposer(page, timeoutMs, signal),
      settleChatGptUi, withChatGptBrowserObservationTimeout,
      chatGptRateLimitDialog, chatGptExpiredSessionAlert,
      throwIfChatGptRateLimitDialog, throwIfChatGptSessionFailureAlert,
      throwIfChatGptSubmissionDialog, throwIfChatGptEffortCapabilityDialog,
    });
  }

  private async selectModelAndEffort(
    page: Page, modelId: string, reasoning: string | undefined, capabilities: ChatGptWebCapabilities,
    captureDiagnostic?: (checkpoint: string) => Promise<void>, stageModelVersion?: ChatGptWebProModelVersion,
    abortSignal?: AbortSignal,
  ): Promise<ChatGptWebModelMode> {
    return ChatGptBrowserWorker.prototype.modelSelectionController.call(this).select(page,
      resolveChatGptWebModelMode(modelId, reasoning, capabilities, stageModelVersion),
      captureDiagnostic, stageModelVersion, abortSignal);
  }

  static forProvider(provider: CodexProviderConfig): ChatGptBrowserWorker {
    const config = resolveBrowserConfig(provider);
    const key = JSON.stringify(config);
    let worker = workers.get(key);
    if (!worker) {
      worker = new ChatGptBrowserWorker(config);
      workers.set(key, worker);
    }
    return worker;
  }

  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private managedBrowserReady?: Promise<{ browser: Browser; context: BrowserContext }>;
  private launcherHelper?: LauncherBrowserHelperClient;
  private maintenanceTail: Promise<void> = Promise.resolve();
  private readonly activeRuns = new Map<string, Promise<string>>();

  private constructor(private readonly config: ResolvedBrowserConfig) {}

  /**
   * Lexical/contenteditable may preserve runs of ASCII spaces by exposing some of them as NBSP
   * through DOM textContent. Treat that DOM-only representation as equivalent only when the
   * expected U+0020 belongs to a multi-space run. Single spaces, tabs, newlines, intentional
   * expected NBSP characters, and every other mutation remain exact and fail closed.
   */
  private promptCodeUnitEquivalent(
    expected: string,
    observed: string,
    index: number,
  ): boolean {
    const expectedUnit = expected[index];
    const observedUnit = observed[index];

    if (expectedUnit === observedUnit) return true;
    if (expectedUnit !== " " || observedUnit !== "\u00A0") return false;

    return expected[index - 1] === " " || expected[index + 1] === " ";
  }

  private promptTextEquivalent(
    expected: string,
    observed: string,
  ): boolean {
    if (expected.length !== observed.length) return false;

    for (let index = 0; index < expected.length; index += 1) {
      if (!this.promptCodeUnitEquivalent(expected, observed, index)) {
        return false;
      }
    }

    return true;
  }

  private promptEquivalentPrefixLength(
    expected: string,
    observed: string,
  ): number {
    const length = Math.min(expected.length, observed.length);

    let index = 0;
    while (
      index < length
      && this.promptCodeUnitEquivalent(expected, observed, index)
    ) {
      index += 1;
    }

    return index;
  }

  run(turn: BrowserTurn): Promise<string> {
    if (this.activeRuns.has(turn.traceId)) {
      return Promise.reject(new Error(`Duplicate ChatGPT web browser turn: ${turn.traceId}`));
    }
    const outstandingLimit = this.config.browserHost === 'launcher' ? MAX_CHATGPT_OUTSTANDING_TURNS : MAX_CHATGPT_BROWSER_TABS;
    if (this.activeRuns.size >= outstandingLimit) {
      return Promise.reject(new Error(
        `ChatGPT Web has reached its ${outstandingLimit} active and waiting task limit; finish or cancel a task before submitting another`,
      ));
    }
    const useHelper = this.config.browserHost === "launcher" && process.env.CODEX_CHATGPT_WEB_BROWSER_HELPER_PROCESS !== "1";
    if (useHelper) {
      this.launcherHelper ??= new LauncherBrowserHelperClient(this.config);
    }
    // Capture the owner before deferring: close() may clear the field before this microtask.
    const helper = this.launcherHelper;
    const run = Promise.resolve().then(() => useHelper ? helper!.run(turn) : this.runExclusive(turn));
    this.activeRuns.set(turn.traceId, run);
    void run.finally(() => {
      if (this.activeRuns.get(turn.traceId) === run) this.activeRuns.delete(turn.traceId);
    }).catch(() => {});
    return run;
  }

  verifyConnector(traceId = `verify_${randomUUID().replaceAll("-", "")}`): Promise<string> {
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(traceId)) {
      return Promise.reject(new Error("ChatGPT connector verification trace id is invalid"));
    }
    return this.enqueueMaintenance("connector verification", () => this.verifyConnectorExclusive(traceId));
  }

  inspectSession(detectCapabilities: boolean): Promise<{
    authenticated: true;
    temporary: true;
    url: string;
    solAvailable?: boolean;
    extraHighAvailable?: boolean;
    proAvailable?: boolean;
  }> {
    return this.enqueueMaintenance("session inspection", () => this.inspectSessionExclusive(detectCapabilities));
  }

  smokeTest(abortSignal?: AbortSignal): Promise<{ effort: string; response: string }> {
    return this.enqueueMaintenance("smoke test", () => this.smokeTestExclusive(abortSignal));
  }

  private enqueueMaintenance<T>(name: string, action: () => Promise<T>): Promise<T> {
    const operation = this.maintenanceTail.then(() => {
      if (this.activeRuns.size > 0) {
        throw new Error(`ChatGPT ${name} requires all browser turns to finish`);
      }
      return action();
    });
    this.maintenanceTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async close(): Promise<void> {
    if (this.launcherHelper) {
      const helper = this.launcherHelper;
      this.launcherHelper = undefined;
      await helper.close();
    }
    await Promise.allSettled([...this.activeRuns.values()]);
    await this.maintenanceTail;
    const browser = this.browser;
    this.browser = undefined;
    this.context = undefined;
    this.page = undefined;
    this.managedBrowserReady = undefined;
    // For connectOverCDP, Playwright implements Browser.close as a transport disconnect; it does
    // not close the launcher-owned Electron process. Always release that connection and its
    // artifact directory instead of leaking one per timeout/helper lifecycle.
    if (browser) await browser.close();
  }

  private async runStage<T>(
    traceId: string,
    stage: string,
    timeoutMs: number,
    action: (abortSignal: AbortSignal) => Promise<T>,
    suspensionClock: Pick<ChatGptSuspensionClock, "suspendedMs"> = chatGptSuspensionClock,
    awaitAbortedActionSettlement = false,
  ): Promise<T> {
    chatGptSuspensionClock.start();
    const startedAt = performance.now();
    const suspendedAtStart = suspensionClock.suspendedMs();
    console.info(`[chatgpt-web] browser turn ${traceId} stage=${stage} started`);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stageTimedOut = false;
    let actionPromise: Promise<T> | undefined;
    try {
      const timeout = new Promise<never>((_, rejectTimeout) => {
        const fireOrRearm = () => {
          // A stage that spans a system sleep has not consumed its budget: the browser was as
          // frozen as this process, so slept time is refunded before the timer is re-armed.
          const suspendedMs = suspensionClock.suspendedMs() - suspendedAtStart;
          const remaining = remainingStageBudgetMs(timeoutMs, performance.now() - startedAt, suspendedMs);
          if (remaining > 0) {
            timer = setTimeout(fireOrRearm, remaining);
            return;
          }
          stageTimedOut = true;
          controller.abort();
          rejectTimeout(new Error(`ChatGPT browser stage timed out: ${stage}`));
        };
        timer = setTimeout(fireOrRearm, timeoutMs);
      });
      actionPromise = action(controller.signal);
      const value = await Promise.race([actionPromise, timeout]);
      console.info(`[chatgpt-web] browser turn ${traceId} stage=${stage} completed durationMs=${Math.round(performance.now() - startedAt)}`);
      return value;
    } catch (error) {
      let surfacedError = error;
      if (stageTimedOut && awaitAbortedActionSettlement && actionPromise) {
        try {
          await actionPromise;
        } catch (settlementError) {
          if (settlementError instanceof ChatGptPersistentBrowserStateError) {
            surfacedError = settlementError;
          }
        }
      }
      console.error(`[chatgpt-web] browser turn ${traceId} stage=${stage} failed durationMs=${Math.round(performance.now() - startedAt)}: ${surfacedError instanceof Error ? surfacedError.message : String(surfacedError)}`);
      throw surfacedError;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    if (!this.page && this.config.browserHost === "managed-chrome" && this.context) {
      try {
        const page = await this.context.newPage();
        this.page = page;
        return page;
      } catch (error) {
        if (this.browser) {
          try {
            await this.browser.close();
            this.browser = undefined;
            this.context = undefined;
            this.managedBrowserReady = undefined;
          } catch {
            // Keep the browser reachable so close() can retry releasing it.
          }
        }
        throw error;
      }
    }
    if (this.browser) {
      // A closed maintenance page can outlive its browser connection. Release that owner before
      // replacing the handle; if close fails, keep it reachable for a later close() retry.
      await this.browser.close();
      this.browser = undefined;
      this.context = undefined;
      this.page = undefined;
      this.managedBrowserReady = undefined;
    }
    if (this.config.browserHost === "launcher") {
      const connection = await connectLauncherBrowserHost(this.config.browserHostDescriptorPath!);
      this.browser = connection.browser;
      this.context = connection.context;
      this.page = connection.page;
      return this.page;
    }
    if (!existsSync(this.config.storageStatePath) || !existsSync(loginVerificationMarkerPath(this.config.storageStatePath))) {
      throw new Error(`ChatGPT web login state is missing: ${this.config.storageStatePath}`);
    }
    if (!existsSync(this.config.chromeExecutablePath)) {
      throw new Error(`Configured Chrome executable does not exist: ${this.config.chromeExecutablePath}`);
    }
    const browser = await chromium.launch({
      executablePath: this.config.chromeExecutablePath,
      headless: !this.config.headed,
    });
    try {
      const context = await browser.newContext({ storageState: this.config.storageStatePath });
      const page = await context.newPage();
      this.browser = browser;
      this.context = context;
      this.page = page;
      return page;
    } catch (error) {
      await browser.close().catch(() => {});
      throw error;
    }
  }

  private async ensureManagedBrowser(): Promise<{ browser: Browser; context: BrowserContext }> {
    if (this.managedBrowserReady) return this.managedBrowserReady;
    const opening = (async () => {
      if (!existsSync(this.config.storageStatePath) || !existsSync(loginVerificationMarkerPath(this.config.storageStatePath))) {
        throw new Error(`ChatGPT web login state is missing: ${this.config.storageStatePath}`);
      }
      if (!existsSync(this.config.chromeExecutablePath)) {
        throw new Error(`Configured Chrome executable does not exist: ${this.config.chromeExecutablePath}`);
      }
      const browser = await chromium.launch({
        executablePath: this.config.chromeExecutablePath,
        headless: !this.config.headed,
      });
      try {
        const context = await browser.newContext({ storageState: this.config.storageStatePath });
        this.browser = browser;
        this.context = context;
        return { browser, context };
      } catch (error) {
        await browser.close().catch(() => {});
        throw error;
      }
    })();
    this.managedBrowserReady = opening;
    try {
      return await opening;
    } catch (error) {
      if (this.managedBrowserReady === opening) this.managedBrowserReady = undefined;
      throw error;
    }
  }

  /**
   * A Codex turn owns one isolated Temporary Chat document. Reusing the same
   * ChatGPT SPA page can retain the previous transcript and autocomplete DOM,
   * so an @app lookup may select stale UI from the preceding turn.
   */
  private async pageForNewTurn(): Promise<Page> {
    if (this.config.browserHost === "launcher") {
      throw new Error("Launcher turns require an explicitly leased browser surface");
    }
    const { context } = await this.ensureManagedBrowser();
    return await context.newPage();
  }

  private async activeComposer(
    page: Page,
    timeoutMs = 30_000,
    abortSignal?: AbortSignal,
  ): Promise<Locator> {
    const composers = page.locator(CHATGPT_COMPOSER_SELECTOR).filter({ visible: true });
    const deadline = Date.now() + timeoutMs;
    let count = 0;
    while (Date.now() < deadline) {
      throwIfPromptAttachmentAborted(abortSignal);
      count = await withBrowserTurnAbort(
        withChatGptBrowserObservationTimeout(
          composers.count(),
          Math.max(1, Math.min(CHATGPT_BROWSER_OBSERVATION_PROBE_TIMEOUT_MS, deadline - Date.now())),
        ),
        abortSignal,
      );
      if (count === 1) return composers.first();
      await withBrowserTurnAbort(
        new Promise(resolveSleep => setTimeout(resolveSleep, 50)),
        abortSignal,
      );
    }
    throw new Error(
      "ChatGPT composer is unavailable. Reload ChatGPT and retry the task.",
      { cause: new Error(`Visible ChatGPT composer count was ${count}`) },
    );
  }

  /** Put every browser operation on one fully hydrated Temporary Chat document. */
  private async prepareTemporaryChatSurface(
    page: Page,
    captureDiagnostic?: (checkpoint: string) => Promise<void>,
    abortSignal?: AbortSignal,
  ): Promise<Locator> {
    if (abortSignal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
    // Launcher verification refreshes its owned page before attaching Playwright so a newly added
    // connector is present in the catalog. Navigating again here destroys that freshly hydrated
    // document and made the first verification race a second SPA bootstrap. A leased turn starts on
    // about:blank and therefore still performs exactly one navigation through this same method.
    if (page.url() !== CHATGPT_TEMPORARY_CHAT_URL) {
      await withBrowserTurnAbort(page.goto(CHATGPT_TEMPORARY_CHAT_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      }), abortSignal);
      await captureDiagnostic?.("temporary-chat-navigation-complete");
    }
    let composer: Locator;
    try {
      composer = await this.activeComposer(page, 30_000, abortSignal);
    } catch (error) {
      if (abortSignal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
      throw new Error("ChatGPT web login is expired or the Temporary Chat surface is unavailable");
    }
    if (await dismissChatGptTemporaryChatOnboarding(page)) {
      await captureDiagnostic?.("temporary-chat-onboarding-dismissed");
    }
    await captureDiagnostic?.("composer-ready");
    await throwIfChatGptSessionFailureAlert(page);
    await assertAuthenticatedChatGptPage(page);
    await assertTemporaryChatPage(page);
    await captureDiagnostic?.("session-verified");
    return composer;
  }

  private async waitForTurnDomMutation(page: Page, timeoutMs = 50): Promise<void> {
    await page.evaluate(({ timeout, attributeFilter }) => new Promise<void>(resolveMutation => {
      let settled = false;
      let settleTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timeoutTimer);
        if (settleTimer) clearTimeout(settleTimer);
        resolveMutation();
      };
      const observer = new MutationObserver(() => {
        if (settleTimer) return;
        // Let one React mutation batch finish before the next compact state read.
        settleTimer = setTimeout(finish, 16);
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter,
      });
      const timeoutTimer = setTimeout(finish, timeout);
    }), { timeout: timeoutMs, attributeFilter: [...CHATGPT_DOM_REVISION_ATTRIBUTES] });
  }

  /** Back off without adding another DOM wait to an already busy renderer. */
  private async waitForLiveProbeRetry(progress: ChatGptTurnProgressReader | undefined, attempt: number, signal?: AbortSignal): Promise<void> {
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await withBrowserTurnAbort(Promise.race([
        new Promise<void>(resolve => { timer = setTimeout(resolve, [1_000, 2_000, 5_000][Math.min(attempt, 2)]!); }),
        ...(progress ? [progress.waitForChange(progress.snapshot().revision, combined).then(() => undefined)] : []),
      ]), signal);
    } finally { if (timer) clearTimeout(timer); controller.abort(); }
  }

  private async waitForTurnDomOrExternalProgress(
    page: Page,
    afterProgressRevision: number,
    externalProgress?: ChatGptTurnProgressReader,
    signal?: AbortSignal,
  ): Promise<void> {
    const domMutation = this.waitForTurnDomMutation(page);
    if (!externalProgress) {
      await withBrowserTurnAbort(domMutation, signal);
      return;
    }
    const progressWaitAbort = new AbortController();
    const progressSignal = signal
      ? AbortSignal.any([progressWaitAbort.signal, signal])
      : progressWaitAbort.signal;
    try {
      await withBrowserTurnAbort(Promise.race([
        domMutation,
        externalProgress.waitForChange(afterProgressRevision, progressSignal).then(() => undefined),
      ]), signal);
    } finally {
      progressWaitAbort.abort();
    }
  }

  private async waitForSubmissionAccepted(
    page: Page,
    baseline: ChatGptSubmissionBaseline,
    signal?: AbortSignal,
    externalProgress?: ChatGptTurnProgressReader,
    initialToolBatchRevision = externalProgress?.snapshot().lastToolBatchRevision ?? 0,
    completionTracker?: ChatGptCompletionTracker,
  ): Promise<ChatGptSubmissionEvidence> {
    if (signal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
    for (;;) {
      if (signal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
      const progress = externalProgress?.snapshot();
      if (progress
        && externalProgress
        && completionTracker?.needsToolBatchObservation(progress.lastToolBatchRevision)) {
        const boundaryText = await this.currentSubmissionAnswerText(page, baseline, signal);
        completionTracker.observeToolBatch(progress.lastToolBatchRevision, boundaryText);
        await externalProgress.acknowledgeToolBatch(progress.lastToolBatchRevision);
      }
      if (progress && progress.lastToolBatchRevision > initialToolBatchRevision) return "mcp_tool_call";
      await throwIfChatGptSessionFailureAlert(page);
      await throwIfChatGptRateLimitDialog(page);
      // Until the new response is bound, last() can still be a historical failed answer.
      // Response errors are checked against the bound current turn in the observation loops.
      let evidence: ChatGptSubmissionEvidence | undefined;
      if (externalProgress) {
        const progressWaitAbort = new AbortController();
        const progressSignal = signal
          ? AbortSignal.any([progressWaitAbort.signal, signal])
          : progressWaitAbort.signal;
        try {
          const observed = await withBrowserTurnAbort(Promise.race([
            this.currentSubmissionEvidence(page, baseline, signal).then(value => ({ kind: "dom" as const, value })),
            externalProgress.waitForChange(progress?.revision ?? 0, progressSignal)
              .then(() => ({ kind: "external" as const })),
          ]), signal);
          if (observed.kind === "external") continue;
          evidence = observed.value;
        } finally {
          progressWaitAbort.abort();
        }
      } else {
        evidence = await this.currentSubmissionEvidence(page, baseline, signal);
      }
      if (evidence) return evidence;
      // A tool approval can appear after acceptance. Only report a blocking dialog
      // when neither the DOM nor the native tool broker has accepted this submission.
      await throwIfChatGptSubmissionDialog(page);
      await this.waitForTurnDomOrExternalProgress(
        page,
        progress?.revision ?? 0,
        externalProgress,
        signal,
      );
    }
  }

  private submissionDomState(page: Page, cache?: ChatGptSubmissionDomCache, signal?: AbortSignal): Promise<ChatGptSubmissionDomState> {
    return submissionDomState(page, cache, signal);
  }

  private async currentSubmissionEvidence(
    page: Page,
    baseline: ChatGptSubmissionBaseline,
    signal?: AbortSignal,
  ): Promise<ChatGptSubmissionEvidence | undefined> {
    const state = await this.submissionDomState(page, baseline.domCache, signal);
    baseline.initialTurnIdentities = chatGptStagedBaselineIdentities(baseline.initialTurnIdentities, baseline.acknowledgedStages, state.acknowledgementTurns);
    return chatGptSubmissionEvidence({
      initialTurnIdentities: baseline.initialTurnIdentities,
      userIdentities: state.userIdentities,
      responseIdentities: state.responseIdentities,
      // A pre-existing Stop control belongs to earlier work, not this send.
      generationRunning: state.visibleStopButtonCount > 0 && !baseline.initialGenerationRunning,
    });
  }

  private async currentSubmissionAnswerText(
    page: Page,
    baseline: ChatGptSubmissionBaseline,
    signal?: AbortSignal,
  ): Promise<string> {
    const state = await this.submissionDomState(page, baseline.domCache, signal);
    baseline.initialTurnIdentities = chatGptStagedBaselineIdentities(baseline.initialTurnIdentities, baseline.acknowledgedStages, state.acknowledgementTurns);
    const identity = chatGptNewTurnIdentity(
      baseline.initialTurnIdentities,
      state.responseIdentities,
    );
    if (!identity) return "";
    const locator = page.locator(`[data-turn-id=${JSON.stringify(identity)}]`);
    return (await this.responseDomSnapshot(locator, {}, signal)).visibleText;
  }

  private async captureSubmissionBaseline(page: Page, abortSignal?: AbortSignal): Promise<ChatGptSubmissionBaseline> {
    const userTurns = page.locator(CHATGPT_USER_TURN_SELECTOR);
    const responseTurns = page.locator(CHATGPT_ASSISTANT_TURN_SELECTOR);
    const domCache: ChatGptSubmissionDomCache = {};
    const state = await this.submissionDomState(page, domCache, abortSignal);
    return {
      userTurns,
      responseTurns,
      initialTurnIdentities: state.turnIdentities,
      initialGenerationRunning: state.visibleStopButtonCount > 0,
      domCache,
    };
  }

  private async waitForNewAssistantTurn(
    page: Page,
    baseline: ChatGptSubmissionBaseline,
    deadline: number | undefined,
    signal?: AbortSignal,
    externalProgress?: ChatGptTurnProgressReader,
    graceMs: number = CHATGPT_RESPONSE_DOM_GRACE_MS,
    completionTracker?: ChatGptCompletionTracker,
    recoverObservation?: ChatGptObservationRecovery,
    recoverableObservation?: ChatGptObservationRecoverability,
  ): Promise<ChatGptAssistantTurnBinding> {
    let observationPage = page;
    let observationBaseline = baseline;
    let recoveryAttempts = 0;
    let liveProbeWaits = 0;
    const acceptedObservationStartedAt = Date.now();
    let responseDeadline = Math.min(
      deadline ?? Number.POSITIVE_INFINITY,
      Date.now() + graceMs,
    );
    for (;;) {
      if (signal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
      if (observationPage.isClosed()) {
        const error = chatGptBrowserTabClosedError();
        if (!recoverObservation || !recoverableObservation?.(error)) throw error;
        recoveryAttempts += 1;
        if (recoveryAttempts > MAX_CHATGPT_BROWSER_PAGE_REBINDS) {
          throw new Error("ChatGPT browser transport remained disconnected after exact-surface recovery", { cause: error });
        }
        const recovered = await recoverObservation(recoveryAttempts, error, observationBaseline, signal);
        observationPage = recovered.page;
        observationBaseline = recovered.baseline;
        continue;
      }
      let progress = externalProgress?.snapshot();
      if (progress?.lastProgressAt !== undefined) {
        responseDeadline = Math.min(
          deadline ?? Number.POSITIVE_INFINITY,
          Math.max(responseDeadline, progress.lastProgressAt + graceMs),
        );
      }
      if (deadline !== undefined && Date.now() >= deadline) {
        throw new Error("ChatGPT web turn timed out");
      }
      await throwIfChatGptSessionFailureAlert(observationPage);
      await throwIfChatGptRateLimitDialog(observationPage);
      let state: ChatGptSubmissionDomState;
      try {
        state = await this.submissionDomState(
          observationPage,
          observationBaseline.domCache,
          signal,
        );
      } catch (error) {
        const latestProgress = externalProgress?.snapshot();
        if (error instanceof ChatGptBrowserObservationTimeoutError
          && (Date.now() - acceptedObservationStartedAt < graceMs
            || chatGptExternalProgressSuppressesDomHealth(latestProgress, Date.now()))) {
          await this.waitForLiveProbeRetry(externalProgress, liveProbeWaits++, signal);
          continue;
        }
        if ((error instanceof ChatGptBrowserObservationTimeoutError || recoverableObservation?.(error))
          && recoverObservation) {
          recoveryAttempts += 1;
          if (recoveryAttempts > MAX_CHATGPT_BROWSER_PAGE_REBINDS) {
            throw new Error(
              `ChatGPT accepted the message, but its DOM remained unresponsive after ${MAX_CHATGPT_BROWSER_PAGE_REBINDS} same-page rebinds`,
              { cause: error },
            );
          }
          const recovered = await recoverObservation(
            recoveryAttempts,
            error instanceof Error ? error : new Error(String(error)),
            observationBaseline,
            signal,
          );
          observationPage = recovered.page;
          observationBaseline = recovered.baseline;
          continue;
        }
        if (!chatGptExternalProgressIsLive(latestProgress, Date.now(), graceMs)) throw error;
        await this.waitForTurnDomOrExternalProgress(
          observationPage,
          latestProgress?.revision ?? 0,
          externalProgress,
          signal,
        );
        continue;
      }
      recoveryAttempts = 0;
      liveProbeWaits = 0;
      observationBaseline.initialTurnIdentities = chatGptStagedBaselineIdentities(observationBaseline.initialTurnIdentities, observationBaseline.acknowledgedStages, state.acknowledgementTurns);
      // A tool batch can arrive while the DOM probe is in flight. Read progress again before
      // acknowledging its boundary; the pre-probe snapshot can otherwise leave the broker waiting
      // despite this exact iteration having successfully observed the page.
      progress = externalProgress?.snapshot();
      const identity = chatGptNewTurnIdentity(
        observationBaseline.initialTurnIdentities,
        state.responseIdentities,
      );
      if (progress
        && externalProgress
        && completionTracker?.needsToolBatchObservation(progress.lastToolBatchRevision)) {
        const boundaryText = identity
          ? (await this.responseDomSnapshot(
            observationPage.locator(`[data-turn-id=${JSON.stringify(identity)}]`),
            {},
            signal,
          )).visibleText
          : "";
        completionTracker.observeToolBatch(progress.lastToolBatchRevision, boundaryText);
        await externalProgress.acknowledgeToolBatch(progress.lastToolBatchRevision);
      }
      if (identity) return {
        identity,
        locator: observationPage.locator(`[data-turn-id=${JSON.stringify(identity)}]`),
        acceptedTurnIdentities: state.turnIdentities,
      };
      // A delayed renderer wake can cross the grace while the assistant appears. Only a fresh
      // observation can prove it is still missing; the explicit turn deadline remains above.
      if (Date.now() >= responseDeadline
        && !chatGptExternalProgressSuppressesDomHealth(progress, Date.now())) {
        throw new Error("ChatGPT accepted the message but did not expose its assistant turn in the DOM");
      }
      await this.waitForTurnDomOrExternalProgress(
        observationPage,
        progress?.revision ?? 0,
        externalProgress,
        signal,
      );
    }
  }

  private async reconcileAssistantTurnBinding(
    page: Page,
    baseline: ChatGptSubmissionBaseline,
    binding: ChatGptAssistantTurnBinding,
    signal?: AbortSignal,
    allowMcpContinuationUserTurn = false,
  ): Promise<ChatGptAssistantTurnBinding> {
    const boundCount = await withChatGptBrowserObservationTimeout(
      withBrowserTurnAbort(binding.locator.count(), signal),
    );
    if (boundCount === 1) return binding;
    if (boundCount > 1) {
      throw new Error(`ChatGPT exposed ${boundCount} DOM nodes for the bound assistant turn`);
    }
    const state = await this.submissionDomState(page, baseline.domCache, signal);
    baseline.initialTurnIdentities = chatGptStagedBaselineIdentities(baseline.initialTurnIdentities, baseline.acknowledgedStages, state.acknowledgementTurns);
    const acceptedTurns = new Set(binding.acceptedTurnIdentities);
    const hasNewUserTurn = state.userIdentities.some(identity => !acceptedTurns.has(identity));
    if (hasNewUserTurn && !allowMcpContinuationUserTurn) {
      throw new Error("ChatGPT opened another user turn while the bound assistant response was detached");
    }
    const acceptedTurnIdentities = hasNewUserTurn ? state.turnIdentities : binding.acceptedTurnIdentities;
    const identity = chatGptReboundTurnIdentity(
      baseline.initialTurnIdentities,
      binding.identity,
      state.responseIdentities,
    );
    if (!identity || identity === binding.identity) {
      return acceptedTurnIdentities === binding.acceptedTurnIdentities
        ? binding : { ...binding, acceptedTurnIdentities };
    }
    return {
      identity,
      locator: page.locator(`[data-turn-id=${JSON.stringify(identity)}]`),
      acceptedTurnIdentities,
    };
  }

  private async attachedPromptText(page: Page, abortSignal?: AbortSignal): Promise<string> {
    const composer = await this.activeComposer(page, 30_000, abortSignal);
    return composer.evaluate(element => {
      const clone = element.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(
        '[data-id^="plugin:"][data-keyword], [data-inline-selection-pill-cursor-target]',
      )
        .forEach(part => part.remove());
      return [...clone.childNodes]
        .map(child => child.textContent ?? "")
        .join("\n")
        .trimStart();
    }, undefined, { timeout: 20_000, signal: abortSignal });
  }

  private async assertPromptAttached(
    page: Page,
    prompt: string,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const deadline = Date.now() + 10_000;
    let observed = "";
    while (Date.now() < deadline) {
      throwIfPromptAttachmentAborted(abortSignal);
      observed = await this.attachedPromptText(page, abortSignal);
      throwIfPromptAttachmentAborted(abortSignal);
      if (this.promptTextEquivalent(prompt, observed)) return;
      await withBrowserTurnAbort(
        new Promise(resolveSleep => setTimeout(resolveSleep, 50)),
        abortSignal,
      );
    }
    throwIfPromptAttachmentAborted(abortSignal);
    const commonPrefix = this.promptEquivalentPrefixLength(prompt, observed);
    throw new ChatGptPromptAttachmentIntegrityError(
      `ChatGPT composer did not preserve the complete prompt (expectedChars=${prompt.length}, actualChars=${observed.length}, commonPrefixChars=${commonPrefix}, expectedUnit=${prompt.charCodeAt(commonPrefix)}, actualUnit=${observed.charCodeAt(commonPrefix)})`,
    );
  }

  private selectedConnectorControl(composer: Locator): Locator {
    return composer
      .locator('[data-id^="plugin:"][data-keyword]')
      .filter({ hasText: this.config.appName, visible: true });
  }

  private async connectorIsSelected(composer: Locator, abortSignal?: AbortSignal): Promise<boolean> {
    const selected = this.selectedConnectorControl(composer);
    const keywords = await withBrowserTurnAbort(
      withChatGptBrowserObservationTimeout(selected.evaluateAll(elements => (
        elements.map(element => element.getAttribute("data-keyword"))
      ))),
      abortSignal,
    );
    const exactMatches = keywords.filter(keyword => keyword === this.config.appName).length;
    if (exactMatches > 1) {
      throw new Error(`ChatGPT composer exposed duplicate ${JSON.stringify(this.config.appName)} connector selections`);
    }
    return exactMatches === 1;
  }

  private async connectorMentionRowTitles(
    menuRows: Locator,
    abortSignal?: AbortSignal,
  ): Promise<string[]> {
    let texts: string[];
    try {
      texts = await withBrowserTurnAbort(
        withChatGptBrowserObservationTimeout(menuRows.allInnerTexts()),
        abortSignal,
      );
    } catch (error) {
      if (abortSignal?.aborted) throw error;
      throw new Error("ChatGPT connector mention popup DOM title observation failed", { cause: error });
    }
    return texts
      .map(text => (text.split("\n")[0] ?? "").replace(/\s+/g, " ").trim())
      .filter(title => title.length > 0);
  }

  private async connectorMentionFailure(
    menuRows: Locator,
    triggerAttempts: number,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const titles = await this.connectorMentionRowTitles(menuRows, abortSignal);
    if (titles.length === 0) {
      return `ChatGPT connector menu did not open after ${triggerAttempts} complete mention trigger attempt(s)`;
    }
    const legacyName = this.legacyConnectorInMenu(titles);
    if (legacyName) return legacyChatGptConnectorMigrationMessage(legacyName);
    if (this.config.appName === CHATGPT_CONNECTOR_NAME && titles.includes(DEV_CHATGPT_CONNECTOR_NAME)) {
      return `ChatGPT exposes the isolated DEV connector ${JSON.stringify(DEV_CHATGPT_CONNECTOR_NAME)},`
        + ` but production requires a separate connector named ${JSON.stringify(CHATGPT_CONNECTOR_NAME)};`
        + ` create ${JSON.stringify(CHATGPT_CONNECTOR_NAME)} against the production tunnel and leave the DEV connector unchanged`;
    }
    return `ChatGPT connector menu opened but exposed no row named ${JSON.stringify(this.config.appName)}`
      + ` after ${triggerAttempts} complete mention trigger attempt(s)`
      + `; verify that the existing connector is enabled and available in this account and chat, refresh the catalog, and retry. A missing menu row does not establish that it is uninstalled`;
  }

  private legacyConnectorInMenu(titles: readonly string[]): string | undefined {
    return LEGACY_CHATGPT_CONNECTOR_NAMES.find(name => (
      titles.includes(name) && currentChatGptConnectorName(name) === this.config.appName
    ));
  }

  private clearChatGptComposerState(page: Page): Promise<void> {
    return clearChatGptPersonalizationComposer(page, {
      activeComposer: (timeout, signal) => this.activeComposer(page, timeout, signal),
      connectorIsSelected: (composer, signal) => this.connectorIsSelected(composer, signal),
    });
  }

  private async selectConnector(
    page: Page,
    captureDiagnostic?: (checkpoint: string) => Promise<void>,
    catalogRefreshAvailable = false,
    attemptBudget: ChatGptConnectorAttemptBudget = { triggerAttempts: 0 },
    abortSignal?: AbortSignal,
  ): Promise<Locator> {
    const capture = async (checkpoint: string): Promise<void> => {
      throwIfPromptAttachmentAborted(abortSignal);
      await withBrowserTurnAbort(captureDiagnostic?.(checkpoint) ?? Promise.resolve(), abortSignal);
      throwIfPromptAttachmentAborted(abortSignal);
    };
    let composer: Locator;
    // The same menu-item class also appears in sidebar history. The nearby Think
    // slash path observes ChatGPT's visible .popover; never use a page-wide row
    // as evidence of the mention popup.
    const popup = page.locator('.popover').filter({ visible: true });
    const menuRows = popup.locator('.__menu-item[tabindex="0"]').filter({ visible: true });
    const appResult = menuRows.filter({
      has: page.getByText(this.config.appName, { exact: true }),
    });
    const popupCount = async (signal?: AbortSignal): Promise<number> => {
      const count = await withBrowserTurnAbort(
        withChatGptBrowserObservationTimeout(popup.count()),
        signal,
      );
      if (count > 1) {
        throw new Error(`ChatGPT connector mention popup observation is ambiguous (${count} visible popovers)`);
      }
      return count;
    };
    const assertMentionAttached = async (editor: Locator, signal?: AbortSignal): Promise<void> => {
      const mention = await withBrowserTurnAbort(editor.evaluate(element => ({
        text: element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
          ? element.value : element.textContent ?? "",
        focused: element === document.activeElement,
      }), undefined, { timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS, signal }), signal);
      if (mention.text !== CHATGPT_CONNECTOR_MENTION_QUERY) {
        throw new ChatGptPromptAttachmentIntegrityError(
          `ChatGPT did not preserve the connector mention (expectedChars=${CHATGPT_CONNECTOR_MENTION_QUERY.length}, actualChars=${mention.text.length}, focused=${mention.focused})`,
        );
      }
    };
    const assertNoPriorPopup = async (signal?: AbortSignal): Promise<void> => {
      if (await popupCount(signal) !== 0) {
        throw new Error("ChatGPT connector mention popup was already visible before its trigger");
      }
    };
    await ensureChatGptPersonalizedConnectorAccess(
      page,
      capture,
      async (personalizationSignal) => {
        let proofResult: boolean | undefined;
        let proofError: unknown;
        try {
          composer = await this.activeComposer(page, 30_000, personalizationSignal);
          await composer.fill("", {
            signal: personalizationSignal,
            timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS,
          });
          await composer.focus({
            signal: personalizationSignal,
            timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS,
          });
          await withBrowserTurnAbort(settleChatGptUi(), personalizationSignal);
          await assertNoPriorPopup(personalizationSignal);
          await composer.pressSequentially(CHATGPT_CONNECTOR_MENTION_QUERY, {
            delay: 25,
            signal: personalizationSignal,
            timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS,
          });
          await capture("personalization-proof-mention-triggered");
          try {
            await appResult.waitFor({ state: "visible", timeout: 2_500, signal: personalizationSignal });
          } catch (error) {
            if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
            proofResult = false;
            await capture("personalization-proof-menu-missing");
          }
          await assertMentionAttached(composer, personalizationSignal);
          if (proofResult !== false) {
            if (await popupCount(personalizationSignal) !== 1) {
              throw new Error("ChatGPT connector mention row lost its visible popup during personalization proof");
            }
            proofResult = true;
            await capture("personalization-proof-menu-visible");
          }
        } catch (error) {
          proofError = error;
        }
        try {
          await this.clearChatGptComposerState(page);
        } catch (cleanupError) {
          throw new ChatGptPersistentBrowserStateError(
            proofError !== undefined ? [proofError, cleanupError] : [cleanupError],
            "ChatGPT connector proof did not leave a verified empty composer",
          );
        }
        if (proofError !== undefined) throw proofError;
        return proofResult === true;
      },
      abortSignal,
    );
    try {
      composer = await this.activeComposer(page, 30_000, abortSignal);
      if (await this.connectorIsSelected(composer, abortSignal)) {
        await capture("connector-already-selected");
        return composer;
      }
      await composer.fill("", { signal: abortSignal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS });

      let firstMenuCaptured = false;
      while (attemptBudget.triggerAttempts < MAX_CHATGPT_CONNECTOR_TRIGGER_ATTEMPTS) {
        attemptBudget.triggerAttempts += 1;
        composer = await this.activeComposer(page, 30_000, abortSignal);
        await composer.fill("", { signal: abortSignal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS });
        await composer.focus({ signal: abortSignal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS });
        await withBrowserTurnAbort(settleChatGptUi(), abortSignal);
        await assertNoPriorPopup(abortSignal);
        await composer.pressSequentially(CHATGPT_CONNECTOR_MENTION_QUERY, {
          delay: 25,
          signal: abortSignal,
          timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS,
        });
        if (!firstMenuCaptured) {
          firstMenuCaptured = true;
          await capture("connector-mention-triggered");
        }
        await assertMentionAttached(composer, abortSignal);
        let exactRowVisible = false;
        try {
          await appResult.waitFor({
            state: "visible",
            timeout: 2_500,
            signal: abortSignal,
          });
          exactRowVisible = true;
        } catch (error) {
          if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
          await popupCount(abortSignal);
          const visibleRows = await this.connectorMentionRowTitles(menuRows, abortSignal);
          const knownIdentityMismatch = this.legacyConnectorInMenu(visibleRows) !== undefined
            || (this.config.appName === CHATGPT_CONNECTOR_NAME
              && visibleRows.includes(DEV_CHATGPT_CONNECTOR_NAME));
          if (knownIdentityMismatch) {
            await capture("connector-menu-missing");
            throw chatGptConnectorUnavailableError(
              await this.connectorMentionFailure(menuRows, attemptBudget.triggerAttempts, abortSignal),
            );
          }
          if (
            catalogRefreshAvailable
            && visibleRows.length > 0
            && !visibleRows.includes(this.config.appName)
            && attemptBudget.triggerAttempts < MAX_CHATGPT_CONNECTOR_TRIGGER_ATTEMPTS
          ) {
            throw new ChatGptConnectorCatalogStaleError(
              this.config.appName,
              attemptBudget.triggerAttempts,
            );
          }
          if (attemptBudget.triggerAttempts >= MAX_CHATGPT_CONNECTOR_TRIGGER_ATTEMPTS) {
            await capture("connector-menu-missing");
            throw chatGptConnectorUnavailableError(
              await this.connectorMentionFailure(menuRows, attemptBudget.triggerAttempts, abortSignal),
            );
          }
          // A missing exact row can leave ChatGPT's mention popup open. Clear the
          // complete composer state before the next trigger so a stale popup
          // cannot make the next attempt fail at assertNoPriorPopup(). The
          // cleanup also proves that no connector pill survived the failed
          // attempt; exact-row, highlight, and selected-pill guards remain the
          // only success gates.
          await this.clearChatGptComposerState(page);
        }
        if (exactRowVisible) {
          if (await popupCount(abortSignal) !== 1) {
            throw new Error("ChatGPT connector mention row lost its visible popup before selection");
          }
          await capture("connector-menu-visible");
          break;
        }
      }
      if (await popupCount(abortSignal) !== 1) {
        throw chatGptConnectorUnavailableError("ChatGPT connector mention popup was not visible for exact-row selection");
      }
      const exactResultCount = await withBrowserTurnAbort(
        withChatGptBrowserObservationTimeout(appResult.count()),
        abortSignal,
      );
      if (exactResultCount !== 1) {
        throw chatGptConnectorUnavailableError(
          `ChatGPT connector menu did not expose one exact ${JSON.stringify(this.config.appName)} row`
          + ` after ${attemptBudget.triggerAttempts} complete mention trigger attempt(s)`,
        );
      }
      // Hidden launcher maintenance keeps a 1x1 Chromium viewport, so pointer activation cannot
      // reach this menu. Require the exact row to own ChatGPT's keyboard highlight first;
      // otherwise move the menu highlight until it does. Keep
      // focus on the composer, activate through the menu's real keyboard owner, then prove the exact
      // selected connector pill below.
      const rowHighlighted = async () => await appResult.getAttribute("data-highlighted", {
        signal: abortSignal,
        timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS,
      }) !== null;
      if (!await rowHighlighted()) {
        const visibleRowCount = await withBrowserTurnAbort(
          withChatGptBrowserObservationTimeout(menuRows.count()),
          abortSignal,
        );
        for (let step = 0; step < visibleRowCount && !await rowHighlighted(); step += 1) {
          await composer.press("ArrowDown", {
            signal: abortSignal,
            timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS,
          });
        }
      }
      if (!await rowHighlighted()) {
        throw new Error(`ChatGPT connector menu could not highlight ${JSON.stringify(this.config.appName)}`);
      }
      await composer.press("Enter", {
        signal: abortSignal,
        timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS,
      });
      await capture("connector-choice-activated");
      // Selecting a connector replaces the Lexical composer subtree. Resolve the active composer
      // again instead of returning the pre-selection locator, otherwise the real turn can focus a
      // detached/hidden editor even though verification just succeeded.
      const selectedComposer = await this.activeComposer(page, 30_000, abortSignal);
      const selectedConnector = this.selectedConnectorControl(selectedComposer);
      await selectedConnector.waitFor({
        state: "visible",
        timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS,
        signal: abortSignal,
      });
      if (!await this.connectorIsSelected(selectedComposer, abortSignal)) {
        throw new Error(`ChatGPT composer did not select ${JSON.stringify(this.config.appName)} connector`);
      }
      await capture("connector-selected");
      return selectedComposer;
    } catch (error) {
      try {
        await this.clearChatGptComposerState(page);
      } catch (cleanupError) {
        throw new ChatGptPersistentBrowserStateError(
          [error, cleanupError],
          "ChatGPT connector selection failed and its composer state could not be cleared",
        );
      }
      throw error;
    }
  }

  private async attachPrompt(
    page: Page,
    prompt: string,
    localTools: boolean,
    captureDiagnostic?: (checkpoint: string) => Promise<void>,
    abortSignal?: AbortSignal,
    catalogRefreshAvailable = false,
    connectorAttemptBudget?: ChatGptConnectorAttemptBudget,
    reuseConnector = false,
    requireThink = false,
  ): Promise<void> {
    throwIfPromptAttachmentAborted(abortSignal);
    const connectorMode = chatGptConnectorAttachmentMode(localTools, reuseConnector);
    let composerMutationStarted = false;
    try {
      if (connectorMode !== "mention") {
        const composer = await this.activeComposer(page, 30_000, abortSignal);
        // Playwright's multiline fill maps through an input action that ChatGPT's Lexical editor can
        // collapse to the first paragraph on the launcher-owned Electron surface. Clear separately,
        // then transport the complete text through the browser's plain-text editing command.
        composerMutationStarted = true;
        await composer.fill("", { signal: abortSignal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS });
        await composer.focus({ signal: abortSignal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS });
        if (requireThink) {
          await this.modelSelectionController().setThinkMode(composer.locator("xpath=ancestor::form[1]"), true, captureDiagnostic, abortSignal);
        }
        await this.insertPromptText(page, prompt, abortSignal);
        await this.assertPromptAttached(page, prompt, abortSignal);
        return;
      }
      const selectedComposer = await this.selectConnector(
        page,
        captureDiagnostic,
        catalogRefreshAvailable,
        connectorAttemptBudget,
        abortSignal,
      );
      // selectConnector owns and rolls back every mutation until it returns. From this point the
      // attachment owns the selected pill and prompt text as one transaction.
      composerMutationStarted = true;
      if (requireThink) {
        await this.modelSelectionController().setThinkMode(selectedComposer.locator("xpath=ancestor::form[1]"), true, captureDiagnostic, abortSignal);
      }
      await selectedComposer.focus({ signal: abortSignal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS });
      await selectedComposer.press(CHATGPT_COMPOSER_DOCUMENT_END_KEY, {
        signal: abortSignal,
        timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS,
      });
      await this.insertPromptText(page, ` ${prompt}`, abortSignal);
      await this.assertPromptAttached(page, prompt, abortSignal);
    } catch (error) {
      if (!composerMutationStarted || error instanceof ChatGptPersistentBrowserStateError) throw error;
      try {
        await this.clearChatGptComposerState(page);
      } catch (cleanupError) {
        throw new ChatGptPersistentBrowserStateError(
          [error, cleanupError],
          "ChatGPT prompt attachment failed and its composer state could not be cleared",
        );
      }
      throw error;
    }
  }

  private async waitForSubmissionAcceptedWithRecovery(
    page: Page,
    baseline: ChatGptSubmissionBaseline,
    abortSignal?: AbortSignal,
    externalProgress?: ChatGptTurnProgressReader,
    initialToolBatchRevision = externalProgress?.snapshot().lastToolBatchRevision ?? 0,
    completionTracker?: ChatGptCompletionTracker,
    recoverObservation?: ChatGptObservationRecovery,
    recoverableObservation?: ChatGptObservationRecoverability,
  ): Promise<ChatGptSubmissionEvidence> {
    let observationPage = page;
    let observationBaseline = baseline;
    let recoveryAttempts = 0;
    for (;;) {
      try {
        const evidence = await this.waitForSubmissionAccepted(
          observationPage,
          observationBaseline,
          abortSignal,
          externalProgress,
          initialToolBatchRevision,
          completionTracker,
        );
        return evidence;
      } catch (error) {
        if (!(error instanceof ChatGptBrowserObservationTimeoutError)
          && !recoverableObservation?.(error)) throw error;
        if (!recoverObservation) throw error;
        recoveryAttempts += 1;
        if (recoveryAttempts > MAX_CHATGPT_BROWSER_PAGE_REBINDS) {
          throw new Error(
            `ChatGPT submission DOM remained unresponsive after ${MAX_CHATGPT_BROWSER_PAGE_REBINDS} same-page rebinds`,
            { cause: error },
          );
        }
        const recovered = await recoverObservation(
          recoveryAttempts,
          error instanceof Error ? error : new Error(String(error)),
          observationBaseline,
          abortSignal,
        );
        observationPage = recovered.page;
        observationBaseline = recovered.baseline;
      }
    }
  }

  private async sendAttachedPrompt(
    page: Page,
    baseline: ChatGptSubmissionBaseline,
    captureDiagnostic?: (checkpoint: string) => Promise<void>,
    abortSignal?: AbortSignal,
    externalProgress?: ChatGptTurnProgressReader,
    submissionLifecycle?: Pick<BrowserTurn, "onSendActivated" | "onSubmitted">,
    completionTracker?: ChatGptCompletionTracker,
    recoverObservation?: ChatGptObservationRecovery,
    recoverableObservation?: ChatGptObservationRecoverability,
    expectedMode?: Pick<ChatGptWebModelMode, "modelVersion" | "effort" | "uiEffortIndex" | "thinkEnabled">,
    submissionRejection?: ChatGptSubmissionRejectionObserver,
  ): Promise<ChatGptSubmissionEvidence> {
    const composer = await this.activeComposer(page);
    const sendButton = composer
      .locator("xpath=ancestor::form[1]")
      .getByTestId("send-button");
    await sendButton.waitFor({ state: "visible", timeout: browserStageTimeouts.send });
    await settleChatGptUi();
    const sendEnableDeadline = Date.now() + CHATGPT_SEND_ENABLE_GRACE_MS;
    for (;;) {
      if (abortSignal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
      if (page.isClosed()) throw chatGptBrowserTabClosedError();
      await throwIfChatGptSessionFailureAlert(page);
      await throwIfChatGptRateLimitDialog(page);
      if (await sendButton.isEnabled()) break;
      if (Date.now() >= sendEnableDeadline) {
        await captureDiagnostic?.("send-disabled");
        throw new Error("ChatGPT send button remained disabled after the complete prompt was attached");
      }
      await settleChatGptUi();
    }
    await throwIfChatGptSubmissionDialog(page);
    await captureDiagnostic?.("send-ready");
    if (expectedMode) await ChatGptBrowserWorker.prototype.modelSelectionController.call(this).verifyBeforeSend(page, composer, expectedMode, abortSignal);
    throwIfPromptAttachmentAborted(abortSignal);
    await submissionLifecycle?.onSendActivated?.();
    // Persistence/IPC can yield long enough for the owning turn to be cancelled.
    // Keep its no-replay fence, but never activate a cancelled send.
    throwIfPromptAttachmentAborted(abortSignal);
    // Activity preceding Enter cannot have been caused by this submission.
    const initialToolBatchRevision = externalProgress?.snapshot().lastToolBatchRevision ?? 0;
    submissionRejection?.begin(page);
    await sendButton.press("Enter", {
      noWaitAfter: true,
      signal: abortSignal,
      // runStage owns the operation budget. A second Locator timeout would silently collapse the
      // 180-second Bigger Context budget back to the ordinary 20 seconds after Enter has already
      // submitted the message; semantic submission evidence below remains the authority.
      timeout: 0,
    });
    const evidence = await this.waitForSubmissionAcceptedWithRecovery(
      page,
      baseline,
      abortSignal,
      externalProgress,
      initialToolBatchRevision,
      completionTracker,
      recoverObservation,
      recoverableObservation,
    );
    // Observation may settle concurrently with cancellation; late evidence cannot revive the turn.
    throwIfPromptAttachmentAborted(abortSignal);
    await submissionLifecycle?.onSubmitted?.();
    return evidence;
  }

  private async waitForMultipartAcknowledgement(
    page: Page,
    initialResponseTurn: ChatGptAssistantTurnBinding,
    submissionBaseline: ChatGptSubmissionBaseline,
    stage: ChatGptWebMultipartStage,
    deadline: number | undefined,
    abortSignal?: AbortSignal,
    externalProgress?: ChatGptTurnProgressReader,
    completionTracker = new ChatGptCompletionTracker(),
  ): Promise<void> {
    // A staged message may briefly create an assistant shell and then replace it while ChatGPT
    // ingests the attached context. The ordinary 60-second missing-response verdict would cut the
    // dedicated multipart acknowledgement budget back down after that transient shell appears.
    // Keep DOM absence bounded by the same per-stage budget that owns this protocol step.
    const domHealthTracker = new ChatGptTurnDomHealthTracker(
      CHATGPT_MULTIPART_RESPONSE_DOM_GRACE_MS,
    );
    const responseDomCache: ChatGptResponseDomCache = {};
    let responseTurn = initialResponseTurn;
    for (;;) {
      if (page.isClosed()) throw chatGptBrowserTabClosedError();
      if (abortSignal?.aborted) {
        const stop = page.locator(CHATGPT_STOP_BUTTON_SELECTOR).last();
        if (await stop.isVisible().catch(() => false)) await stop.press("Enter").catch(() => {});
        throw new DOMException("ChatGPT multipart stage aborted", "AbortError");
      }
      if (deadline !== undefined && Date.now() >= deadline) {
        throw new Error("ChatGPT Bigger Context transaction timed out while awaiting a stage acknowledgement");
      }
      await throwIfChatGptSessionFailureAlert(page);
      await throwIfChatGptTerminalErrorAlert(responseTurn.locator);
      let snapshot = await this.responseDomSnapshot(responseTurn.locator, responseDomCache, abortSignal);
      if (!snapshot.responsePresent && await responseTurn.locator.count() !== 1) {
        const rebound = await this.reconcileAssistantTurnBinding(
          page,
          submissionBaseline,
          responseTurn,
          abortSignal,
        );
        if (rebound.identity !== responseTurn.identity) {
          responseTurn = rebound;
          responseDomCache.key = undefined;
          responseDomCache.snapshot = undefined;
          snapshot = await this.responseDomSnapshot(responseTurn.locator, responseDomCache, abortSignal);
        }
      }
      if (snapshot.stoppedThinkingVisible) throw chatGptStoppedThinkingError();
      const externalProgressSnapshot = externalProgress?.snapshot();
      if (externalProgress
        && externalProgressSnapshot
        && completionTracker.needsToolBatchObservation(externalProgressSnapshot.lastToolBatchRevision)) {
        completionTracker.observeToolBatch(
          externalProgressSnapshot.lastToolBatchRevision,
          snapshot.visibleText,
        );
        await externalProgress.acknowledgeToolBatch(externalProgressSnapshot.lastToolBatchRevision);
      }
      const externalProgressLive = chatGptExternalProgressSuppressesDomHealth(
        externalProgressSnapshot,
        Date.now(),
      );
      const externalToolCallsInFlight = chatGptExternalToolCallsAreInFlight(externalProgressSnapshot);
      if (!snapshot.responsePresent && externalProgressLive) {
        // Proven MCP activity outranks a momentarily unavailable staging DOM, exactly as it does
        // in the main turn loop.
        domHealthTracker.suspendForLiveProgress();
        await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
        continue;
      }
      const running = await page.locator(CHATGPT_STOP_BUTTON_SELECTOR).last().isVisible().catch(() => false);
      const domError = domHealthTracker.update({
        responsePresent: snapshot.responsePresent,
        running,
        currentText: snapshot.visibleText,
        completionActionVisible: snapshot.completionActionVisible,
        externalProgressLive,
      });
      if (domError) throw new Error(domError);
      if (completionTracker.update({
        responsePresent: snapshot.responsePresent,
        running,
        currentText: snapshot.visibleText,
        currentHtml: snapshot.fullHtml,
        completionActionVisible: snapshot.completionActionVisible,
        externalToolCallsInFlight,
      })) {
        const actual = snapshot.visibleText.trim();
        if (actual !== stage.acknowledgement) {
          throw new ChatGptWebAdapterError(
            "ChatGPT did not confirm the Bigger Context handoff. Disable Bigger Context or retry the task.",
            {
              status: 502,
              errorType: "server_error",
              code: "multipart_protocol_violation",
              retryable: false,
              cause: new Error(
                `Bigger Context acknowledgement mismatch (actualChars=${actual.length.toLocaleString("en-US")})`,
              ),
            },
          );
        }
        return;
      }
      await new Promise(resolveSleep => setTimeout(resolveSleep, 100));
    }
  }

  private async resetCompactionComposerForRetry(
    page: Page,
    baseline: ChatGptSubmissionBaseline,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    throwIfPromptAttachmentAborted(abortSignal);
    const before = await this.currentSubmissionEvidence(page, baseline, abortSignal);
    if (before) {
      throw new ChatGptPromptAttachmentIntegrityError(
        "ChatGPT changed while the compaction prompt was being prepared. Check the ChatGPT tab before retrying.",
        new Error(`Submission evidence appeared after prompt attachment failed: ${before}`),
      );
    }

    const composer = await this.activeComposer(page, 30_000, abortSignal);
    await composer.fill("", { signal: abortSignal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS });
    await composer.focus({ signal: abortSignal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS });
    await withBrowserTurnAbort(settleChatGptUi(), abortSignal);
    throwIfPromptAttachmentAborted(abortSignal);

    const after = await this.currentSubmissionEvidence(page, baseline, abortSignal);
    if (after) {
      throw new ChatGptPromptAttachmentIntegrityError(
        "ChatGPT changed while the compaction prompt was being reset. Check the ChatGPT tab before retrying.",
        new Error(`Submission evidence appeared while resetting the prompt: ${after}`),
      );
    }
    const observed = await this.attachedPromptText(page, abortSignal);
    if (observed.length > 0) {
      throw new ChatGptPromptAttachmentIntegrityError(
        `ChatGPT composer could not reset cleanly for compaction retry (actualChars=${observed.length})`,
      );
    }
  }

  private async attachPromptWithCompactionRetry(
    page: Page,
    prompt: string,
    localTools: boolean,
    compaction: boolean,
    baseline: ChatGptSubmissionBaseline,
    captureDiagnostic?: (checkpoint: string) => Promise<void>,
    abortSignal?: AbortSignal,
    catalogRefreshAvailable = false,
    connectorAttemptBudget?: ChatGptConnectorAttemptBudget,
    reuseConnector = false,
    requireThink = false,
  ): Promise<void> {
    let retryAvailable = compaction;
    for (;;) {
      try {
        await this.attachPrompt(
          page,
          prompt,
          localTools,
          captureDiagnostic,
          abortSignal,
          catalogRefreshAvailable,
          connectorAttemptBudget,
          reuseConnector,
          requireThink,
        );
        return;
      } catch (error) {
        if (!retryAvailable || !(error instanceof ChatGptPromptAttachmentIntegrityError)) throw error;
        retryAvailable = false;
        const evidence = await this.currentSubmissionEvidence(page, baseline, abortSignal);
        if (evidence) {
          throw new ChatGptPromptAttachmentIntegrityError(
            "ChatGPT changed while the compaction prompt was being prepared. Check the ChatGPT tab before retrying.",
            new Error(`Prompt attachment failed before submission evidence appeared: ${evidence}`, { cause: error }),
          );
        }
        await captureDiagnostic?.("prompt-attachment-integrity-retry");
        await this.resetCompactionComposerForRetry(page, baseline, abortSignal);
      }
    }
  }

  private async attachMultipartStagePrompt(
    page: Page,
    prompt: string,
    captureDiagnostic?: (checkpoint: string) => Promise<void>,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    // A cooldown dialog can appear only after ChatGPT accepted the preceding part. Detect it before
    // editing the next composer so the account limit cannot be misreported as attachment corruption.
    await this.throwIfMultipartStageBlocked(page, abortSignal);
    await this.attachPrompt(page, prompt, false, captureDiagnostic, abortSignal);
  }

  private async throwIfMultipartStageBlocked(page: Page, abortSignal?: AbortSignal): Promise<void> {
    throwIfPromptAttachmentAborted(abortSignal);
    // Keep this owned observation settled before returning. Racing it against cancellation could
    // leave its dialog acknowledgement running against a page already released to another turn.
    await throwIfChatGptRateLimitDialog(page);
    throwIfPromptAttachmentAborted(abortSignal);
  }

  private async insertPromptText(page: Page, text: string, abortSignal?: AbortSignal): Promise<void> {
    throwIfPromptAttachmentAborted(abortSignal);
    const composer = await this.activeComposer(page, 30_000, abortSignal);
    await composer.focus({ signal: abortSignal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS });
    // CDP Input.insertText is interpreted as live typing by ChatGPT's Lexical plugins. On a large
    // JSON transport it can turn literal Markdown backticks into rich code nodes, remove the
    // delimiters from textContent, and leave the next insertion outside the intended block. The
    // browser's editing command updates the same focused contenteditable atomically.
    // Large multiline inputs use escaped text blocks, never source HTML.
    // Exact readback before submission remains the authority.
    const beforeInsertion = await composer.innerHTML({ timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS });
    let inserted = await composer.evaluate(insertPlainTextIntoComposer, text, {
      timeout: 20_000,
      signal: abortSignal,
    });
    throwIfPromptAttachmentAborted(abortSignal);
    if (!inserted) {
      // Effort selection can replace the editor between focus and insertion (#564).
      // Retry once only if no edit occurred. Partial edits must fail the integrity check,
      // never append the entire prompt a second time or retry an accepted submission.
      const current = await this.activeComposer(page, 5_000, abortSignal);
      if (await current.innerHTML({ timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS }) === beforeInsertion) {
        await current.focus({ signal: abortSignal, timeout: CHATGPT_CONNECTOR_ACTION_TIMEOUT_MS });
        inserted = await current.evaluate(insertPlainTextIntoComposer, text, {
          timeout: 20_000, signal: abortSignal,
        });
        throwIfPromptAttachmentAborted(abortSignal);
      }
    }
    if (!inserted) {
      throw new ChatGptPromptAttachmentIntegrityError(
        "ChatGPT composer rejected the plain-text editing command",
      );
    }
  }

  private async verifyConnectorExclusive(
    traceId = `verify_${randomUUID().replaceAll("-", "")}`,
  ): Promise<string> {
    const page = await this.ensurePage();
    const diagnostics = new ChatGptBrowserDiagnostics(
      traceId,
      this.config.browserDiagnosticsPath ?? join(getConfigDir(), "diagnostics", "browser-turns"),
      this.config.appName,
    );
    const captureDiagnostic = (checkpoint: string): Promise<void> => diagnostics.capture(page, checkpoint);
    try {
      await captureDiagnostic("connector-verification-started");
      await this.prepareTemporaryChatSurface(page, captureDiagnostic);
      // The launcher refreshes its owned ChatGPT document before starting this helper. A second
      // reload here can discard the first catalog's exact mismatch evidence and report a generic
      // menu failure instead of identifying the connector the account actually exposes.
      await this.selectConnector(page, captureDiagnostic);
      // Verification proves selection but does not submit a turn. Leaving the selected plugin in
      // ChatGPT's persisted composer draft makes the next hard refresh restore half-hydrated plugin
      // state; clearing it through native editor deletion keeps repeated verification transactional.
      await this.clearChatGptComposerState(page);
      await captureDiagnostic("connector-verification-cleared");
      await captureDiagnostic("connector-verification-succeeded");
      return this.config.appName;
    } catch (error) {
      await diagnostics.capture(page, "connector-verification-failed", error);
      throw error;
    } finally {
      diagnostics.dispose();
    }
  }

  private async inspectSessionExclusive(detectCapabilities: boolean): Promise<{
    authenticated: true;
    temporary: true;
    url: string;
    solAvailable?: boolean;
    extraHighAvailable?: boolean;
    proAvailable?: boolean;
  }> {
    const page = await this.ensurePage();
    await this.prepareTemporaryChatSurface(page);
    const url = page.url();
    if (!detectCapabilities) return { authenticated: true, temporary: true, url };
    const capabilities = await detectChatGptAccountCapabilities(page);
    return { authenticated: true, temporary: true, url, ...capabilities };
  }

  private async smokeTestExclusive(abortSignal?: AbortSignal): Promise<{ effort: string; response: string }> {
    const page = await this.ensurePage();
    await this.prepareTemporaryChatSurface(page);
    const account = await detectChatGptAccountCapabilities(page);
    // Core smoke runs before the optional MCP connector is configured, so it must remain a
    // browser-only transport check. Connector setup has its own explicit verification operation.
    const capabilities: ChatGptWebCapabilities = { ...account, localToolsEnabled: false };
    const modelId = account.solAvailable ? CHATGPT_WEB_MODEL_ID : CHATGPT_WEB_LUNA_MODEL_ID;
    const reasoning = account.solAvailable ? "high" : "low";
    const mode = resolveChatGptWebModelMode(modelId, reasoning, capabilities);
    const traceId = `smoke_${randomUUID().replaceAll("-", "")}`;
    const response = await this.runBrowserTurn({
      traceId,
      modelId,
      reasoning,
      capabilities,
      prepare: async () => ({ text: CHATGPT_SMOKE_TEXT, images: [], files: [], release: () => {} }),
      abortSignal,
      onTextDelta: () => {},
    }, undefined, page);
    if (response.trim() !== CHATGPT_SMOKE_EXPECTED) {
      throw new Error(
        `ChatGPT smoke test returned an unexpected answer (${JSON.stringify(response.trim().slice(0, 200))})`,
      );
    }
    return { effort: mode.displayLabel, response: CHATGPT_SMOKE_EXPECTED };
  }

  private async attachFiles(
    page: Page,
    prompt: CompiledChatGptWebPrompt,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const files = chatGptPromptFilePayloads(prompt);
    if (files.length === 0) return;
    const composer = await this.activeComposer(page, 30_000, abortSignal);
    const composerForm = composer.locator("xpath=ancestor::form[1]");
    const input = page.locator('input[data-testid="upload-photos-input"]');
    await withBrowserTurnAbort(input.waitFor({ state: "attached", timeout: 20_000 }), abortSignal);
    await withBrowserTurnAbort(input.setInputFiles(files), abortSignal);
    try {
      await withBrowserTurnAbort(Promise.all(files.map(file => (
        composerForm.getByRole("group", { name: file.name, exact: true })
          .waitFor({ state: "visible", timeout: 60_000 })
      ))), abortSignal);
    } catch (error) {
      if (abortSignal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
      const alerts = (await page.locator('[role="alert"]').allInnerTexts().catch(() => []))
        .map(text => text.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      throw new Error(
        `ChatGPT did not accept all prompt attachments`
        + (alerts.length > 0 ? `: ${alerts.join(" | ")}` : ""),
      );
    }
    const send = composerForm.getByTestId("send-button");
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (abortSignal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
      if (await send.isEnabled().catch(() => false)) return;
      await withBrowserTurnAbort(new Promise(resolveSleep => setTimeout(resolveSleep, 100)), abortSignal);
    }
    throw new Error("ChatGPT accepted the prompt attachments but did not make the message ready to send");
  }

  private responseDomSnapshot(responseTurn: Locator, cache?: ChatGptResponseDomCache, abortSignal?: AbortSignal): Promise<ChatGptResponseDomSnapshot> {
    return responseDomSnapshot(responseTurn, cache, abortSignal);
  }

  private stalledTurnDiagnostic(page: Page, responseTurn: Locator): Promise<string> {
    return stalledTurnDiagnostic(page, responseTurn);
  }

  private async runExclusive(turn: BrowserTurn): Promise<string> {
    if (turn.abortSignal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
    if (this.config.browserHost !== "launcher") return this.runBrowserTurn(turn);

    const lease = await notifyLauncherTurn(this.config.browserHostDescriptorPath!, {
      phase: "start",
      taskProgressVersion: 1,
      requestedModel: turn.requestedModel,
      requestedEffort: turn.modelId === CHATGPT_WEB_LUNA_MODEL_ID ? "luna" : resolveChatGptWebModelMode(turn.modelId, turn.reasoning, turn.capabilities).effort,
      ...(turn.accountRoutingKey ? { accountRoutingKey: turn.accountRoutingKey } : {}),
      traceId: turn.traceId,
      helperPid: process.pid,
      ...(turn.conversationKey ? { conversationKey: turn.conversationKey } : {}),
      ...(turn.conversationKey && (turn.nativeConnector || turn.capabilities.localToolsEnabled || turn.requireRetainedConversation)
        ? { connectorIdentity: this.config.appName }
        : {}),
      ...(turn.requireRetainedConversation ? { requireRetainedConversation: true } : {}),
    }, undefined, turn.abortSignal).catch(error => {
      if (error instanceof LauncherAccountCooldownError) throw new ChatGptWebAdapterError(error.message, {
        status: 429, errorType: "rate_limit_error", code: "account_cooldown", retryable: false,
      });
      if (error instanceof LauncherBrowserTurnCancelledError) throw chatGptBrowserTabClosedError();
      if (error instanceof LauncherRetainedConversationUnavailableError) {
        throw chatGptRetainedConversationUnavailableError();
      }
      throw error;
    });
    const surfaceId = lease.surfaceId;
    const reused = lease.reused === true;
    let terminal: "completed" | "failed" | "aborted" = "completed";
    let terminalMessage: string | undefined;
    let originalError: unknown;
    const normalizedFailureCode = (error: unknown):
      "rate_limit_exceeded" | "account_safety_stop" | "context_length_exceeded"
      | "model_unavailable" | "tool_timeout" | "browser_failure" | "other" => {
      if (!(error instanceof ChatGptWebAdapterError)) return "browser_failure";
      if (error.code === "rate_limit_exceeded" || error.code === "account_safety_stop"
        || error.code === "context_length_exceeded") return error.code;
      if (error.code === "model_version_unavailable" || error.code === "model_effort_unavailable"
        || error.code === "chatgpt_pro_unavailable") return "model_unavailable";
      if (error.code === "codex_tool_timeout") return "tool_timeout";
      return "other";
    };
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatInFlight = false;
    let lastHeartbeatFailureAt = 0;
    const sendHeartbeat = () => {
      if (heartbeatInFlight) return;
      heartbeatInFlight = true;
      void notifyLauncherTurn(this.config.browserHostDescriptorPath!, {
        phase: "heartbeat",
        traceId: turn.traceId,
        helperPid: process.pid,
        surfaceId,
      }, LAUNCHER_TURN_HEARTBEAT_TIMEOUT_MS).catch(error => {
        const now = Date.now();
        if (now - lastHeartbeatFailureAt < 30_000) return;
        lastHeartbeatFailureAt = now;
        console.warn(
          `[chatgpt-web] launcher turn heartbeat failed for ${turn.traceId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }).finally(() => {
        heartbeatInFlight = false;
      });
    };
    try {
      if (!surfaceId) throw new Error("Launcher did not lease a browser tab for the ChatGPT turn");
      if (lease.taskProgressVersion !== 1) throw new Error('NEKODEX and its browser helper need matching versions. Restart NEKODEX before running new Web tasks; this prompt was not sent.');
      if (turn.requireRetainedConversation && !reused) {
        throw chatGptRetainedConversationUnavailableError();
      }
      if (reused && !turn.prepareResume) {
        throw new Error("Launcher reused a ChatGPT conversation without a continuation prompt");
      }
      await turn.onPreparedSelected?.(reused);
      heartbeatTimer = setInterval(sendHeartbeat, LAUNCHER_TURN_HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref?.();
      let sequence = lease.taskProgressSequence ?? 0;
      let lastPhase = '';
      const onTaskProgress: BrowserTurn['onTaskProgress'] = async phase => {
        if (phase === lastPhase) return;
        await notifyLauncherTurn(this.config.browserHostDescriptorPath!, {
          phase: 'progress', traceId: turn.traceId, helperPid: process.pid, surfaceId,
          taskPhase: phase, sequence: ++sequence,
        }, LAUNCHER_TURN_HEARTBEAT_TIMEOUT_MS);
        lastPhase = phase;
      };
      return await this.runBrowserTurn({ ...turn, onTaskProgress }, surfaceId, undefined, reused);
    } catch (error) {
      originalError = error;
      terminal = error instanceof ChatGptCompactionHandoffAccepted
        ? "completed"
        : (error instanceof DOMException && error.name === "AbortError")
        || (error instanceof ChatGptWebAdapterError && error.code === "client_cancelled")
        ? "aborted"
        : "failed";
      terminalMessage = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
      throw error;
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      try {
        const release = await notifyLauncherTurn(this.config.browserHostDescriptorPath!, {
          phase: "end",
          traceId: turn.traceId,
          helperPid: process.pid,
          status: terminal,
          ...(terminal === "failed" ? { failureCode: normalizedFailureCode(originalError) } : {}),
          ...(terminalMessage ? { message: terminalMessage } : {}),
          ...(terminal === "completed" && turn.retainConversation ? { retain: true } : {}),
          ...(terminal === "completed" && (turn.nativeConnector || turn.capabilities.localToolsEnabled)
            ? { connectorBound: true }
            : {}),
        });
        if (release.cancelledByUser) throw chatGptBrowserTabClosedError();
      } catch (controlError) {
        if (controlError instanceof ChatGptWebAdapterError && controlError.code === "client_cancelled") {
          throw controlError;
        }
        if (!originalError) throw controlError;
        console.error(
          `[chatgpt-web] launcher turn-end notification failed after browser error: ${controlError instanceof Error ? controlError.message : String(controlError)}`,
        );
      }
    }
  }

  private async recordAcceptedUsage(turn: BrowserTurn, mode: Pick<ChatGptWebModelMode, "effort" | "modelVersion">,
    receipt: string = randomUUID(), outcome?: "completed", page?: Page,
    messageKind: "task" | "context_stage" | "compaction" = turn.compaction ? "compaction" : "task"): Promise<string> {
    const { modelVersion, modelVersionSource } = this.modelSelectionController().acceptedUsage(page);
    if (this.config.browserHost === "launcher") {
      try {
        await notifyLauncherTurn(this.config.browserHostDescriptorPath!, {
          phase: "usage", traceId: turn.traceId, helperPid: process.pid, receipt,
          effort: turn.modelId === CHATGPT_WEB_LUNA_MODEL_ID ? "luna" : mode.effort,
          modelVersion, modelVersionSource, messageKind, ...(outcome ? { outcome } : {}),
        }, 2_000);
      } catch { console.warn("[chatgpt-web] local usage observation unavailable; totals may be incomplete"); }
    }
    return receipt;
  }

  private async runBrowserTurn(
    turn: BrowserTurn,
    launcherSurfaceId?: string,
    maintenancePage?: Page,
    reuseConversation = false,
  ): Promise<string> {
    if (turn.abortSignal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
    if ((turn.externalProgress !== undefined) !== (turn.completionFence !== undefined)) {
      throw new Error("Tool-capable ChatGPT turns require both progress and terminal-fence transports");
    }
    if ((turn.captureLunaCheckpoint === true) !== (turn.onLunaCheckpoint !== undefined)) {
      throw new Error("ChatGPT Luna checkpoint capture requires exactly one checkpoint callback");
    }
    if (turn.captureLunaCheckpoint && turn.modelId !== CHATGPT_WEB_LUNA_MODEL_ID) {
      throw new Error("Private rolling checkpoint capture is valid only for ChatGPT Luna");
    }
    const browserCapabilities = turn.nativeConnector
      ? { ...turn.capabilities, localToolsEnabled: true }
      : turn.capabilities;
    if (turn.compactionExecution !== undefined) {
      let execution: ChatGptWebCompactionExecution;
      try {
        execution = parseChatGptWebCompactionExecution(turn.compactionExecution);
      } catch (error) {
        throw new Error("Explicit compaction execution has an invalid model/effort combination", { cause: error });
      }
      if (turn.compaction !== true || turn.capabilities.localToolsEnabled
        || turn.modelId !== CHATGPT_WEB_MODEL_ID || !turn.capabilities.proAvailable
        || turn.reasoning !== execution.effort) {
        throw new Error("Explicit compaction execution requires a read-only summary with matching effort and an available model");
      }
    }
    const requestedMode = resolveChatGptWebModelMode(
      turn.modelId, turn.reasoning, browserCapabilities, turn.compactionExecution?.modelVersion,
    );
    const prepare = reuseConversation ? turn.prepareResume : turn.prepare;
    if (!prepare) throw new Error("The retained ChatGPT conversation has no continuation prompt");
    const prepared = await prepare();
    const diagnostics = new ChatGptBrowserDiagnostics(
      turn.traceId,
      this.config.browserDiagnosticsPath ?? join(getConfigDir(), "diagnostics", "browser-turns"),
      this.config.appName,
    );
    let turnConnection: Browser | undefined;
    const recoverableLauncherObservation = (error: unknown) => launcherSurfaceId !== undefined
      && isConfirmedLauncherCdpDisconnect(error, turnConnection, turn.abortSignal);
    let managedPage: Page | undefined;
    let diagnosticPage: Page | undefined;
    const submissionRejection = new ChatGptSubmissionRejectionObserver();
    let providerSubmissionStage: string | undefined;
    try {
      if (turn.abortSignal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
      assertChatGptPromptAttachments(prepared);
      const multipartTransactionId = prepared.multipart
        ? `ctx_${randomUUID().replaceAll("-", "")}`
        : undefined;
      const multipartStages = prepared.multipart && multipartTransactionId
        ? prepared.multipart.parts.slice(0, -1).map((payload, index) => formatChatGptWebMultipartStage(
          payload,
          multipartTransactionId,
          index + 1,
          prepared.multipart!.parts.length,
        ))
        : undefined;
      const multipartFinalPrompt = prepared.multipart && multipartTransactionId
        ? formatChatGptWebMultipartCommit(prepared.multipart, multipartTransactionId)
        : undefined;
      const estimatedInputTokens = estimateCompiledChatGptWebInputTokens(prepared, turn.modelId);
      const estimatedMessageTokens = estimateCompiledChatGptWebMessageTokens(prepared, turn.modelId);
      const maxMessageChars = compiledChatGptWebMaxMessageChars(prepared);
      const maxStageMessageTokens = multipartStages
        ? Math.max(...multipartStages.map(stage => estimateTokens(stage.text, turn.modelId)))
        : undefined;
      const maxStageChars = multipartStages
        ? Math.max(...multipartStages.map(stage => stage.text.length))
        : undefined;
      const stagingMode = multipartStages
        ? resolveChatGptWebMultipartStagingMode(
          turn.modelId,
          browserCapabilities,
          maxStageMessageTokens!,
          maxStageChars!,
          !turn.compactionExecution,
        )
        : requestedMode;
      if (prepared.multipart) {
        assertChatGptWebMultipartInputWithinLimits(
          estimatedInputTokens,
          estimatedMessageTokens,
          turn.modelId,
          requestedMode.effort,
          browserCapabilities,
          maxMessageChars,
          prepared.multipart.parts.length,
          multipartStages
            && multipartFinalPrompt
            && maxStageMessageTokens !== undefined
            && maxStageChars !== undefined ? {
            stagingEffort: stagingMode.effort,
            maxStageMessageTokens,
            maxStageChars,
            finalMessageTokens: estimateTokens(multipartFinalPrompt, turn.modelId) + skillFileTokens(prepared.skillFiles, turn.modelId),
            finalMessageChars: multipartFinalPrompt.length,
            finalImageTokens: estimateChatGptWebImageTokens(prepared),
          } : undefined,
        );
      } else {
        assertChatGptWebInputWithinLimits(
          estimatedInputTokens,
          estimatedMessageTokens,
          turn.modelId,
          requestedMode.effort,
          browserCapabilities,
          maxMessageChars,
        );
      }
      const deadline = this.config.turnTimeoutMs === undefined
        ? undefined
        : Date.now() + this.config.turnTimeoutMs;
      let page = await this.runStage(turn.traceId, "browser_page", browserStageTimeouts.browserPage, async (abortSignal) => {
        const acquisitionSignal = browserStageAbortSignal(abortSignal, turn.abortSignal);
        if (acquisitionSignal.aborted) {
          throw new DOMException("ChatGPT browser page acquisition aborted", "AbortError");
        }
        if (maintenancePage) return maintenancePage;
        if (!launcherSurfaceId) {
          const managedPagePromise = this.pageForNewTurn();
          let managed: Page;
          try {
            managed = await withBrowserTurnAbort(managedPagePromise, acquisitionSignal);
          } catch (error) {
            // Browser-context page creation has no AbortSignal. If cancellation wins first, close a
            // page that materializes later so the detached acquisition cannot leak a hidden tab.
            if (acquisitionSignal.aborted) {
              void managedPagePromise.then(latePage => latePage.close().catch(() => {}), () => {});
            }
            throw error;
          }
          if (acquisitionSignal.aborted) {
            await managed.close().catch(() => {});
            throw new DOMException("ChatGPT browser page acquisition aborted", "AbortError");
          }
          return managed;
        }
        const connection = await connectLauncherBrowserHost(
          this.config.browserHostDescriptorPath!,
          browserStageTimeouts.browserPage,
          launcherSurfaceId,
          acquisitionSignal,
        );
        if (acquisitionSignal.aborted) {
          await connection.browser.close().catch(() => {});
          throw new DOMException("ChatGPT browser page acquisition aborted", "AbortError");
        }
        turnConnection = connection.browser;
        await waitForOperationalChatGptViewport(connection.page, acquisitionSignal);
        return connection.page;
      });
      if (!maintenancePage && !launcherSurfaceId) managedPage = page;
      diagnosticPage = page;
      const rebindLauncherPage = async (
        attempt: number,
        cause: Error,
        callerSignal?: AbortSignal,
      ): Promise<void> => {
        if (!launcherSurfaceId || !this.config.browserHostDescriptorPath) throw cause;
        console.warn(
          `[chatgpt-web] browser turn ${turn.traceId} is rebinding its existing launcher page after an observation failure:`
          + ` ${redactChatGptUiDiagnostic(cause.message)}`,
        );
        for (let retry = 0; ; retry += 1) {
          let actionSettled = false;
          const previousConnection = turnConnection;
          const previousConnectionAlreadyDisconnected = previousConnection?.isConnected() === false;
          if (previousConnectionAlreadyDisconnected) turnConnection = undefined;
          try {
            // A failed disconnect is terminal: the old probe must lose its transport before a
            // replacement can acquire this same leased surface.
            const connection = await connectAfterClosingBrowserConnection(
              previousConnectionAlreadyDisconnected ? undefined : previousConnection,
              () => {
                turnConnection = undefined;
                return this.runStage(
                  turn.traceId,
                  `response_page_rebind_${attempt}`,
                  browserStageTimeouts.browserPage,
                  async (stageSignal) => {
                    try {
                      const signal = AbortSignal.any([
                        stageSignal,
                        ...(callerSignal ? [callerSignal] : []),
                        ...(turn.abortSignal ? [turn.abortSignal] : []),
                      ]);
                      await notifyLauncherTurn(this.config.browserHostDescriptorPath!, {
                        phase: "heartbeat", traceId: turn.traceId, helperPid: process.pid,
                        surfaceId: launcherSurfaceId, refreshViewport: true,
                      });
                      const rebound = await connectLauncherBrowserHost(
                        this.config.browserHostDescriptorPath!, browserStageTimeouts.browserPage, launcherSurfaceId, signal,
                      );
                      // Own it before viewport validation so failed readiness has an exact cleanup handle.
                      turnConnection = rebound.browser;
                      diagnosticPage = rebound.page;
                      await waitForOperationalChatGptViewport(rebound.page, signal);
                      return rebound;
                    } finally { actionSettled = true; }
                  },
                );
              },
            );
            turnConnection = connection.browser;
            page = connection.page;
            diagnosticPage = page;
            break;
          } catch (error) {
            if (!turnConnection || !canRetryOwnedPageRebind(error, {
              retry, actionSettled, hasConnection: true,
              aborted: Boolean(callerSignal?.aborted || turn.abortSignal?.aborted),
            })) throw error;
            // Await acknowledged close; failed or timed-out cleanup never permits another attempt.
            await withChatGptBrowserObservationTimeout(turnConnection.close(), 5_000);
            turnConnection = undefined;
          }
        }
        console.warn(
          `[chatgpt-web] browser turn ${turn.traceId} rebound its exact launcher-owned page after an observation failure`,
        );
      };
      const recoverPageObservation = async (
        attempt: number,
        cause: Error,
        baseline: ChatGptSubmissionBaseline,
        checkpoint: "submission-page-rebound" | "assistant-page-rebound",
        abortSignal?: AbortSignal,
      ): Promise<ChatGptSubmissionObservationRecovery> => {
        await rebindLauncherPage(attempt, cause, abortSignal);
        const reboundBaseline: ChatGptSubmissionBaseline = {
          ...baseline,
          userTurns: page.locator(CHATGPT_USER_TURN_SELECTOR),
          responseTurns: page.locator(CHATGPT_ASSISTANT_TURN_SELECTOR),
          domCache: {},
        };
        await diagnostics.capture(page, checkpoint);
        return { page, baseline: reboundBaseline };
      };
      const recoverSubmissionObservation: ChatGptObservationRecovery = (
        attempt,
        cause,
        baseline,
        abortSignal,
      ) => recoverPageObservation(
        attempt,
        cause,
        baseline,
        "submission-page-rebound",
        abortSignal,
      );
      const recoverAssistantObservation: ChatGptObservationRecovery = (
        attempt,
        cause,
        baseline,
        abortSignal,
      ) => recoverPageObservation(
        attempt,
        cause,
        baseline,
        "assistant-page-rebound",
        abortSignal,
      );
      // Rebinding the exact leased page is a browser-ownership operation. Read-only
      // compaction needs it too; acquiring MCP tools is not a prerequisite.
      const launcherObservationRecovery = launcherSurfaceId !== undefined
        && this.config.browserHostDescriptorPath !== undefined;
      await diagnostics.capture(page, "browser-page-acquired");
      if (reuseConversation && new URL(page.url()).origin !== "https://chatgpt.com") {
        throw new Error("The retained ChatGPT conversation left its trusted origin");
      }
      console.info(
        `[chatgpt-web] browser turn ${turn.traceId} opened (transport=${prepared.multipart ? `multipart-${prepared.multipart.parts.length}` : "inline"}, maxMessageChars=${maxMessageChars}, estimatedInputTokens=${estimatedInputTokens}, images=${prepared.images.length}, compactionTrimmedMessages=${prepared.trimmedCompactionMessages ?? 0})`,
      );
      if (multipartStages) {
        console.info(
          `[chatgpt-web] browser turn ${turn.traceId} multipart staging effort=${stagingMode.effort}`
          + ` maxStageMessageTokens=${maxStageMessageTokens} maxStageChars=${maxStageChars}`,
        );
      }
      if (!reuseConversation) {
        await this.runStage(
          turn.traceId,
          "temporary_chat_preparation",
          browserStageTimeouts.temporaryChatPreparation,
          stageSignal => this.prepareTemporaryChatSurface(
            page,
            checkpoint => diagnostics.capture(page, checkpoint),
            browserStageAbortSignal(stageSignal, turn.abortSignal),
          ),
        );
      }
      // A retained lease proves the connector binding, not the current model selection.
      // Reconcile the live control before every submission, including retained continuations.
      let mode = await this.runStage(turn.traceId, "effort_selection", browserStageTimeouts.effortSelection, (abortSignal) => (
        this.selectModelAndEffort(
          page,
          turn.modelId,
          stagingMode.effort,
          browserCapabilities,
          checkpoint => diagnostics.capture(page, checkpoint),
          requestedMode.modelVersion,
          browserStageAbortSignal(abortSignal, turn.abortSignal),
        )
      ));
      await diagnostics.capture(page, "effort-selection-complete");

      let finalPrompt = prepared.text;
      if (prepared.multipart && multipartStages && multipartTransactionId && multipartFinalPrompt) {
        for (let index = 0; index < multipartStages.length; index += 1) {
          // ChatGPT may rewrite or reset the effort control after accepting a staged message. Reopen
          // the semantic slider and prove the requested state before mutating the next composer.
          if (index > 0) {
            await this.runStage(
              turn.traceId,
              `multipart_stage_${index + 1}_preflight`,
              browserStageTimeouts.promptAttachment,
              stageSignal => this.throwIfMultipartStageBlocked(
                page,
                browserStageAbortSignal(stageSignal, turn.abortSignal),
              ),
              chatGptSuspensionClock,
              true,
            );
            mode = await this.runStage(
              turn.traceId,
              `multipart_stage_${index + 1}_effort_selection`,
              browserStageTimeouts.effortSelection,
              stageSignal => this.selectModelAndEffort(
                page,
                turn.modelId,
                stagingMode.effort,
                browserCapabilities,
                checkpoint => diagnostics.capture(page, `multipart-${index + 1}-${checkpoint}`),
                requestedMode.modelVersion,
                browserStageAbortSignal(stageSignal, turn.abortSignal),
              ),
            );
            await diagnostics.capture(page, `multipart-stage-${index + 1}-effort-selected`);
          }
          const stage = multipartStages[index]!;
          let stageBaseline = await this.captureSubmissionBaseline(page, turn.abortSignal);
          await this.runStage(
            turn.traceId,
            `multipart_stage_${index + 1}_attachment`,
            browserStageTimeouts.promptAttachment,
            (stageSignal) => this.attachMultipartStagePrompt(
              page,
              stage.text,
              checkpoint => diagnostics.capture(page, `multipart-${index + 1}-${checkpoint}`),
              turn.abortSignal ? AbortSignal.any([stageSignal, turn.abortSignal]) : stageSignal,
            ),
            chatGptSuspensionClock,
            true,
          );
          await diagnostics.capture(page, `multipart-stage-${index + 1}-attachment-complete`);
          const evidence = await this.runStage(
            turn.traceId,
            `multipart_stage_${index + 1}_send`,
            browserStageTimeouts.multipartStageSend,
            (stageSignal) => this.sendAttachedPrompt(
              page,
              stageBaseline,
              checkpoint => diagnostics.capture(page, `multipart-${index + 1}-${checkpoint}`),
              turn.abortSignal ? AbortSignal.any([stageSignal, turn.abortSignal]) : stageSignal,
              undefined,
              { onSendActivated: async () => {
                providerSubmissionStage = `context part ${index + 1}`;
                await turn.onTaskProgress?.('sending-context');
              }, onSubmitted: () => turn.onTaskProgress?.('context-accepted') },
              undefined,
              launcherObservationRecovery
                ? async (...args) => {
                  const recovered = await recoverSubmissionObservation(...args);
                  stageBaseline = recovered.baseline;
                  return recovered;
                }
                : undefined,
              recoverableLauncherObservation,
              { ...stagingMode, modelVersion: requestedMode.modelVersion },
              submissionRejection,
            ),
          );
          const stageUsageReceipt = await this.recordAcceptedUsage(
            turn, { ...stagingMode, modelVersion: requestedMode.modelVersion }, undefined, undefined, page, "context_stage",
          );
          console.info(
            `[chatgpt-web] browser turn ${turn.traceId} multipart part ${index + 1}/${prepared.multipart.parts.length} submission accepted evidence=${evidence}`,
          );
          await this.runStage(
            turn.traceId,
            `multipart_stage_${index + 1}_acknowledgement`,
            browserStageTimeouts.multipartStageAcknowledgement,
            async (stageSignal) => {
              const acknowledgementSignal = turn.abortSignal
                ? AbortSignal.any([stageSignal, turn.abortSignal])
                : stageSignal;
              const responseTurn = await this.waitForNewAssistantTurn(
                page,
                stageBaseline,
                deadline,
                acknowledgementSignal,
                // A part still being ingested has produced no MCP activity, so there is no progress
                // to consult here; the dedicated acknowledgement stage owns this wait.
                undefined,
                CHATGPT_MULTIPART_RESPONSE_DOM_GRACE_MS,
                undefined,
                launcherObservationRecovery
                  ? async (...args) => {
                    const recovered = await recoverAssistantObservation(...args);
                    stageBaseline = recovered.baseline;
                    return recovered;
                  }
                  : undefined,
                recoverableLauncherObservation,
              );
              await this.waitForMultipartAcknowledgement(
                page,
                responseTurn,
                stageBaseline,
                stage,
                deadline,
                acknowledgementSignal,
                turn.externalProgress,
              );
            },
            chatGptSuspensionClock,
          );
          const stageRejection = await submissionRejection.failure();
          if (stageRejection) throw stageRejection;
          await diagnostics.capture(page, `multipart-stage-${index + 1}-acknowledged`);
          await this.recordAcceptedUsage(
            turn, { ...stagingMode, modelVersion: requestedMode.modelVersion }, stageUsageReceipt, "completed", page, "context_stage",
          );
          await turn.onMultipartStageAcknowledged?.(index + 1);
        }
        if (mode.effort !== requestedMode.effort) {
          mode = await this.runStage(
            turn.traceId,
            "final_part_effort_selection",
            browserStageTimeouts.effortSelection,
            (abortSignal) => this.selectModelAndEffort(
              page,
              turn.modelId,
              requestedMode.effort,
              browserCapabilities,
              checkpoint => diagnostics.capture(page, `final-part-${checkpoint}`),
              requestedMode.modelVersion,
              browserStageAbortSignal(abortSignal, turn.abortSignal),
            ),
          );
          await diagnostics.capture(page, "final-part-effort-selected");
        }
        finalPrompt = multipartFinalPrompt;
      }

      let submissionBaseline = await this.captureSubmissionBaseline(page, turn.abortSignal);
      submissionBaseline.acknowledgedStages = multipartStages?.map(stage => stage.acknowledgement);
      let catalogRefreshAvailable = mode.localTools && !reuseConversation && !prepared.multipart;
      const connectorAttemptBudget: ChatGptConnectorAttemptBudget = { triggerAttempts: 0 };
      for (;;) {
        try {
          await this.runStage(
            turn.traceId,
            "prompt_attachment",
            browserStageTimeouts.promptAttachment,
            (stageSignal) => {
              const promptAbortSignal = turn.abortSignal
                ? AbortSignal.any([stageSignal, turn.abortSignal])
                : stageSignal;
              return this.attachPromptWithCompactionRetry(
                page,
                finalPrompt,
                mode.localTools,
                turn.compaction === true,
                submissionBaseline,
                checkpoint => diagnostics.capture(page, checkpoint),
                promptAbortSignal,
                catalogRefreshAvailable,
                connectorAttemptBudget,
                reuseConversation,
                mode.thinkEnabled,
              );
            },
            chatGptSuspensionClock,
            true,
          );
          break;
        } catch (error) {
          if (!(error instanceof ChatGptConnectorCatalogStaleError) || !catalogRefreshAvailable) throw error;
          catalogRefreshAvailable = false;
          await diagnostics.capture(page, "connector-catalog-stale");
          await this.runStage(
            turn.traceId,
            "connector_catalog_refresh",
            browserStageTimeouts.temporaryChatPreparation,
            async (abortSignal) => {
              const refreshSignal = browserStageAbortSignal(abortSignal, turn.abortSignal);
              await withBrowserTurnAbort(
                page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 }),
                refreshSignal,
              );
              await this.prepareTemporaryChatSurface(
                page,
                checkpoint => diagnostics.capture(page, checkpoint),
                refreshSignal,
              );
              mode = await this.selectModelAndEffort(
                page,
                turn.modelId,
                turn.reasoning,
                turn.capabilities,
                checkpoint => diagnostics.capture(page, checkpoint),
                requestedMode.modelVersion,
                refreshSignal,
              );
              submissionBaseline = await this.captureSubmissionBaseline(page, refreshSignal);
            },
          );
          await diagnostics.capture(page, "connector-catalog-refreshed");
        }
      }
      await diagnostics.capture(page, "prompt-attachment-complete");
      await this.runStage(turn.traceId, "file_attachment", browserStageTimeouts.fileAttachment, stageSignal => (
        this.attachFiles(page, prepared, browserStageAbortSignal(stageSignal, turn.abortSignal))
      ));
      await diagnostics.capture(page, "file-attachment-complete");
      const completionTracker = new ChatGptCompletionTracker();
      const finalSubmissionEvidence = await this.runStage(
        turn.traceId,
        "send",
        // A multipart commit lands on a conversation already carrying every staged part, so it
        // needs the same acceptance headroom the stages themselves get.
        prepared.multipart ? browserStageTimeouts.multipartStageSend : browserStageTimeouts.send,
        (stageSignal) => this.sendAttachedPrompt(
          page,
          submissionBaseline,
          checkpoint => diagnostics.capture(page, checkpoint),
          turn.abortSignal ? AbortSignal.any([stageSignal, turn.abortSignal]) : stageSignal,
          turn.externalProgress,
          {
            ...turn,
            onSendActivated: async () => {
              providerSubmissionStage = "response";
              await turn.onTaskProgress?.('sending');
              await turn.onSendActivated?.();
            },
            onSubmitted: async () => {
              await turn.onSubmitted?.();
              await turn.onTaskProgress?.('accepted');
            },
          },
          completionTracker,
          launcherObservationRecovery
            ? async (...args) => {
              const recovered = await recoverSubmissionObservation(...args);
              submissionBaseline = recovered.baseline;
              return recovered;
            }
            : undefined,
          recoverableLauncherObservation,
          requestedMode,
          submissionRejection,
        ),
      );
      await this.recordAcceptedUsage(turn, requestedMode, undefined, undefined, page);
      console.info(`[chatgpt-web] browser turn ${turn.traceId} submission accepted evidence=${finalSubmissionEvidence}`);
      let responseTurn = await this.waitForNewAssistantTurn(
        page,
        submissionBaseline,
        deadline,
        turn.abortSignal,
        turn.externalProgress,
        CHATGPT_RESPONSE_DOM_GRACE_MS,
        completionTracker,
        launcherObservationRecovery
          ? async (...args) => {
            const recovered = await recoverAssistantObservation(...args);
            submissionBaseline = recovered.baseline;
            return recovered;
          }
          : undefined,
        recoverableLauncherObservation,
      );
      await diagnostics.capture(page, "send-accepted");

      let lastHeartbeat = 0;
      let finalText = "";
      let sawRunning = false;
      let loggedCompletionWait = false;
      let capturedResponse = false;
      const sentAt = Date.now();
      const visibleTrace = new ChatGptVisibleTraceTracker();
      const markdownBuffer = new ChatGptMarkdownBuffer();
      const checkpointStream = turn.captureLunaCheckpoint
        ? new ChatGptLunaCheckpointStream()
        : undefined;
      const emitMarkdownDelta = (delta: string): void => {
        const visible = checkpointStream ? checkpointStream.push(delta) : delta;
        if (visible) turn.onTextDelta(visible);
      };
      const throwMarkdownConsistencyError = (error: unknown): never => {
        if (!(error instanceof ChatGptMarkdownConsistencyError)) throw error;
        if (error.diagnostic) {
          console.error(
            `[chatgpt-web] browser turn ${turn.traceId} Markdown conflict: ${JSON.stringify(error.diagnostic)}`,
          );
        }
        throw new ChatGptWebAdapterError(error.message, {
          status: 502,
          errorType: "server_error",
          code: "browser_stream_inconsistent",
          retryable: false,
        });
      };
      const domHealthTracker = new ChatGptTurnDomHealthTracker();
      const responseDomCache: ChatGptResponseDomCache = {};
      let consecutiveObservationRebinds = 0;
      let consecutiveLiveProbeWaits = 0;
      const responseObservationStartedAt = Date.now();
      let internalObservationFaults = 0;
      let observedThisIteration = false;
      let completionFenceRevision: number | undefined;
      let unacknowledgedAsyncResultSince: number | undefined;
      for (;;) {
        // The heartbeat is a consumer callback, so it stays outside the observation-fault region:
        // a defect in the caller must not be retried as though the page could not be read.
        if (Date.now() - lastHeartbeat >= 10_000) {
          turn.onHeartbeat?.();
          lastHeartbeat = Date.now();
        }
       try {
        observedThisIteration = false;
        if (page.isClosed()) {
          throw chatGptBrowserTabClosedError();
        }
        if (turn.abortSignal?.aborted) {
          const stop = page.locator(CHATGPT_STOP_BUTTON_SELECTOR).last();
          if (await stop.isVisible().catch(() => false)) await stop.press("Enter").catch(() => {});
          throw new DOMException("ChatGPT web turn aborted", "AbortError");
        }
        if (deadline !== undefined && Date.now() >= deadline) {
          throw new Error("ChatGPT web turn timed out");
        }
        await throwIfChatGptSessionFailureAlert(page);
        await throwIfChatGptTerminalErrorAlert(responseTurn.locator);

        if (mode.localTools && await resolveChatGptToolConfirmation(
          page,
          this.config.appName,
          this.config.autoApproveToolCalls,
          turn.abortSignal,
          CHATGPT_TOOL_CONFIRMATION_TIMEOUT_MS,
          () => diagnostics.capture(page, "tool-confirmation-visible"),
        )) {
          internalObservationFaults = 0;
          await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
          continue;
        }

        let snapshot: ChatGptResponseDomSnapshot;
        try {
          snapshot = await this.responseDomSnapshot(responseTurn.locator, responseDomCache, turn.abortSignal);
        } catch (error) {
          if (!(error instanceof ChatGptBrowserObservationTimeoutError)) throw error;
          if (Date.now() - responseObservationStartedAt < CHATGPT_RESPONSE_DOM_GRACE_MS
            || chatGptExternalProgressSuppressesDomHealth(turn.externalProgress?.snapshot(), Date.now())) {
            await this.waitForLiveProbeRetry(turn.externalProgress, consecutiveLiveProbeWaits++, turn.abortSignal);
            continue;
          }
          if (!launcherSurfaceId) throw error;
          snapshot = absentResponseDomSnapshot();
        }
        if (!snapshot.responsePresent) {
          try {
            const rebound = await withChatGptBrowserObservationTimeout(
              this.reconcileAssistantTurnBinding(
                page,
                submissionBaseline,
                responseTurn,
                turn.abortSignal,
                chatGptExternalToolCallsAreInFlight(turn.externalProgress?.snapshot()),
              ),
            );
            const reboundIdentityChanged = rebound.identity !== responseTurn.identity;
            responseTurn = rebound;
            if (reboundIdentityChanged) {
              responseDomCache.key = undefined;
              responseDomCache.snapshot = undefined;
              snapshot = await this.responseDomSnapshot(responseTurn.locator, responseDomCache, turn.abortSignal);
            }
          } catch (error) {
            if (!(error instanceof ChatGptBrowserObservationTimeoutError) || !launcherSurfaceId) throw error;
            if (Date.now() - responseObservationStartedAt < CHATGPT_RESPONSE_DOM_GRACE_MS
              || chatGptExternalProgressSuppressesDomHealth(turn.externalProgress?.snapshot(), Date.now())) {
              await this.waitForLiveProbeRetry(turn.externalProgress, consecutiveLiveProbeWaits++, turn.abortSignal);
              continue;
            }
            consecutiveObservationRebinds += 1;
            if (consecutiveObservationRebinds > MAX_CHATGPT_BROWSER_PAGE_REBINDS) {
              throw new Error(
                `ChatGPT browser DOM remained unresponsive after ${MAX_CHATGPT_BROWSER_PAGE_REBINDS} same-page rebinds`,
                { cause: error },
              );
            }
            await rebindLauncherPage(consecutiveObservationRebinds, error, turn.abortSignal);
            submissionBaseline = {
              ...submissionBaseline,
              userTurns: page.locator(CHATGPT_USER_TURN_SELECTOR),
              responseTurns: page.locator(CHATGPT_ASSISTANT_TURN_SELECTOR),
              domCache: {},
            };
            responseTurn = {
              ...responseTurn,
              locator: page.locator(`[data-turn-id=${JSON.stringify(responseTurn.identity)}]`),
            };
            responseDomCache.key = undefined;
            responseDomCache.snapshot = undefined;
            await diagnostics.capture(page, "response-page-rebound");
            continue;
          }
        }
        if (snapshot.stoppedThinkingVisible) {
          const progress = turn.externalProgress?.snapshot();
          const error = chatGptStoppedThinkingError({
            responsePresent: snapshot.responsePresent,
            finalTextChars: snapshot.markdownSegments.reduce((sum, value) => sum + value.text.length, 0),
            activeToolCalls: progress?.activeToolCalls ?? 0,
            toolBatchObserved: (progress?.lastToolBatchRevision ?? 0) > 0,
            ...(progress?.lastProgressAt ? { lastProgressAgeMs: Date.now() - progress.lastProgressAt } : {}),
          });
          await diagnostics.capture(page, "stopped-thinking", error);
          throw error;
        }
        if (snapshot.responsePresent) { consecutiveObservationRebinds = 0; consecutiveLiveProbeWaits = 0; }
        // The page was read successfully, so the fault budget is genuinely consecutive even when
        // this iteration goes on to `continue` for a rebind, confirmation, or liveness pause.
        internalObservationFaults = 0;
        observedThisIteration = true;
        // Liveness may postpone a verdict, never waive it: once activity goes stale the DOM alone
        // decides, so a tool call that never returns cannot hold a turn with no explicit deadline open forever.
        const externalProgressSnapshot = turn.externalProgress?.snapshot();
        if (turn.externalProgress
          && externalProgressSnapshot
          && completionTracker.needsToolBatchObservation(externalProgressSnapshot.lastToolBatchRevision)) {
          completionTracker.observeToolBatch(
            externalProgressSnapshot.lastToolBatchRevision,
            snapshot.visibleText,
          );
          await turn.externalProgress.acknowledgeToolBatch(externalProgressSnapshot.lastToolBatchRevision);
        }
        const externalProgressLive = chatGptExternalProgressSuppressesDomHealth(
          externalProgressSnapshot,
          Date.now(),
        );
        const externalToolCallsInFlight = chatGptExternalToolCallsAreInFlight(externalProgressSnapshot);
        await turn.onTaskProgress?.(externalToolCallsInFlight ? 'waiting-tools' : 'responding');
        if (!snapshot.responsePresent && externalProgressLive) {
          // Current-turn MCP activity proves that ChatGPT is still executing even if its renderer
          // temporarily cannot expose the response subtree. DOM remains authoritative for text and
          // completion; this only prevents a live turn from being misclassified as vanished.
          domHealthTracker.suspendForLiveProgress();
          await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
          continue;
        }
        const stop = page.locator(CHATGPT_STOP_BUTTON_SELECTOR).last();
        const running = await stop.isVisible().catch(() => false);
        if (running) sawRunning = true;
        if (snapshot.responsePresent) {
          if (!capturedResponse) {
            capturedResponse = true;
            await diagnostics.capture(page, "response-visible");
          }
          const textDelta = (() => {
            try {
              return markdownBuffer.observe(snapshot.markdownSegments);
            } catch (error) {
              return throwMarkdownConsistencyError(error);
            }
          })();
          for (const trace of visibleTrace.observe(snapshot.traceBlocks, snapshot.completionActionVisible)) {
            if (trace.kind === "commentary") turn.onCommentary?.(trace.text, trace.continuation === true);
            else turn.onReasoningSummary?.(trace.text, trace.continuation === true);
          }
          if (textDelta) emitMarkdownDelta(textDelta);
          const domError = domHealthTracker.update({
            responsePresent: snapshot.responsePresent,
            running,
            currentText: snapshot.visibleText,
            completionActionVisible: snapshot.completionActionVisible,
            externalProgressLive,
          });
          if (domError) throw new Error(domError);
          const completionReady = completionTracker.update({
            responsePresent: snapshot.responsePresent,
            running,
            currentText: snapshot.visibleText,
            currentHtml: snapshot.fullHtml,
            completionActionVisible: snapshot.completionActionVisible,
            externalToolCallsInFlight,
          });
          if (!completionReady) {
            completionFenceRevision = undefined;
            unacknowledgedAsyncResultSince = undefined;
          }
          if (completionReady) {
            if (turn.completionFence) {
              if (completionFenceRevision === undefined) {
                const fence = await turn.completionFence.begin();
                if (!("revision" in fence)) {
                  completionFenceRevision = undefined;
                  if (fence.blockedReason === "active_work") {
                    unacknowledgedAsyncResultSince = undefined;
                  } else {
                    unacknowledgedAsyncResultSince ??= Date.now();
                    if (Date.now() - unacknowledgedAsyncResultSince >= CHATGPT_COMPLETION_ACTION_GRACE_MS) {
                      throw new ChatGptWebAdapterError(
                        `ChatGPT completed while ${fence.blockedCount} owned Codex tool result(s) remained unacknowledged. Poll the terminal operation result and acknowledge its delivery before completing the response.`,
                        {
                          status: 409,
                          errorType: "invalid_request_error",
                          code: "unacknowledged_async_result",
                          retryable: false,
                        },
                      );
                    }
                  }
                  await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
                  continue;
                }
                unacknowledgedAsyncResultSince = undefined;
                completionFenceRevision = fence.revision;
                // The fence revision is captured after this DOM projection. Force one fresh read
                // before commit so an MCP activity that just settled cannot disappear between a
                // stale cached completion and the broker's terminal decision.
                responseDomCache.key = undefined;
                responseDomCache.snapshot = undefined;
                await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
                continue;
              }
              if (!await turn.completionFence.commit(completionFenceRevision)) {
                completionFenceRevision = undefined;
                unacknowledgedAsyncResultSince = undefined;
                responseDomCache.key = undefined;
                responseDomCache.snapshot = undefined;
                await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
                continue;
              }
            }
            if (snapshot.visibleText === "api_tool unavailable") {
              throw new Error("ChatGPT selected mode rejected the Codex Native MCP tool (api_tool unavailable)");
            }
            const final = (() => {
              try {
                return markdownBuffer.finish();
              } catch (error) {
                return throwMarkdownConsistencyError(error);
              }
            })();
            if (!final.markdown && snapshot.visibleText) {
              throw new Error("ChatGPT completed with visible text that could not be serialized as Markdown");
            }
            if (final.delta) emitMarkdownDelta(final.delta);
            if (checkpointStream) {
              const completed = checkpointStream.finishOptional(snapshot.visibleText);
              if (completed.visibleRemainder) turn.onTextDelta(completed.visibleRemainder);
              if (completed.captured) turn.onLunaCheckpoint!(completed.captured);
              else console.warn(`[chatgpt-web] browser turn ${turn.traceId} completed without a Luna rolling checkpoint; preserving full native history`);
              finalText = completed.answer;
            } else {
              finalText = final.markdown;
            }
            if (!turn.compaction) {
              const artifacts = await acquireChatGptResponseArtifacts(
                page,
                responseTurn.locator,
                turn.traceId,
                responseTurn.identity,
                turn.abortSignal,
                launcherSurfaceId && this.config.browserHostDescriptorPath ? {
                  taskDirectory: launcherArtifactTaskDirectory(
                    this.config.browserHostDescriptorPath,
                    turn.traceId,
                  ),
                  networkGuard: {
                    register: input => registerLauncherArtifactDownload(
                      this.config.browserHostDescriptorPath!,
                      {
                        traceId: turn.traceId,
                        helperPid: process.pid,
                        surfaceId: launcherSurfaceId,
                        ...input,
                      },
                      turn.abortSignal,
                    ),
                    wait: leaseId => waitForLauncherArtifactDownload(
                      this.config.browserHostDescriptorPath!,
                      { traceId: turn.traceId, helperPid: process.pid, surfaceId: launcherSurfaceId, leaseId },
                      60_000,
                      turn.abortSignal,
                    ),
                    cancel: (leaseId, reason) => cancelLauncherArtifactDownload(
                      this.config.browserHostDescriptorPath!,
                      {
                        traceId: turn.traceId,
                        helperPid: process.pid,
                        surfaceId: launcherSurfaceId,
                        leaseId,
                        reason: reason.message.slice(0, 500),
                      },
                    ),
                  },
                } : {},
              );
              const artifactMarkdown = chatGptArtifactMarkdown(artifacts);
              if (artifactMarkdown) {
                turn.onTextDelta(artifactMarkdown);
                finalText += artifactMarkdown;
              }
            }
            break;
          }
          if (!loggedCompletionWait && Date.now() - sentAt >= 60_000) {
            loggedCompletionWait = true;
            await diagnostics.capture(page, "response-stalled-60s");
            const diagnostic = await this.stalledTurnDiagnostic(page, responseTurn.locator).catch(error => JSON.stringify({
              diagnosticError: error instanceof Error ? error.message : String(error),
            }));
            console.warn(
              `[chatgpt-web] waiting for completed-turn evidence (running=${running}, sawRunning=${sawRunning}, textChars=${snapshot.visibleText.length}, completionActionVisible=${snapshot.completionActionVisible}, ui=${diagnostic})`,
            );
          }
        } else {
          const domError = domHealthTracker.update({
            responsePresent: false,
            running,
            currentText: "",
            completionActionVisible: false,
            externalProgressLive,
          });
          if (domError) throw new Error(domError);
        }
        await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
       } catch (error) {
        if (launcherSurfaceId && recoverableLauncherObservation(error)) {
          consecutiveObservationRebinds += 1;
          if (consecutiveObservationRebinds > MAX_CHATGPT_BROWSER_PAGE_REBINDS) {
            throw new Error(
              `ChatGPT browser transport remained disconnected after ${MAX_CHATGPT_BROWSER_PAGE_REBINDS} exact-surface rebinds`,
              { cause: error },
            );
          }
          await rebindLauncherPage(
            consecutiveObservationRebinds,
            error instanceof Error ? error : new Error(String(error)),
            turn.abortSignal,
          );
          submissionBaseline = {
            ...submissionBaseline,
            userTurns: page.locator(CHATGPT_USER_TURN_SELECTOR),
            responseTurns: page.locator(CHATGPT_ASSISTANT_TURN_SELECTOR),
            domCache: {},
          };
          responseTurn = {
            ...responseTurn,
            locator: page.locator(`[data-turn-id=${JSON.stringify(responseTurn.identity)}]`),
          };
          responseDomCache.key = undefined;
          responseDomCache.snapshot = undefined;
          await diagnostics.capture(page, "response-transport-rebound");
          continue;
        }
        // Only a defect in this worker is retried here. Every deliberate signal — adapter errors,
        // aborts, closed tabs, DOM-health verdicts — still fails the turn immediately.
        // Retry only faults raised while reading the page. Once observation succeeded, a
        // TypeError belongs to a consumer - Markdown buffering, text/trace callbacks, checkpoint
        // capture - and retrying it would rerun an iteration whose side effects already happened.
        if (!(error instanceof TypeError) || observedThisIteration) throw error;
        internalObservationFaults += 1;
        if (internalObservationFaults > MAX_CHATGPT_INTERNAL_OBSERVATION_FAULTS) {
          throw new Error(
            `ChatGPT browser observation failed ${internalObservationFaults} times in a row: ${error.message}`,
            { cause: error },
          );
        }
        console.warn(
          `[chatgpt-web] browser turn ${turn.traceId} tolerated internal observation fault`
          + ` ${internalObservationFaults}/${MAX_CHATGPT_INTERNAL_OBSERVATION_FAULTS}: ${error.message}`,
        );
        await diagnostics.capture(page, "internal-observation-fault");
        responseDomCache.key = undefined;
        responseDomCache.snapshot = undefined;
        await new Promise(resolveSleep => setTimeout(resolveSleep, 250));
       }
      }

      if (this.context && this.config.browserHost === "managed-chrome") {
        try {
          const state = sanitizeBrowserLoginStorageState(await this.context.storageState());
          atomicWriteFile(this.config.storageStatePath, `${JSON.stringify(state)}\n`);
          writeBrowserLoginVerificationMarker(this.config.storageStatePath, {
            solAvailable: browserCapabilities.solAvailable,
            ...(browserCapabilities.extraHighAvailable !== undefined
              ? { extraHighAvailable: browserCapabilities.extraHighAvailable }
              : {}),
            proAvailable: browserCapabilities.proAvailable,
          });
        } catch (error) {
          // The answer is already complete. A failed disk snapshot must not discard it or the
          // live context, which can still serve this session until the worker is closed.
          console.warn(
            `[chatgpt-web] browser turn ${turn.traceId} completed, but managed-Chrome session state could not be saved`
            + ` to ${this.config.storageStatePath}: ${error instanceof Error ? error.message : String(error)}`
            + "; the current browser context remains usable, but a new worker may reload older login state",
          );
        }
      }
      const rejection = await submissionRejection.failure();
      if (rejection) throw rejection;
      await diagnostics.capture(page, "turn-completed");
      console.info(
        `[chatgpt-web] browser turn ${turn.traceId} completed`
        + ` (markdownChars=${finalText.length}, domFullScans=${responseDomCache.fullScans ?? 0}, domCacheHits=${responseDomCache.cacheHits ?? 0})`,
      );
      return finalText;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError"
        && turn.abortSignal?.reason instanceof ChatGptCompactionHandoffAccepted) {
        console.info(`[chatgpt-web] browser turn ${turn.traceId} ended after accepted structured compaction handoff`);
        if (diagnosticPage && !diagnosticPage.isClosed()) {
          await diagnostics.capture(diagnosticPage, "compaction-handoff-accepted");
        }
        throw turn.abortSignal.reason;
      }
      if (!(error instanceof DOMException && error.name === "AbortError")
        && !(error instanceof ChatGptWebAdapterError && error.code === "client_cancelled")) {
        error = await submissionRejection.failure() ?? error;
      }
      const reportedError = chatGptSubmittedProviderFailure(error, providerSubmissionStage);
      console.error(
        `[chatgpt-web] browser turn ${turn.traceId} failed:`
        + ` ${redactChatGptUiDiagnostic(reportedError instanceof Error ? reportedError.message : String(reportedError))}`,
      );
      if (diagnosticPage && !diagnosticPage.isClosed()) {
        await diagnostics.capture(diagnosticPage, "turn-failed", reportedError);
      }
      throw reportedError;
    } finally {
      submissionRejection.dispose();
      diagnostics.dispose();
      prepared.release();
      if (turnConnection) {
        await turnConnection.close().catch(error => {
          console.error(
            `[chatgpt-web] failed to release launcher browser connection for ${turn.traceId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      } else if (managedPage && !managedPage.isClosed()) {
        await managedPage.close().catch(error => {
          console.error(
            `[chatgpt-web] failed to close managed browser tab for ${turn.traceId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
    }
  }
}
