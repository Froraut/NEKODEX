import languages from "../electron/languages.json";
import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  Button, cx, Icon, IconButton as KitIconButton, Notice, Page, Select, StateDot as KitStateDot, SurfaceHeader, Switch, Tabs,
  useFocusSafeDisabled, type IconName, type Status,
} from "./design";
import { localizeRuntimeMessage, type Copy } from "./i18n";
import { stripIpcErrorPrefix } from "./ipc-error";
import { useModalFocus } from "./modal-focus";
import { availableChatGptWebModelRoutes, resolveChatGptWebContextLimits, resolveChatGptWebTransportLimits } from "../../src/chatgpt-web-models";
import type { BrowserInteractionMode, DoctorReport, Language, LauncherSnapshot, ProModelVersion } from "./types";

// Shared launcher pieces, drawn with the design-system kit (./design). Names and props are the 6.1.5 API so
// surfaces keep compiling; the look comes from design/components.css and surfaces/shell.css (nk-* classes).

export { Switch };
// Moved to ./modal-focus (the kit Dialog uses it without importing this module); re-exported for callers.
export { useModalFocus };

// ConnectionsTabs switches surfaces (setup <-> mcp), which remounts the tabs. A tab chosen while focus was in
// the tabs gets focus back after the switch, so the kit's arrow-key model keeps working across surfaces.
let pendingConnectionsTab: "models" | "tools" | null = null;

const CONNECTIONS_TAB_PREFIX = "connections-tab";
const CONNECTIONS_PANEL_ID = "connections-panel";

/** Props for the element that holds the active Connections tab's content (the tab panel the tabs point at). */
export function connectionsTabPanelProps(active: "models" | "tools") {
  return { "aria-labelledby": `${CONNECTIONS_TAB_PREFIX}-${active}`, id: CONNECTIONS_PANEL_ID, role: "tabpanel" } as const;
}

/** A tab's status line; derive it from the same readiness that drives the page (word and dot together). */
export interface ConnectionsTabStatus { state: Status; label: string }

export function ConnectionsTabs({
  active,
  copy,
  modelsReady,
  modelsStatus,
  onModels,
  onTools,
  toolsReady,
  toolsStatus,
}: {
  active: "models" | "tools";
  copy: Copy;
  modelsReady: boolean;
  /** Overrides the Verified / Not connected line derived from modelsReady. */
  modelsStatus?: ConnectionsTabStatus;
  onModels: () => void;
  onTools: () => void;
  toolsReady: boolean;
  /** Overrides the Verified / Not connected line derived from toolsReady. */
  toolsStatus?: ConnectionsTabStatus;
}) {
  const status = (ready: boolean, override?: ConnectionsTabStatus) => override
    ?? { state: ready ? "ready" as const : "idle" as const, label: ready ? copy.connectionVerified : copy.connectionPending };
  const models = status(modelsReady, modelsStatus);
  const tools = status(toolsReady, toolsStatus);
  useLayoutEffect(() => {
    if (pendingConnectionsTab !== active) return;
    pendingConnectionsTab = null;
    document.getElementById(`${CONNECTIONS_TAB_PREFIX}-${active}`)?.focus();
  }, [active]);
  const select = (id: string) => {
    if (id !== "models" && id !== "tools") return;
    if (id !== active && document.activeElement?.closest(".nk-tabs")) {
      pendingConnectionsTab = id;
      requestAnimationFrame(() => { pendingConnectionsTab = null; });
    }
    (id === "models" ? onModels : onTools)();
  };
  return (
    <Tabs
      active={active}
      className="nk-connections-tabs"
      idPrefix={CONNECTIONS_TAB_PREFIX}
      label={copy.connectionsNav}
      onSelect={select}
      panelId={CONNECTIONS_PANEL_ID}
      tabs={[
        { id: "models", label: copy.modelsConnectionTab, state: models.state, status: models.label },
        { id: "tools", label: copy.toolsConnectionTab, state: tools.state, status: tools.label },
      ]}
    />
  );
}

export function StateDot({ state }: { state: Status }) {
  return <KitStateDot state={state} />;
}

/** A surface page: the design system's Page (960, or 760 when narrow) with its SurfaceHeader. */
export function ContentSurface({
  children,
  eyebrow,
  fit = false,
  narrow = false,
  subtitle,
  title,
}: {
  children: ReactNode;
  eyebrow?: string;
  /** Kept for API compatibility: pages scroll with the workspace. */
  fit?: boolean;
  narrow?: boolean;
  subtitle?: string;
  title: string;
}) {
  return (
    <Page className={cx("nk-surface", fit && "is-fit")} width={narrow ? "narrow" : undefined}>
      <SurfaceHeader eyebrow={eyebrow} subtitle={subtitle} title={title} />
      {children}
    </Page>
  );
}

export function SetupRow({
  action,
  complete,
  current = false,
  description,
  disabled,
  index,
  onAction,
  onSecondaryAction,
  repeatable = false,
  rowRef,
  secondaryAction,
  secondaryDisabled = false,
  title,
  titleAction,
}: {
  action: string;
  complete: boolean;
  /** The derived next step: accent index and the primary action. */
  current?: boolean;
  description: string;
  disabled: boolean;
  index: number;
  onAction: () => void;
  onSecondaryAction?: () => void;
  repeatable?: boolean;
  rowRef?: RefObject<HTMLDivElement | null>;
  secondaryAction?: string;
  secondaryDisabled?: boolean;
  title: string;
  titleAction?: ReactNode;
}) {
  return (
    <div className={cx("nk-setup-row", complete && "is-complete", current && !complete && "is-current")} ref={rowRef}>
      <span className="nk-setup-row__index">{complete ? <Icon className="nk-icon" name="check" /> : index}</span>
      <div>
        <div className="nk-setup-row__heading">
          <strong>{title}</strong>
          {titleAction}
        </div>
        <p>{description}</p>
      </div>
      <div className="nk-setup-row__actions">
        {secondaryAction && onSecondaryAction ? (
          <SecondaryButton disabled={secondaryDisabled || complete} onClick={onSecondaryAction}>
            {secondaryAction}
          </SecondaryButton>
        ) : null}
        <Button disabled={disabled || (complete && !repeatable)} onClick={onAction} variant={current && !complete ? "primary" : "secondary"}>
          {action}
        </Button>
      </div>
    </div>
  );
}

export function SecondaryButton({
  children,
  disabled = false,
  icon,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  icon?: IconName;
  onClick: () => void;
}) {
  return <Button disabled={disabled} icon={icon} onClick={onClick}>{children}</Button>;
}

export function ZeroRiskModelMenu({
  busy,
  copy,
  onChange,
  proEnabled,
}: {
  busy: boolean;
  copy: Copy;
  onChange: (enabled: boolean) => void;
  proEnabled: boolean;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const selectedRadio = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (busy) setOpen(false); }, [busy]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => selectedRadio.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const closeMenu = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const choose = (enabled: boolean) => {
    if (busy) return;
    closeMenu();
    if (enabled !== proEnabled) onChange(enabled);
  };
  const option = (enabled: boolean, title: string, body: string) => (
    <ChoiceButton
      body={body}
      buttonRef={proEnabled === enabled ? selectedRadio : undefined}
      compact
      disabled={busy}
      onChoose={() => choose(enabled)}
      selected={proEnabled === enabled}
      title={title}
    />
  );

  return (
    <div
      className={cx("nk-menu", open && "is-open")}
      onKeyDown={(event) => {
        if (event.key === "Escape") closeMenu();
      }}
    >
      <KitIconButton
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        buttonRef={trigger}
        className="nk-menu__trigger"
        disabled={busy}
        icon="settings"
        label={copy.zeroRiskModelSettings}
        onClick={() => setOpen((current) => !current)}
      />
      {open ? (
        <>
          <button
            aria-label={`${copy.close}: ${copy.zeroRiskModelSettings}`}
            className="nk-menu__scrim"
            onClick={closeMenu}
            tabIndex={-1}
            type="button"
          />
          <div
            aria-label={copy.zeroRiskModelSettings}
            className="nk-menu__panel"
            id={panelId}
            onKeyDown={handleRadioGroupKeys}
            role="radiogroup"
          >
            <p>{copy.zeroRiskModelSettingsBody}</p>
            <div className="nk-menu__option">
              {option(false, copy.zeroRiskDefaultProfile, copy.zeroRiskDefaultProfileBody)}
            </div>
            <div className="nk-menu__option has-info">
              {option(true, copy.zeroRiskProProfile, copy.zeroRiskProProfileBody)}
              <span
                aria-label={copy.zeroRiskProProfileInfo}
                className="nk-menu__info"
                role="img"
                tabIndex={0}
              >
                <Icon className="nk-icon" name="info" />
                <span className="nk-tooltip" role="tooltip">
                  {copy.zeroRiskProProfileInfo}
                </span>
              </span>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function handleRadioGroupKeys(event: ReactKeyboardEvent<HTMLElement>) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const radios = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([aria-disabled="true"]):not(:disabled)')];
  if (!radios.length) return;
  const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[role="radio"]') : null;
  if (!target || !event.currentTarget.contains(target)) return;
  // The group is busy (the focused radio keeps focus while aria-disabled): the keys do nothing, not even scroll.
  if (target.getAttribute("aria-disabled") === "true") { event.preventDefault(); return; }
  const current = radios.indexOf(target);
  if (current < 0) return;
  let next = current;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = radios.length - 1;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (next - 1 + radios.length) % radios.length;
  else next = (next + 1) % radios.length;
  event.preventDefault();
  radios[next]?.focus();
  radios[next]?.click();
}

/** A section heading inside a page (heading style), with an optional caption on the right. */
export function SectionHeading({ label, meta, spaced = false }: { label: string; meta?: string; spaced?: boolean }) {
  return (
    <div className={cx("nk-section-heading", spaced && "is-spaced")}>
      <span>{label}</span>
      {meta ? <small>{meta}</small> : null}
    </div>
  );
}

/** An inline notice (the design system's Notice) for warnings and confirmations inside a flow. */
export function NoticeRow({
  children,
  icon,
  tone,
}: {
  children: ReactNode;
  icon: IconName;
  tone: "warning" | "success";
}) {
  return <Notice className="nk-notice-row" icon={icon} tone={tone}>{children}</Notice>;
}

export function PrimaryButton({
  children,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return <Button disabled={disabled} onClick={onClick} variant="primary">{children}</Button>;
}

export function messageOf(value: unknown): string {
  return stripIpcErrorPrefix(value instanceof Error ? value.message : String(value));
}

export function TutorialVideo({ copy, label, src }: { copy: Copy; label: string; src: string }) {
  const [expanded, setExpanded] = useState(false);
  const inlineVideo = useRef<HTMLVideoElement>(null);
  const expandedVideo = useRef<HTMLVideoElement>(null);
  const expandedDialog = useRef<HTMLDivElement>(null);
  const expandedAt = useRef(0);

  const closeExpanded = () => {
    const currentTime = expandedVideo.current?.currentTime;
    if (inlineVideo.current && Number.isFinite(currentTime)) {
      inlineVideo.current.currentTime = currentTime ?? 0;
    }
    setExpanded(false);
  };
  useModalFocus(expanded, expandedDialog, closeExpanded);

  return (
    <>
      <div className="nk-media">
        <video aria-label={label} controls preload="metadata" muted playsInline ref={inlineVideo} src={src} />
        <KitIconButton
          className="nk-media__expand"
          icon="expand"
          label={copy.expandGuideVideo}
          onClick={() => {
            expandedAt.current = inlineVideo.current?.currentTime ?? 0;
            inlineVideo.current?.pause();
            setExpanded(true);
          }}
        />
      </div>
      {expanded ? createPortal(
        <div
          aria-label={label}
          aria-modal="true"
          className="nk-media is-expanded"
          ref={expandedDialog}
          role="dialog"
          tabIndex={-1}
        >
          <video
            aria-label={label}
            controls
            preload="metadata"
            muted
            onLoadedMetadata={(event) => {
              event.currentTarget.currentTime = expandedAt.current;
            }}
            playsInline
            ref={expandedVideo}
            src={src}
          />
          <KitIconButton
            className="nk-media__close"
            data-modal-autofocus
            icon="close"
            label={copy.closeGuideVideo}
            onClick={closeExpanded}
          />
        </div>,
        document.body,
      ) : null}
    </>
  );
}

/** A labelled input row; a plain <input>, <select> or <textarea> child gets the kit's field styling. */
export function FieldRow({ children, label }: { children: ReactNode; label: string }) {
  const control = isValidElement<{ className?: string }>(children)
    && (children.type === "input" || children.type === "select" || children.type === "textarea")
    ? cloneElement(children, { className: cx("nk-input", children.props.className) })
    : children;
  return (
    <label className="nk-field-row">
      <span>{label}</span>
      {control}
    </label>
  );
}

export function DoctorSummary({ copy, language, report }: { copy: Copy; language: Language; report: DoctorReport }) {
  const healthy = report.ok && report.checks.every(check => check.status === "ok");
  const visibleChecks = healthy
    ? report.checks.slice(-6)
    : report.checks.filter((check) => check.status !== "ok");
  return (
    <div className={cx("nk-doctor", healthy && "is-healthy")}>
      <header>
        <Icon className="nk-icon" name={healthy ? "check" : "activity"} />
        <strong>{healthy ? copy.healthy : copy.needsAttention}</strong>
      </header>
      <div>
        {visibleChecks.map((check) => (
          <p key={check.id}>
            <StateDot state={check.status === "ok" ? "ready" : check.status === "warning" ? "busy" : "error"} />
            <span>{check.status === "ok"
              ? localizeRuntimeMessage(copy, check.message, check.id, language)
              : check.message}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

function ChoiceMark({ selected }: { selected: boolean }) {
  return <span aria-hidden="true" className="nk-choice__mark">{selected ? <Icon className="nk-icon" name="check" /> : null}</span>;
}

/** A choice card (role="radio"); one that is focused when the group turns busy keeps focus (useFocusSafeDisabled). */
function ChoiceButton({ body, buttonRef, compact = false, disabled, onChoose, selected, title }: {
  body: string;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  compact?: boolean;
  disabled: boolean;
  onChoose: () => void;
  selected: boolean;
  title: string;
}) {
  const guard = useFocusSafeDisabled<HTMLButtonElement>(disabled);
  return (
    <button
      aria-checked={selected}
      aria-disabled={guard.soft ? "true" : undefined}
      className={cx("nk-choice", compact && "nk-choice--compact", selected && "is-selected")}
      disabled={guard.disabled}
      onBlur={guard.onBlur}
      onClick={guard.soft ? undefined : onChoose}
      onFocus={guard.onFocus}
      ref={buttonRef}
      role="radio"
      tabIndex={selected ? 0 : -1}
      type="button"
    >
      <ChoiceMark selected={selected} />
      <span className="nk-choice__copy">
        <strong>{title}</strong>
        <small>{body}</small>
      </span>
    </button>
  );
}

export function InteractionModePicker({
  className,
  copy,
  disabled,
  mode,
  onChange,
}: {
  className?: string;
  copy: Copy;
  disabled: boolean;
  mode: BrowserInteractionMode;
  onChange: (mode: BrowserInteractionMode) => void;
}) {
  const choice = (value: BrowserInteractionMode, title: string, body: string) => (
    <ChoiceButton body={body} disabled={disabled} onChoose={() => onChange(value)} selected={mode === value} title={title} />
  );
  return (
    <div
      aria-label={copy.interactionMode}
      className={cx("nk-choice-group", className)}
      onKeyDown={handleRadioGroupKeys}
      role="radiogroup"
    >
      {choice("automatic", copy.automaticInteraction, copy.automaticInteractionBody)}
      {choice("manual", copy.manualInteraction, copy.manualInteractionBody)}
    </div>
  );
}

export function ContextBudgetTable({ snapshot, copy }: { snapshot: LauncherSnapshot; copy: Copy }) {
  if (!snapshot.state.coreSetupComplete || !snapshot.contextCapabilities) return null;
  const capabilities = { ...snapshot.contextCapabilities, browserInteractionMode: snapshot.state.browserInteractionMode,
    experimentalBiggerContext: snapshot.state.experimentalBiggerContext, zeroRiskProEnabled: snapshot.state.zeroRiskProEnabled };
  const routes = availableChatGptWebModelRoutes(capabilities);
  return <div className="nk-budget-table">
    <table>
      <caption>{copy.contextBudgetCaption}</caption>
      <thead><tr><th scope="col">{copy.contextBudgetModel}</th><th scope="col">{copy.contextBudgetHistory}</th><th scope="col">{copy.contextBudgetMessage}</th></tr></thead>
      <tbody>{routes.map(route => {
        const effort = route.interactionMode === "manual" ? "low" : route.adapterEffort;
        const limits = resolveChatGptWebContextLimits(route.backendModel, effort, capabilities);
        const transport = resolveChatGptWebTransportLimits(route.backendModel, effort, capabilities);
        const number = (value: number) => value.toLocaleString(snapshot.state.language || "en");
        const oneMessage = transport.browserMessageTokenLimit !== undefined
          ? `${number(transport.browserMessageTokenLimit)} ${copy.contextTokenUnit}`
          : transport.browserComposerCharLimit !== undefined ? `${number(transport.browserComposerCharLimit)} ${copy.contextCharUnit}` : "—";
        return <tr key={route.slug}><th scope="row">{route.displayName}</th><td>{number(limits.autoCompactTokenLimit)} {copy.contextTokenUnit}</td><td>{oneMessage}</td></tr>;
      })}</tbody>
    </table>
    <p>{copy.contextBudgetEvidence}</p>
  </div>;
}

/** A setting: title and one-sentence consequence on the left, the control right-aligned (kit SettingRow markup). */
export function SettingRow({
  body,
  children,
  flushAfter = false,
  label,
}: {
  body: string;
  children: ReactNode;
  flushAfter?: boolean;
  label: string;
}) {
  const hasSwitch = isValidElement(children) && children.type === Switch;
  return (
    <div className={cx("nk-setting-row", hasSwitch && "has-switch", flushAfter && "is-flush-after")}>
      <div>
        <strong>{label}</strong>
        <p>{body}</p>
      </div>
      <div className="nk-setting-row__control">{children}</div>
    </div>
  );
}

export function LanguageMenu({ copy, language, onChange, disabled = false }: { disabled?: boolean; copy: Copy; language: Language; onChange: (language: Language) => void }) {
  const options: Array<{ label: string; value: Language }> =
    (Object.entries(languages) as Array<[Language, { label: string }]>).map(([value, { label }]) => ({ label, value }));
  return <Select disabled={disabled} label={copy.language} onChange={value => onChange(value as Language)} options={options} value={language} />;
}

export function ProModelVersionMenu({
  copy,
  disabled,
  onChange,
  value,
}: {
  copy: Copy;
  disabled: boolean;
  onChange: (value: ProModelVersion | null) => void;
  value: ProModelVersion | null;
}) {
  return (
    <Select
      disabled={disabled}
      label={copy.proModelVersion}
      onChange={(next) => onChange(next === "" ? null : next as ProModelVersion)}
      options={[
        { value: "", label: copy.proModelFollow },
        { value: "5.6", label: copy.proModel56 },
        ...(value === "5.5" ? [{ value: "5.5", label: copy.legacySavedModel, disabled: true }] : []),
        { value: "6", label: copy.proModel6 },
      ]}
      value={value ?? ""}
    />
  );
}

export function platformLabel(value: string): string {
  return value === "darwin" ? "macOS" : value === "win32" ? "Windows" : value === "linux" ? "Linux" : value;
}

export function IconButton({
  buttonRef,
  controls,
  disabled = false,
  expanded,
  icon,
  label,
  onClick,
}: {
  buttonRef?: RefObject<HTMLButtonElement | null>;
  controls?: string;
  disabled?: boolean;
  expanded?: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <KitIconButton
      aria-controls={controls}
      aria-expanded={expanded}
      buttonRef={buttonRef}
      disabled={disabled}
      icon={icon}
      label={label}
      onClick={onClick}
    />
  );
}
