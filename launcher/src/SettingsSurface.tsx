import { selectLanguage } from "./language-selection";
import taskControlCopy from "../electron/task-control-copy.json";
import type { CompactionModel } from "./types";
import { codexSettingsStatus } from "./setup-progress";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { type Copy } from "./i18n";
import { LocaleNotice } from "./LocaleNotice";
import { RouteDiagnostics } from "./RouteDiagnostics";
import { workflowCopy } from "./workflow-copy";
import { APPEARANCE_OPTIONS, appearanceCopy } from "./appearance-copy";
import { settingsCopy } from "./settings-copy";
import type { Appearance, BrowserCapacitySettings, BrowserInteractionMode, BrowserState, DoctorReport, Language, LauncherSnapshot, LauncherState, OperationState, ProModelVersion } from "./types";
import { Button, Disclosure, Mark, Notice, Page, Select, SettingRow, SettingsGroup, SurfaceHeader, Switch, cx } from "./design";
import { messageOf, DoctorSummary, InteractionModePicker, ContextBudgetTable, LanguageMenu, ProModelVersionMenu, platformLabel } from './launcher-ui';
import "./surfaces/settings.css";
const api = window.codexWebLauncher;

/** Group anchors, in page order; the contents rail links to them. */
const SECTION_IDS = ["settings-agent", "settings-workspace", "settings-advanced", "settings-diagnostics", "settings-about"] as const;
type SectionId = typeof SECTION_IDS[number];

/**
 * Tracks the settings group in view for the contents rail: IntersectionObserver on the workspace scroller
 * (the first group crossing the top 40% of the scroller wins; at the very end of the page the last group).
 * A rail click pins its target until that scroll ends.
 */
function useSectionInView(anchor: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState<SectionId>(SECTION_IDS[0]);
  const pinned = useRef<SectionId | null>(null);
  useEffect(() => {
    const scroller = anchor.current?.closest<HTMLElement>(".nk-shell__scroll") ?? null;
    const targets = SECTION_IDS.map(id => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (!scroller || !targets.length || typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const atEnd = () => scroller.scrollHeight > scroller.clientHeight + 1 && scroller.scrollTop > 0
      && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
    const pick = () => {
      if (pinned.current) return;
      if (atEnd()) { setActive(SECTION_IDS[SECTION_IDS.length - 1]); return; }
      const first = SECTION_IDS.find(id => visible.has(id));
      if (first) setActive(first);
    };
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id); else visible.delete(entry.target.id);
      }
      pick();
    }, { root: scroller, rootMargin: "0px 0px -60% 0px", threshold: 0 });
    targets.forEach(target => observer.observe(target));
    let release: number | undefined;
    const unpin = () => { window.clearTimeout(release); if (pinned.current) { pinned.current = null; } };
    const onScroll = () => {
      if (pinned.current) { window.clearTimeout(release); release = window.setTimeout(unpin, 160); return; }
      pick();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("scrollend", unpin);
    return () => {
      observer.disconnect();
      window.clearTimeout(release);
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("scrollend", unpin);
    };
  }, [anchor]);
  const go = (id: SectionId, event: ReactMouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    pinned.current = id;
    setActive(id);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    // Move focus with the reader, as an in-page link would: to the group heading.
    const heading = target.querySelector<HTMLElement>("h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    // Scrolls that do not move (target already in place) never fire scrollend.
    window.setTimeout(() => { if (pinned.current === id) pinned.current = null; }, 1200);
  };
  return { active, go };
}

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
  const [languageLoad, setLanguageLoad] = useState<{ language: Language; failed: boolean } | null>(null);
  const busy = localBusy || Boolean(snapshot.lifecycle?.transition);
  const [turnsCancelled, setTurnsCancelled] = useState<string | null>(null);
  const taskCopy = taskControlCopy[language] ?? taskControlCopy.en;
  const settings = settingsCopy(language);
  const appearance = appearanceCopy(language);
  const network = workflowCopy(language).network;
  const [integrationRemoved, setIntegrationRemoved] = useState(false);
  const [logoutAccountId, setLogoutAccountId] = useState<string | null>(null);
  const currentAccountId = browser?.accountId ?? "default";
  const confirmingLogout = logoutAccountId === currentAccountId;
  const logoutTrigger = useRef<HTMLButtonElement>(null);
  const logoutWasOpen = useRef(false);
  useEffect(() => {
    if (logoutWasOpen.current && !confirmingLogout) logoutTrigger.current?.focus();
    logoutWasOpen.current = confirmingLogout;
  }, [confirmingLogout]);
  useEffect(() => { setLogoutAccountId(null); }, [currentAccountId]);
  const [routeDiagnosticsGeneration, setRouteDiagnosticsGeneration] = useState(0);
  const codexStatus = codexSettingsStatus(snapshot.state, devProfile, Boolean(catalogFailure));
  const proModelBusy = busy
    || operation?.status === "running"
    || browser?.tabs.some((tab) => tab.status === "running") === true;
  const manual = snapshot.state.browserInteractionMode === "manual";
  const layoutRef = useRef<HTMLDivElement>(null);
  const contents = useSectionInView(layoutRef);

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
  const updateLanguage = (next: Language) => runAction(async () => {
    setLanguageLoad({ language: next, failed: false });
    try {
      const state = await selectLanguage(next, language => api!.setLanguage(language));
      if (state) updateState(state);
      setLanguageLoad(null);
    } catch (cause) { setLanguageLoad({ language: next, failed: true }); throw cause; }
  });
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

  const pendingContext = snapshot.state.pendingBiggerContext;
  // Advanced context settings open while a context change is pending, and stay as the user leaves them afterwards.
  const contextChangePending = typeof pendingContext === "boolean";
  const [advancedOpen, setAdvancedOpen] = useState(contextChangePending);
  useEffect(() => { if (contextChangePending) setAdvancedOpen(true); }, [contextChangePending]);
  const seconds = new Intl.NumberFormat(language, { style: "unit", unit: "second", unitDisplay: "short" });
  const sectionTitles: Record<SectionId, string> = {
    "settings-agent": settings.agent,
    "settings-workspace": settings.workspace,
    "settings-advanced": settings.advanced,
    "settings-diagnostics": copy.diagnostics,
    "settings-about": settings.about,
  };

  return (
    <div className="settings-layout" ref={layoutRef}>
      <nav aria-label={settings.onThisPage} className="settings-toc">
        <small aria-hidden="true" className="nk-type-caption">{settings.onThisPage}</small>
        <ul>
          {SECTION_IDS.map(id => (
            <li key={id}>
              <a aria-current={contents.active === id ? "location" : undefined} className="nk-type-small" href={`#${id}`}
                onClick={event => contents.go(id, event)}>{sectionTitles[id]}</a>
            </li>
          ))}
        </ul>
      </nav>

      <Page className="settings-page" width="narrow">
        <SurfaceHeader title={devProfile ? copy.devSettingsTitle : copy.settingsTitle} subtitle={copy.settingsSubtitle} />

        <SettingsGroup id="settings-agent" title={settings.agent}>
          <div className="settings-block">
            <strong className="nk-type-body-strong">{copy.interactionMode}</strong>
            <InteractionModePicker
              copy={copy}
              disabled={busy}
              mode={snapshot.state.browserInteractionMode}
              onChange={(mode) => void setInteractionMode(mode)}
            />
          </div>
          <SettingRow
            title={copy.browserCapacity}
            description={copy.browserCapacityBody}
            control={(
              <div className="settings-capacity">
                <form className="nk-field__row" noValidate onSubmit={event => { event.preventDefault(); void saveCapacity(); }}>
                  <input className="nk-input" aria-label={copy.browserCapacity} type="number" min={1} max={capacity.maximum} step={1}
                    aria-invalid={!capacityValid} aria-describedby="capacity-feedback"
                    value={capacityInput} disabled={busy} onChange={event => setCapacityInput(event.target.value)} />
                  <Button type="submit" disabled={busy || !capacityValid || capacityValue === capacity.configured}>
                    {busy ? copy.loading : copy.browserCapacitySave}
                  </Button>
                </form>
                <p id="capacity-feedback" className={!capacityValid ? "nk-field__error" : "nk-field__hint"} role="status">
                  {!capacityValid ? copy.capacityInvalid.replace("{max}", String(capacity.maximum))
                    : capacityValue !== capacity.configured ? copy.unsavedChanges : copy.capacitySaved}
                </p>
                <p className="nk-field__hint" role="status">
                  {copy.browserCapacityStatus.replace("{active}", String(capacity.active)).replace("{saved}", String(capacity.configured))}
                </p>
                {capacity.restartRequired ? <p className="nk-field__hint" role="status">{copy.browserCapacityRestart}</p> : null}
              </div>
            )}
          />
          <SettingRow
            title={copy.manualSubmitTime}
            description={copy.manualSubmitTimeBody}
            control={(
              <Select label={copy.manualSubmitTime} disabled={busy}
                value={String(snapshot.state.manualSubmitTimeoutSec ?? 120)}
                onChange={value => void savePreference(() => api!.setPreference("manualSubmitTimeoutSec", Number(value)))}
                options={[30, 60, 120, 180, 300, 600].map(value => ({ value: String(value), label: seconds.format(value) }))} />
            )}
          />
          <SettingRow
            title={copy.proModelVersion}
            description={copy.proModelVersionBody}
            control={(
              <ProModelVersionMenu
                copy={copy}
                disabled={proModelBusy || snapshot.state.coreSetupComplete !== true}
                onChange={(value) => void setProModelVersion(value)}
                value={snapshot.proModelVersion}
              />
            )}
          />
          <SettingRow
            title={copy.webSubagents}
            description={copy.webSubagentsBody}
            control={<Switch label={copy.webSubagents} checked={snapshot.state.allowWebSubagents}
              disabled={proModelBusy || !snapshot.state.coreSetupComplete}
              onChange={enabled => void savePreference(() => api!.setWebSubagents(enabled))} />}
          />
          <SettingRow
            title={copy.savedChats}
            description={copy.savedChatsBody}
            control={<Switch label={copy.savedChats} checked={snapshot.state.useSavedChats}
              disabled={busy || !snapshot.state.coreSetupComplete}
              onChange={enabled => void savePreference(() => api!.setUseSavedChats(enabled))} />}
          />
        </SettingsGroup>

        <SettingsGroup id="settings-workspace" title={settings.workspace}>
          <SettingRow
            title={appearance.title}
            description={appearance.body}
            control={(
              <Select label={appearance.title} value={snapshot.state.appearance ?? "dark"} disabled={busy}
                onChange={value => void savePreference(() => api!.setPreference("appearance", value as Appearance))}
                options={APPEARANCE_OPTIONS.map(option => ({ value: option, label: appearance.options[option] }))} />
            )}
          />
          <SettingRow
            title={copy.language}
            description={copy.chooseLanguageHint}
            control={(
              <div className="settings-control-stack">
                {languageLoad ? <LocaleNotice language={languageLoad.language} copy={copy} failed={languageLoad.failed} /> : null}
                <LanguageMenu disabled={busy} copy={copy} language={language} onChange={(next) => void updateLanguage(next)} />
              </div>
            )}
          />
          {!devProfile ? (
            <SettingRow
              title={copy.launchAtLogin}
              description={copy.launchAtLoginBody}
              control={<Switch label={copy.launchAtLogin} checked={snapshot.state.autoStart} disabled={busy}
                onChange={(checked) => void savePreference(async () => (await api!.setAutostart(checked)).state)} />}
            />
          ) : null}
          <SettingRow
            title={copy.keepRunningOnClose}
            description={devProfile ? copy.devKeepRunningBody : copy.keepRunningOnCloseBody}
            control={<Switch label={copy.keepRunningOnClose} checked={snapshot.state.keepRunningOnClose} disabled={busy}
              onChange={(checked) => void savePreference(() => api!.setPreference("keepRunningOnClose", checked))} />}
          />
          <SettingRow
            title={copy.showDuringTurns}
            description={copy.showDuringTurnsBody}
            control={<Switch label={copy.showDuringTurns} checked={snapshot.state.showBrowserDuringTurns}
              disabled={busy || manual}
              onChange={(checked) => void savePreference(() => api!.setPreference("showBrowserDuringTurns", checked))} />}
          />
          <SettingRow
            title={network.settingTitle}
            description={network.settingBody}
            control={<Switch label={network.settingTitle} checked={snapshot.state.showNetworkIssueNotice !== false} disabled={busy}
              onChange={(checked) => void savePreference(() => api!.setPreference("showNetworkIssueNotice", checked))} />}
          />
          <SettingRow
            title={copy.passkeyBrowser}
            description={copy.passkeyBrowserBody}
            control={(
              <Select label={copy.passkeyBrowser} value={snapshot.state.passkeyBrowser ?? "chrome"}
                disabled={busy || operation?.status === "running"}
                onChange={value => void savePreference(() => api!.setPreference("passkeyBrowser", value as "chrome" | "firefox"))}
                options={[{ value: "chrome", label: "Google Chrome" }, { value: "firefox", label: "Firefox" }]} />
            )}
          />
          <SettingRow
            title={copy.toolsConnectionTab}
            description={copy.mcpBody}
            control={(
              <Button disabled={busy} onClick={() => configureInteractionMode(snapshot.state.browserInteractionMode)}>
                {copy.manageToolsConnection}
              </Button>
            )}
          />
          {browser?.authenticated && !manual ? (
            <SettingRow
              title="ChatGPT"
              description={browser.accountName || browser.accountLabel
                ? [browser.accountName, browser.accountLabel].filter(Boolean).join(" · ") : undefined}
              control={confirmingLogout ? (
                <div className="settings-confirm" role="group" aria-label={copy.logOut}
                  onKeyDown={event => {
                    if (event.key === "Escape" && !busy) {
                      event.preventDefault(); event.stopPropagation(); setLogoutAccountId(null);
                    }
                  }}>
                  <p role="alert">{copy.logOutConfirmBody}</p>
                  <div className="settings-confirm__actions">
                    <Button autoFocus disabled={busy} onClick={() => setLogoutAccountId(null)}>
                      {copy.logOutKeepSignedIn}
                    </Button>
                    <Button variant="danger" disabled={busy}
                      onClick={() => {
                        setLogoutAccountId(null);
                        void savePreference(async () => (await api!.logoutChatGpt()).state);
                      }}>
                      {copy.logOut}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button disabled={busy} ref={logoutTrigger} onClick={() => setLogoutAccountId(currentAccountId)}>
                  {copy.logOut}
                </Button>
              )}
            />
          ) : null}
        </SettingsGroup>

        <section className="nk-settings-group" id="settings-advanced">
          <header><h2>{settings.advanced}</h2></header>
          <Disclosure
            className="settings-disclosure"
            open={advancedOpen}
            onToggle={setAdvancedOpen}
            hint={[copy.compactionModel, copy.biggerContext].join(" · ")}
            title={copy.advancedContext}
          >
            <div className="settings-rows">
              <SettingRow
                title={copy.compactionModel}
                description={copy.compactionModelBody}
                control={(
                  <Select label={copy.compactionModel}
                    disabled={proModelBusy || !snapshot.state.coreSetupComplete || manual}
                    value={snapshot.compactionModel ?? "follow"}
                    onChange={next => {
                      const value = next === "follow" ? null : next as CompactionModel;
                      void runAction(async () => {
                        const result = await api!.setCompactionModel(value);
                        updateCompactionModel(result.compactionModel);
                      });
                    }}
                    options={[
                      { value: "follow", label: copy.compactionFollow },
                      { value: "extra-high", label: "GPT-5.6 Sol · Extra High" },
                      { value: "5.6-pro", label: "GPT-5.6 Sol Pro" },
                      ...(snapshot.compactionModel === "5.5-pro" ? [{ value: "5.5-pro", label: copy.legacySavedModel, disabled: true }] : []),
                    ]} />
                )}
              />
              <SettingRow
                title={copy.biggerContext}
                description={manual ? copy.manualBiggerContextUnavailable : copy.biggerContextBody}
                control={(
                  <div className="settings-control-inline">
                    <Button variant="link" size="sm" onClick={showBiggerContextInfo} disabled={busy || manual}>
                      {copy.setupDetails}
                    </Button>
                    <Switch
                      label={copy.biggerContext}
                      checked={pendingContext ?? snapshot.state.experimentalBiggerContext}
                      disabled={busy || manual || snapshot.state.coreSetupComplete !== true}
                      onChange={(checked) => void setBiggerContext(checked)}
                    />
                  </div>
                )}
              />
              <SettingRow
                title={copy.skillAttachments}
                description={manual ? copy.manualSkillAttachmentsUnavailable : copy.skillAttachmentsBody}
                control={<Switch label={copy.skillAttachments} checked={snapshot.state.experimentalSkillAttachments}
                  disabled={busy || manual || !snapshot.state.coreSetupComplete}
                  onChange={(checked) => void setSkillAttachments(checked)} />}
              />
              <SettingRow
                title={copy.freshConversation}
                description={copy.freshConversationBody}
                control={<Switch label={copy.freshConversation} checked={snapshot.state.experimentalFreshConversationPerTurn}
                  disabled={busy || manual || !snapshot.state.coreSetupComplete}
                  onChange={enabled => void savePreference(() => api!.setFreshConversation(enabled))} />}
              />
            </div>
            <p className="settings-context-status nk-type-caption" role="status">
              {snapshot.state.experimentalBiggerContext ? copy.contextActiveBigger : copy.contextActiveStandard}
            </p>
            <ContextBudgetTable snapshot={snapshot} copy={copy} />
            {typeof pendingContext === "boolean" ? (
              <Notice
                className="settings-context-change"
                tone={snapshot.state.contextChangeError ? "warning" : "info"}
                title={snapshot.state.contextChangeApplying ? copy.contextApplying
                  : snapshot.state.contextChangeError ? copy.contextFailed : copy.contextWaiting}
                action={<>
                  <Button size="sm" disabled={localBusy || snapshot.state.contextChangeApplying}
                    onClick={() => void savePreference(() => api!.cancelContextChange())}>{copy.cancelContextChange}</Button>
                  {snapshot.state.contextChangeError ? (
                    <Button size="sm" disabled={busy} onClick={() => void setBiggerContext(pendingContext)}>
                      {copy.retryContextChange}
                    </Button>
                  ) : null}
                </>}
              >
                {snapshot.state.contextChangeError || null}
              </Notice>
            ) : null}
          </Disclosure>
        </section>

        <section className="nk-settings-group" id="settings-diagnostics">
          <header><h2>{copy.diagnostics}</h2></header>
          {codexStatus ? (
            <section className="settings-codex-status" aria-label={copy.modelsConnectionTab}>
              <Notice
                tone={codexStatus === "catalog-error" ? "warning" : "info"}
                title={codexStatus === "picker" ? copy.setupConfirmTitle
                  : codexStatus === "catalog-error" ? copy.catalogUnavailable
                  : codexStatus === "catalog" ? copy.setupCatalogTitle
                  : codexStatus === "removed" ? copy.integrationRemoved : copy.codexSettingsSaved}
                action={<Button size="sm" onClick={showModelSetup}>{copy.openModelSettings}</Button>}
              >
                {codexStatus === "picker" ? copy.setupConfirmBody
                  : codexStatus === "catalog-error" ? copy.catalogFailureKeptInstall
                  : codexStatus === "removed" ? copy.codexIntegrationRemovedBody
                  : codexStatus === "manual-refresh" ? copy.codexManualRefreshBody : copy.setupCatalogBody}
              </Notice>
            </section>
          ) : null}
          <div className="nk-panel">
            {!devProfile ? (
              <RouteDiagnostics
                key={routeDiagnosticsGeneration}
                disabled={busy || operation?.status === "running" || browser?.navigationLocked === true}
                language={language}
                readReport={() => api!.routeDiagnostics()}
              />
            ) : null}
            <SettingRow
              className={cx(doctor && "settings-row--with-result")}
              title={copy.runDoctor}
              description={settings.doctorBody}
              control={(
                <Button icon="activity" disabled={busy} onClick={() => void runDoctor()}>{copy.runDoctor}</Button>
              )}
            />
            {doctor ? (
              <div className="settings-row-result">
                <DoctorSummary copy={copy} language={language} report={doctor} />
              </div>
            ) : null}
            {!devProfile ? (
              <SettingRow
                title={taskCopy.all}
                description={turnsCancelled ?? taskCopy.detail}
                control={<Button variant="danger" disabled={busy} onClick={() => void cancelTurns()}>{taskCopy.confirm}</Button>}
              />
            ) : null}
            {!devProfile ? (
              <SettingRow
                title={copy.uninstallIntegration}
                description={integrationRemoved ? copy.integrationRemoved : copy.uninstallIntegrationBody}
                control={<Button variant="danger" disabled={busy} onClick={() => void uninstallIntegration()}>{settings.remove}</Button>}
              />
            ) : null}
          </div>
        </section>

        <SettingsGroup id="settings-about" title={settings.about}>
          <div className="settings-about">
            <Mark label={null} size={32} />
            <div>
              <strong className="nk-type-body-strong">{copy.product}</strong>
              <p className="nk-type-small">
                {devProfile ? `${copy.devBadge} · ${snapshot.profilePaths.coreHome} · ` : ""}
                FroRaut · {platformLabel(snapshot.platform)} · v{snapshot.version}
              </p>
            </div>
          </div>
        </SettingsGroup>
      </Page>
    </div>
  );
}
