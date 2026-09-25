import type { Locator, Page, Request, Response } from "playwright-core";
import { ChatGptWebAdapterError } from "./adapter-error";
import { throwIfPromptAttachmentAborted, withChatGptBrowserObservationTimeout } from "./browser-operation-support";
import type { ChatGptWebModelMode } from "./model";

export const CHATGPT_TOOL_CONFIRMATION_TIMEOUT_MS = 60_000;

export const chatGptRateLimitDialog = (page: Page): Locator => page.locator('[role="dialog"]')
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

export const chatGptExpiredSessionAlert = (page: Page): Locator => page
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
