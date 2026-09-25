import { useFeatureAction } from "./useFeatureAction";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrandMark } from "./BrandMark";
import { BrowserWorkspaceManager } from "./BrowserWorkspaceManager";
import { ExistingChromeLoginGuide } from "./ExistingChromeLoginGuide";
import { PasskeyLoginGuide } from "./PasskeyLoginGuide";
import { ManualTurnGuide } from "./ManualTurnGuide";
import { Icon } from "./icons";
import { IconButton, PrimaryButton, SecondaryButton, StateDot, messageOf } from "./launcher-ui";
import { localizeLauncherError, type Copy } from "./i18n";
import { browserControls } from "./browser-controls";
import { browserWindowCopy } from "./browser-window-copy";
import { passkeyFailureText } from "./passkey-copy";
import { sessionIssueCopy } from "./session-issue-copy";
import { workflowCopy } from "./workflow-copy";
import type { WorkspaceReadiness } from "./workspace-readiness";
import type { BrowserInteractionMode, BrowserState, Language, OperationState } from "./types";

const api = window.codexWebLauncher;

export function BrowserSurface({
  accountSetup,
  browser,
  error,
  browserSlotRef,
  copy,
  interactionMode,
  language,
  transitionBusy,
  operation,
  platform,
  readiness,
  setError,
}: {
  accountSetup?: ReactNode;
  browser: BrowserState | null;
  error: string | null;
  browserSlotRef: (node: HTMLDivElement | null) => void;
  copy: Copy;
  interactionMode: BrowserInteractionMode;
  language: Language;
  transitionBusy: boolean;
  operation: OperationState | null;
  platform: string;
  readiness: WorkspaceReadiness;
  setError: (error: string | null) => void;
}) {
  const [passkeyStarting, setPasskeyStarting] = useState(false);
  const workflow = workflowCopy(language);
  const windowCopy = browserWindowCopy(language);
  const windowAction = useFeatureAction<"window" | "tab">(false, cause => setError(messageOf(cause)));
  const [passkeyRequestPending, setPasskeyRequestPending] = useState(false);
  const [existingChromeStarting, setExistingChromeStarting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; traceId: string | null } | null>(null);
  const [closingTabs, setClosingTabs] = useState<Set<string>>(new Set());
  const closingTabRequests = useRef(new Set<string>());
  const confirmingTabRequests = useRef(new Set<string>());
  const [confirmingTabs, setConfirmingTabs] = useState<Set<string>>(new Set());
  const sessionRetryInFlight = useRef(false);
  const [sessionRetryBusy, setSessionRetryBusy] = useState(false);
  const activeBrowserTabs = browser?.tabs.filter(tab => ["running", "loading", "testing"].includes(tab.status)) ?? [];
  const recoverableBrowserTabs = browser?.tabs.filter(tab => !["error", "aborted"].includes(tab.status)) ?? [];
  const cancelTab = browser?.tabs.find(tab => tab.id === cancelTarget?.id
    && tab.traceId === cancelTarget?.traceId && tab.status === "running");
  useEffect(() => { if (cancelTarget && !cancelTab) setCancelTarget(null); }, [cancelTarget, cancelTab]);
  const visible = browser?.visible === true;
  const manualInteraction = interactionMode === "manual";
  const { navigationLocked: browserNavigationLocked, passkeyAvailable, passkeyWaiting, passkeyBlocked, passkeyCanImport,
    existingChromeAvailable, existingChromeWaiting, existingChromeBlocked } = browserControls(
    browser, operation, platform, interactionMode,
  );
  const navigationLocked = transitionBusy || browserNavigationLocked;
  const selectedManualTab = browser?.tabs.find(tab => tab.active && tab.interactionMode === "manual");
  const passkeyLabel = passkeyStarting || browser?.passkeyLogin?.phase === "starting" ? copy.passkeyStarting
    : !passkeyWaiting ? copy.passkeySignIn
    : passkeyCanImport ? copy.passkeyContinue
    : browser?.passkeyLogin?.phase === "verifying" ? copy.passkeyVerifying
    : browser?.passkeyLogin?.phase === "cancelling" ? copy.passkeyCancelling
    : copy.passkeyImporting;
  const passkeyActionDisabled = transitionBusy || passkeyBlocked || passkeyRequestPending
    || (passkeyWaiting ? !passkeyCanImport : passkeyStarting);
  useEffect(() => {
    if (passkeyWaiting) setPasskeyStarting(false);
  }, [passkeyWaiting]);
  const navigate = async (action: "back" | "forward" | "reload") => {
    if (navigationLocked) return;
    try {
      await api!.navigateBrowser(action);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const zoom = async (action: "in" | "out" | "reset") => {
    try {
      await api!.zoomBrowser(action);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const toggle = async () => {
    if (transitionBusy && !visible) return;
    try {
      if (visible) await api!.hideBrowser();
      else await api!.showBrowser();
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const selectTab = async (tabId: string) => {
    if (transitionBusy) return;
    try {
      await api!.selectBrowserTab(tabId);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const retrySession = async () => {
    if (sessionRetryInFlight.current || transitionBusy || browser?.navigationLocked || !browser?.accountId) return;
    sessionRetryInFlight.current = true;
    setSessionRetryBusy(true);
    setError(null);
    try {
      await api!.refreshAccountAuthentication(browser.accountId);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      sessionRetryInFlight.current = false;
      setSessionRetryBusy(false);
    }
  };
  const closeTab = async (tabId: string, expectedTraceId?: string | null) => {
    if (transitionBusy) return;
    if (closingTabRequests.current.has(tabId)) return;
    closingTabRequests.current.add(tabId);
    setClosingTabs(new Set(closingTabRequests.current));
    try {
      await api!.closeBrowserTab(tabId, expectedTraceId);
      setCancelTarget(current => current?.id === tabId && current.traceId === expectedTraceId ? null : current);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      closingTabRequests.current.delete(tabId);
      setClosingTabs(new Set(closingTabRequests.current));
    }
  };
  const openPasskeyLogin = async () => {
    if (passkeyActionDisabled || passkeyWaiting) return;
    setPasskeyStarting(true);
    setError(null);
    try {
      await api!.openPasskeyLogin();
    } catch (cause) {
      setError(passkeyFailureText(messageOf(cause), copy));
    } finally {
      setPasskeyStarting(false);
    }
  };
  const openExistingChromeLogin = async () => {
    if (transitionBusy || existingChromeBlocked || existingChromeWaiting || existingChromeStarting) return;
    setExistingChromeStarting(true);
    setError(null);
    try { await api!.openExistingChromeLogin(); }
    catch { setError(copy.existingChromeFailure); }
    finally { setExistingChromeStarting(false); }
  };
  const continuePasskeyLogin = async () => {
    if (!passkeyCanImport || passkeyRequestPending) return;
    setPasskeyRequestPending(true);
    setError(null);
    try {
      await api!.continuePasskeyLogin();
    } catch (cause) {
      const detail = messageOf(cause);
      setError(detail === "No passkey sign-in is waiting for Continue"
        ? copy.passkeyImporting
        : passkeyFailureText(detail, copy));
    } finally {
      setPasskeyRequestPending(false);
    }
  };
  const copyManualPrompt = async (tabId: string): Promise<boolean> => {
    if (transitionBusy) return false;
    try {
      await api!.copyManualPrompt(tabId);
      return true;
    } catch (cause) {
      setError(messageOf(cause));
      return false;
    }
  };
  const confirmManualSent = async (tabId: string) => {
    if (transitionBusy || confirmingTabRequests.current.has(tabId)) return;
    confirmingTabRequests.current.add(tabId);
    setConfirmingTabs(new Set(confirmingTabRequests.current));
    try {
      await api!.confirmManualSent(tabId);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      confirmingTabRequests.current.delete(tabId);
      setConfirmingTabs(new Set(confirmingTabRequests.current));
    }
  };

  return (
    <section className="browser-surface">
      {accountSetup}
      {error ? <div className="browser-inline-error" role="alert">
        <p>{localizeLauncherError(copy, error)}</p>
        <button type="button" className="text-button" onClick={() => setError(null)}>{copy.dismiss}</button>
      </div> : null}
      {browser?.accountName ? <div className="browser-account-label">{copy.accountsCurrent}: {browser.accountName}</div> : null}
      <div className="browser-tab-strip" role="tablist" aria-label={copy.browser} title={copy.browserTabLimit}>
        {(browser?.tabs ?? []).map((tab) => (
          <div
            className={`browser-tab${tab.active ? " is-active" : ""}`}
            key={tab.id}
          >
            <button
              className="browser-tab-select"
              onClick={() => void selectTab(tab.id)}
              onKeyDown={(event) => {
                if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  const tabs = browser?.tabs ?? [];
                  const index = tabs.findIndex((candidate) => candidate.id === tab.id);
                  const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                  const next = tabs[nextIndex];
                  if (next) {
                    void selectTab(next.id);
                    event.currentTarget.closest('[role="tablist"]')
                      ?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus();
                  }
                }
              }}
              aria-disabled={transitionBusy}
              role="tab"
              aria-selected={tab.active}
              aria-label={`${browserTabTitleFromTitle(tab.title, copy)} — ${tab.status === "running" ? copy.running
                : tab.status === "loading" ? copy.loading : tab.status === "testing" ? copy.overviewRunTesting
                  : tab.status === "error" ? copy.failed : tab.status === "ready" ? copy.complete : copy.noActiveTask}`}
              tabIndex={tab.active ? 0 : -1}
              type="button"
            >
              <BrandMark small />
              {tab.loading ? <i className="tab-spinner" aria-hidden="true" /> : <StateDot state={browserTabTone(tab.status)} />}
              <span className="browser-tab-title" title={tab.traceId ? `${tab.title} · ${tab.traceId}` : tab.title}>
                {browserTabTitleFromTitle(tab.title, copy)}
              </span>
            </button>
            {tab.closable ? (
              <button
                aria-label={`${tab.status === "running" ? copy.manualPromptCancel : copy.hideTab}: ${browserTabTitleFromTitle(tab.title, copy)}`}
                disabled={transitionBusy || closingTabs.has(tab.id)}
                className={tab.status === "running" ? "browser-tab-cancel" : undefined}
                onClick={() => {
                  if (tab.status === "running") setCancelTarget({ id: tab.id, traceId: tab.traceId });
                  else void closeTab(tab.id, tab.traceId);
                }}
                title={tab.status === "running" ? copy.manualPromptCancel : copy.hideTab}
                type="button"
              >
                {closingTabs.has(tab.id) ? <i className="tab-spinner" aria-hidden="true" />
                  : <Icon name={tab.status === "running" ? "stop" : "close"} />}
              </button>
            ) : null}
          </div>
        ))}
        <div className="browser-tab-drag draggable" />
      </div>
      {cancelTab ? <div className="browser-cancel-confirm" role="alert"
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setCancelTarget(null); } }}>
        <div><strong>{copy.browserCancelTaskTitle}</strong>
          <p className="browser-cancel-target">{browserTabTitleFromTitle(cancelTab.title, copy)}</p>
          <p>{copy.browserCancelTaskBody}</p></div>
        <div className="browser-cancel-actions">
          <button type="button" className="button-secondary" autoFocus disabled={transitionBusy || closingTabs.has(cancelTab.id)} onClick={() => setCancelTarget(null)}>{copy.back}</button>
          <button type="button" className="button-secondary browser-confirm-cancel" disabled={transitionBusy || closingTabs.has(cancelTab.id)}
            aria-label={`${copy.manualPromptCancel}: ${browserTabTitleFromTitle(cancelTab.title, copy)}`}
            onClick={() => void closeTab(cancelTab.id, cancelTab.traceId)}>{closingTabs.has(cancelTab.id) ? copy.browserCancellingTask : copy.manualPromptCancel}</button>
        </div>
      </div> : null}
      <div className="browser-workspace-actions">
        <button type="button" className="text-button" disabled={transitionBusy || windowAction.pending !== null}
          onClick={() => void windowAction.run("window", () => api!.openBrowserWindow(false))}>{windowCopy.newWindow}</button>
        {platform === "darwin" ? <button type="button" className="text-button" disabled={transitionBusy || windowAction.pending !== null}
          onClick={() => void windowAction.run("tab", () => api!.openBrowserWindow(true))}>{windowCopy.newTab}</button> : null}
        <span>{platform === "darwin" ? windowCopy.hint : windowCopy.tabsMacOnly}</span>
      </div>
      {browser?.workspaces ? <BrowserWorkspaceManager
        language={language}
        snapshot={browser.workspaces}
        selectedAccountId={browser.accountId}
        disabled={transitionBusy}
        onOpen={(accountId, asTab) => api!.openBrowserWorkspace(accountId, { asTab })}
        onRestore={accountId => api!.restoreBrowserWorkspaces(accountId)}
        onFocus={(accountId, workspaceId) => api!.focusBrowserWorkspace(accountId, workspaceId)}
        onClose={(accountId, workspaceId) => api!.closeBrowserWorkspace(accountId, workspaceId)}
      /> : null}
      <div className="browser-toolbar">
        <div className="browser-history">
          <IconButton
            disabled={navigationLocked || !browser?.canGoBack}
            icon="back"
            label={copy.back}
            onClick={() => void navigate("back")}
          />
          <IconButton
            disabled={navigationLocked || !browser?.canGoForward}
            icon="forward"
            label={copy.forward}
            onClick={() => void navigate("forward")}
          />
          <IconButton disabled={navigationLocked || !visible} icon="reload" label={copy.reload} onClick={() => void navigate("reload")} />
        </div>
        <div className="browser-address" title={formatBrowserAddress(browser?.url, copy)}>
          <Icon name="globe" />
          <span>{formatBrowserAddress(browser?.url, copy)}</span>
        </div>
        <div className="browser-zoom-controls">
          <IconButton icon="minus" label={copy.zoomOut} onClick={() => void zoom("out")} />
          <button
            aria-label={copy.zoomReset}
            className="browser-zoom-reset"
            onClick={() => void zoom("reset")}
            title={copy.zoomReset}
            type="button"
          >
            {Math.round((browser?.zoomFactor ?? 1) * 100)}%
          </button>
          <IconButton icon="plus" label={copy.zoomIn} onClick={() => void zoom("in")} />
        </div>
        {existingChromeAvailable ? (
          <button className="toolbar-text-button" type="button"
            disabled={transitionBusy || existingChromeBlocked || existingChromeStarting || existingChromeWaiting}
            onClick={() => void openExistingChromeLogin()}>{copy.existingChromeSignIn}</button>
        ) : null}
        {passkeyAvailable ? (
          <button
            className="toolbar-text-button"
            disabled={passkeyActionDisabled}
            onClick={() => void (passkeyWaiting ? continuePasskeyLogin() : openPasskeyLogin())}
            type="button"
          >
            {passkeyLabel}
          </button>
        ) : null}
        <button disabled={transitionBusy && !visible} className="toolbar-text-button" onClick={() => void toggle()} type="button">
          {visible ? copy.hideBrowser : copy.openChatgpt}
        </button>
        {browser?.loading ? <i className="browser-loading-line" /> : null}
      </div>
      {!manualInteraction && browser?.existingChromeLogin ? (
        <ExistingChromeLoginGuide transitionBusy={transitionBusy} progress={browser.existingChromeLogin} copy={copy} language={language} onRetry={openExistingChromeLogin} setError={setError} />
      ) : !manualInteraction && browser?.passkeyLogin && browser.passkeyLogin.phase !== "completed" ? (
        <PasskeyLoginGuide transitionBusy={transitionBusy} progress={browser.passkeyLogin} copy={copy} language={language} onRetry={openPasskeyLogin} setError={setError} />
      ) : browser?.loginKind === "embedded" ? (
        <div className="browser-login-guide" role="status">
          <p>{passkeyAvailable ? copy.embeddedLoginPasskeyBody : copy.embeddedLoginBody}</p>
        </div>
      ) : null}
      {!manualInteraction && browser?.authenticationStatus === "unavailable" ? (
        <section className="browser-recovery-notice" aria-live="polite" data-testid="browser-session-recovery">
          <Icon name="alert" />
          <div>
            <strong>{workflow.session.verificationUnavailable}</strong>
            <p>{sessionIssueCopy(language, browser?.authenticationIssue)}</p>
            {browser.lastVerifiedAt ? <small>{workflow.session.lastVerifiedAt.replace("{time}", new Date(browser.lastVerifiedAt).toLocaleString(language))}</small> : null}
          </div>
          <div className="browser-recovery-actions">
            {recoverableBrowserTabs.length ? <button className="text-button" disabled={transitionBusy}
              onClick={() => void selectTab(recoverableBrowserTabs[0]!.id)} type="button">{copy.openWorkspace}</button> : null}
            <button className="button-secondary" disabled={sessionRetryBusy || transitionBusy || browser.navigationLocked || !browser.accountId}
              aria-busy={sessionRetryBusy} onClick={() => void retrySession()} type="button">
              {sessionRetryBusy ? workflow.session.checkingVerification : workflow.session.retryVerification}
            </button>
          </div>
        </section>
      ) : browser?.authenticated === true && (readiness.web === "degraded" || readiness.web === "unavailable") ? (
        <section className="browser-recovery-notice" aria-live="polite" data-testid="browser-web-recovery">
          <Icon name="alert" />
          <div><strong>{workflow.recovery.webTransportTitle}</strong><p>{readiness.native === "ready"
            ? workflow.recovery.webTransportBody : copy.localToolsUnavailableBody}</p>
            {readiness.native === "ready" ? <small>{workflow.recovery.nativePreserved}</small> : null}</div>
        </section>
      ) : null}
      {selectedManualTab
        && ["awaiting-user", "sent"].includes(selectedManualTab.manualState ?? "") ? (
        <ManualTurnGuide
          copy={copy}
          confirmPending={confirmingTabs.has(selectedManualTab.id)}
          transitionBusy={transitionBusy}
          onCancel={() => {
            // Match the tab strip: stopping a running turn asks for confirmation first.
            if (selectedManualTab.status === "running") setCancelTarget({ id: selectedManualTab.id, traceId: selectedManualTab.traceId });
            else void closeTab(selectedManualTab.id, selectedManualTab.traceId);
          }}
          onCopy={() => copyManualPrompt(selectedManualTab.id)}
          onSent={() => void confirmManualSent(selectedManualTab.id)}
          tab={selectedManualTab}
        />
      ) : null}
      <div className="browser-viewport" ref={browserSlotRef}>
        {!visible ? (
          <div className="browser-empty">
            <BrandMark />
            <h1>{activeBrowserTabs.length ? `${activeBrowserTabs.length} · ${copy.overviewActiveRuns}` : manualInteraction
              ? copy.browserReady
              : browser?.authenticationStatus === "unavailable" ? workflow.session.verificationUnavailable
                : browser?.authenticated ? copy.noActiveTask : copy.stepAccount}</h1>
            <p>{activeBrowserTabs.length ? copy.overviewActiveRunsBody : manualInteraction
              ? copy.stepAccountBody
              : browser?.authenticationStatus === "unavailable" ? sessionIssueCopy(language, browser.authenticationIssue)
                : browser?.authenticated
              ? copy.noActiveTaskBody
              : existingChromeWaiting ? copy.existingChromeBody : passkeyWaiting ? copy.passkeyContinueBody : copy.stepAccountBody}</p>
            <div className="browser-empty-actions">
              {activeBrowserTabs.length ? <PrimaryButton disabled={transitionBusy} onClick={() => void selectTab(activeBrowserTabs[0].id)}>{copy.openWorkspace}</PrimaryButton> : null}
              {existingChromeAvailable && browser?.authenticationStatus !== "unavailable" ? <PrimaryButton
                disabled={transitionBusy || existingChromeBlocked || existingChromeStarting || existingChromeWaiting}
                onClick={() => void openExistingChromeLogin()}>{copy.existingChromeSignIn}</PrimaryButton> : null}
              <SecondaryButton disabled={transitionBusy || passkeyWaiting || existingChromeWaiting} onClick={() => void toggle()}>
                {manualInteraction || browser?.authenticated || browser?.authenticationStatus === "unavailable" ? copy.openChatgpt : copy.signIn}
              </SecondaryButton>
              {passkeyAvailable && browser?.authenticationStatus !== "unavailable" ? (
                <SecondaryButton
                  disabled={passkeyActionDisabled}
                  onClick={passkeyWaiting ? continuePasskeyLogin : openPasskeyLogin}
                >
                  {passkeyLabel}
                </SecondaryButton>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="browser-underlay" aria-hidden="true">
            <span>{copy.loading}</span>
          </div>
        )}
      </div>
    </section>
  );
}

export function browserTabTitleFromTitle(value: string | undefined, copy: Copy): string {
  const title = value?.trim();
  if (!title || title === "about:blank" || title.includes("codex-web-gpt-browser-host")) return copy.temporaryChat;
  return title.replace(/\s*[|–-]\s*ChatGPT\s*$/i, "") || copy.temporaryChat;
}

function browserTabTone(status: BrowserState["tabs"][number]["status"]): "idle" | "ready" | "busy" | "error" {
  if (status === "error" || status === "aborted") return "error";
  if (status === "loading" || status === "running" || status === "testing") return "busy";
  if (status === "ready") return "ready";
  return "idle";
}

function formatBrowserAddress(url: string | undefined, copy: Copy): string {
  if (!url || url.startsWith("about:blank")) return copy.browserAddress;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return copy.browserAddress;
    if (parsed.hostname === "chatgpt.com" && parsed.searchParams.get("temporary-chat") === "true") {
      return `chatgpt.com  /  ${copy.temporaryChat}`;
    }
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return copy.browserAddress;
  }
}
