import type { Locator, Page, Request, Response } from "playwright-core";
import { ChatGptWebAdapterError } from "./adapter-error";
import { throwIfPromptAttachmentAborted, withChatGptBrowserObservationTimeout } from "./browser-operation-support";
import type { ChatGptWebModelMode } from "./model";

export const CHATGPT_TOOL_CONFIRMATION_TIMEOUT_MS = 60_000;

export const chatGptRateLimitDialog = (page: Page): Locator => page.locator('[role="dialog"]')
  .filter({ hasText: /Too many requests|Trop de requêtes|太多要求|太多请求|リクエストが多すぎます|요청이 너무 많습니다|요청을 너무 빠르게 보내고 있습니다/i })
  .filter({ hasText: /making requests too quickly|Vous envoyez des demandes trop rapidement|過於頻繁|过于频繁|リクエストの頻度が高すぎます|요청을 너무 빠르게 보내고 있습니다/i })
  .last();

export async function throwIfChatGptRateLimitDialog(page: Page): Promise<void> {
  const dialog = chatGptRateLimitDialog(page);
  if (!await dialog.isVisible().catch(() => false)) return;

  const acknowledge = dialog.getByRole("button", { name: /^(Got it|J[’']ai compris|Compris|知道了|了解|알겠습니다)$/ }).last();
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
  .filter({ hasText: /Not in history|Pas de conservation dans l[’']historique/ })
  .filter({ hasText: /No model training|Aucun entraînement de modèle/ })
  .filter({ hasText: /Memory off|Mémoire désactivée/ })
  .last();

export async function dismissChatGptTemporaryChatOnboarding(page: Page): Promise<boolean> {
  const dialog = chatGptTemporaryChatOnboardingDialog(page);
  if (!await dialog.isVisible().catch(() => false)) return false;
  const continueButton = dialog.getByRole("button", { name: /^(?:Continue|Continuer)$/, exact: true }).last();
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
  .filter({ hasText: /Failed to load subscription|Échec du chargement de l[’']abonnement/i })
  .last();

export const chatGptExpiredSessionAlert = (page: Page): Locator => page
  .locator('[role="alert"], [role="dialog"]')
  .filter({ hasText: /Your session has expired|Votre session a expiré|你的工作階段已過期|您的工作階段已過期|你的会话已过期|您的会话已过期/i })
  .last();

export async function throwIfChatGptSessionFailureAlert(page: Page): Promise<void> {
  const safetyAlert = page.locator('[role="alert"], [role="dialog"], [role="alertdialog"]')
    .filter({ hasText: /Suspicious activity detected|Nous détectons une activité suspecte|Activité inhabituelle détectée/i })
    .filter({ hasText: /someone else.*using your ChatGPT account|activité suspecte|activité inhabituelle/i }).last();
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
  .getByText(/(?:Something went wrong|Une erreur s[’']est produite)[\s\S]*help\.openai\.com/i)
  .last();

const chatGptThinkingFailedAlert = (scope: ChatGptTextScope): Locator => scope
  // Exact collapsed status only, with its optional textual disclosure chevron. Substrings in
  // answers or quoted diagnostics are ordinary content.
  .getByText(/^Thinking failed(?:\s*[>›])?\s*$/i)
  .last();

// ChatGPT can reject an input with either HTTP 413 or a terminal error event inside HTTP 200 SSE.
// Observe only browser-issued submissions from this owned page after Send is activated;
// an old response, another tab, or a background endpoint cannot classify this turn.
export class ChatGptSubmissionRejectionObserver {
  private page?: Page;
  private generation = 0;
  private readonly requests = new Set<Request>();
  private readonly streams = new Map<Request, Response>();
  private checks: Array<Promise<ChatGptWebAdapterError | undefined>> = [];

  constructor(private readonly onRejected?: (error: ChatGptWebAdapterError) => void) {}

  private readonly onRequest = (request: Request): void => {
    if (!this.page || request.method() !== "POST"
      || request.url() !== "https://chatgpt.com/backend-api/f/conversation") return;
    try { if (request.frame() !== this.page.mainFrame()) return; } catch { return; }
    this.requests.add(request);
  };

  private readonly onResponse = (response: Response): void => {
    if (!this.requests.delete(response.request())) return;
    const contentType = response.headers()["content-type"];
    if (response.status() === 403 && response.headers()["cf-mitigated"]?.toLowerCase() === "challenge") {
      const error = new ChatGptWebAdapterError(
        "ChatGPT blocked this request with a browser security check. Open ChatGPT in the launcher, complete any check shown there, then retry.",
        { status: 403, errorType: "permission_error", code: "chatgpt_security_check", retryable: false },
      );
      this.checks.push(Promise.resolve(error));
      this.onRejected?.(error);
      return;
    }
    if (response.status() === 200 && contentType?.includes("text/event-stream")) {
      this.streams.set(response.request(), response);
      return;
    }
    if (response.status() !== 413 || !contentType?.includes("application/json")) return;
    this.observeRejection(response.json().then(body => body?.detail?.code === "message_length_exceeds_limit"));
  };

  private readonly onRequestFinished = (request: Request): void => {
    const response = this.streams.get(request);
    this.streams.delete(request);
    this.requests.delete(request);
    if (!response) return;
    // Read only after the stream ends. A long-running successful response must not hold up
    // failure() or run into a response-body timeout while it is still generating.
    this.observeRejection(response.text().then(body => body.split(/\r?\n\r?\n/).some(block => {
      const data = block.split(/\r?\n/)
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data || data === "[DONE]") return false;
      try {
        const event = JSON.parse(data);
        // These are top-level service fields, not model text or a localized error message.
        return event?.error_code === "input_too_large" && event?.error_reason === "last_user_message"
          && typeof event?.error === "string" && event.error.length > 0;
      } catch {
        return false;
      }
    })));
  };

  private readonly onRequestFailed = (request: Request): void => {
    this.requests.delete(request);
    this.streams.delete(request);
  };

  private observeRejection(check: Promise<boolean>): void {
    const generation = this.generation;
    this.checks.push(withChatGptBrowserObservationTimeout(check, 3_000)
      .then(rejected => {
        if (generation !== this.generation || !rejected) return undefined;
        const error = new ChatGptWebAdapterError(
          "ChatGPT rejected this message because it exceeds the selected mode's input-size limit. Compact the task before retrying.",
          { status: 400, errorType: "invalid_request_error", code: "context_length_exceeded", retryable: false },
        );
        this.onRejected?.(error);
        return error;
      })
      // Unreadable or unfamiliar responses do not establish a size rejection. The normal
      // bound-response DOM error remains authoritative in that case.
      .catch(() => undefined));
  }

  begin(page: Page): void {
    this.dispose();
    this.checks = [];
    this.page = page;
    page.on("request", this.onRequest);
    page.on("response", this.onResponse);
    page.on("requestfinished", this.onRequestFinished);
    page.on("requestfailed", this.onRequestFailed);
  }

  async failure(): Promise<ChatGptWebAdapterError | undefined> {
    return (await Promise.all(this.checks)).find(error => error !== undefined);
  }

  /** An owned successful conversation stream is still open, even if Stop is absent. */
  hasActiveResponse(): boolean {
    return this.streams.size > 0 && this.page !== undefined && !this.page.isClosed();
  }

  dispose(): void {
    this.generation += 1;
    this.page?.off("request", this.onRequest);
    this.page?.off("response", this.onResponse);
    this.page?.off("requestfinished", this.onRequestFinished);
    this.page?.off("requestfailed", this.onRequestFailed);
    this.page = undefined;
    this.requests.clear();
    this.streams.clear();
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
  const escapedAppName = appName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dialogs = page.locator('[role="dialog"], [data-testid="tool-approval-card"], [data-codex-approval-surface="true"]')
    .filter({ hasText: new RegExp(`(?:Allow ChatGPT to use|Autoriser ChatGPT à utiliser) ${escapedAppName}\\s*\\?`) })
    .filter({ visible: true });
  const dialogCount = await dialogs.count().catch(() => 0);
  if (dialogCount === 0) return false;
  if (dialogCount !== 1) throw new Error("ChatGPT exposed multiple approvals for the selected connector");
  const dialog = dialogs.first();
  await onVisible?.();
  if (signal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
  const deny = dialog.getByRole("button", { name: /^(?:Deny|Refuser)$/ }).filter({ visible: true });

  if (autoApprove) {
    // ChatGPT exposes either "Allow once" or the shorter "Allow" for the current one-shot approval.
    // Keep the matcher anchored so persistent actions such as "Always allow" cannot match. The
    // current card no longer activates on Enter, so click and wait until it is gone.
    const allowCurrentAction = dialog
      .getByRole("button", { name: /^(?:Allow(?: once)?|Autoriser(?: une fois)?)$/ })
      .filter({ visible: true });
    await allowCurrentAction.first().waitFor({ state: "visible", timeout: 10_000 });
    await deny.first().waitFor({ state: "visible", timeout: 10_000 });
    if (await allowCurrentAction.count() !== 1 || await deny.count() !== 1) {
      throw new Error("ChatGPT approval does not expose a unique one-time Allow and Deny action");
    }
    if (signal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
    await allowCurrentAction.click({ timeout: 10_000 });
    await dialog.waitFor({ state: "hidden", timeout: 10_000 });
    return true;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
    if (!await dialog.isVisible().catch(() => false)) return true;
    await new Promise(resolveSleep => setTimeout(resolveSleep, Math.min(100, Math.max(1, deadline - Date.now()))));
  }

  if (signal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
  if (!await dialog.isVisible().catch(() => false)) return true;
  if (await deny.count() !== 1) throw new Error("ChatGPT approval does not expose a unique Deny action");
  await deny.click({ timeout: 5_000 });
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  return true;
}
