import { modelConnectionReadiness, setupNextStep } from "./setup-progress";
import { ClientConnections } from "./ClientConnections";
import { useRef, useState, type ReactNode } from "react";
import { type Copy } from "./i18n";
import { RouteDiagnostics } from "./RouteDiagnostics";
import { type WorkspaceReadiness } from "./workspace-readiness";
import type { BrowserState, LauncherSnapshot, LauncherState, OperationState } from "./types";
import { Badge, Button, Disclosure, Notice, Page, SettingRow, SetupRow, StateDot, SurfaceHeader } from "./design";
import { ConnectionsTabs, ZeroRiskModelMenu, messageOf } from './launcher-ui';
import { currentToolProof } from './launcher-readiness';
import "./surfaces/connections.css";
const api = window.codexWebLauncher;

type SetupStep = "account" | "smoke" | "install" | "tools";

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
  const signInRow = useRef<HTMLDivElement>(null);
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
  const useExistingChrome = !manualInteraction && ["darwin", "win32", "linux"].includes(snapshot.platform)
    && (!browser?.accountId || browser.accountId === "default");
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
    const details = troubleshooting.current;
    if (!details) return;
    details.open = true;
    details.scrollIntoView({ block: "start" });
    // The routing check is the first control in the troubleshooting body.
    details.querySelector<HTMLButtonElement>("button")?.focus();
  };
  const showAccountSignInChoices = () => {
    const row = signInRow.current;
    row?.scrollIntoView({ block: "center" });
    row?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
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
  const nextDisabled = busy || readiness.action === "wait" || (nextStep === "confirm" && pendingContext);

  // The derived next step is shown on its setup row (the one current row, with the primary button). States that
  // no row represents (session retry, waiting, catalog failure, everything ready) are a notice above the rows.
  const complete: Record<SetupStep, boolean> = {
    account: browser?.authenticated === true,
    smoke: snapshot.smokePassed,
    install: pickerReady,
    tools: toolsVerified,
  };
  const nextRow: SetupStep | null = readiness.action === "retry-session" || readiness.reason === "catalog-unavailable"
    || readiness.action === "wait" ? null
    : readiness.action === "open-accounts" ? "account"
      : readiness.action === "open-tools" || readiness.action === "repair-web" ? "tools"
        : ({ "sign-in": "account", test: "smoke", install: "install", catalog: "install", confirm: "install",
          tools: "tools", ready: null } as const)[nextStep];
  const currentRow = nextRow && !complete[nextRow] && !(manualInteraction && (nextRow === "account" || nextRow === "smoke"))
    ? nextRow : null;
  const catalogNotice = !manualInteraction && catalogFailure;
  const statusNotice = currentRow === null && !(catalogNotice && readiness.reason === "catalog-unavailable");
  const statusTone = readiness.action === "retry-session" || readiness.action === "repair-web" ? "warning"
    : nextStep === "ready" && readiness.action !== "wait" ? "success" : "info";
  const variant = (row: SetupStep) => currentRow === row ? "primary" : "secondary";
  const optional = <Badge tone="outline">{copy.optional}</Badge>;

  const installAction = confirmPending ? confirmModels : catalogPending ? showTroubleshooting
    : manualInteraction && !snapshot.state.mcpRuntimeInstalled ? showMcp : install;
  const installDisabled = busy || (confirmPending && pendingContext) || (!manualInteraction && !browser?.authenticated)
    || (!snapshot.state.coreSetupComplete && !snapshot.smokePassed && !manualInteraction);
  let installDescription: ReactNode = confirmPending ? copy.setupConfirmBody : catalogPending ? copy.setupCatalogBody
    : devProfile ? copy.devStepInstallBody : copy.stepInstallBody;
  if (confirmPending && pendingContext) {
    installDescription = <>{installDescription}<span className="nk-connections__row-note" role="status">
      <StateDot state="busy" />{copy.contextWaiting}</span></>;
  }

  return (
    <Page className="nk-connections">
      <SurfaceHeader
        eyebrow={nextStep === "ready" ? copy.connectionVerified : copy.required}
        subtitle={devProfile
          ? copy.devSetupSubtitle
          : manualInteraction ? copy.manualInteractionBody : copy.setupSubtitle}
        title={nextStep === "ready" ? copy.modelsConnectionTab : devProfile ? copy.devSetupTitle : copy.setupTitle}
      />
      <ConnectionsTabs active="models" copy={copy} modelsReady={pickerReady}
        onModels={() => {}} onTools={showMcp} toolsReady={toolsVerified} />
      <div className="nk-connections__content">
        {manualInteraction ? (
          // Outside DEV the subtitle already carries the Manual mode explanation.
          <Notice title={copy.manualInteraction}>{devProfile ? copy.manualInteractionBody : null}</Notice>
        ) : null}
        {catalogNotice ? (
          <Notice
            action={<Button onClick={showTroubleshooting} size="sm"
              variant={readiness.reason === "catalog-unavailable" && !nextDisabled ? "primary" : "secondary"}>
              {copy.openRoutingChecks}
            </Button>}
            title={<span id="catalog-failure-title">{copy.catalogUnavailable}</span>}
            tone="error"
          >
            {copy.catalogFailureKeptInstall}
          </Notice>
        ) : null}
        {statusNotice ? (
          <Notice
            action={<Button busy={readiness.action === "wait"} disabled={nextDisabled} onClick={nextAction} size="sm" variant="primary">
              {nextLabel}
            </Button>}
            className="nk-connections__next"
            title={nextTitle}
            tone={statusTone}
          >
            {nextBody}
          </Notice>
        ) : currentRow === "tools" && readiness.action === "repair-web" ? (
          <Notice title={copy.localToolsUnavailable} tone="warning">{copy.localToolsUnavailableBody}</Notice>
        ) : null}

        <div className="nk-connections__steps">
          {!manualInteraction ? <>
            <SetupRow
              actions={<>
                {useExistingChrome && !browser?.authenticated ? (
                  <Button disabled={busy || complete.account} onClick={openExistingChromeLogin} size="sm">
                    {copy.existingChromeSignIn}
                  </Button>
                ) : null}
                <Button disabled={busy || complete.account} onClick={openLogin} size="sm" variant={variant("account")}>
                  {browser?.authenticated
                    ? copy.signedIn
                    : browser?.status === "loading" ? copy.checkingSignIn : copy.stepAccount}
                </Button>
              </>}
              complete={complete.account}
              current={currentRow === "account"}
              description={browser?.authenticated && browser.accountLabel
                ? `${copy.signedIn}: ${browser.accountLabel}`
                : copy.stepAccountBody}
              index={1}
              ref={signInRow}
              title={copy.stepAccount}
            />
            <SetupRow
              actions={<Button disabled={busy || !browser?.authenticated || complete.smoke} onClick={smoke} size="sm" variant={variant("smoke")}>
                {snapshot.smokePassed ? copy.smokePassed : copy.runSmoke}
              </Button>}
              complete={complete.smoke}
              current={currentRow === "smoke"}
              description={snapshot.state.coreSetupComplete ? copy.setupOptionalCheck : copy.stepSmokeBody}
              index={2}
              tag={snapshot.state.coreSetupComplete ? optional : undefined}
              title={copy.stepSmoke}
            />
          </> : null}
          <SetupRow
            actions={<Button disabled={installDisabled || complete.install} onClick={installAction} size="sm" variant={variant("install")}>
              {confirmPending ? copy.confirmPicker : catalogPending ? copy.diagnostics : pickerReady ? copy.done : devProfile ? copy.devInstall : copy.install}
            </Button>}
            complete={complete.install}
            current={currentRow === "install"}
            description={installDescription}
            index={manualInteraction ? 1 : 3}
            tag={manualInteraction ? (
              <ZeroRiskModelMenu
                busy={busy || snapshot.state.coreSetupComplete !== true}
                copy={copy}
                proEnabled={snapshot.state.zeroRiskProEnabled}
                onChange={(enabled) => void setZeroRiskPro(enabled)}
              />
            ) : undefined}
            title={confirmPending ? copy.setupConfirmTitle : catalogPending ? copy.setupCatalogTitle : snapshot.state.coreSetupComplete ? copy.setupInstalledTitle : devProfile ? copy.devStepInstall : copy.stepInstall}
          />
          <SetupRow
            actions={<Button disabled={!manualInteraction && !snapshot.state.codexCatalogVerified} iconEnd="chevron"
              onClick={showMcp} size="sm" variant={variant("tools")}>
              {toolsVerified ? copy.mcpReady : copy.configureMcp}
            </Button>}
            complete={complete.tools}
            current={currentRow === "tools"}
            description={<>
              {devProfile ? copy.devMcpBody : copy.mcpBody}
              {Number.isFinite(verifiedAt) ? <span className="nk-connections__row-note">
                {copy.lastConnectorVerification.replace("{time}", new Date(verifiedAt).toLocaleString(snapshot.state.language ?? "en"))}
              </span> : null}
            </>}
            index={manualInteraction ? 2 : 4}
            tag={manualInteraction ? undefined : optional}
            title={devProfile ? copy.devMcpTitle : copy.mcpTitle}
          />
        </div>

        <div className="nk-connections__more">
          <Disclosure ref={troubleshooting} title={copy.setupTroubleshooting}>
            <div className="nk-connections__stack">
            <RouteDiagnostics disabled={busy} language={snapshot.state.language ?? "en"}
              onActionError={cause => setError(messageOf(cause))}
              onExport={() => api!.exportLogs()} onViewActivity={showActivity}
              readReport={() => api!.routeDiagnostics()} />
            {snapshot.state.coreSetupComplete ? (
              <div className="nk-connections__actions">
                <Button disabled={busy} icon="reload" onClick={() => void install()} size="sm" variant="ghost">{copy.setupRepair}</Button>
              </div>
            ) : null}
            </div>
          </Disclosure>
          {!manualInteraction ? <ClientConnections language={snapshot.state.language ?? "en"} busy={busy}
            configured={snapshot.state.coreSetupComplete === true} devProfile={devProfile} /> : null}
          {!devProfile && !manualInteraction ? (
            <Disclosure hint={copy.optional} title="Hermes">
              <div className="nk-connections__stack">
              <SettingRow
                control={<Button disabled={localBusy || !snapshot.state.mcpRuntimeInstalled} onClick={() => void addHermes()}>
                  {hermesAdded ? copy.hermesUpdate : copy.hermesAdd}
                </Button>}
                description={copy.hermesBody}
                title={copy.hermesTitle}
              />
              <p className="nk-connections__status" role="status">
                <StateDot state={hermesAdded ? "ready" : "idle"} />
                {hermesAdded ? copy.hermesAdded : !toolsVerified ? copy.hermesPending : copy.hermesChoose}
              </p>
              <details className="nk-connections__nested">
                <summary>{copy.hermesDirectTitle}</summary>
                <p>{copy.hermesDirectBody}</p>
                <Button disabled={localBusy || !snapshot.state.mcpRuntimeInstalled} onClick={() => void addHermes("codex_responses")} size="sm">
                  {copy.hermesDirectAdd}
                </Button>
              </details>
              </div>
            </Disclosure>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
