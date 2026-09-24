import { modelConnectionReadiness, setupNextStep } from "./setup-progress";
import { useRef, useState } from "react";
import { type Copy } from "./i18n";
import { Icon } from "./icons";
import { RouteDiagnostics } from "./RouteDiagnostics";
import { type WorkspaceReadiness } from "./workspace-readiness";
import type { BrowserState, LauncherSnapshot, LauncherState, OperationState } from "./types";
const api = window.codexWebLauncher;
import { ConnectionsTabs, ContentSurface, SetupRow, ZeroRiskModelMenu, SectionHeading, NoticeRow, PrimaryButton, McpMark, messageOf } from './launcher-ui';
import { currentToolProof } from './launcher-readiness';

export function SetupSurface({
  activateBrowser,
  browser,
  catalogFailure,
  copy,
  devProfile,
  operation,
  readiness,
  setError,
  showActivity,
  showMcp,
  snapshot,
  updateState,
}: {
  activateBrowser: (show?: boolean) => Promise<void>;
  browser: BrowserState | null;
  catalogFailure: string | null;
  copy: Copy;
  devProfile: boolean;
  operation: OperationState | null;
  readiness: WorkspaceReadiness;
  setError: (error: string | null) => void;
  showActivity: () => void;
  showMcp: () => void;
  snapshot: LauncherSnapshot;
  updateState: (state: LauncherState) => void;
}) {
  const [localBusy, setLocalBusy] = useState(false);
  const [hermesAdded, setHermesAdded] = useState(false);
  const verifiedAt = snapshot.state.setupVerifiedAt ? Date.parse(snapshot.state.setupVerifiedAt) : Number.NaN;
  const manualInteraction = snapshot.state.browserInteractionMode === "manual";
  const models = modelConnectionReadiness({ manual: manualInteraction,
    installed: snapshot.state.coreSetupComplete === true,
    catalogVerified: snapshot.state.codexCatalogVerified === true,
    pickerConfirmed: snapshot.state.codexPickerConfirmed === true,
    development: devProfile });
  const catalogPending = models === "catalog-pending";
  const pickerReady = models === "available";
  const confirmPending = models === "picker-pending";
  const pendingContext = typeof snapshot.state.pendingBiggerContext === "boolean";
  const troubleshooting = useRef<HTMLDetailsElement>(null);
  const accountSignInChoices = useRef<HTMLDivElement>(null);
  const toolsVerified = currentToolProof(snapshot, operation);
  const nextStep = setupNextStep({ manual: manualInteraction, signedIn: browser?.authenticated === true,
    smokePassed: snapshot.smokePassed, installed: snapshot.state.coreSetupComplete === true,
    catalogVerified: snapshot.state.codexCatalogVerified === true, pickerConfirmed: snapshot.state.codexPickerConfirmed === true,
    toolsInstalled: snapshot.state.mcpRuntimeInstalled === true && snapshot.mcpCredentialsConfigured,
    toolsVerified, development: devProfile });
  const busy = localBusy
    || operation?.status === "running"
    || (!manualInteraction && (
      browser?.loginInProgress === true
      || browser?.navigationLocked === true
      || browser?.status === "loading"
      || browser?.status === "testing"
      || browser?.status === "running"
    ));
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setLocalBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLocalBusy(false);
    }
  };

  const openLogin = () => run(async () => {
    await activateBrowser();
    await api!.openLogin();
  });
  const useExistingChrome = !manualInteraction && ["darwin", "win32", "linux"].includes(snapshot.platform);
  const openExistingChromeLogin = () => run(async () => {
    await activateBrowser(false);
    await api!.openExistingChromeLogin();
  });
  const smoke = () => run(async () => {
    await activateBrowser();
    await api!.smokeTest();
    updateState((await api!.snapshot()).state);
  });
  const install = () => run(async () => {
    await api!.setupCore();
    updateState((await api!.snapshot()).state);
  });
  const setZeroRiskPro = (enabled: boolean) => run(async () => {
    updateState(await api!.setZeroRiskPro(enabled));
  });
  // Saving a separate Hermes provider does not navigate the browser or replace a running turn.
  const addHermes = async (runtime: "codex_responses" | "codex_app_server" = "codex_app_server") => {
    if (localBusy) return;
    setLocalBusy(true);
    setError(null);
    try { await api!.setupHermes({ runtime, makeDefault: runtime === "codex_app_server" }); setHermesAdded(true); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setLocalBusy(false); }
  };

  const confirmModels = () => run(async () => { updateState(await api!.confirmCodexModels()); });
  const retrySession = () => run(async () => {
    if (!browser?.accountId) throw new Error(copy.accountConnection);
    await api!.refreshAccountAuthentication(browser.accountId);
  });
  const showTroubleshooting = () => {
    if (!troubleshooting.current) return;
    troubleshooting.current.open = true;
    troubleshooting.current.scrollIntoView({ block: "start" });
    troubleshooting.current.querySelector<HTMLButtonElement>("button")?.focus();
  };
  const showAccountSignInChoices = () => {
    accountSignInChoices.current?.scrollIntoView({ block: "center" });
    accountSignInChoices.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  };
  const readyTitle = manualInteraction ? copy.manualSetupReady
    : toolsVerified ? copy.setupChecksPassed : copy.setupReadyModels;
  const readyBody = manualInteraction ? copy.manualSetupReadyBody
    : toolsVerified ? copy.connectorAvailableNotExecuted : copy.setupUseCodex;
  const nextTitle = readiness.action === "retry-session" ? copy.connectionPending
    : readiness.reason === "session-checking" ? copy.checkingSignIn
      : readiness.reason === "catalog-unavailable" ? copy.catalogUnavailable
      : readiness.action === "open-accounts" ? copy.stepAccount
        : readiness.action === "repair-web" ? copy.localToolsUnavailable
          : readiness.action === "open-tools" ? copy.localTools
            : ({ "sign-in": copy.stepAccount, test: copy.stepSmoke, install: copy.stepInstall,
    catalog: copy.setupCatalogTitle, confirm: copy.setupConfirmTitle, tools: copy.localTools,
    ready: readyTitle }[nextStep]);
  const nextBody = readiness.action === "retry-session" ? copy.stepAccountBody
    : readiness.reason === "session-checking" ? copy.stepAccountBody
      : readiness.reason === "catalog-unavailable" ? copy.catalogFailureKeptInstall
      : readiness.action === "open-accounts" ? copy.stepAccountBody
        : readiness.action === "repair-web" ? copy.localToolsUnavailableBody
          : readiness.action === "open-tools" ? copy.mcpBody
            : ({ "sign-in": copy.stepAccountBody, test: copy.stepSmokeBody, install: copy.stepInstallBody,
    catalog: copy.setupCatalogBody, confirm: copy.setupConfirmBody, tools: copy.mcpBody,
    ready: readyBody }[nextStep]);
  const nextLabel = readiness.action === "retry-session" ? copy.retry
    : readiness.reason === "catalog-unavailable" ? copy.diagnostics
    : readiness.action === "open-accounts" ? copy.next
      : readiness.action === "repair-web" || readiness.action === "open-tools" ? copy.configureMcp
        : readiness.action === "wait" ? copy.loading
          : ({ "sign-in": copy.next, test: copy.runSmoke, install: copy.install,
    catalog: copy.diagnostics, confirm: copy.confirmPicker, tools: copy.configureMcp,
    ready: copy.openWorkspace }[nextStep]);
  const nextAction = () => {
    if (readiness.action === "retry-session") void retrySession();
    else if (readiness.reason === "catalog-unavailable") showTroubleshooting();
    else if (readiness.action === "open-accounts") showAccountSignInChoices();
    else if (readiness.action === "open-tools" || readiness.action === "repair-web") showMcp();
    else if (readiness.action === "wait") return;
    else if (nextStep === "sign-in") showAccountSignInChoices();
    else if (nextStep === "test") void smoke();
    else if (nextStep === "install") void install();
    else if (nextStep === "confirm") void confirmModels();
    else if (nextStep === "catalog") showTroubleshooting();
    else if (nextStep === "tools") showMcp();
    else void activateBrowser().catch(cause => setError(messageOf(cause)));
  };

  return (
    <ContentSurface
      eyebrow={nextStep === "ready" ? copy.connectionVerified : copy.required}
      subtitle={devProfile
        ? copy.devSetupSubtitle
        : manualInteraction ? copy.manualInteractionBody : copy.setupSubtitle}
      title={nextStep === "ready" ? copy.modelsConnectionTab : devProfile ? copy.devSetupTitle : copy.setupTitle}
    >
      <ConnectionsTabs active="models" copy={copy} modelsReady={pickerReady}
        onModels={() => {}} onTools={showMcp} toolsReady={toolsVerified} />
      {manualInteraction ? <NoticeRow icon="info" tone="success">{copy.manualInteractionBody}</NoticeRow> : null}
      {!manualInteraction && catalogFailure ? (
        <section className="connection-inline-failure" aria-labelledby="catalog-failure-title">
          <Icon name="alert" />
          <div><strong id="catalog-failure-title">{copy.catalogUnavailable}</strong><p>{copy.catalogFailureKeptInstall}</p></div>
          <button className="button-secondary" onClick={showTroubleshooting} type="button">{copy.openRoutingChecks}</button>
        </section>
      ) : null}
      <section className="setup-overview setup-next" aria-label={copy.setupNext}>
        <div><small>{copy.setupNext}</small><h2>{nextTitle}</h2><p>{nextBody}</p>
          {confirmPending && pendingContext ? <p role="status">{copy.contextWaiting}</p> : null}
        </div>
        <PrimaryButton disabled={busy || readiness.action === "wait" || (nextStep === "confirm" && pendingContext)} onClick={nextAction}>{nextLabel}</PrimaryButton>
      </section>
      <SectionHeading label={devProfile ? copy.devCoreSetup : copy.coreSetup} />
      <div className="setup-list">
        {!manualInteraction ? <>
          <SetupRow
            action={browser?.authenticated
              ? copy.signedIn
              : browser?.status === "loading" ? copy.checkingSignIn : useExistingChrome ? copy.existingChromeSignIn : copy.signIn}
            complete={browser?.authenticated === true}
            description={browser?.authenticated && browser.accountLabel
              ? `${copy.signedIn}: ${browser.accountLabel}`
              : useExistingChrome ? copy.existingChromeBody : copy.stepAccountBody}
            disabled={busy}
            index={1}
            onAction={useExistingChrome ? openExistingChromeLogin : openLogin}
            secondaryAction={useExistingChrome && !browser?.authenticated ? copy.signIn : undefined}
            onSecondaryAction={openLogin}
            rowRef={accountSignInChoices}
            secondaryDisabled={busy}
            title={copy.stepAccount}
          />
          <SetupRow
            action={snapshot.smokePassed ? copy.smokePassed : copy.runSmoke}
            complete={snapshot.smokePassed}
            description={snapshot.state.coreSetupComplete ? copy.setupOptionalCheck : copy.stepSmokeBody}
            titleAction={snapshot.state.coreSetupComplete ? <small className="setup-optional">{copy.optional}</small> : undefined}
            disabled={busy || !browser?.authenticated}
            index={2}
            onAction={smoke}
            title={copy.stepSmoke}
          />
        </> : null}
        <SetupRow
          action={confirmPending ? copy.confirmPicker : catalogPending ? copy.diagnostics : pickerReady ? copy.done : devProfile ? copy.devInstall : copy.install}
          complete={pickerReady}
          description={confirmPending ? copy.setupConfirmBody : catalogPending ? copy.setupCatalogBody : devProfile ? copy.devStepInstallBody : copy.stepInstallBody}
          disabled={busy || (confirmPending && pendingContext) || (!manualInteraction && !browser?.authenticated)
            || (!snapshot.state.coreSetupComplete && !snapshot.smokePassed && !manualInteraction)}
          index={manualInteraction ? 1 : 3}
          onAction={confirmPending ? confirmModels : catalogPending ? showTroubleshooting : manualInteraction && !snapshot.state.mcpRuntimeInstalled ? showMcp : install}
          title={confirmPending ? copy.setupConfirmTitle : catalogPending ? copy.setupCatalogTitle : snapshot.state.coreSetupComplete ? copy.setupInstalledTitle : devProfile ? copy.devStepInstall : copy.stepInstall}
          titleAction={manualInteraction ? (
            <ZeroRiskModelMenu
              busy={busy || snapshot.state.coreSetupComplete !== true}
              copy={copy}
              proEnabled={snapshot.state.zeroRiskProEnabled}
              onChange={(enabled) => void setZeroRiskPro(enabled)}
            />
          ) : undefined}
        />
      </div>

      <details className="setup-troubleshooting" ref={troubleshooting}>
        <summary>{copy.setupTroubleshooting}<Icon name="chevron" /></summary>
        <RouteDiagnostics disabled={busy} language={snapshot.state.language ?? "en"}
          onActionError={cause => setError(messageOf(cause))}
          onExport={() => api!.exportLogs()} onViewActivity={showActivity}
          readReport={() => api!.routeDiagnostics()} />
        {snapshot.state.coreSetupComplete ? <button className="button-secondary" type="button" disabled={busy} onClick={() => void install()}>{copy.setupRepair}</button> : null}
      </details>

      <SectionHeading label={copy.localTools} meta={manualInteraction ? copy.required : copy.optional} spaced />
      {Number.isFinite(verifiedAt) ? (
        <p>{copy.lastConnectorVerification.replace("{time}", new Date(verifiedAt).toLocaleString(snapshot.state.language ?? "en"))}</p>
      ) : null}
      <button
        className="next-surface-row"
        disabled={!manualInteraction && !snapshot.state.codexCatalogVerified}
        onClick={showMcp}
        type="button"
      >
        <McpMark />
        <span>
          <strong>{devProfile ? copy.devMcpTitle : copy.mcpTitle}</strong>
          <small>{devProfile ? copy.devMcpBody : copy.mcpBody}</small>
        </span>
        <em>{toolsVerified ? copy.mcpReady : copy.configureMcp}</em>
        <Icon name="chevron" />
      </button>
      {!devProfile && !manualInteraction ? <>
        <details className="setup-troubleshooting"><summary>Hermes <small>{copy.optional}</small><Icon name="chevron" /></summary>
        <div className="setup-overview">
          <strong>{copy.hermesTitle}</strong>
          <p>{copy.hermesBody}</p>
          <PrimaryButton disabled={localBusy || !snapshot.state.mcpRuntimeInstalled} onClick={() => void addHermes()}>{hermesAdded ? copy.hermesUpdate : copy.hermesAdd}</PrimaryButton>
          <p role="status">{hermesAdded ? copy.hermesAdded : !toolsVerified ? copy.hermesPending : copy.hermesChoose}</p>
          <details>
            <summary>{copy.hermesDirectTitle}</summary>
            <p>{copy.hermesDirectBody}</p>
            <button className="secondary-button" disabled={localBusy || !snapshot.state.mcpRuntimeInstalled} onClick={() => void addHermes("codex_responses")} type="button">{copy.hermesDirectAdd}</button>
          </details>
        </div>
        </details>
      </> : null}
    </ContentSurface>
  );
}
