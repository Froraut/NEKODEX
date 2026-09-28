import { selectLanguage } from "./language-selection";
import taskControlCopy from "../electron/task-control-copy.json";
import type { CompactionModel } from "./types";
import { codexSettingsStatus } from "./setup-progress";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import { type Copy } from "./i18n";
import { LocaleNotice } from "./LocaleNotice";
import { RouteDiagnostics } from "./RouteDiagnostics";
import { workflowCopy } from "./workflow-copy";
import { APPEARANCE_OPTIONS, appearanceCopy } from "./appearance-copy";
import { settingsCopy } from "./settings-copy";
import type { Appearance, BrowserCapacitySettings, BrowserInteractionMode, BrowserState, DoctorReport, Language, LauncherSnapshot, LauncherState, OperationState, ProModelVersion } from "./types";
import { Button, Disclosure, Mark, Notice, Page, Select, SettingRow, SettingsGroup, SurfaceHeader, Switch, TextField, cx } from "./design";
import { messageOf, DoctorSummary, InteractionModePicker, ContextBudgetTable, LanguageMenu, ProModelVersionMenu, platformLabel } from './launcher-ui';
import "./surfaces/settings.css";
const api = window.codexWebLauncher;

/** Group anchors, in page order; the contents rail links to them. */
const SECTION_IDS = ["settings-agent", "settings-workspace", "settings-advanced", "settings-diagnostics", "settings-about"] as const;
type SectionId = typeof SECTION_IDS[number];

/** The control a save belongs to: it alone shows busy while that save waits or runs. */
type ActionKey = "mode" | "capacity" | "manualSubmit" | "pro" | "webSubagents" | "savedChats" | "appearance" | "language"
  | "autoStart" | "keepRunning" | "showDuringTurns" | "networkNotice" | "passkeyBrowser" | "logout" | "compaction"
  | "biggerContext" | "skills" | "fresh" | "cancelContext" | "doctor" | "cancelTurns" | "uninstall";

/** How far below a group's landing spot (its scroll-margin) the reading line sits. Smaller than the shortest group. */
const READING_LINE = 88;
/** After a rail click, the clicked group stays current until the reader scrolls this far from where it landed. */
const PIN_RELEASE = 48;
/** A programmatic scroll counts as finished once the scroller has been still this long (scrollend is a fast path). */
const SCROLL_SETTLE_MS = 150;

/** Moves focus to a group's title, as an in-page link would (the title is not otherwise focusable). */
function focusGroupHeading(id: SectionId) {
  const heading = document.getElementById(id)?.querySelector<HTMLElement>("h2");
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

/**
 * Tracks the settings group in view for the contents rail. The current group is the last one whose top has passed a
 * reading line just below the spot a rail link lands it on. Near the end of the page the line speeds up, so groups
 * whose titles can never reach it (the short last groups) still become current in order, the last one at the end.
 * A rail click shows its target at once and keeps it until the reader scrolls away from where it landed.
 */
function useSectionInView(anchor: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState<SectionId>(SECTION_IDS[0]);
  const pin = useRef<{ id: SectionId; landedAt: number | null } | null>(null);
  /** (Re)starts the wait for a rail scroll to finish. */
  const armSettle = useRef<() => void>(() => {});
  useEffect(() => {
    const layout = anchor.current;
    const scroller = layout?.closest<HTMLElement>(".nk-shell__scroll") ?? null;
    if (!layout || !scroller) return;
    let frame = 0;
    let idle: number | undefined;
    const pick = () => {
      frame = 0;
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      // Scaled displays can stop a fraction short of the end.
      const scrollTop = scroller.scrollTop >= max - 1 ? max : scroller.scrollTop;
      const current = pin.current;
      if (current) {
        if (current.landedAt === null || Math.abs(scrollTop - current.landedAt) < PIN_RELEASE) return;
        pin.current = null;
      }
      const groups = SECTION_IDS.map(id => document.getElementById(id));
      if (groups.some(group => !group)) return;
      const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
      const tops = groups.map(group => group!.getBoundingClientRect().top - origin);
      const offset = (parseFloat(getComputedStyle(groups[0]!).scrollMarginTop) || 0) + READING_LINE;
      // Distance the line must still travel at the end of the page to reach the last group's top.
      const overflow = Math.max(0, tops[tops.length - 1] - (max + offset));
      const ramp = Math.min(max, overflow);
      const line = scrollTop + offset + (ramp > 0 && scrollTop > max - ramp ? overflow * (scrollTop - (max - ramp)) / ramp : 0);
      let index = 0;
      tops.forEach((top, i) => { if (top <= line + 0.5) index = i; });
      setActive(SECTION_IDS[index]);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(pick); };
    const settle = () => {
      window.clearTimeout(idle);
      const current = pin.current;
      if (current && current.landedAt === null) current.landedAt = scroller.scrollTop;
    };
    armSettle.current = () => { window.clearTimeout(idle); idle = window.setTimeout(settle, SCROLL_SETTLE_MS); };
    const onScroll = () => {
      if (pin.current?.landedAt === null) armSettle.current();
      schedule();
    };
    // The reader's own wheel or touch ends a rail scroll early; the rail then follows the page again.
    const onUserScroll = () => {
      if (pin.current?.landedAt === null) { pin.current = null; window.clearTimeout(idle); schedule(); }
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("scrollend", settle);
    scroller.addEventListener("wheel", onUserScroll, { passive: true });
    scroller.addEventListener("touchstart", onUserScroll, { passive: true });
    // Groups change height (Advanced opens, a report appears, the window resizes): the current group can change too.
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resize?.observe(layout);
    resize?.observe(scroller);
    schedule();
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(idle);
      resize?.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("scrollend", settle);
      scroller.removeEventListener("wheel", onUserScroll);
      scroller.removeEventListener("touchstart", onUserScroll);
      armSettle.current = () => {};
    };
  }, [anchor]);
  const go = (id: SectionId, event: ReactMouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    pin.current = { id, landedAt: null };
    setActive(id);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    focusGroupHeading(id);
    // Scroll events re-arm this; a scroll that does not move (the group is already in place) settles after the pause.
    armSettle.current();
  };
  return { active, go };
}

export function SettingsSurface({
  browser,
  catalogFailure,
  showModelSetup,
  showActivity,
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
  /** Opens Activity (the routing check's failure advice points there). */
  showActivity?: () => void;
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
  const [languageLoad, setLanguageLoad] = useState<{ language: Language; failed: boolean } | null>(null);
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
  const manual = snapshot.state.browserInteractionMode === "manual";
  const layoutRef = useRef<HTMLDivElement>(null);
  const contents = useSectionInView(layoutRef);

  // Saves run one at a time, in the order they were asked for (each returns the whole launcher state, so they must
  // not overlap). Only the control being saved shows busy; the rest of the page stays usable and queues behind it.
  const [pending, setPending] = useState<ReadonlySet<ActionKey>>(() => new Set());
  const pendingKeys = useRef(new Set<ActionKey>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const saving = (key: ActionKey) => pending.has(key);
  // Another launcher transition (runtime start, update, repair) refuses every change until it ends; one of our own
  // saves can hold it too, and then the page must not lock behind it.
  const locked = Boolean(snapshot.lifecycle?.transition) && pending.size === 0;
  const tasksRunning = operation?.status === "running" || browser?.tabs.some((tab) => tab.status === "running") === true;
  const runAction = (key: ActionKey, action: () => Promise<void>) => {
    if ((locked && key !== "cancelContext") || pendingKeys.current.has(key)) return;
    pendingKeys.current.add(key);
    setPending(new Set(pendingKeys.current));
    setError(null);
    const run = queue.current.then(async () => {
      try { await action(); }
      catch (cause) { setError(messageOf(cause)); }
      finally {
        pendingKeys.current.delete(key);
        setPending(new Set(pendingKeys.current));
      }
    });
    queue.current = run;
    return run;
  };
  const saveCapacity = () => {
    if (!capacityValid || capacityValue === capacity.configured) return;
    const value = capacityValue;
    return runAction("capacity", async () => {
      const saved = await api!.setBrowserCapacity(value);
      updateBrowserCapacity(saved); setCapacityInput(String(saved.configured));
    });
  };
  const savePreference = (key: ActionKey, action: () => Promise<LauncherState>) => runAction(key, async () => { updateState(await action()); });
  const updateLanguage = (next: Language) => runAction("language", async () => {
    setLanguageLoad({ language: next, failed: false });
    try {
      const state = await selectLanguage(next, language => api!.setLanguage(language));
      if (state) updateState(state);
      setLanguageLoad(null);
    } catch (cause) { setLanguageLoad({ language: next, failed: true }); throw cause; }
  });
  const runDoctor = () => runAction("doctor", async () => {
    setDoctor(null);
    setDoctor(await api!.doctor());
  });
  const cancelTurns = () => runAction("cancelTurns", async () => {
    const receipt = await api!.cancelTurns();
    if (receipt.cancelled) return;
    setTurnsCancelled(receipt.cancelledHttpTurns === 0 && receipt.cancelledBrowserTurns === 0
      && receipt.cancelledCompactionRuns === 0 ? taskCopy.none : taskCopy.receipt
        .replace("{http}", String(receipt.cancelledHttpTurns))
        .replace("{browser}", String(receipt.cancelledBrowserTurns))
        .replace("{compaction}", receipt.cancelledCompactionRuns === null ? taskCopy.unknown : String(receipt.cancelledCompactionRuns)));
  });
  const setBiggerContext = (enabled: boolean) => savePreference("biggerContext", () => api!.setBiggerContext(enabled));
  const setInteractionMode = (mode: BrowserInteractionMode) => {
    if (mode === snapshot.state.browserInteractionMode) return;
    return runAction("mode", async () => {
      // Retire diagnostics before IPC: even a failed receipt may have replaced the runtime.
      setRouteDiagnosticsGeneration(generation => generation + 1);
      const result = await api!.setBrowserInteractionMode(mode);
      updateState(result.state);
      if (result.credentialsRequired) configureInteractionMode(result.targetMode);
    });
  };
  const setProModelVersion = (value: ProModelVersion | null) => runAction("pro", async () => {
    const result = await api!.setProModelVersion(value);
    updateProModelVersion(result.proModelVersion);
  });
  const setCompactionModel = (value: CompactionModel | null) => runAction("compaction", async () => {
    const result = await api!.setCompactionModel(value);
    updateCompactionModel(result.compactionModel);
  });
  const uninstallIntegration = () => runAction("uninstall", async () => {
    const result = await api!.uninstallIntegration();
    if (!result.cancelled) {
      updateState(result.state); setIntegrationRemoved(true);
      setRouteDiagnosticsGeneration(generation => generation + 1);
    }
  });
  // Removed in this session, or earlier (the launcher keeps "restart Codex" after a removal until setup runs again).
  const integrationGone = snapshot.state.coreSetupComplete !== true
    && (integrationRemoved || snapshot.state.codexRestartRequired === true);

  // The ChatGPT row goes away once the log out lands; focus that was on its button moves to the group title.
  const showChatGpt = browser?.authenticated === true && !manual;
  const chatGptWasShown = useRef(showChatGpt);
  useEffect(() => {
    const focusLost = !document.activeElement || document.activeElement === document.body;
    if (chatGptWasShown.current && !showChatGpt && focusLost) focusGroupHeading("settings-workspace");
    chatGptWasShown.current = showChatGpt;
  }, [showChatGpt]);

  const pendingContext = snapshot.state.pendingBiggerContext;
  // Advanced context settings open while a context change is pending, and stay as the user leaves them afterwards.
  const contextChangePending = typeof pendingContext === "boolean";
  const [advancedOpen, setAdvancedOpen] = useState(contextChangePending);
  useEffect(() => { if (contextChangePending) setAdvancedOpen(true); }, [contextChangePending]);
  // The pending-change notice leaves once the change is cancelled or applied. When its Cancel or Retry button had
  // focus, focus moves to the Bigger Context switch it was about instead of falling to <body>.
  const contextNoticeFocused = useRef(false);
  const contextSwitchRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (contextChangePending || !contextNoticeFocused.current) return;
    contextNoticeFocused.current = false;
    if (document.activeElement && document.activeElement !== document.body) return;
    contextSwitchRow.current?.querySelector<HTMLElement>('[role="switch"]')?.focus({ preventScroll: true });
  }, [contextChangePending]);
  const seconds = new Intl.NumberFormat(language, { style: "unit", unit: "second", unitDisplay: "short" });
  const sectionTitles: Record<SectionId, string> = {
    "settings-agent": settings.agent,
    "settings-workspace": settings.workspace,
    "settings-advanced": settings.advanced,
    "settings-diagnostics": copy.diagnostics,
    "settings-about": settings.about,
  };
  const capacityFeedback = !capacityValid ? copy.capacityInvalid.replace("{max}", String(capacity.maximum))
    : saving("capacity") ? settings.capacitySaving
    : capacityValue !== capacity.configured ? copy.unsavedChanges : "";

  return (
    <div className="settings-layout" ref={layoutRef}>
      <Page className="settings-page" width="narrow">
        <SurfaceHeader title={devProfile ? copy.devSettingsTitle : copy.settingsTitle} subtitle={copy.settingsSubtitle} />

        <SettingsGroup id="settings-agent" title={settings.agent}>
          <div aria-busy={saving("mode") || undefined} className="settings-block">
            <strong className="nk-type-body-strong">{copy.interactionMode}</strong>
            <InteractionModePicker
              copy={copy}
              disabled={locked || saving("mode")}
              mode={snapshot.state.browserInteractionMode}
              onChange={(mode) => void setInteractionMode(mode)}
            />
          </div>
          <SettingRow
            title={copy.browserCapacity}
            description={<>
              {copy.browserCapacityBody}
              {/* A lasting live region: the note is announced when a save makes a restart necessary. */}
              <span className="settings-row-note" role="status">{capacity.restartRequired ? settings.capacityRestart : ""}</span>
            </>}
            control={(
              <div className="settings-capacity">
                <form noValidate onSubmit={event => { event.preventDefault(); void saveCapacity(); }}>
                  <TextField aria-label={copy.browserCapacity} type="number" min={1} max={capacity.maximum} step={1}
                    aria-invalid={!capacityValid} aria-describedby="capacity-feedback"
                    value={capacityInput} disabled={locked} readOnly={saving("capacity")}
                    onChange={event => setCapacityInput(event.target.value)}
                    action={(
                      <Button type="submit" busy={saving("capacity")}
                        disabled={locked || !capacityValid || capacityValue === capacity.configured}>
                        {copy.browserCapacitySave}
                      </Button>
                    )} />
                </form>
                <p id="capacity-feedback" className={!capacityValid ? "nk-field__error" : "nk-field__hint"} role="status">
                  {capacityFeedback}
                </p>
                <p className="nk-field__hint" role="status">
                  {copy.browserCapacityStatus.replace("{active}", String(capacity.active)).replace("{saved}", String(capacity.configured))}
                </p>
              </div>
            )}
          />
          <SettingRow
            title={copy.manualSubmitTime}
            description={copy.manualSubmitTimeBody}
            control={(
              <Select label={copy.manualSubmitTime} aria-busy={saving("manualSubmit") || undefined} disabled={locked || saving("manualSubmit")}
                value={String(snapshot.state.manualSubmitTimeoutSec ?? 120)}
                onChange={value => void savePreference("manualSubmit", () => api!.setPreference("manualSubmitTimeoutSec", Number(value)))}
                options={[30, 60, 120, 180, 300, 600].map(value => ({ value: String(value), label: seconds.format(value) }))} />
            )}
          />
          <SettingRow
            title={copy.proModelVersion}
            description={copy.proModelVersionBody}
            control={(
              <ProModelVersionMenu
                copy={copy}
                disabled={locked || saving("pro") || tasksRunning || snapshot.state.coreSetupComplete !== true}
                onChange={(value) => void setProModelVersion(value)}
                value={snapshot.proModelVersion}
              />
            )}
          />
          <SettingRow
            title={copy.webSubagents}
            description={copy.webSubagentsBody}
            control={<Switch label={copy.webSubagents} checked={snapshot.state.allowWebSubagents}
              busy={saving("webSubagents")} disabled={locked || tasksRunning || !snapshot.state.coreSetupComplete}
              onChange={enabled => void savePreference("webSubagents", () => api!.setWebSubagents(enabled))} />}
          />
          <SettingRow
            title={copy.savedChats}
            description={copy.savedChatsBody}
            control={<Switch label={copy.savedChats} checked={snapshot.state.useSavedChats}
              busy={saving("savedChats")} disabled={locked || !snapshot.state.coreSetupComplete}
              onChange={enabled => void savePreference("savedChats", () => api!.setUseSavedChats(enabled))} />}
          />
        </SettingsGroup>

        <SettingsGroup id="settings-workspace" title={settings.workspace}>
          <SettingRow
            title={appearance.title}
            description={appearance.body}
            control={(
              <Select label={appearance.title} value={snapshot.state.appearance ?? "dark"} aria-busy={saving("appearance") || undefined}
                disabled={locked || saving("appearance")}
                onChange={value => void savePreference("appearance", () => api!.setPreference("appearance", value as Appearance))}
                options={APPEARANCE_OPTIONS.map(option => ({ value: option, label: appearance.options[option] }))} />
            )}
          />
          <SettingRow
            title={copy.language}
            description={settings.languageBody}
            control={(
              <div className="settings-control-stack">
                {languageLoad ? <LocaleNotice language={languageLoad.language} copy={copy} failed={languageLoad.failed} /> : null}
                <LanguageMenu disabled={locked || saving("language")} copy={copy} language={language} onChange={(next) => void updateLanguage(next)} />
              </div>
            )}
          />
          {!devProfile ? (
            <SettingRow
              title={copy.launchAtLogin}
              description={copy.launchAtLoginBody}
              control={<Switch label={copy.launchAtLogin} checked={snapshot.state.autoStart} busy={saving("autoStart")} disabled={locked}
                onChange={(checked) => void savePreference("autoStart", async () => (await api!.setAutostart(checked)).state)} />}
            />
          ) : null}
          <SettingRow
            title={copy.keepRunningOnClose}
            description={devProfile ? copy.devKeepRunningBody : copy.keepRunningOnCloseBody}
            control={<Switch label={copy.keepRunningOnClose} checked={snapshot.state.keepRunningOnClose} busy={saving("keepRunning")} disabled={locked}
              onChange={(checked) => void savePreference("keepRunning", () => api!.setPreference("keepRunningOnClose", checked))} />}
          />
          <SettingRow
            title={copy.showDuringTurns}
            description={copy.showDuringTurnsBody}
            control={<Switch label={copy.showDuringTurns} checked={snapshot.state.showBrowserDuringTurns}
              busy={saving("showDuringTurns")} disabled={locked || manual}
              onChange={(checked) => void savePreference("showDuringTurns", () => api!.setPreference("showBrowserDuringTurns", checked))} />}
          />
          <SettingRow
            title={network.settingTitle}
            description={network.settingBody}
            control={<Switch label={network.settingTitle} checked={snapshot.state.showNetworkIssueNotice !== false}
              busy={saving("networkNotice")} disabled={locked}
              onChange={(checked) => void savePreference("networkNotice", () => api!.setPreference("showNetworkIssueNotice", checked))} />}
          />
          <SettingRow
            title={copy.passkeyBrowser}
            description={copy.passkeyBrowserBody}
            control={(
              <Select label={copy.passkeyBrowser} value={snapshot.state.passkeyBrowser ?? "chrome"} aria-busy={saving("passkeyBrowser") || undefined}
                disabled={locked || saving("passkeyBrowser") || operation?.status === "running"}
                onChange={value => void savePreference("passkeyBrowser", () => api!.setPreference("passkeyBrowser", value as "chrome" | "firefox"))}
                options={[{ value: "chrome", label: "Google Chrome" }, { value: "firefox", label: "Firefox" }]} />
            )}
          />
          <SettingRow
            title={copy.toolsConnectionTab}
            description={copy.mcpBody}
            control={(
              <Button onClick={() => configureInteractionMode(snapshot.state.browserInteractionMode)}>
                {copy.manageToolsConnection}
              </Button>
            )}
          />
          {showChatGpt && browser ? (
            <SettingRow
              title="ChatGPT"
              description={browser.accountName || browser.accountLabel
                ? [browser.accountName, browser.accountLabel].filter(Boolean).join(" · ") : undefined}
              control={confirmingLogout ? (
                <div className="settings-confirm" role="group" aria-label={copy.logOut}
                  onKeyDown={event => {
                    if (event.key === "Escape") {
                      event.preventDefault(); event.stopPropagation(); setLogoutAccountId(null);
                    }
                  }}>
                  <p role="alert">{copy.logOutConfirmBody}</p>
                  <div className="settings-confirm__actions">
                    <Button autoFocus onClick={() => setLogoutAccountId(null)}>
                      {copy.logOutKeepSignedIn}
                    </Button>
                    <Button variant="danger" disabled={locked}
                      onClick={() => {
                        // The confirmation gives way to the Log out button: focus moves onto it before the save marks
                        // it busy, so it keeps focus (a focused busy button stays focusable) and the reader their place.
                        flushSync(() => setLogoutAccountId(null));
                        logoutTrigger.current?.focus();
                        void savePreference("logout", async () => (await api!.logoutChatGpt()).state);
                      }}>
                      {copy.logOut}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button busy={saving("logout")} disabled={locked} ref={logoutTrigger} onClick={() => setLogoutAccountId(currentAccountId)}>
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
                  <Select label={copy.compactionModel} aria-busy={saving("compaction") || undefined}
                    disabled={locked || saving("compaction") || tasksRunning || !snapshot.state.coreSetupComplete || manual}
                    value={snapshot.compactionModel ?? "follow"}
                    onChange={next => void setCompactionModel(next === "follow" ? null : next as CompactionModel)}
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
                  <div className="settings-control-inline" ref={contextSwitchRow}>
                    <Button variant="link" size="sm" onClick={showBiggerContextInfo} disabled={manual || saving("biggerContext")}>
                      {copy.setupDetails}
                    </Button>
                    <Switch
                      label={copy.biggerContext}
                      checked={pendingContext ?? snapshot.state.experimentalBiggerContext}
                      busy={saving("biggerContext")} disabled={locked || manual || snapshot.state.coreSetupComplete !== true}
                      onChange={(checked) => void setBiggerContext(checked)}
                    />
                  </div>
                )}
              />
              <SettingRow
                title={copy.skillAttachments}
                description={manual ? copy.manualSkillAttachmentsUnavailable : copy.skillAttachmentsBody}
                control={<Switch label={copy.skillAttachments} checked={snapshot.state.experimentalSkillAttachments}
                  busy={saving("skills")} disabled={locked || manual || !snapshot.state.coreSetupComplete}
                  onChange={(checked) => void savePreference("skills", () => api!.setSkillAttachments(checked))} />}
              />
              <SettingRow
                title={copy.freshConversation}
                description={copy.freshConversationBody}
                control={<Switch label={copy.freshConversation} checked={snapshot.state.experimentalFreshConversationPerTurn}
                  busy={saving("fresh")} disabled={locked || manual || !snapshot.state.coreSetupComplete}
                  onChange={enabled => void savePreference("fresh", () => api!.setFreshConversation(enabled))} />}
              />
            </div>
            <p className="settings-context-status nk-type-caption" role="status">
              {snapshot.state.experimentalBiggerContext ? copy.contextActiveBigger : copy.contextActiveStandard}
            </p>
            <ContextBudgetTable snapshot={snapshot} copy={copy} />
            {typeof pendingContext === "boolean" ? (
              <Notice
                className="settings-context-change"
                onFocus={() => { contextNoticeFocused.current = true; }}
                onBlur={event => { if (event.relatedTarget) contextNoticeFocused.current = false; }}
                tone={snapshot.state.contextChangeError ? "warning" : "info"}
                title={snapshot.state.contextChangeApplying ? copy.contextApplying
                  : snapshot.state.contextChangeError ? copy.contextFailed : copy.contextWaiting}
                action={<>
                  {/* Cancelling stays possible during a launcher transition (the main process allows it). */}
                  <Button size="sm" busy={saving("cancelContext")} disabled={snapshot.state.contextChangeApplying}
                    onClick={() => void savePreference("cancelContext", () => api!.cancelContextChange())}>{copy.cancelContextChange}</Button>
                  {snapshot.state.contextChangeError ? (
                    <Button size="sm" busy={saving("biggerContext")} disabled={locked} onClick={() => void setBiggerContext(pendingContext)}>
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
                disabled={locked || saving("mode") || saving("uninstall") || operation?.status === "running" || browser?.navigationLocked === true}
                language={language}
                onActionError={cause => setError(messageOf(cause))}
                onExport={() => api!.exportLogs()}
                onViewActivity={showActivity}
                readReport={() => api!.routeDiagnostics()}
              />
            ) : null}
            <SettingRow
              className={cx(doctor && "settings-row--with-result")}
              title={copy.runDoctor}
              description={settings.doctorBody}
              control={(
                <Button icon="activity" busy={saving("doctor")} disabled={locked} onClick={() => void runDoctor()}>{copy.runDoctor}</Button>
              )}
            />
            {doctor ? (
              <div className="settings-row-result">
                <DoctorSummary copy={copy} language={language} report={doctor} />
              </div>
            ) : null}
            {/* Both destructive rows open the launcher's own confirmation dialog, whose Cancel all / Remove is the
                confirming (danger) step; the row button is only the first, secondary click. */}
            {!devProfile ? (
              <SettingRow
                title={taskCopy.all}
                description={turnsCancelled ?? taskCopy.detail}
                control={<Button busy={saving("cancelTurns")} disabled={locked} onClick={() => void cancelTurns()}>{taskCopy.confirm}</Button>}
              />
            ) : null}
            {!devProfile ? (
              <SettingRow
                title={copy.uninstallIntegration}
                description={integrationGone ? copy.integrationRemoved : copy.uninstallIntegrationBody}
                control={(
                  <Button busy={saving("uninstall")} disabled={locked || integrationGone} onClick={() => void uninstallIntegration()}>
                    {settings.remove}
                  </Button>
                )}
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

      {/* After the page in the DOM, so Tab and screen readers reach it after the settings; the grid puts it right. */}
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
    </div>
  );
}
