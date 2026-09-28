import { useFeatureAction } from "./useFeatureAction";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrowserWorkspaceManager } from "./BrowserWorkspaceManager";
import { ExistingChromeLoginGuide } from "./ExistingChromeLoginGuide";
import { PasskeyLoginGuide } from "./PasskeyLoginGuide";
import { ManualTurnGuide } from "./ManualTurnGuide";
import { Button, Icon, IconButton, Mark, Notice, Panel, Select, StateDot, cx } from "./design";
import { messageOf } from "./launcher-ui";
import { localizeLauncherError, type Copy } from "./i18n";
import { browserControls } from "./browser-controls";
import { browserWindowCopy } from "./browser-window-copy";
import { passkeyFailureText } from "./passkey-copy";
import { sessionIssueCopy } from "./session-issue-copy";
import { workflowCopy } from "./workflow-copy";
import { NetworkIssueNotice } from "./NetworkIssueNotice";
import type { WorkspaceReadiness } from "./workspace-readiness";
import type { BrowserInteractionMode, BrowserState, Language, OperationState } from "./types";
import "./surfaces/browser.css";

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
  networkNoticeMuted = false,
  onMuteNetworkNotice,
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
  networkNoticeMuted?: boolean;
  onMuteNetworkNotice?: () => Promise<void>;
}) {
  const [passkeyStarting, setPasskeyStarting] = useState(false);
  const workflow = workflowCopy(language);
  const windowCopy = browserWindowCopy(language);
  const accountAction = useFeatureAction<string>(transitionBusy, cause => setError(messageOf(cause)));
  const [passkeyRequestPending, setPasskeyRequestPending] = useState(false);
  const [existingChromeStarting, setExistingChromeStarting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; traceId: string | null } | null>(null);
  const [closingTabs, setClosingTabs] = useState<Set<string>>(new Set());
  const closingTabRequests = useRef(new Set<string>());
  const confirmingTabRequests = useRef(new Set<string>());
  const [confirmingTabs, setConfirmingTabs] = useState<Set<string>>(new Set());
  const sessionRetryInFlight = useRef(false);
  const [sessionRetryBusy, setSessionRetryBusy] = useState(false);
  const activeBrowserTabs = browser?.tabs.filter(tab => tab.id !== "home" && ["running", "loading", "testing"].includes(tab.status)) ?? [];
  const recoverableBrowserTabs = browser?.tabs.filter(tab => tab.id !== "home" && !["error", "aborted"].includes(tab.status)) ?? [];
  const cancelTab = browser?.tabs.find(tab => tab.id === cancelTarget?.id
    && tab.traceId === cancelTarget?.traceId && tab.status === "running");
  useEffect(() => { if (cancelTarget && !cancelTab) setCancelTarget(null); }, [cancelTarget, cancelTab]);
  const visible = browser?.visible === true;
  const tabStrip = useRef<HTMLDivElement>(null);
  const activeTabId = browser?.tabs.find(tab => tab.active)?.id;
  useEffect(() => {
    tabStrip.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId]);
  const manualInteraction = interactionMode === "manual";
  const { navigationLocked: browserNavigationLocked, passkeyAvailable, passkeyWaiting, passkeyBlocked, passkeyCanImport,
    existingChromeAvailable, existingChromeWaiting, existingChromeBlocked } = browserControls(
    browser, operation, platform, interactionMode,
  );
  const navigationLocked = transitionBusy || browserNavigationLocked;
  const accountSelectionLocked = transitionBusy || accountAction.pending !== null
    || browser?.loginInProgress === true || passkeyWaiting || existingChromeWaiting;
  const accounts = browser?.workspaces?.accounts ?? [];
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

  const externalLoginGuide = !manualInteraction && browser?.existingChromeLogin && browser.existingChromeLogin.phase !== "completed" ? (
    <ExistingChromeLoginGuide transitionBusy={transitionBusy} progress={browser.existingChromeLogin} copy={copy} language={language} onRetry={openExistingChromeLogin} setError={setError} />
  ) : !manualInteraction && browser?.passkeyLogin && browser.passkeyLogin.phase !== "completed" ? (
    <PasskeyLoginGuide transitionBusy={transitionBusy} progress={browser.passkeyLogin} copy={copy} language={language}
      onRetry={openPasskeyLogin} onContinue={continuePasskeyLogin} continuePending={passkeyRequestPending} setError={setError} />
  ) : null;

  const sessionRecovery = visible && !manualInteraction && browser?.authenticationStatus === "unavailable";
  const address = formatBrowserAddress(browser?.url, copy);
  // One account context drives the embedded page and the separate windows (BrowserWorkspaceManager).
  const accountControl = accounts.length > 0 && browser?.accountId ? <label className="browser-bar__account">
    <span>{windowCopy.account}</span>
    <Select className="browser-bar__select" size="sm" label={windowCopy.account} value={browser.accountId} disabled={accountSelectionLocked}
      options={accounts.map(account => ({ value: account.accountId, label: account.label }))}
      onChange={accountId => {
        if (!accountSelectionLocked && accountId !== browser.accountId) {
          setError(null);
          void accountAction.run(accountId, () => api!.selectAccount(accountId));
        }
      }} />
  </label> : browser?.accountName ? <span className="browser-bar__account">
    <span>{windowCopy.account}</span><strong>{browser.accountName}</strong>
  </span> : null;

  return (
    <section className="browser-frame">
      {accountSetup}
      {/* One bar for the task tabs, the account context and separate windows; an open window list wraps below it. */}
      <div className="browser-bar">
        <div className="browser-tabs" ref={tabStrip} role="tablist" aria-label={windowCopy.taskTabs} title={copy.browserTabLimit}>
          {(browser?.tabs ?? []).map((tab) => {
            const running = tab.status === "running";
            const closing = closingTabs.has(tab.id);
            return (
              <div className={cx("browser-tabs__tab", tab.active && "is-active", running && "is-running")} key={tab.id}>
                <button
                  className="browser-tabs__select"
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
                  aria-label={`${tab.id === "home" ? "ChatGPT" : browserTabTitleFromTitle(tab.title, copy)} — ${tab.id === "home" ? (browser?.authenticated ? copy.sessionConnected : copy.stepAccount) : tab.status === "running" ? copy.running
                    : tab.status === "loading" ? copy.loading : tab.status === "testing" ? copy.overviewRunTesting
                      : tab.status === "error" ? copy.failed : tab.status === "ready" ? copy.complete : copy.noActiveTask}`}
                  tabIndex={tab.active ? 0 : -1}
                  type="button"
                >
                  <Mark size={16} label={null} />
                  {tab.loading ? <i className="browser-tabs__spinner" aria-hidden="true" /> : <StateDot state={browserTabTone(tab.status)} />}
                  <span className="browser-tabs__title" title={tab.traceId ? `${tab.title} · ${tab.traceId}` : tab.title}>
                    {tab.id === "home" ? "ChatGPT" : browserTabTitleFromTitle(tab.title, copy)}
                  </span>
                </button>
                {tab.closable ? (
                  <button
                    aria-label={`${running ? copy.manualPromptCancel : copy.hideTab}: ${browserTabTitleFromTitle(tab.title, copy)}`}
                    disabled={transitionBusy || closing}
                    className="nk-icon-btn nk-icon-btn--sm browser-tabs__close"
                    onClick={() => {
                      if (running) setCancelTarget({ id: tab.id, traceId: tab.traceId });
                      else void closeTab(tab.id, tab.traceId);
                    }}
                    title={running ? copy.manualPromptCancel : copy.hideTab}
                    type="button"
                  >
                    {closing ? <i className="browser-tabs__spinner" aria-hidden="true" />
                      : <Icon className="nk-icon" name={running ? "stop" : "close"} />}
                  </button>
                ) : null}
              </div>
            );
          })}
          <div className="browser-tabs__drag draggable" />
        </div>
        {browser?.workspaces ? <BrowserWorkspaceManager
          language={language}
          snapshot={browser.workspaces}
          selectedAccountId={browser.accountId}
          disabled={accountSelectionLocked}
          onOpen={(accountId, asTab) => api!.openBrowserWorkspace(accountId, { asTab })}
          onRestore={accountId => api!.restoreBrowserWorkspaces(accountId)}
          onFocus={(accountId, workspaceId) => api!.focusBrowserWorkspace(accountId, workspaceId)}
          onClose={(accountId, workspaceId) => api!.closeBrowserWorkspace(accountId, workspaceId)}
        >{accountControl}</BrowserWorkspaceManager> : <div className="browser-bar__end">{accountControl}</div>}
      </div>
      {visible ? <div className="browser-nav">
        <div className="browser-nav__group">
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
        {/* A location label, not an editable address field. */}
        <div className="browser-nav__location" title={address}>
          <Icon className="nk-icon" name="globe" />
          <span>{address}</span>
        </div>
        <div className="browser-nav__group">
          <IconButton icon="minus" label={copy.zoomOut} onClick={() => void zoom("out")} />
          <Button variant="ghost" size="sm" className="browser-nav__zoom" aria-label={copy.zoomReset} title={copy.zoomReset}
            onClick={() => void zoom("reset")}>
            {Math.round((browser?.zoomFactor ?? 1) * 100)}%
          </Button>
          <IconButton icon="plus" label={copy.zoomIn} onClick={() => void zoom("in")} />
        </div>
        <div className="browser-nav__actions">
          {existingChromeAvailable && !externalLoginGuide ? (
            <Button variant="ghost" size="sm"
              disabled={transitionBusy || existingChromeBlocked || existingChromeStarting || existingChromeWaiting}
              onClick={() => void openExistingChromeLogin()}>{copy.existingChromeSignIn}</Button>
          ) : null}
          {passkeyAvailable && !externalLoginGuide ? (
            <Button variant="ghost" size="sm"
              disabled={passkeyActionDisabled}
              onClick={() => void (passkeyWaiting ? continuePasskeyLogin() : openPasskeyLogin())}
            >
              {passkeyLabel}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" disabled={transitionBusy && !visible} onClick={() => void toggle()}>
            {visible ? copy.hideBrowser : copy.openChatgpt}
          </Button>
        </div>
        {browser?.loading ? <i className="browser-nav__progress" aria-hidden="true" /> : null}
      </div> : null}
      {/* The native view paints above renderer overlays, so notices take layout space above the slot. */}
      <div className="browser-notices">
        {error ? <Notice tone="error"
          action={<Button variant="ghost" size="sm" onClick={() => setError(null)}>{copy.dismiss}</Button>}>
          {localizeLauncherError(copy, error)}
        </Notice> : null}
        {cancelTab ? <div className="browser-confirm" role="alert"
          onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setCancelTarget(null); } }}>
          <Panel as="div" variant="raised" padding="compact" className="browser-confirm__panel">
            <div className="browser-confirm__copy">
              <strong>{copy.browserCancelTaskTitle}</strong>
              <p className="browser-confirm__target">{browserTabTitleFromTitle(cancelTab.title, copy)}</p>
              <p>{copy.browserCancelTaskBody}</p>
            </div>
            <div className="browser-confirm__actions">
              <Button autoFocus disabled={transitionBusy || closingTabs.has(cancelTab.id)} onClick={() => setCancelTarget(null)}>{copy.back}</Button>
              <Button variant="danger" disabled={transitionBusy || closingTabs.has(cancelTab.id)}
                aria-label={`${copy.manualPromptCancel}: ${browserTabTitleFromTitle(cancelTab.title, copy)}`}
                onClick={() => void closeTab(cancelTab.id, cancelTab.traceId)}>{closingTabs.has(cancelTab.id) ? copy.browserCancellingTask : copy.manualPromptCancel}</Button>
            </div>
          </Panel>
        </div> : null}
        {visible && externalLoginGuide ? externalLoginGuide : visible && browser?.loginKind === "embedded" ? (
          <Notice>{passkeyAvailable ? copy.embeddedLoginPasskeyBody : copy.embeddedLoginBody}</Notice>
        ) : null}
        {sessionRecovery ? (
          <Notice data-testid="browser-session-recovery" tone="warning" title={workflow.session.verificationUnavailable}
            meta={browser.lastVerifiedAt ? workflow.session.lastVerifiedAt.replace("{time}", new Date(browser.lastVerifiedAt).toLocaleString(language)) : undefined}
            action={<>
              {recoverableBrowserTabs.length ? <Button variant="ghost" size="sm" disabled={transitionBusy}
                onClick={() => void selectTab(recoverableBrowserTabs[0]!.id)}>{copy.openWorkspace}</Button> : null}
              <Button size="sm" busy={sessionRetryBusy} disabled={transitionBusy || browser.navigationLocked || !browser.accountId}
                onClick={() => void retrySession()}>
                {sessionRetryBusy ? workflow.session.checkingVerification : workflow.session.retryVerification}
              </Button>
            </>}>
            {sessionIssueCopy(language, browser?.authenticationIssue)}
          </Notice>
        ) : browser?.authenticated === true && (readiness.web === "degraded" || readiness.web === "unavailable") ? (
          <Notice data-testid="browser-web-recovery" tone="warning" title={workflow.recovery.webTransportTitle}
            meta={readiness.native === "ready" ? workflow.recovery.nativePreserved : undefined}>
            {readiness.native === "ready" ? workflow.recovery.webTransportBody : copy.localToolsUnavailableBody}
          </Notice>
        ) : null}
        <NetworkIssueNotice language={language} browser={browser} muted={networkNoticeMuted} onDontShowAgain={onMuteNetworkNotice} />
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
      </div>
      {/* The slot's geometry places the native ChatGPT view (App measures it); keep it the last flex child. */}
      <div className="browser-slot" ref={browserSlotRef}>
        {!visible ? (
          <div className="browser-idle">
            <Mark size={56} />
            {externalLoginGuide ? externalLoginGuide : <div className="browser-idle__copy">
              <h1 className="nk-type-title">{activeBrowserTabs.length ? `${activeBrowserTabs.length} · ${copy.overviewActiveRuns}` : manualInteraction
                ? copy.browserReady
                : browser?.authenticationStatus === "unavailable" ? workflow.session.verificationUnavailable
                  : browser?.authenticated ? copy.noActiveTask : copy.stepAccount}</h1>
              <p>{activeBrowserTabs.length ? copy.overviewActiveRunsBody : manualInteraction
                ? copy.stepAccountBody
                : browser?.authenticationStatus === "unavailable" ? sessionIssueCopy(language, browser.authenticationIssue)
                  : browser?.authenticated
                ? copy.noActiveTaskBody
                : existingChromeWaiting ? copy.existingChromeBody : passkeyWaiting ? copy.passkeyContinueBody : copy.stepAccountBody}</p>
              <div className="browser-idle__actions">
                {activeBrowserTabs.length ? <Button variant="primary" disabled={transitionBusy} onClick={() => void selectTab(activeBrowserTabs[0].id)}>{copy.openWorkspace}</Button> :
                  <Button variant="primary" disabled={transitionBusy || passkeyWaiting || existingChromeWaiting} onClick={() => void toggle()}>
                    {manualInteraction || browser?.authenticated || browser?.authenticationStatus === "unavailable" ? copy.openChatgpt : copy.stepAccount}
                  </Button>}
                {browser?.authenticationStatus === "unavailable" && !manualInteraction ? <Button
                  disabled={sessionRetryBusy || transitionBusy || browser.navigationLocked || !browser.accountId}
                  onClick={() => void retrySession()}>
                  {sessionRetryBusy ? workflow.session.checkingVerification : workflow.session.retryVerification}
                </Button> : null}
                {existingChromeAvailable && browser?.authenticationStatus !== "unavailable" ? <Button
                  disabled={transitionBusy || existingChromeBlocked || existingChromeStarting || existingChromeWaiting}
                  onClick={() => void openExistingChromeLogin()}>{copy.existingChromeSignIn}</Button> : null}
                {passkeyAvailable && browser?.authenticationStatus !== "unavailable" ? (
                  <Button
                    disabled={passkeyActionDisabled}
                    onClick={passkeyWaiting ? continuePasskeyLogin : openPasskeyLogin}
                  >
                    {passkeyLabel}
                  </Button>
                ) : null}
              </div>
            </div>}
          </div>
        ) : (
          <div className="browser-slot__underlay" aria-hidden="true">
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
