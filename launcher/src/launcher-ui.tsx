import languages from "../electron/languages.json";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { localizeRuntimeMessage, type Copy } from "./i18n";
import { Icon, type IconName } from "./icons";
import { availableChatGptWebModelRoutes, resolveChatGptWebContextLimits, resolveChatGptWebTransportLimits } from "../../src/chatgpt-web-models";
import type { BrowserInteractionMode, DoctorReport, Language, LauncherSnapshot, ProModelVersion } from "./types";

export function ConnectionsTabs({
  active,
  copy,
  modelsReady,
  onModels,
  onTools,
  toolsReady,
}: {
  active: "models" | "tools";
  copy: Copy;
  modelsReady: boolean;
  onModels: () => void;
  onTools: () => void;
  toolsReady: boolean;
}) {
  const tab = (id: "models" | "tools", label: string, ready: boolean, onClick: () => void) => (
    <button aria-current={active === id ? "page" : undefined}
      className={active === id ? "is-active" : ""} onClick={onClick} type="button">
      <span>{label}</span>
      <small><StateDot state={ready ? "ready" : "idle"} />
        {ready ? copy.connectionVerified : copy.connectionPending}</small>
    </button>
  );
  return (
    <nav aria-label={copy.connectionsNav} className="connections-tabs">
      {tab("models", copy.modelsConnectionTab, modelsReady, onModels)}
      {tab("tools", copy.toolsConnectionTab, toolsReady, onTools)}
    </nav>
  );
}

export function StateDot({ state }: { state: "idle" | "ready" | "busy" | "error" }) {
  return <i aria-hidden="true" className={`state-dot is-${state}`} />;
}

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
  fit?: boolean;
  narrow?: boolean;
  subtitle?: string;
  title: string;
}) {
  return (
    <section className={`content-surface${fit ? " is-fit-surface" : " is-page-scroll"}`}>
      <div className={`content-scroll${narrow ? " is-narrow" : ""}${fit ? " is-fit" : ""}`}>
        <header className="surface-header">
          {eyebrow ? <span>{eyebrow}</span> : null}
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </header>
        {children}
      </div>
    </section>
  );
}

export function SetupRow({
  action,
  complete,
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
    <div className={`setup-row${complete ? " is-complete" : ""}`} ref={rowRef}>
      <span className="setup-index">{complete ? <Icon name="check" /> : index}</span>
      <div className="setup-row-copy">
        <div className="setup-row-heading">
          <strong>{title}</strong>
          {titleAction}
        </div>
        <p>{description}</p>
      </div>
      <div className="setup-actions">
        {secondaryAction && onSecondaryAction ? (
          <SecondaryButton disabled={secondaryDisabled || complete} onClick={onSecondaryAction}>
            {secondaryAction}
          </SecondaryButton>
        ) : null}
        <SecondaryButton disabled={disabled || (complete && !repeatable)} onClick={onAction}>
          {action}
        </SecondaryButton>
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
  return (
    <button className="button-secondary" disabled={disabled} onClick={onClick} type="button">
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
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

  return (
    <div
      className={`zero-risk-model-menu${open ? " is-open" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") closeMenu();
      }}
    >
      <button
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={copy.zeroRiskModelSettings}
        className="zero-risk-model-trigger"
        disabled={busy}
        onClick={() => setOpen((current) => !current)}
        ref={trigger}
        title={copy.zeroRiskModelSettings}
        type="button"
      >
        <Icon name="settings" />
      </button>
      {open ? (
        <>
          <button
            aria-label={`${copy.close}: ${copy.zeroRiskModelSettings}`}
            className="zero-risk-model-scrim"
            onClick={closeMenu}
            tabIndex={-1}
            type="button"
          />
          <div
            aria-label={copy.zeroRiskModelSettings}
            className="zero-risk-model-panel"
            id={panelId}
            onKeyDown={handleRadioGroupKeys}
            role="radiogroup"
          >
            <p>{copy.zeroRiskModelSettingsBody}</p>
            <div className="zero-risk-model-option-row">
              <button
                aria-checked={!proEnabled}
                className={!proEnabled ? "is-selected" : ""}
                disabled={busy}
                onClick={() => choose(false)}
                ref={!proEnabled ? selectedRadio : undefined}
                role="radio"
                tabIndex={!proEnabled ? 0 : -1}
                type="button"
              >
                {!proEnabled ? <span className="zero-risk-model-radio"><Icon name="check" /></span> : null}
                <span>
                  <strong>{copy.zeroRiskDefaultProfile}</strong>
                  <small>{copy.zeroRiskDefaultProfileBody}</small>
                </span>
              </button>
            </div>
            <div className="zero-risk-model-option-row has-info">
              <button
                aria-checked={proEnabled}
                className={proEnabled ? "is-selected" : ""}
                disabled={busy}
                onClick={() => choose(true)}
                ref={proEnabled ? selectedRadio : undefined}
                role="radio"
                tabIndex={proEnabled ? 0 : -1}
                type="button"
              >
                {proEnabled ? <span className="zero-risk-model-radio"><Icon name="check" /></span> : null}
                <span>
                  <strong>{copy.zeroRiskProProfile}</strong>
                  <small>{copy.zeroRiskProProfileBody}</small>
                </span>
              </button>
              <span
                aria-label={copy.zeroRiskProProfileInfo}
                className="zero-risk-model-info"
                role="img"
                tabIndex={0}
              >
                <Icon name="info" />
                <span className="zero-risk-model-tooltip" role="tooltip">
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

export function SectionHeading({ label, meta, spaced = false }: { label: string; meta?: string; spaced?: boolean }) {
  return (
    <div className={`section-heading${spaced ? " is-spaced" : ""}`}>
      <span>{label}</span>
      {meta ? <small>{meta}</small> : null}
    </div>
  );
}

export function NoticeRow({
  children,
  icon,
  tone,
}: {
  children: ReactNode;
  icon: IconName;
  tone: "warning" | "success";
}) {
  return (
    <div className={`notice-row tone-${tone}`}>
      <Icon name={icon} />
      <span>{children}</span>
    </div>
  );
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
  return (
    <button className="button-primary" disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  );
}

export function McpMark() {
  return <i aria-hidden="true" className="mcp-mark" />;
}

export function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
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
      <div className="guide-media">
        <video aria-label={label} controls preload="metadata" muted playsInline ref={inlineVideo} src={src} />
        <button
          aria-label={copy.expandGuideVideo}
          className="guide-media-expand"
          onClick={() => {
            expandedAt.current = inlineVideo.current?.currentTime ?? 0;
            inlineVideo.current?.pause();
            setExpanded(true);
          }}
          type="button"
        >
          <Icon name="expand" />
        </button>
      </div>
      {expanded ? createPortal(
        <div
          aria-label={label}
          aria-modal="true"
          className="guide-media is-expanded"
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
          <button
            aria-label={copy.closeGuideVideo}
            className="guide-media-close"
            data-modal-autofocus
            onClick={closeExpanded}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

export function useModalFocus(
  active: boolean,
  container: RefObject<HTMLElement | null>,
  onClose: () => void,
  { closeAllowed = true, restoreFocus }: { closeAllowed?: boolean; restoreFocus?: RefObject<HTMLElement | null> } = {},
) {
  const close = useRef(onClose);
  const canClose = useRef(closeAllowed);
  close.current = onClose;
  canClose.current = closeAllowed;
  useEffect(() => {
    if (!active || !container.current) return;
    const modal = container.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inerted = new Map<HTMLElement, boolean>();
    let branch: HTMLElement = modal;
    let parent = branch.parentElement;
    while (parent) {
      for (const element of parent.children) {
        if (element instanceof HTMLElement && element !== branch && !inerted.has(element)) {
          inerted.set(element, element.inert);
          element.inert = true;
        }
      }
      if (parent === document.body) break;
      branch = parent;
      parent = branch.parentElement;
    }
    const visible = (element: HTMLElement) => {
      if (element.hidden || element.closest("[inert]")) return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const focusable = () => [...modal.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), video[controls], [href], [tabindex]:not([tabindex="-1"])')].filter(visible);
    const focusFirst = () => {
      const preferred = modal.querySelector<HTMLElement>("[data-modal-autofocus]");
      (preferred && visible(preferred) && !preferred.matches(":disabled") ? preferred : focusable()[0] ?? modal).focus();
    };
    const frame = requestAnimationFrame(focusFirst);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (canClose.current) close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) { event.preventDefault(); modal.focus(); return; }
      const first = controls[0]!;
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof Node && modal.contains(event.target)) return;
      event.stopPropagation();
      focusFirst();
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin, true);
      for (const [element, inert] of inerted) element.inert = inert;
      const restore = restoreFocus?.current ?? previous;
      requestAnimationFrame(() => {
        const target = restore?.isConnected && !restore.closest("[inert]") && !restore.matches(":disabled")
          ? restore
          : document.querySelector<HTMLElement>('.sidebar-item[aria-current="page"]:not(:disabled)');
        target?.focus();
      });
    };
  }, [active, container, restoreFocus]);
}

export function FieldRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="field-row">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function DoctorSummary({ copy, language, report }: { copy: Copy; language: Language; report: DoctorReport }) {
  const healthy = report.ok && report.checks.every(check => check.status === "ok");
  const visibleChecks = healthy
    ? report.checks.slice(-6)
    : report.checks.filter((check) => check.status !== "ok");
  return (
    <div className={`doctor-summary${healthy ? " is-healthy" : ""}`}>
      <header>
        <Icon name={healthy ? "check" : "activity"} />
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
  return (
    <div
      aria-label={copy.interactionMode}
      className={`interaction-mode-picker${className ? ` ${className}` : ""}`}
      onKeyDown={handleRadioGroupKeys}
      role="radiogroup"
    >
      <button
        aria-checked={mode === "automatic"}
        className={mode === "automatic" ? "is-selected" : ""}
        disabled={disabled}
        onClick={() => onChange("automatic")}
        role="radio"
        tabIndex={mode === "automatic" ? 0 : -1}
        type="button"
      >
        {mode === "automatic" ? (
          <span className="interaction-mode-check"><Icon name="check" /></span>
        ) : null}
        <span>
          <strong>{copy.automaticInteraction}</strong>
          <small>{copy.automaticInteractionBody}</small>
        </span>
      </button>
      <button
        aria-checked={mode === "manual"}
        className={mode === "manual" ? "is-selected" : ""}
        disabled={disabled}
        onClick={() => onChange("manual")}
        role="radio"
        tabIndex={mode === "manual" ? 0 : -1}
        type="button"
      >
        {mode === "manual" ? (
          <span className="interaction-mode-check"><Icon name="check" /></span>
        ) : null}
        <span>
          <strong>{copy.manualInteraction}</strong>
          <small>{copy.manualInteractionBody}</small>
        </span>
      </button>
    </div>
  );
}

export function ContextBudgetTable({ snapshot, copy }: { snapshot: LauncherSnapshot; copy: Copy }) {
  if (!snapshot.state.coreSetupComplete || !snapshot.contextCapabilities) return null;
  const capabilities = { ...snapshot.contextCapabilities, browserInteractionMode: snapshot.state.browserInteractionMode,
    experimentalBiggerContext: snapshot.state.experimentalBiggerContext, zeroRiskProEnabled: snapshot.state.zeroRiskProEnabled };
  const routes = availableChatGptWebModelRoutes(capabilities);
  return <div className="context-budget-table">
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
  return (
    <div className={`setting-row${flushAfter ? " is-flush-after" : ""}`}>
      <div>
        <strong>{label}</strong>
        <p>{body}</p>
      </div>
      {children}
    </div>
  );
}

export function Switch({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-label={label}
      aria-checked={checked}
      className={`switch${checked ? " is-on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span />
    </button>
  );
}

export function LanguageMenu({ copy, language, onChange, disabled = false }: { disabled?: boolean; copy: Copy; language: Language; onChange: (language: Language) => void }) {
  const options: Array<{ label: string; value: Language }> =
    (Object.entries(languages) as Array<[Language, { label: string }]>).map(([value, { label }]) => ({ label, value }));
  return <label className="language-menu">
    <span className="visually-hidden">{copy.language}</span>
    <select disabled={disabled} aria-label={copy.language} className="language-menu-trigger" value={language}
      onChange={event => onChange(event.target.value as Language)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
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
    <select
      aria-label={copy.proModelVersion}
      className="settings-select"
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === ""
        ? null
        : event.target.value as ProModelVersion)}
      value={value ?? ""}
    >
      <option value="">{copy.proModelFollow}</option>
      <option value="5.6">{copy.proModel56}</option>
      <option value="5.5">{copy.proModel55}</option>
      <option value="6">{copy.proModel6}</option>
    </select>
  );
}

export function platformLabel(value: string): string {
  return value === "darwin" ? "macOS" : value === "win32" ? "Windows" : value === "linux" ? "Linux" : value;
}
