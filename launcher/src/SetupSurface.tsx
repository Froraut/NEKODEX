import { modelConnectionReadiness, setupNextStep } from "./setup-progress";
import { ClientConnections } from "./ClientConnections";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { type Copy } from "./i18n";
import { RouteDiagnostics } from "./RouteDiagnostics";
import { modelsTabConnection, type WorkspaceReadiness } from "./workspace-readiness";
import { connectionTabStatus, connectionsCopy, connectionsSubtitle, workspaceHeadline } from "./connections-copy";
import type { BrowserState, LauncherSnapshot, LauncherState, OperationState } from "./types";
import { Badge, Button, Disclosure, Icon, Notice, Page, SettingRow, SetupRow, StateDot, SurfaceHeader } from "./design";
import { ConnectionsTabs, ZeroRiskModelMenu, connectionsTabPanelProps, messageOf } from './launcher-ui';
import { currentToolProof } from './launcher-readiness';
import "./surfaces/connections.css";
const api = window.codexWebLauncher;

type SetupStep = "account" | "smoke" | "install" | "tools";

// "Open routing checks" elsewhere (the Overview hero and Models row) opens this page: a one-shot request that the
// page opens Troubleshooting and focuses the routing check when it mounts, so the button does what it says.
let pendingRoutingChecks = false;
export function requestRoutingChecks() {
  pendingRoutingChecks = true;
}

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
  const language = snapshot.state.language ?? "en";
  const words = connectionsCopy(language);
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
  useLayoutEffect(() => {
    if (!pendingRoutingChecks) return;
    pendingRoutingChecks = false;
    showTroubleshooting();
  }, []);
  const showAccountSignInChoices = () => {
    const row = signInRow.current;
    row?.scrollIntoView({ block: "center" });
    row?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  };
  // Title, body and next step come from the same readiness headline as the Overview hero.
  const headline = workspaceHeadline(readiness, { app: copy, language, development: devProfile, manual: manualInteraction,
    authenticationIssue: browser?.authenticationIssue, codexRestartRequired: snapshot.state.codexRestartRequired === true,
    toolProof: browser?.toolProof });
  const runHeadlineStep = () => {
    switch (headline.step) {
      case "wait": return;
      case "retry-session": void retrySession(); return;
      case "sign-in": showAccountSignInChoices(); return;
      case "routing-checks": showTroubleshooting(); return;
      case "tools": case "repair": showMcp(); return;
      case "activity": showActivity(); return;
      case "open-workspace": void activateBrowser().catch(cause => setError(messageOf(cause))); return;
      case "setup":
        if (nextStep === "sign-in") showAccountSignInChoices();
        else if (nextStep === "test") void smoke();
        else if (nextStep === "install") void install();
        else if (nextStep === "confirm") void confirmModels();
        else if (nextStep === "catalog") showTroubleshooting();
        else if (nextStep === "tools") showMcp();
    }
  };
  const headlineDisabled = busy || (nextStep === "confirm" && pendingContext);

  // The derived next step is shown on its setup row (the one current row, with the primary button). States that
  // no row represents (session retry, waiting, catalog failure, everything ready) are a notice above the rows.
  const complete: Record<SetupStep, boolean> = {
    account: browser?.authenticated === true,
    smoke: snapshot.smokePassed,
    install: pickerReady,
    // The same derived tools status as the tab and the Overview row (the connector proof alone is not enough).
    tools: readiness.connections.tools.ready,
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
  // States no row represents (session retry, waiting, everything ready, runtime or Web problems) are one notice with
  // the page's primary. A Web problem while a row is current is explained by the notice; the row keeps the primary.
  const webProblem = readiness.reason === "web-repair-available" || readiness.reason === "web-degraded"
    || readiness.reason === "web-unavailable";
  const statusNotice = currentRow === null ? !(catalogNotice && readiness.reason === "catalog-unavailable") : webProblem;
  const statusAction = currentRow === null && headline.step !== "wait";
  // Manual mode installs the harness during the tools setup, so the model row waits for it.
  const toolsFirst = manualInteraction && !snapshot.state.mcpRuntimeInstalled && !pickerReady;
  const variant = (row: SetupStep) => currentRow === row ? "primary" : "secondary";
  const optional = <Badge tone="outline">{copy.optional}</Badge>;

  const installAction = confirmPending ? confirmModels : catalogPending ? showTroubleshooting : install;
  const installDisabled = busy || toolsFirst || (confirmPending && pendingContext) || (!manualInteraction && !browser?.authenticated)
    || (!snapshot.state.coreSetupComplete && !snapshot.smokePassed && !manualInteraction);
  // Codex reads the catalog only at startup; until the picker is confirmed, a changed list needs a restart.
  const confirmBody = snapshot.state.codexRestartRequired === true ? copy.setupConfirmRestartBody : copy.setupConfirmBody;
  let installDescription: ReactNode = confirmPending ? confirmBody : catalogPending ? copy.setupCatalogBody
    : devProfile ? copy.devStepInstallBody : copy.stepInstallBody;
  if (confirmPending && pendingContext) {
    installDescription = <>{installDescription}<span className="nk-connections__row-note" role="status">
      <StateDot state="busy" />{copy.contextWaiting}</span></>;
  } else if (toolsFirst) {
    installDescription = <>{installDescription}<span className="nk-connections__row-note">{words.toolsFirst}</span></>;
  }
  const dateTime = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });

  return (
    <Page className="nk-connections">
      {/* One header for both tabs: the tab strip never moves, and each tab reports its own status. */}
      <SurfaceHeader
        subtitle={connectionsSubtitle(copy, language, { development: devProfile, manual: manualInteraction })}
        title={copy.connectionsNav}
      />
      <ConnectionsTabs active="models" copy={copy}
        modelsReady={modelsTabConnection(readiness.connections).ready}
        modelsStatus={connectionTabStatus(modelsTabConnection(readiness.connections), copy, language)}
        onModels={() => {}} onTools={showMcp}
        toolsReady={readiness.connections.tools.ready}
        toolsStatus={connectionTabStatus(readiness.connections.tools, copy, language)} />
      <div className="nk-connections__content" {...connectionsTabPanelProps("models")}>
        {manualInteraction ? (
          // Outside DEV the subtitle already carries the Manual mode explanation.
          <Notice title={copy.manualInteraction}>{devProfile ? copy.manualInteractionBody : null}</Notice>
        ) : null}
        {catalogNotice ? (
          <Notice
            action={<Button onClick={showTroubleshooting} size="sm"
              variant={readiness.reason === "catalog-unavailable" && !busy ? "primary" : "secondary"}>
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
            action={statusAction ? <Button busy={localBusy && headline.step === "retry-session"} disabled={headlineDisabled}
              onClick={runHeadlineStep} size="sm" variant="primary">
              {headline.action}
            </Button> : undefined}
            className="nk-connections__next"
            // While NEKODEX checks something there is nothing to press: a busy status line instead of a button.
            meta={headline.step === "wait" ? <span className="nk-connections__row-note">
              <StateDot state="busy" />{headline.action}</span> : undefined}
            title={headline.title}
            tone={headline.tone}
          >
            {headline.body}
          </Notice>
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
                <Button disabled={busy} onClick={openLogin} size="sm" variant={variant("account")}>
                  {browser?.status === "loading" ? copy.checkingSignIn : copy.stepAccount}
                </Button>
              </>}
              complete={complete.account}
              result={copy.signedIn}
              current={currentRow === "account"}
              description={browser?.authenticated && browser.accountLabel
                ? `${copy.signedIn}: ${browser.accountLabel}`
                : copy.stepAccountBody}
              index={1}
              ref={signInRow}
              title={copy.stepAccount}
            />
            <SetupRow
              actions={<Button disabled={busy || !browser?.authenticated} onClick={smoke} size="sm" variant={variant("smoke")}>
                {copy.runSmoke}
              </Button>}
              complete={complete.smoke}
              result={copy.smokePassed}
              current={currentRow === "smoke"}
              description={snapshot.state.coreSetupComplete ? copy.setupOptionalCheck : copy.stepSmokeBody}
              index={2}
              tag={snapshot.state.coreSetupComplete ? optional : undefined}
              title={copy.stepSmoke}
            />
          </> : null}
          <SetupRow
            actions={<Button disabled={installDisabled} onClick={installAction} size="sm" variant={variant("install")}>
              {confirmPending ? copy.confirmPicker : catalogPending ? copy.openRoutingChecks : devProfile ? copy.devInstall : copy.install}
            </Button>}
            complete={complete.install}
            result={copy.done}
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
              {complete.tools ? copy.manageToolsConnection
                : readiness.action === "repair-web" ? words.openRepair : copy.configureMcp}
            </Button>}
            complete={complete.tools}
            current={currentRow === "tools"}
            description={<>
              {devProfile ? copy.devMcpBody : copy.mcpBody}
              {Number.isFinite(verifiedAt) ? <span className="nk-connections__row-note">
                {copy.lastConnectorVerification.replace("{time}", dateTime.format(new Date(verifiedAt)))}
              </span> : null}
            </>}
            index={manualInteraction ? 2 : 4}
            tag={manualInteraction ? undefined : optional}
            title={devProfile ? copy.devMcpTitle : words.toolsTitle}
          />
        </div>

        <div className="nk-connections__more">
          <Disclosure ref={troubleshooting} title={copy.setupTroubleshooting}>
            <div className="nk-connections__stack">
            <RouteDiagnostics disabled={busy} language={language} showDoctorLocation
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
          {!manualInteraction ? <ClientConnections language={language} busy={busy}
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
                {hermesAdded ? copy.hermesAdded : !complete.tools ? copy.hermesPending : copy.hermesChoose}
              </p>
              <details className="nk-connections__nested">
                <summary><Icon className="nk-icon" focusable="false" name="chevron" size={14} />{copy.hermesDirectTitle}</summary>
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
