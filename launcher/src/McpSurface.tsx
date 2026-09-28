import { accountToolsCopy } from "./account-tools-onboarding";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { native6CopyFor, localizeRuntimeMessage, type Copy } from "./i18n";
import { modelsTabConnection, type WorkspaceReadiness } from "./workspace-readiness";
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
  const verified = !configuringInactiveMode && currentToolProof(snapshot, operation);
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

  const setAsyncConnectorIdentity = async (enabled: boolean) => {
    if (busy) return;
    setLocalBusy(true);
    setError(null);
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
  const runtimeKeyInvalid = Boolean(runtimeKey && !runtimeKey.trim());

  return (
    <Page className="nk-connections">
      <SurfaceHeader
        actions={onReturnToAccount ? <Button disabled={busy} icon="back" onClick={onReturnToAccount} variant="ghost">
          {accountToolsCopy(language).back}
        </Button> : undefined}
        subtitle={connectionsSubtitle(copy, language, { development: devProfile,
          manual: snapshot.state.browserInteractionMode === "manual" })}
        title={copy.connectionsNav}
      />
      <ConnectionsTabs active="tools" copy={copy}
        modelsReady={modelsTabConnection(readiness.connections).ready}
        modelsStatus={connectionTabStatus(modelsTabConnection(readiness.connections), copy, language)}
        onModels={showSetup} onTools={() => {}}
        toolsReady={readiness.connections.tools.ready}
        toolsStatus={connectionTabStatus(readiness.connections.tools, copy, language)} />
      <div className="nk-connections__content" {...connectionsTabPanelProps("tools")}>
        {accountSetupLabel ? (
          <Notice title={`${accountToolsCopy(language).target}: ${accountSetupLabel}`}>{accountToolsCopy(language).identity}</Notice>
        ) : null}
        {!manualInteraction && !configuringInactiveMode && !snapshot.state.codexCatalogVerified ? (
          <Notice icon="setup" tone="warning">{copy.mcpCatalogRequired}</Notice>
        ) : null}
        {!configuringInactiveMode && (tunnelRepair?.eligible === true || tunnelRepair?.active === true || repairOutcome) ? (
          <Notice
            data-testid="web-route-repair"
            action={<Button busy={repairing} disabled={busy || tunnelRepair?.eligible !== true}
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
          {/* Earlier steps (and the current one) are buttons that return to that step. */}
          <PhaseSteps disabled={busy} onSelect={index => void safeMove(index)}
            steps={steps.map((item, index) => ({
              label: item.title,
              state: stepState(index),
              current: index === step,
              selectable: index <= step,
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
                {!manualInteraction && !verified && ["Codex Native6", "Codex Native6 DEV"].includes(snapshot.connectorNames[interactionMode]) ? (
                  <Notice tone="warning">
                    {native6CopyFor(language).body.replace("{connector}", snapshot.connectorNames[interactionMode])}
                  </Notice>
                ) : <details className="nk-connections__nested"><summary>
                  <Icon className="nk-icon" focusable="false" name="chevron" size={14} />{copy.connectorUpgradeHelp}</summary>
                  <Notice tone="warning">
                    {manualInteraction ? copy.manualConnectorNotice : native6CopyFor(language).retained}
                  </Notice>
                  {!manualInteraction && snapshot.state.experimentalAsyncToolOperations ? (
                    <Button disabled={busy} onClick={() => void setAsyncConnectorIdentity(false)} size="sm">
                      {native6CopyFor(language).compatibility}
                    </Button>
                  ) : null}
                </details>}
                {!configuringInactiveMode && connectorProofMismatch(snapshot)
                  ? <Notice tone="warning">{native6CopyFor(language).mismatch}</Notice> : null}
                {native6UpgradeAvailable ? (
                  <Notice
                    action={<Button disabled={busy} onClick={() => void setAsyncConnectorIdentity(true)} size="sm" variant="primary">
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
                    <div>
                      <dt>{copy.currentSavedConnector}</dt>
                      <dd><code>{currentConnectorName || copy.connectorIdentityUnavailable}</code></dd>
                    </div>
                    <div>
                      <dt><label htmlFor={identityInputId}>{copy.createConnectorIdentity}</label></dt>
                      <dd>
                        <input aria-label={copy.createConnectorIdentity} className="nk-input" id={identityInputId} readOnly
                          onFocus={event => event.currentTarget.select()}
                          value={targetConnectorName || copy.connectorIdentityUnavailable} />
                      </dd>
                    </div>
                  </dl>
                  <p className="nk-connections__warning"><Icon className="nk-icon" name="alert" />{copy.newConnectorRequired}</p>
                  <p className={cx("nk-connections__status", exactConnectorVerified && "is-ready")} role="status">
                    <StateDot state={exactConnectorVerified ? "ready" : "idle"} />
                    {exactConnectorVerified ? copy.connectorVerified : copy.connectorNotVerified}
                  </p>
                </div>
                <div className="nk-connections__actions">
                  {snapshot.urls.developerMode ? <Button icon="external"
                    onClick={() => void openExternal(snapshot.urls.developerMode!)}>{copy.openDeveloperMode}</Button> : null}
                  <Button
                    disabled={!connectorConfiguredForTarget}
                    icon="external"
                    onClick={() => void (async () => {
                      setError(null);
                      try {
                        await api!.openExternal(snapshot.urls.connectors);
                      } catch (cause) {
                        setError(messageOf(cause));
                      }
                    })()}
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
                  <Button
                    disabled={busy || !connectorConfiguredForTarget}
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
            <TutorialVideo
              copy={copy}
              label={`${copy.guideVideo}: ${steps[step]!.title}`}
              src={guideMedia}
            />
          </Disclosure> : null}
        </div>
      </div>
    </Page>
  );
}
