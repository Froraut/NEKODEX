import taskControlCopy from "../electron/task-control-copy.json";
import type { CompactionModel } from "./types";
import { codexSettingsStatus } from "./setup-progress";
import { BrandMark } from "./BrandMark";
import { useEffect, useRef, useState } from "react";
import { type Copy } from "./i18n";
import { Icon } from "./icons";
import { RouteDiagnostics } from "./RouteDiagnostics";
import type { BrowserCapacitySettings, BrowserInteractionMode, BrowserState, DoctorReport, Language, LauncherSnapshot, LauncherState, OperationState, ProModelVersion } from "./types";
const api = window.codexWebLauncher;
import { ContentSurface, SecondaryButton, SectionHeading, messageOf, DoctorSummary, InteractionModePicker, ContextBudgetTable, SettingRow, Switch, LanguageMenu, ProModelVersionMenu, platformLabel } from './launcher-ui';

export function SettingsSurface({
  browser,
  catalogFailure,
  showModelSetup,
  configureInteractionMode,
  copy,
  devProfile,
  language,
  operation,
  setError,
  snapshot,
  updateBrowserCapacity,
  updateProModelVersion,
  showBiggerContextInfo,
  updateCompactionModel,
  updateState,
}: {
  browser: BrowserState | null;
  catalogFailure: string | null;
  showModelSetup: () => void;
  configureInteractionMode: (mode: BrowserInteractionMode) => void;
  copy: Copy;
  devProfile: boolean;
  language: Language;
  operation: OperationState | null;
  setError: (error: string | null) => void;
  snapshot: LauncherSnapshot;
  updateBrowserCapacity: (value: BrowserCapacitySettings) => void;
  updateProModelVersion: (value: ProModelVersion | null) => void;
  showBiggerContextInfo: () => void;
  updateCompactionModel: (value: CompactionModel | null) => void;
  updateState: (state: LauncherState) => void;
}) {
  const capacity = snapshot.browserCapacity;
  const [capacityInput, setCapacityInput] = useState(String(snapshot.browserCapacity.configured));
  const previousConfiguredCapacity = useRef(capacity.configured);
  useEffect(() => {
    const previous = previousConfiguredCapacity.current;
    previousConfiguredCapacity.current = capacity.configured;
    // Refresh saved/runtime evidence without overwriting an unfinished edit.
    setCapacityInput(current => current.trim() !== "" && Number(current) === previous
      ? String(capacity.configured) : current);
  }, [capacity.configured]);
  const capacityValue = Number(capacityInput);
  const capacityValid = capacityInput.trim() !== "" && Number.isSafeInteger(capacityValue)
    && capacityValue >= 1 && capacityValue <= capacity.maximum;
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [localBusy, setBusy] = useState(false);
  const busy = localBusy || Boolean(snapshot.lifecycle?.transition);
  const [turnsCancelled, setTurnsCancelled] = useState<string | null>(null);
  const taskCopy = taskControlCopy[language] ?? taskControlCopy.en;
  const [integrationRemoved, setIntegrationRemoved] = useState(false);
  const [routeDiagnosticsGeneration, setRouteDiagnosticsGeneration] = useState(0);
  const codexStatus = codexSettingsStatus(snapshot.state, devProfile, Boolean(catalogFailure));
  const proModelBusy = busy
    || operation?.status === "running"
    || browser?.tabs.some((tab) => tab.status === "running") === true;

  const actionInFlight = useRef(false);
  const runAction = async (action: () => Promise<void>) => {
    if (busy || actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true); setError(null);
    try { await action(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { actionInFlight.current = false; setBusy(false); }
  };
  const saveCapacity = () => {
    if (!capacityValid || capacityValue === capacity.configured) return;
    return runAction(async () => {
      const saved = await api!.setBrowserCapacity(capacityValue);
      updateBrowserCapacity(saved); setCapacityInput(String(saved.configured));
    });
  };
  const savePreference = (action: () => Promise<LauncherState>) => runAction(async () => { updateState(await action()); });
  const updateLanguage = (next: Language) => savePreference(() => api!.setLanguage(next));
  const runDoctor = () => runAction(async () => {
    setDoctor(null);
    setDoctor(await api!.doctor());
  });
  const cancelTurns = () => runAction(async () => {
    const receipt = await api!.cancelTurns();
    if (receipt.cancelled) return;
    setTurnsCancelled(receipt.cancelledHttpTurns === 0 && receipt.cancelledBrowserTurns === 0
      && receipt.cancelledCompactionRuns === 0 ? taskCopy.none : taskCopy.receipt
        .replace("{http}", String(receipt.cancelledHttpTurns))
        .replace("{browser}", String(receipt.cancelledBrowserTurns))
        .replace("{compaction}", receipt.cancelledCompactionRuns === null ? taskCopy.unknown : String(receipt.cancelledCompactionRuns)));
  });
  const setBiggerContext = (enabled: boolean) => savePreference(() => api!.setBiggerContext(enabled));
  const setSkillAttachments = (enabled: boolean) => savePreference(() => api!.setSkillAttachments(enabled));
  const setInteractionMode = (mode: BrowserInteractionMode) => runAction(async () => {
    // Retire diagnostics before IPC: even a failed receipt may have replaced the runtime.
    if (mode !== snapshot.state.browserInteractionMode) setRouteDiagnosticsGeneration(generation => generation + 1);
    const result = await api!.setBrowserInteractionMode(mode);
    updateState(result.state);
    if (result.credentialsRequired) configureInteractionMode(result.targetMode);
  });
  const setProModelVersion = (value: ProModelVersion | null) => runAction(async () => {
    const result = await api!.setProModelVersion(value);
    updateProModelVersion(result.proModelVersion);
  });
  const uninstallIntegration = () => runAction(async () => {
    const result = await api!.uninstallIntegration();
    if (!result.cancelled) {
      updateState(result.state); setIntegrationRemoved(true);
      setRouteDiagnosticsGeneration(generation => generation + 1);
    }
  });

  return (
    <ContentSurface narrow title={devProfile ? copy.devSettingsTitle : copy.settingsTitle} subtitle={copy.settingsSubtitle}>
      <SectionHeading label={copy.executionSettings} />
      <div className="settings-list">
        <InteractionModePicker
          copy={copy}
          disabled={busy}
          mode={snapshot.state.browserInteractionMode}
          onChange={(mode) => void setInteractionMode(mode)}
        />
        <SettingRow body={copy.browserCapacityBody} label={copy.browserCapacity}>
          <div className="capacity-setting">
            <form className="capacity-controls" noValidate onSubmit={event => { event.preventDefault(); void saveCapacity(); }}>
              <input aria-label={copy.browserCapacity} type="number" min={1} max={capacity.maximum} step={1}
                aria-invalid={!capacityValid} aria-describedby="capacity-feedback"
                value={capacityInput} disabled={busy} onChange={event => setCapacityInput(event.target.value)} />
              <button className="button-secondary" type="submit" disabled={busy || !capacityValid || capacityValue === capacity.configured}>{busy ? copy.loading : copy.browserCapacitySave}</button>
            </form>
            <p id="capacity-feedback" className={!capacityValid ? "field-error" : "field-hint"} role="status">{!capacityValid ? copy.capacityInvalid.replace("{max}", String(capacity.maximum)) : capacityValue !== capacity.configured ? copy.unsavedChanges : copy.capacitySaved}</p>
            <p role="status">{copy.browserCapacityStatus.replace("{active}", String(capacity.active)).replace("{saved}", String(capacity.configured))}</p>
            {capacity.restartRequired ? <p role="status">{copy.browserCapacityRestart}</p> : null}
          </div>
        </SettingRow>
        <SettingRow body={copy.manualSubmitTimeBody} label={copy.manualSubmitTime}>
          <select className="settings-select" aria-label={copy.manualSubmitTime} disabled={busy}
            value={snapshot.state.manualSubmitTimeoutSec ?? 120}
            onChange={event => void savePreference(() => api!.setPreference("manualSubmitTimeoutSec", Number(event.target.value)))}>
            {[30, 60, 120, 180, 300, 600].map(seconds => <option key={seconds} value={seconds}>{seconds} s</option>)}
          </select>
        </SettingRow>
        <SettingRow body={copy.showDuringTurnsBody} label={copy.showDuringTurns}>
          <Switch
            label={copy.showDuringTurns}
            checked={snapshot.state.showBrowserDuringTurns}
            disabled={busy || snapshot.state.browserInteractionMode === "manual"}
            onChange={(checked) => void savePreference(() => api!.setPreference("showBrowserDuringTurns", checked))}
          />
        </SettingRow>

        <SectionHeading label={copy.connectionsNav} spaced />
        {browser?.authenticated && snapshot.state.browserInteractionMode === "automatic" ? (
          <div className="setting-row">
            <strong>ChatGPT</strong>
            <button className="button-secondary" type="button" disabled={busy}
              onClick={() => void savePreference(async () => (await api!.logoutChatGpt()).state)}>
              {copy.logOut}
            </button>
          </div>
        ) : null}
        <SettingRow label={copy.toolsConnectionTab} body={copy.mcpBody}>
          <button className="button-primary" type="button" disabled={busy}
            onClick={() => configureInteractionMode(snapshot.state.browserInteractionMode)}>
            {copy.manageToolsConnection}
          </button>
        </SettingRow>

        <SectionHeading label={copy.modelsAndContextSettings} spaced />
        <SettingRow body={copy.compactionModelBody} label={copy.compactionModel}>
          <select className="settings-select" aria-label={copy.compactionModel}
            disabled={proModelBusy || !snapshot.state.coreSetupComplete || snapshot.state.browserInteractionMode === "manual"}
            value={snapshot.compactionModel ?? "follow"}
            onChange={event => {
              const value = event.target.value === "follow" ? null : event.target.value as CompactionModel;
              void runAction(async () => {
                const result = await api!.setCompactionModel(value);
                updateCompactionModel(result.compactionModel);
              });
            }}>
            <option value="follow">{copy.compactionFollow}</option>
            <option value="extra-high">GPT-5.6 Extra High</option>
            <option value="5.6-pro">GPT-5.6 Pro</option>
            <option value="5.5-pro">GPT-5.5 Pro</option>
          </select>
        </SettingRow>
        <SettingRow body={copy.proModelVersionBody} label={copy.proModelVersion}>
          <ProModelVersionMenu
            copy={copy}
            disabled={proModelBusy || snapshot.state.coreSetupComplete !== true}
            onChange={(value) => void setProModelVersion(value)}
            value={snapshot.proModelVersion}
          />
        </SettingRow>
        <details className="advanced-settings" open={typeof snapshot.state.pendingBiggerContext === "boolean" ? true : undefined}>
        <summary>{copy.advancedContext}<Icon name="chevron" /></summary>
        <SettingRow
          body={snapshot.state.browserInteractionMode === "manual"
            ? copy.manualBiggerContextUnavailable
            : copy.biggerContextBody}
          label={copy.biggerContext}
        >
          <button className="text-button" type="button" onClick={showBiggerContextInfo} disabled={busy || snapshot.state.browserInteractionMode === "manual"}>
            {copy.setupDetails}
          </button>
          <Switch
            label={copy.biggerContext}
            checked={snapshot.state.pendingBiggerContext ?? snapshot.state.experimentalBiggerContext}
            disabled={busy
              || snapshot.state.browserInteractionMode === "manual"
              || snapshot.state.coreSetupComplete !== true}
            onChange={(checked) => void setBiggerContext(checked)}
          />
        </SettingRow>
        <SettingRow body={snapshot.state.browserInteractionMode === "manual"
          ? copy.manualSkillAttachmentsUnavailable : copy.skillAttachmentsBody} label={copy.skillAttachments}>
          <Switch
            label={copy.skillAttachments}
            checked={snapshot.state.experimentalSkillAttachments}
            disabled={busy || snapshot.state.browserInteractionMode === "manual" || !snapshot.state.coreSetupComplete}
            onChange={(checked) => void setSkillAttachments(checked)}
          />
        </SettingRow>
        <SettingRow body={copy.webSubagentsBody} label={copy.webSubagents}>
          <Switch label={copy.webSubagents} checked={snapshot.state.allowWebSubagents}
            disabled={proModelBusy || !snapshot.state.coreSetupComplete}
            onChange={enabled => void savePreference(() => api!.setWebSubagents(enabled))} />
        </SettingRow>
        <SettingRow body={copy.freshConversationBody} label={copy.freshConversation}>
          <Switch label={copy.freshConversation} checked={snapshot.state.experimentalFreshConversationPerTurn}
            disabled={busy || snapshot.state.browserInteractionMode === "manual" || !snapshot.state.coreSetupComplete}
            onChange={enabled => void savePreference(() => api!.setFreshConversation(enabled))} />
        </SettingRow>
        <p role="status">{snapshot.state.experimentalBiggerContext ? copy.contextActiveBigger : copy.contextActiveStandard}</p>
        <ContextBudgetTable snapshot={snapshot} copy={copy} />
        {typeof snapshot.state.pendingBiggerContext === "boolean" ? <div role="status">
          <p>{snapshot.state.contextChangeApplying ? copy.contextApplying : snapshot.state.contextChangeError ? copy.contextFailed : copy.contextWaiting}</p>
          {snapshot.state.contextChangeError ? <p>{snapshot.state.contextChangeError}</p> : null}
          <button className="secondary-button" type="button" disabled={localBusy || snapshot.state.contextChangeApplying}
            onClick={() => void savePreference(() => api!.cancelContextChange())}>{copy.cancelContextChange}</button>
          {snapshot.state.contextChangeError ? <button className="secondary-button" type="button" disabled={busy}
            onClick={() => void setBiggerContext(snapshot.state.pendingBiggerContext!)}>{copy.retryContextChange}</button> : null}
        </div> : null}
        </details>

        <SectionHeading label={copy.applicationSettings} spaced />
        {!devProfile ? <SettingRow body={copy.launchAtLoginBody} label={copy.launchAtLogin}>
          <Switch
            label={copy.launchAtLogin}
            checked={snapshot.state.autoStart}
            disabled={busy}
            onChange={(checked) => void savePreference(async () => (await api!.setAutostart(checked)).state)}
          />
        </SettingRow> : null}
        <SettingRow body={devProfile ? copy.devKeepRunningBody : copy.keepRunningOnCloseBody} label={copy.keepRunningOnClose}>
          <Switch
            label={copy.keepRunningOnClose}
            checked={snapshot.state.keepRunningOnClose}
            disabled={busy}
            onChange={(checked) => void savePreference(() => api!.setPreference("keepRunningOnClose", checked))}
          />
        </SettingRow>
        <SettingRow body={copy.passkeyBrowserBody} label={copy.passkeyBrowser}>
          <select className="settings-select" aria-label={copy.passkeyBrowser} value={snapshot.state.passkeyBrowser ?? "chrome"}
            disabled={busy || operation?.status === "running"}
            onChange={event => void savePreference(() => api!.setPreference("passkeyBrowser", event.target.value as "chrome" | "firefox"))}>
            <option value="chrome">Google Chrome</option><option value="firefox">Firefox</option>
          </select>
        </SettingRow>
        <SettingRow body={copy.chooseLanguageHint} label={copy.language}>
          <LanguageMenu disabled={busy} copy={copy} language={language} onChange={(next) => void updateLanguage(next)} />
        </SettingRow>
      </div>

      {codexStatus ? <section className="codex-settings-status" aria-label={copy.modelsConnectionTab}>
        <div role="status"><strong>{codexStatus === "picker" ? copy.setupConfirmTitle
          : codexStatus === "catalog-error" ? copy.catalogUnavailable
          : codexStatus === "catalog" ? copy.setupCatalogTitle
          : codexStatus === "removed" ? copy.integrationRemoved : copy.codexSettingsSaved}</strong>
          <p>{codexStatus === "picker" ? copy.setupConfirmBody
            : codexStatus === "catalog-error" ? copy.catalogFailureKeptInstall
            : codexStatus === "removed" ? copy.codexIntegrationRemovedBody
            : codexStatus === "manual-refresh" ? copy.codexManualRefreshBody : copy.setupCatalogBody}</p>
        </div>
        <SecondaryButton onClick={showModelSetup}>{copy.openModelSettings}</SecondaryButton>
      </section> : null}

      <SectionHeading label={copy.diagnostics} spaced />
      {!devProfile ? <RouteDiagnostics
        key={routeDiagnosticsGeneration}
        disabled={busy || operation?.status === "running" || browser?.navigationLocked === true}
        language={language}
        readReport={() => api!.routeDiagnostics()}
      /> : null}
      <button className="diagnostic-row" disabled={busy} onClick={() => void runDoctor()} type="button">
        <Icon name="activity" />
        <span>
          <strong>{copy.runDoctor}</strong>
          <small>{doctor ? (doctor.ok && doctor.checks.every(check => check.status === "ok") ? copy.healthy : copy.needsAttention) : copy.status}</small>
        </span>
        <Icon name="chevron" />
      </button>
      {!devProfile ? <button className="diagnostic-row" disabled={busy} onClick={() => void cancelTurns()} type="button">
        <Icon name="close" />
        <span>
          <strong>{taskCopy.all}</strong>
          <small>{turnsCancelled ?? taskCopy.detail}</small>
        </span>
        <Icon name="chevron" />
      </button> : null}
      {!devProfile ? <button className="diagnostic-row" disabled={busy} onClick={() => void uninstallIntegration()} type="button">
        <Icon name="close" />
        <span>
          <strong>{copy.uninstallIntegration}</strong>
          <small>{integrationRemoved ? copy.integrationRemoved : copy.uninstallIntegrationBody}</small>
        </span>
        <Icon name="chevron" />
      </button> : null}
      {doctor ? <DoctorSummary copy={copy} language={language} report={doctor} /> : null}

      <div className="about-row">
        <BrandMark small />
        <span>
          <strong>{copy.product}</strong>
          <small>
            {devProfile ? `${copy.devBadge} · ${snapshot.profilePaths.coreHome} · ` : ""}
            FroRaut · {platformLabel(snapshot.platform)} · v{snapshot.version}
          </small>
        </span>
      </div>
    </ContentSurface>
  );
}
