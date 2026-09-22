import { modelConnectionReadiness } from "./setup-progress";
import { accountToolsCopy } from "./account-tools-onboarding";
import { useEffect, useMemo, useRef, useState } from "react";
import { native6CopyFor, localizeRuntimeMessage, type Copy } from "./i18n";
import { Icon } from "./icons";
import { type WorkspaceReadiness } from "./workspace-readiness";
import { workflowCopy } from "./workflow-copy";
import type { BrowserInteractionMode, DoctorReport, Language, LauncherSnapshot, LauncherState, OperationState } from "./types";
const api = window.codexWebLauncher;
import { ConnectionsTabs, StateDot, ContentSurface, SecondaryButton, NoticeRow, PrimaryButton, messageOf, TutorialVideo, FieldRow, DoctorSummary } from './launcher-ui';
import { connectorProofMismatch, runtimeCapabilities, currentToolProof } from './launcher-readiness';
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
  const currentRuntime = runtimeCapabilities(snapshot);
  const busy = localBusy || operation?.status === "running";
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const wizardHeading = useRef<HTMLHeadingElement>(null);
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

  return (
    <ContentSurface
      subtitle={devProfile ? copy.devMcpSubtitle : copy.mcpSubtitle}
      title={devProfile ? copy.devMcpTitle : copy.localTools}
    >
      {accountSetupLabel ? <p className="field-hint"><strong>{accountToolsCopy(language).target}: {accountSetupLabel}</strong><br />
        {accountToolsCopy(language).identity}</p> : null}
      {onReturnToAccount ? <button type="button" className="text-button" disabled={busy}
        onClick={onReturnToAccount}>{accountToolsCopy(language).back}</button> : null}
      <ConnectionsTabs active="tools" copy={copy}
        modelsReady={modelConnectionReadiness({ manual: manualInteraction,
          installed: snapshot.state.coreSetupComplete === true,
          catalogVerified: snapshot.state.codexCatalogVerified === true,
          pickerConfirmed: snapshot.state.codexPickerConfirmed === true,
          development: devProfile }) === "available"}
        onModels={showSetup} onTools={() => {}} toolsReady={verified} />
      {!manualInteraction && !configuringInactiveMode && !snapshot.state.codexCatalogVerified ? (
        <NoticeRow icon="setup" tone="warning">{copy.mcpCatalogRequired}</NoticeRow>
      ) : null}
      {!configuringInactiveMode && (runtimeCapabilities(snapshot)?.tunnelRepair?.eligible === true
        || runtimeCapabilities(snapshot)?.tunnelRepair?.active === true || repairOutcome) ? (
        <section className="connection-recovery-card" aria-live="polite" data-testid="web-route-repair">
          <Icon name="alert" />
          <div>
            <strong>{workflow.recovery.webTransportTitle}</strong>
            <p>{readiness.native === "ready" ? workflow.recovery.webTransportBody : copy.localToolsUnavailableBody}</p>
            {readiness.native === "ready" ? <p>{workflow.recovery.nativePreserved}</p> : null}
            {repairOutcome ? <p role="status">{repairOutcome === "recovered" ? workflow.recovery.recovered
              : repairOutcome === "unavailable" ? workflow.recovery.stillUnavailable : workflow.recovery.couldNotVerify}</p> : null}
          </div>
          <button className="button-secondary" type="button"
            disabled={busy || repairBusy || runtimeCapabilities(snapshot)?.tunnelRepair?.active === true
              || runtimeCapabilities(snapshot)?.tunnelRepair?.eligible !== true}
            aria-busy={repairBusy || runtimeCapabilities(snapshot)?.tunnelRepair?.active === true}
            onClick={() => void repairWebRoute()}>
            {repairBusy || runtimeCapabilities(snapshot)?.tunnelRepair?.active
              ? workflow.recovery.repairing : workflow.recovery.repairAction}
          </button>
        </section>
      ) : null}

      <div className="wizard-stepper" aria-label={`${copy.localTools}: ${step + 1} / 3`} role="group">
        {steps.map((item, index) => (
          <button
            className={`${index === step ? "is-active" : ""}${index < step || (index === 2 && verified) ? " is-complete" : ""}`}
            aria-label={`${index + 1}. ${item.title}`}
            aria-current={index === step ? "step" : undefined}
            title={item.title}
            disabled={busy || index > step}
            key={item.title}
            onClick={() => void safeMove(index)}
            type="button"
          >
            <span>{index < step || (index === 2 && verified) ? <Icon name="check" /> : index + 1}</span>
            <em>{item.title}</em>
          </button>
        ))}
      </div>

      <div aria-busy={busy} className="mcp-stage">
        {guideMedia ? <details className="setup-video-help" onToggle={event => { if (!event.currentTarget.open) event.currentTarget.querySelector("video")?.pause(); }}><summary>{copy.guideVideo}</summary>
          <TutorialVideo
            copy={copy}
            label={`${copy.guideVideo}: ${steps[step]!.title}`}
            src={guideMedia}
          />
        </details> : null}

          <section
            className="wizard-content"
            key={step}
          >
            <header>
              <span>0{step + 1}</span>
              <div>
                <h2 ref={wizardHeading} tabIndex={-1}>{steps[step]!.title}</h2>
                {step === 2 && !manualInteraction ? <div className="connector-instructions">
                  <ol>
                    {[copy.mcpStepThreeStepOne, copy.mcpStepThreeStepTwo, copy.mcpStepThreeStepThree]
                      .map(instruction => <li key={instruction}>{instruction}</li>)}
                  </ol>
                  <p>{copy.mcpStepThreePermissions}</p>
                </div> : <p>{steps[step]!.body}</p>}
              </div>
            </header>

            {step === 0 ? (
              <><p>{accountToolsCopy(language).keyInstructions}</p><p>{accountToolsCopy(language).identity}</p>
              <div className="inline-actions">
                <SecondaryButton icon="external" onClick={() => void openExternal(snapshot.urls.tunnels)}>
                  {copy.openTunnels}
                </SecondaryButton>
                <SecondaryButton icon="external" onClick={() => void openExternal(snapshot.urls.keys)}>
                  {copy.openKeys}
                </SecondaryButton>
              </div></>
            ) : null}
            {step === 1 ? (
              credentialsConfigured && !replacingCredentials ? (
                <div className="saved-credentials">
                  <NoticeRow icon="check" tone="success">
                    <span>
                      <strong>{copy.credentialsConfigured}</strong>
                      <small>{copy.credentialsConfiguredBody}</small>
                    </span>
                  </NoticeRow>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setReplacingCredentials(true)}
                    type="button"
                  >
                    {copy.replaceCredentials}
                  </button>
                </div>
              ) : (
                <div className="field-list">
                  <FieldRow label={copy.tunnelId}>
                    <input
                      aria-describedby="mcp-credentials-hint"
                      aria-invalid={Boolean(tunnelId && !tunnelId.trim())}
                      autoCapitalize="none"
                      autoCorrect="off"
                      onChange={(event) => setTunnelId(event.target.value)}
                      placeholder="tunnel_…"
                      spellCheck={false}
                      value={tunnelId}
                    />
                  </FieldRow>
                  <FieldRow label={copy.runtimeKey}>
                    <input
                      aria-describedby="mcp-credentials-hint"
                      aria-invalid={Boolean(runtimeKey && !runtimeKey.trim())}
                      autoCapitalize="none"
                      autoCorrect="off"
                      onChange={(event) => setRuntimeKey(event.target.value)}
                      placeholder="sk-…"
                      spellCheck={false}
                      type="password"
                      value={runtimeKey}
                    />
                  </FieldRow>
                  {credentialsConfigured ? (
                    <button
                      className="text-button keep-credentials"
                      disabled={busy}
                      onClick={() => {
                        setTunnelId("");
                        setRuntimeKey("");
                        setReplacingCredentials(false);
                      }}
                      type="button"
                    >
                      {copy.keepCredentials}
                    </button>
                  ) : null}
                </div>
              )
            ) : null}
            {step === 1 ? (
            <><p className="mcp-step-two-hint" id="mcp-credentials-hint">
                {manualInteraction || configuringInactiveMode || snapshot.state.codexCatalogVerified
                  ? copy.mcpStepTwoHint
                  : copy.mcpCatalogRequired}
              </p>
            {credentialsConfigured && !replacingCredentials ? (
              <p className="mcp-step-two-hint">{workflow.recovery.fullSetupBody}</p>
            ) : null}
            </>
            ) : null}
        {step === 2 ? (
              <div className="connector-actions">
                {!manualInteraction && !verified && ["Codex Native6", "Codex Native6 DEV"].includes(snapshot.connectorNames[interactionMode]) ? (
                  <NoticeRow icon="alert" tone="warning">
                    {native6CopyFor(language).body.replace("{connector}", snapshot.connectorNames[interactionMode])}
                  </NoticeRow>
                ) : <details className="connector-upgrade-help"><summary>{copy.connectorUpgradeHelp}</summary>
                  <NoticeRow icon="alert" tone="warning">
                    {manualInteraction ? copy.manualConnectorNotice : native6CopyFor(language).retained}
                  </NoticeRow>
                  {!manualInteraction && snapshot.state.experimentalAsyncToolOperations ? (
                    <button className="button-secondary" disabled={busy}
                      onClick={() => void setAsyncConnectorIdentity(false)} type="button">
                      {native6CopyFor(language).compatibility}
                    </button>
                  ) : null}
                </details>}
                {!configuringInactiveMode && connectorProofMismatch(snapshot)
                  ? <NoticeRow icon="alert" tone="warning">{native6CopyFor(language).mismatch}</NoticeRow> : null}
                {native6UpgradeAvailable ? <div className="connector-upgrade-action">
                  <p>{recommendedConnectorName
                    ? native6CopyFor(language).body.replace("{connector}", recommendedConnectorName)
                    : native6CopyFor(language).title}</p>
                  <PrimaryButton disabled={busy} onClick={() => void setAsyncConnectorIdentity(true)}>
                    {native6CopyFor(language).upgrade}
                  </PrimaryButton>
                </div> : null}
                <div className="connector-identity-card">
                  <div>
                    <span>{copy.currentSavedConnector}</span>
                    <code>{currentConnectorName || copy.connectorIdentityUnavailable}</code>
                  </div>
                  <label>
                    <span>{copy.createConnectorIdentity}</span>
                    <input aria-label={copy.createConnectorIdentity} readOnly
                      onFocus={event => event.currentTarget.select()}
                      value={targetConnectorName || copy.connectorIdentityUnavailable} />
                  </label>
                  <p className="connector-identity-warning"><Icon name="alert" />{copy.newConnectorRequired}</p>
                  <p className={`connector-verification-status${exactConnectorVerified ? " is-ready" : ""}`} role="status">
                    <StateDot state={exactConnectorVerified ? "ready" : "idle"} />
                    {exactConnectorVerified ? copy.connectorVerified : copy.connectorNotVerified}
                  </p>
                </div>
                <div className="inline-actions">
                  {snapshot.urls.developerMode ? <SecondaryButton icon="external"
                    onClick={() => void openExternal(snapshot.urls.developerMode!)}>{copy.openDeveloperMode}</SecondaryButton> : null}
                  <SecondaryButton
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
                  </SecondaryButton>
                </div>
                {doctor ? <DoctorSummary copy={copy} language={language} report={doctor} /> : null}
              </div>
            ) : null}
          </section>
      </div>

      <div className="wizard-footer">
        <button className="text-button" disabled={step === 0 || busy} onClick={() => void safeMove(step - 1)} type="button">
          {copy.previous}
        </button>
        {step === 0 ? <PrimaryButton disabled={busy} onClick={() => void safeMove(1)}>{copy.next}</PrimaryButton> : null}
        {step === 1 ? (
          <PrimaryButton
            disabled={
              busy
              || (!manualInteraction && !configuringInactiveMode && !snapshot.state.codexCatalogVerified)
              || ((!credentialsConfigured || replacingCredentials) && (!tunnelId.trim() || !runtimeKey.trim()))
            }
            onClick={() => void install()}
          >
            {busy ? copy.running : credentialsConfigured && !replacingCredentials
              ? workflow.recovery.fullSetupAction : copy.connect}
          </PrimaryButton>
        ) : null}
            {step === 2 ? (
          <>
            {!onReturnToAccount && verified ? (
              <SecondaryButton disabled={busy} onClick={() => void verify()}>
                {copy.verifyRuntime}
              </SecondaryButton>
            ) : null}
            <PrimaryButton
              disabled={busy || !connectorConfiguredForTarget}
              onClick={() => void (onReturnToAccount ? onReturnToAccount() : verified ? onDone() : verify())}
            >
              {busy
                ? operation?.name === "mcp-verification" && operation.status === "running"
                  ? localizeRuntimeMessage(copy, operation.message, undefined, language)
                  : copy.running
                : onReturnToAccount ? accountToolsCopy(language).back : verified ? copy.done : native6CopyFor(language).verify}
            </PrimaryButton>
          </>
        ) : null}
      </div>
    </ContentSurface>
  );
}
