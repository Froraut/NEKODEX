import { useFeatureAction } from "./useFeatureAction";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { BrowserWorkspaceManager } from "./BrowserWorkspaceManager";
import { ExistingChromeLoginGuide } from "./ExistingChromeLoginGuide";
import { PasskeyLoginGuide } from "./PasskeyLoginGuide";
import { ManualTurnGuide } from "./ManualTurnGuide";
import { Button, Icon, IconButton, Mark, Notice, Panel, Select, StateDot, cx } from "./design";
import { messageOf } from "./launcher-ui";
import { localizeLauncherError, type Copy } from "./i18n";
import { browserControls } from "./browser-controls";
import { browserWindowCopy } from "./browser-window-copy";
import { connectionsCopy } from "./connections-copy";
import { passkeyFailureText } from "./passkey-copy";
import { sessionIssueCopy } from "./session-issue-copy";
import { shellCopy } from "./shell-copy";
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
  onOpenConnections,
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
  /** Opens Connections, where the Web transport is repaired (the web-recovery notice's action). */
  onOpenConnections?: () => void;
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
  const frameRef = useRef<HTMLElement>(null);
  const tabStrip = useRef<HTMLDivElement>(null);
  const toolbarToggle = useRef<HTMLButtonElement>(null);
  const idlePrimary = useRef<HTMLButtonElement>(null);
  // The control that opened the cancel confirmation (a tab's stop button or the manual guide's Cancel turn).
  const confirmOpener = useRef<HTMLElement | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    // The separate windows panel (BrowserWorkspaceManager) hands off focus for its own controls.
    const remember = (event: FocusEvent) => {
      const target = event.target;
      lastFocused.current = target instanceof HTMLElement && !target.closest(".browser-windows") ? target : null;
    };
    // Focus that leaves a control which is still on the page (a click on empty space, another view) is not a removal:
    // forget it, so a later unrelated removal does not pull focus back.
    const release = (event: FocusEvent) => {
      const target = event.target;
      if (event.relatedTarget || target !== lastFocused.current) return;
      window.setTimeout(() => {
        if (lastFocused.current === target && target instanceof HTMLElement && target.isConnected) lastFocused.current = null;
      });
    };
    frame.addEventListener("focusin", remember);
    frame.addEventListener("focusout", release);
    return () => {
      frame.removeEventListener("focusin", remember);
      frame.removeEventListener("focusout", release);
    };
  }, []);
  // When a state change removes the focused control (toolbar, idle state, guide, confirmation, tab), focus moves to
  // the next logical control instead of falling to <body>. The separate windows panel handles its own rows.
  useLayoutEffect(() => {
    const previous = lastFocused.current;
    if (!previous || previous.isConnected) return;
    lastFocused.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const frame = frameRef.current;
    if (!frame) return;
    const find = (selector: string) => frame.querySelector<HTMLElement>(selector);
    const selectedTab = () => find('.browser-tabs [role="tab"][aria-selected="true"]');
    // A replacement that mounts disabled cannot take focus (the idle Sign in while a passkey sign-in waits, after
    // Hide ChatGPT): skip it for the next candidate, the state's heading.
    const enabled = (element: HTMLElement | null) => element && !element.matches(":disabled") ? element : null;
    let target: HTMLElement | null = null;
    if (previous.closest(".browser-confirm")) {
      target = confirmOpener.current?.isConnected ? confirmOpener.current : selectedTab();
    } else if (previous.closest(".browser-tabs__tab")) {
      target = selectedTab();
    } else if (previous.closest(".browser-manual")) {
      target = find(".browser-manual__title");
    }
    target ??= find(".browser-guide__title")
      ?? enabled(visible ? toolbarToggle.current : idlePrimary.current)
      ?? find("h1")
      ?? selectedTab();
    target?.focus();
  });
  const askToCancel = (tab: { id: string; traceId: string | null }, opener: HTMLElement | null) => {
    confirmOpener.current = opener;
    setCancelTarget({ id: tab.id, traceId: tab.traceId });
  };
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
  // Starting, importing, verifying and cancelling are progress states: the button shows a spinner, not only faint text.
  const passkeyBusy = passkeyLabel !== copy.passkeySignIn && passkeyLabel !== copy.passkeyContinue;
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

  // On the idle slot a guide replaces the state (its title is the page's h1); above a visible page it is a section.
  const guideHeadingLevel = visible ? 2 : 1;
  const externalLoginGuide = !manualInteraction && browser?.existingChromeLogin && browser.existingChromeLogin.phase !== "completed" ? (
    <ExistingChromeLoginGuide transitionBusy={transitionBusy} progress={browser.existingChromeLogin} copy={copy} language={language}
      headingLevel={guideHeadingLevel} onRetry={openExistingChromeLogin} setError={setError} />
  ) : !manualInteraction && browser?.passkeyLogin && browser.passkeyLogin.phase !== "completed" ? (
    <PasskeyLoginGuide transitionBusy={transitionBusy} progress={browser.passkeyLogin} copy={copy} language={language}
      headingLevel={guideHeadingLevel} onRetry={openPasskeyLogin} onContinue={continuePasskeyLogin}
      continuePending={passkeyRequestPending} setError={setError} />
  ) : null;
  // The existing-Chrome guide owns its import failure (message, retry): the same operation error is not repeated above it.
  const errorOwnedByGuide = Boolean(error && browser?.existingChromeLogin && externalLoginGuide
    && operation?.name === "existing-chrome-login" && operation.status === "failed" && operation.message === error);
  const zoomLevel = `${Math.round((browser?.zoomFactor ?? 1) * 100)}%`;
  // The notice's action opens Connections (it does not repair by itself), worded like the Setup row's.
  const webRecoveryAction = readiness.action === "repair-web" ? connectionsCopy(language).openRepair
    : readiness.action === "open-tools" ? copy.manageToolsConnection : null;

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
    <section className="browser-frame" ref={frameRef}>
      {/* The idle state and an idle sign-in guide carry the page's h1; a visible page gets a hidden one. */}
      {visible ? <h1 className="nk-visually-hidden" tabIndex={-1}>{copy.browser}</h1> : null}
      {/* One bar for the task tabs, the account context and separate windows; an open window list wraps below it. */}
      <div className="browser-bar">
        <div className="browser-tabs" ref={tabStrip} role="tablist" aria-label={windowCopy.taskTabs} title={copy.browserTabLimit}
          onWheel={(event) => {
            // A vertical mouse wheel scrolls the strip sideways when it overflows.
            const strip = event.currentTarget;
            if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && strip.scrollWidth > strip.clientWidth) strip.scrollLeft += event.deltaY;
          }}>
          {(browser?.tabs ?? []).map((tab) => {
            const running = tab.status === "running";
            const closing = closingTabs.has(tab.id);
            return (
              <div className={cx("browser-tabs__tab", tab.active && "is-active", running && "is-running", closing && "is-closing")} key={tab.id}>
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
                    onClick={(event) => {
                      if (running) askToCancel(tab, event.currentTarget);
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
          {/* The spoken name starts with the visible level: "100% Reset zoom". */}
          <Button variant="ghost" size="sm" className="browser-nav__zoom" title={copy.zoomReset}
            onClick={() => void zoom("reset")}>
            {zoomLevel}<span className="nk-visually-hidden"> {copy.zoomReset}</span>
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
            <Button variant="ghost" size="sm" busy={passkeyBusy}
              disabled={passkeyActionDisabled}
              onClick={() => void (passkeyWaiting ? continuePasskeyLogin() : openPasskeyLogin())}
            >
              {passkeyLabel}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" ref={toolbarToggle} disabled={transitionBusy && !visible} onClick={() => void toggle()}>
            {visible ? copy.hideBrowser : copy.openChatgpt}
          </Button>
        </div>
        {browser?.loading ? <i className="browser-nav__progress" aria-hidden="true" /> : null}
      </div> : null}
      {/* The native view paints above renderer overlays, so notices take layout space above the slot. */}
      <div className="browser-notices">
        {error && !errorOwnedByGuide ? <Notice tone="error" className="browser-notices__error"
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
            meta={browser.lastVerifiedAt ? workflow.session.lastVerifiedAt.replace("{time}", formatDateTime(browser.lastVerifiedAt, language)) : undefined}
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
            action={webRecoveryAction && onOpenConnections ? <Button size="sm" disabled={transitionBusy}
              onClick={onOpenConnections}>{webRecoveryAction}</Button> : undefined}>
            {readiness.native === "ready" ? workflow.recovery.webTransportBody : copy.localToolsUnavailableBody}
          </Notice>
        ) : null}
        <NetworkIssueNotice language={language} browser={browser} muted={networkNoticeMuted} onDontShowAgain={onMuteNetworkNotice} />
        {accountSetup}
        {selectedManualTab
          && ["awaiting-user", "sent"].includes(selectedManualTab.manualState ?? "") ? (
          <ManualTurnGuide
            copy={copy}
            confirmPending={confirmingTabs.has(selectedManualTab.id)}
            transitionBusy={transitionBusy}
            onCancel={(opener) => {
              // Match the tab strip: stopping a running turn asks for confirmation first.
              if (selectedManualTab.status === "running") askToCancel(selectedManualTab, opener);
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
              <h1 className="nk-type-title" tabIndex={-1}>{activeBrowserTabs.length ? `${activeBrowserTabs.length} · ${copy.overviewActiveRuns}` : manualInteraction
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
                {activeBrowserTabs.length ? <Button variant="primary" ref={idlePrimary} disabled={transitionBusy} onClick={() => void selectTab(activeBrowserTabs[0].id)}>{copy.openWorkspace}</Button> :
                  <Button variant="primary" ref={idlePrimary} disabled={transitionBusy || passkeyWaiting || existingChromeWaiting} onClick={() => void toggle()}>
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
                  <Button busy={passkeyBusy}
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
            {/* The launch screen's loading treatment: a spinner and the localized "Loading…". */}
            <span className="nk-spinner" /><span>{shellCopy(language).loading}</span>
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

function formatDateTime(value: string, language: Language): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(date);
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
