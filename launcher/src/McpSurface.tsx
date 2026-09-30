import { accountToolsCopy, accountToolsStep } from "./account-tools-onboarding";
import { useAccountPoolSnapshot } from "./useAccountPoolSnapshot";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { connectorAttachCopyFor, connectorAttachNotice, native6CopyFor, localizeRuntimeMessage, type Copy } from "./i18n";
import { modelsTabConnection, type ConnectionStatus, type WorkspaceReadiness } from "./workspace-readiness";
import { connectionTabStatus, connectionsCopy, connectionsSubtitle } from "./connections-copy";
import { workflowCopy } from "./workflow-copy";
import type { BrowserInteractionMode, DoctorReport, Language, LauncherSnapshot, LauncherState, OperationState } from "./types";
import { Button, Disclosure, Icon, Notice, Page, Panel, PhaseSteps, StateDot, SurfaceHeader, TextField, cx } from "./design";
import { ConnectionsTabs, connectionsTabPanelProps, messageOf, TutorialVideo, DoctorSummary } from './launcher-ui';
import { connectorProofMismatch, runtimeCapabilities, currentToolProof } from './launcher-readiness';
import "./surfaces/connections.css";
const api = window.codexWebLauncher;
const MCP_GUIDE_MEDIA = [
  new URL("./assets/mcp-create-tunnel.mp4", import.meta.url).href,
  new URL("./assets/mcp-connect-connector.mp4", import.meta.url).href,
  null,
] as const;
export function McpSurface({
  accountSetupLabel,
  targetAccountId = null,
  browserAccountId = null,
  onReturnToAccount,
  copy,
  devProfile,
  interactionMode,
  language,
  onDone,
  operation,
  readiness,
  setError,
  showSetup,
  snapshot,
  updateState,
  updateSnapshot,
}: {
  accountSetupLabel?: string | null;
  /** Per-account setup (opened from an account card): the account whose connector this page sets up. */
  targetAccountId?: string | null;
  /** The account open in the Browser (live browser state; the launcher snapshot's copy can lag behind). */
  browserAccountId?: string | null;
  onReturnToAccount?: () => void;
  copy: Copy;
  devProfile: boolean;
  interactionMode: BrowserInteractionMode;
  language: Language;
  onDone: () => void;
  operation: OperationState | null;
  readiness: WorkspaceReadiness;
  setError: (error: string | null) => void;
  showSetup: () => void;
  snapshot: LauncherSnapshot;
  updateState: (state: LauncherState) => void;
  updateSnapshot: () => Promise<void>;
}) {
  const configuringInactiveMode = interactionMode !== snapshot.state.browserInteractionMode;
  const [step, setStep] = useState(
    configuringInactiveMode ? 1
      : snapshot.state.mcpRuntimeInstalled && snapshot.mcpCredentialsConfigured ? 2
      : Math.min(2, Math.max(0, snapshot.state.mcpGuideStep || 0)),
  );
  const [tunnelId, setTunnelId] = useState("");
  const [runtimeKey, setRuntimeKey] = useState("");
  const [credentialsConfigured, setCredentialsConfigured] = useState(
    interactionMode === snapshot.state.browserInteractionMode
      ? snapshot.mcpCredentialsConfigured
      : false,
  );
  const [replacingCredentials, setReplacingCredentials] = useState(false);
  useEffect(() => {
    if (!replacingCredentials && interactionMode === snapshot.state.browserInteractionMode) {
      setCredentialsConfigured(snapshot.mcpCredentialsConfigured);
    }
  }, [interactionMode, replacingCredentials, snapshot.mcpCredentialsConfigured, snapshot.state.browserInteractionMode]);
  const [localBusy, setLocalBusy] = useState(false);
  const repairInFlight = useRef(false);
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairOutcome, setRepairOutcome] = useState<"recovered" | "unavailable" | "failed" | null>(null);
  const [repairOutcomeRevision, setRepairOutcomeRevision] = useState<number | null>(null);
  const workflow = workflowCopy(language);
  const words = connectionsCopy(language);
  const currentRuntime = runtimeCapabilities(snapshot);
  const busy = localBusy || operation?.status === "running";
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const wizardHeading = useRef<HTMLHeadingElement>(null);
  const tunnelFieldId = useId();
  const runtimeKeyFieldId = useId();
  const replaceCredentialsId = useId();
  // Replace / Keep saved credentials swap the controls: focus moves to the control that takes the removed one's place.
  const credentialsFocus = useRef<string | null>(null);
  const previousStep = useRef(step);
  // The global tool proof belongs to the account selected in the Browser. Per-account setup reports that account's
  // own connector check (the same fact as its card), never another account's proof.
  const { snapshot: pool } = useAccountPoolSnapshot({ api: api!, initial: "immediate", retainOnFailure: false,
    identity: targetAccountId ?? "" });
  const targetAccount = targetAccountId ? pool?.accounts.find(account => account.id === targetAccountId) ?? null : null;
  // The card's own derivation (accountToolsStep), so the page and the account card never disagree.
  const runtimeConfigured = snapshot.state.mcpRuntimeInstalled === true && snapshot.mcpCredentialsConfigured;
  const verified = !configuringInactiveMode && (targetAccountId
    ? targetAccount !== null && accountToolsStep(targetAccount, runtimeConfigured) === "verified"
    : currentToolProof(snapshot, operation));
  // ChatGPT pages (developer mode, plugins) open in the configured account's own window; with no account they fall
  // back to the system browser.
  const pageAccountId = targetAccountId ?? browserAccountId ?? snapshot.browser?.accountId ?? null;
  const manualInteraction = interactionMode === "manual";
  useEffect(() => {
    if (repairOutcome !== "recovered" || repairOutcomeRevision === null
      || (currentRuntime?.revision ?? 0) <= repairOutcomeRevision) return;
    if (readiness.web !== "ready" || currentRuntime?.tunnelRepair?.eligible === true
      || currentRuntime?.tunnelRepair?.active === true) {
      setRepairOutcome(null);
      setRepairOutcomeRevision(null);
    }
  }, [currentRuntime?.revision, currentRuntime?.tunnelRepair?.active,
    currentRuntime?.tunnelRepair?.eligible, readiness.web, repairOutcome, repairOutcomeRevision]);
  const steps = useMemo(() => [
    { title: accountToolsCopy(language).tunnelTitle, body: accountToolsCopy(language).sharedTunnel },
    { title: copy.mcpStepTwo, body: copy.mcpStepTwoBody },
    {
      title: copy.mcpStepThree,
      body: manualInteraction ? copy.manualMcpStepThreeBody : null,
    },
  ], [copy, language, manualInteraction]);
  const guideMedia = MCP_GUIDE_MEDIA[step];
  const recommendedConnectorName = snapshot
    .recommendedConnectorNames?.[interactionMode]?.trim() ?? "";
  const retainedTargetName = snapshot.connectorNames[interactionMode]?.trim() ?? "";
  const targetConnectorName = recommendedConnectorName
    || (manualInteraction || snapshot.state.experimentalAsyncToolOperations ? retainedTargetName : "");
  const currentConnectorName = retainedTargetName;
  const connectorIdentityAvailable = targetConnectorName.length > 0;
  const exactConnectorVerified = verified
    && snapshot.state.setupConnectorName === targetConnectorName;
  const native6UpgradeAvailable = !manualInteraction
    && (recommendedConnectorName
      ? currentConnectorName !== recommendedConnectorName
      : snapshot.state.experimentalAsyncToolOperations !== true);
  const connectorConfiguredForTarget = connectorIdentityAvailable && !native6UpgradeAvailable;
  // The saved identity already is the target: nothing is renamed or upgraded, only attached here.
  const reattachingSavedConnector = connectorConfiguredForTarget && currentConnectorName === targetConnectorName;
  const setupAccountLabel = accountSetupLabel || snapshot.browser?.accountLabel || null;

  // A pressed control that a state change removes while it has focus hands focus on instead of dropping it to <body>:
  // "Upgrade to Native6" and "Use Native4 (compatibility)" replace each other once the connector identity changes, and
  // the Web transport repair notice goes once the route has recovered. Focus moves to the control that took the
  // pressed one's place, else (none, or folded away in its closed details) to the step heading.
  const upgradeButton = useRef<HTMLButtonElement>(null);
  const compatibilityButton = useRef<HTMLButtonElement>(null);
  const repairButton = useRef<HTMLButtonElement>(null);
  const removalFocus = useRef<{ pressed: HTMLElement | null; next: RefObject<HTMLElement | null> | null } | null>(null);
  useLayoutEffect(() => {
    const pending = removalFocus.current;
    if (!pending) return;
    if (pending.pressed?.isConnected) {
      if (document.activeElement !== pending.pressed) removalFocus.current = null;
      return;
    }
    removalFocus.current = null;
    if (document.activeElement && document.activeElement !== document.body) return;
    const next = pending.next?.current;
    (next && !next.closest("details:not([open])") ? next : wizardHeading.current)?.focus();
  });

  const setAsyncConnectorIdentity = async (enabled: boolean) => {
    if (busy) return;
    setLocalBusy(true);
    setError(null);
    removalFocus.current = enabled
      ? { pressed: upgradeButton.current, next: compatibilityButton }
      : { pressed: compatibilityButton.current, next: upgradeButton };
    try {
      updateState(await api!.setAsyncToolOperations(enabled));
      await updateSnapshot();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLocalBusy(false);
    }
  };

  const guide = useRef<HTMLDetailsElement>(null);
  const identityInputId = useId();

  useEffect(() => {
    const target = credentialsFocus.current;
    if (!target) return;
    credentialsFocus.current = null;
    document.getElementById(target)?.focus();
  }, [replacingCredentials]);

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    requestAnimationFrame(() => wizardHeading.current?.focus());
  }, [step]);

  const move = async (next: number) => {
    const state = await api!.setMcpStep(next);
    updateState(state);
    setStep(next);
  };
  const safeMove = async (next: number) => {
    if (busy) return;
    setError(null);
    try {
      await move(next);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const openExternal = async (url: string) => {
    setError(null);
    try {
      await api!.openExternal(url);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const openChatGptPage = async (url: string) => {
    if (!pageAccountId) return openExternal(url);
    setError(null);
    try {
      await api!.openBrowserWorkspace(pageAccountId, { asTab: false, address: url });
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const install = async () => {
    if (busy) return;
    setLocalBusy(true);
    setError(null);
    try {
      await api!.setupMcp({
        interactionMode,
        ...(credentialsConfigured && !replacingCredentials
          ? { replace: false }
          : { tunnelId, runtimeKey, replace: true }),
      });
      setRuntimeKey("");
      setTunnelId("");
      setCredentialsConfigured(true);
      setReplacingCredentials(false);
      try {
        await updateSnapshot();
      } catch (cause) {
        // setupMcp has already committed; a stale metadata read must not make
        // the committed setup look like an installation failure.
        setError(messageOf(cause));
      }
      await move(2);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLocalBusy(false);
    }
  };
  const verify = async () => {
    if (busy) return;
    setLocalBusy(true);
    setError(null);
    setDoctor(null);
    try {
      setDoctor(await api!.verifyMcp());
      await updateSnapshot();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLocalBusy(false);
    }
  };
  const repairWebRoute = async () => {
    const repair = runtimeCapabilities(snapshot)?.tunnelRepair;
    if (repairInFlight.current || repair?.eligible !== true || repair.active || busy) return;
    repairInFlight.current = true;
    removalFocus.current = { pressed: repairButton.current, next: null };
    setRepairBusy(true);
    setRepairOutcome(null);
    setRepairOutcomeRevision(null);
    setError(null);
    try {
      const result = await api!.repairWebRoute();
      await updateSnapshot();
      setRepairOutcome(result.status);
      setRepairOutcomeRevision(currentRuntime?.revision ?? 0);
    } catch (cause) {
      setRepairOutcome("failed");
      setRepairOutcomeRevision(currentRuntime?.revision ?? 0);
      setError(messageOf(cause));
    } finally {
      repairInFlight.current = false;
      setRepairBusy(false);
    }
  };

  const tunnelRepair = runtimeCapabilities(snapshot)?.tunnelRepair;
  const repairing = repairBusy || tunnelRepair?.active === true;
  // An eligible repair is the next step: it takes the primary, and the wizard's own action steps back to secondary.
  const repairIsNext = !configuringInactiveMode && tunnelRepair?.eligible === true && !repairing;
  // The shown step is always the current one; steps before it are done, steps after it are still ahead (even when
  // the connector was verified earlier, the wizard does not claim a later step while an earlier one is open).
  const stepState = (index: number) => index === step ? "current" as const : index < step ? "complete" as const : "upcoming" as const;
  const tunnelInvalid = Boolean(tunnelId && !tunnelId.trim());
  // Configuring the inactive mode: the active mode's status would describe a different connection.
  const toolsTab: ConnectionStatus = configuringInactiveMode
    ? { key: interactionMode === "manual" ? "needs-setup" : "not-connected", dot: "idle", action: "connect", ready: false }
    : !targetAccountId ? readiness.connections.tools
    : verified ? { key: "verified", dot: "ready", action: "manage", ready: true }
      : { key: credentialsConfigured ? "connector-pending" : "not-connected", dot: "idle", action: "connect", ready: false };
  const runtimeKeyInvalid = Boolean(runtimeKey && !runtimeKey.trim());

  return (
    <Page className="nk-connections">
      <SurfaceHeader
        actions={onReturnToAccount ? <Button disabled={busy} icon="back" onClick={onReturnToAccount} variant="ghost">
          {accountToolsCopy(language).back}
        </Button> : undefined}
        subtitle={connectionsSubtitle(copy, language, { development: devProfile,
          manual: interactionMode === "manual" })}
        title={copy.connectionsNav}
      />
      <ConnectionsTabs active="tools" copy={copy}
        modelsReady={modelsTabConnection(readiness.connections).ready}
        modelsStatus={connectionTabStatus(modelsTabConnection(readiness.connections), copy, language)}
        onModels={showSetup} onTools={() => {}}
        toolsReady={toolsTab.ready}
        toolsStatus={connectionTabStatus(toolsTab, copy, language)} />
      <div className="nk-connections__content" {...connectionsTabPanelProps("tools")}>
        {accountSetupLabel ? (
          // The system-browser caveat is on step 1, next to the links it concerns.
          <Notice title={`${accountToolsCopy(language).target}: ${accountSetupLabel}`} />
        ) : null}
        {!manualInteraction && !configuringInactiveMode && !snapshot.state.codexCatalogVerified ? (
          <Notice icon="setup" tone="warning">{copy.mcpCatalogRequired}</Notice>
        ) : null}
        {/* Kept while the repair runs: a snapshot read before the outcome is set must not remove the focused button. */}
        {!configuringInactiveMode && (repairing || tunnelRepair?.eligible === true || repairOutcome) ? (
          <Notice
            data-testid="web-route-repair"
            action={<Button busy={repairing} disabled={busy || tunnelRepair?.eligible !== true} ref={repairButton}
              onClick={() => void repairWebRoute()} size="sm" variant={repairIsNext && !busy ? "primary" : "secondary"}>
              {repairing ? workflow.recovery.repairing : workflow.recovery.repairAction}
            </Button>}
            meta={repairOutcome ? <span role="status">{repairOutcome === "recovered" ? workflow.recovery.recovered
              : repairOutcome === "unavailable" ? workflow.recovery.stillUnavailable : workflow.recovery.couldNotVerify}</span> : undefined}
            title={workflow.recovery.webTransportTitle}
            tone="warning"
          >
            {readiness.native === "ready" ? workflow.recovery.webTransportBody : copy.localToolsUnavailableBody}
          </Notice>
        ) : null}

        <div aria-label={`${devProfile ? copy.devMcpTitle : copy.toolsConnectionTab}: ${step + 1} / 3`} className="nk-connections__wizard" role="group">
          {/* A progress indicator only: Back and Next move between steps. */}
          <PhaseSteps steps={steps.map((item, index) => ({
            label: item.title,
            state: stepState(index),
            current: index === step,
          }))} />
        </div>

        <div aria-busy={busy} className="nk-connections__stage">
          <Panel as="section" className="nk-connections__step" key={step}>
            <header className="nk-connections__step-head">
              <small>{`0${step + 1}`}</small>
              <h2 ref={wizardHeading} tabIndex={-1}>{steps[step]!.title}</h2>
              {step === 2 && !manualInteraction ? <div className="nk-connections__instructions">
                <ol>
                  {[copy.mcpStepThreeStepOne, copy.mcpStepThreeStepTwo, copy.mcpStepThreeStepThree]
                    .map(instruction => <li key={instruction}>{instruction}</li>)}
                </ol>
                <p>{copy.mcpStepThreePermissions}</p>
              </div> : steps[step]!.body ? <p>{steps[step]!.body}</p> : null}
            </header>

            {step === 0 ? (
              <div className="nk-connections__step-body">
                <p>{accountToolsCopy(language).keyInstructions}</p>
                <p>{accountToolsCopy(language).identity}</p>
                <div className="nk-connections__actions">
                  <Button icon="external" onClick={() => void openExternal(snapshot.urls.tunnels)}>{copy.openTunnels}</Button>
                  <Button icon="external" onClick={() => void openExternal(snapshot.urls.keys)}>{copy.openKeys}</Button>
                </div>
              </div>
            ) : null}
            {step === 1 ? (
              <div className="nk-connections__step-body">
                {credentialsConfigured && !replacingCredentials ? (
                  <Notice
                    action={<Button disabled={busy} id={replaceCredentialsId} size="sm" variant="ghost"
                      onClick={() => { credentialsFocus.current = tunnelFieldId; setReplacingCredentials(true); }}>
                      {copy.replaceCredentials}
                    </Button>}
                    title={copy.credentialsConfigured}
                    tone="success"
                  >
                    {copy.credentialsConfiguredBody}
                  </Notice>
                ) : (
                  <div className="nk-connections__fields">
                    <TextField
                      // The kit wires the error (id `${id}-hint`); the shared hint stays in the description.
                      aria-describedby={tunnelInvalid ? `${tunnelFieldId}-hint mcp-credentials-hint` : "mcp-credentials-hint"}
                      autoCapitalize="none"
                      autoCorrect="off"
                      error={tunnelInvalid ? words.tunnelIdRequired : undefined}
                      id={tunnelFieldId}
                      label={copy.tunnelId}
                      onChange={(event) => setTunnelId(event.target.value)}
                      placeholder="tunnel_…"
                      spellCheck={false}
                      value={tunnelId}
                    />
                    <TextField
                      aria-describedby={runtimeKeyInvalid ? `${runtimeKeyFieldId}-hint mcp-credentials-hint` : "mcp-credentials-hint"}
                      autoCapitalize="none"
                      autoCorrect="off"
                      error={runtimeKeyInvalid ? words.runtimeKeyRequired : undefined}
                      id={runtimeKeyFieldId}
                      label={copy.runtimeKey}
                      onChange={(event) => setRuntimeKey(event.target.value)}
                      placeholder="sk-…"
                      spellCheck={false}
                      type="password"
                      value={runtimeKey}
                    />
                    {credentialsConfigured ? (
                      <div className="nk-connections__actions">
                        <Button
                          disabled={busy}
                          onClick={() => {
                            setTunnelId("");
                            setRuntimeKey("");
                            credentialsFocus.current = replaceCredentialsId;
                            setReplacingCredentials(false);
                          }}
                          size="sm"
                          variant="ghost"
                        >
                          {copy.keepCredentials}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
                <p className="nk-connections__hint" id="mcp-credentials-hint">
                  {manualInteraction || configuringInactiveMode || snapshot.state.codexCatalogVerified
                    ? copy.mcpStepTwoHint
                    : copy.mcpCatalogRequired}
                </p>
                {credentialsConfigured && !replacingCredentials ? (
                  <p className="nk-connections__hint">{workflow.recovery.fullSetupBody}</p>
                ) : null}
              </div>
            ) : null}
            {step === 2 ? (
              <div className="nk-connections__step-body">
                {!manualInteraction && !verified && reattachingSavedConnector ? (
                  <Notice tone="warning">
                    {connectorAttachNotice(language, targetConnectorName, setupAccountLabel)}
                  </Notice>
                ) : <details className="nk-connections__nested"><summary>
                  <Icon className="nk-icon" focusable="false" name="chevron" size={14} />{copy.connectorUpgradeHelp}</summary>
                  <Notice tone="warning">
                    {manualInteraction ? copy.manualConnectorNotice : native6CopyFor(language).retained}
                  </Notice>
                  {!manualInteraction && snapshot.state.experimentalAsyncToolOperations ? (
                    <Button disabled={busy} onClick={() => void setAsyncConnectorIdentity(false)} ref={compatibilityButton} size="sm">
                      {native6CopyFor(language).compatibility}
                    </Button>
                  ) : null}
                </details>}
                {!configuringInactiveMode && connectorProofMismatch(snapshot)
                  ? <Notice tone="warning">{native6CopyFor(language).mismatch}</Notice> : null}
                {native6UpgradeAvailable ? (
                  <Notice
                    action={<Button disabled={busy} onClick={() => void setAsyncConnectorIdentity(true)} ref={upgradeButton} size="sm"
                      variant="primary">
                      {native6CopyFor(language).upgrade}
                    </Button>}
                    icon="update"
                  >
                    {recommendedConnectorName
                      ? native6CopyFor(language).body.replace("{connector}", recommendedConnectorName)
                      : native6CopyFor(language).title}
                  </Notice>
                ) : null}
                <div className="nk-connections__identity">
                  <dl>
                    {reattachingSavedConnector ? null : (
                      <div>
                        <dt>{copy.currentSavedConnector}</dt>
                        <dd><code>{currentConnectorName || copy.connectorIdentityUnavailable}</code></dd>
                      </div>
                    )}
                    <div>
                      <dt><label htmlFor={identityInputId}>
                        {reattachingSavedConnector ? connectorAttachCopyFor(language).nameInChatGpt : copy.createConnectorIdentity}
                      </label></dt>
                      <dd>
                        <input aria-label={reattachingSavedConnector ? connectorAttachCopyFor(language).nameInChatGpt : copy.createConnectorIdentity}
                          className="nk-input" id={identityInputId} readOnly
                          onFocus={event => event.currentTarget.select()}
                          value={targetConnectorName || copy.connectorIdentityUnavailable} />
                      </dd>
                    </div>
                  </dl>
                  {native6UpgradeAvailable ? (
                    <p className="nk-connections__warning"><Icon className="nk-icon" name="alert" />{copy.newConnectorRequired}</p>
                  ) : null}
                  <p className={cx("nk-connections__status", exactConnectorVerified && "is-ready")} role="status">
                    <StateDot state={exactConnectorVerified ? "ready" : "idle"} />
                    {exactConnectorVerified ? copy.connectorVerified : copy.connectorNotVerified}
                  </p>
                </div>
                <div className="nk-connections__actions">
                  {snapshot.urls.developerMode ? <Button icon="browser"
                    onClick={() => void openChatGptPage(snapshot.urls.developerMode!)}>{copy.openDeveloperMode}</Button> : null}
                  <Button
                    disabled={!connectorConfiguredForTarget}
                    icon="browser"
                    onClick={() => void openChatGptPage(snapshot.urls.connectors)}
                  >
                    {copy.openConnectors}
                  </Button>
                </div>
                {doctor ? <DoctorSummary copy={copy} language={language} report={doctor} /> : null}
              </div>
            ) : null}

            <footer className="nk-connections__step-actions">
              <Button disabled={step === 0 || busy} icon="back" onClick={() => void safeMove(step - 1)} variant="ghost">
                {copy.previous}
              </Button>
              <span className="nk-connections__spacer" />
              {step === 0 ? <Button disabled={busy} onClick={() => void safeMove(1)} variant={repairIsNext ? "secondary" : "primary"}>{copy.next}</Button> : null}
              {step === 1 ? (
                <Button
                  disabled={
                    busy
                    || (!manualInteraction && !configuringInactiveMode && !snapshot.state.codexCatalogVerified)
                    || ((!credentialsConfigured || replacingCredentials) && (!tunnelId.trim() || !runtimeKey.trim()))
                  }
                  onClick={() => void install()}
                  variant={repairIsNext ? "secondary" : "primary"}
                >
                  {busy ? copy.running : credentialsConfigured && !replacingCredentials
                    ? workflow.recovery.fullSetupAction : copy.connect}
                </Button>
              ) : null}
              {step === 2 ? (
                <>
                  {!onReturnToAccount && verified ? (
                    <Button disabled={busy} onClick={() => void verify()}>
                      {copy.verifyRuntime}
                    </Button>
                  ) : null}
                  {/* Going back to the account is always possible; only verifying needs the target connector identity. */}
                  <Button
                    disabled={busy || (!onReturnToAccount && !connectorConfiguredForTarget)}
                    onClick={() => void (onReturnToAccount ? onReturnToAccount() : verified ? onDone() : verify())}
                    variant={native6UpgradeAvailable || repairIsNext ? "secondary" : "primary"}
                  >
                    {busy
                      ? operation?.name === "mcp-verification" && operation.status === "running"
                        ? localizeRuntimeMessage(copy, operation.message, undefined, language)
                        : copy.running
                      : onReturnToAccount ? accountToolsCopy(language).back : verified ? copy.done : native6CopyFor(language).verify}
                  </Button>
                </>
              ) : null}
            </footer>
          </Panel>

          {guideMedia ? <Disclosure ref={guide} title={copy.guideVideo}
            onToggle={open => { if (!open) guide.current?.querySelector("video")?.pause(); }}>
            <div className="nk-connections__disclosure-content">
              <TutorialVideo
                copy={copy}
                label={`${copy.guideVideo}: ${steps[step]!.title}`}
                src={guideMedia}
              />
            </div>
          </Disclosure> : null}
        </div>
      </div>
    </Page>
  );
}
