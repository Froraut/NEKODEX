import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { BrandMark } from "./BrandMark";
import type { Copy } from "./i18n";
import { Icon, type IconName } from "./icons";
import { IconButton, PrimaryButton, StateDot, Switch, useModalFocus } from "./launcher-ui";
import { taskCenterTitle } from "./task-center-copy";
import type { Language, Surface } from "./types";
import { updateCopyFor } from "./update-copy";

// Presentational shell chrome for App: title bar, sidebar pieces, dialogs and the
// compact-drawer focus trap. App keeps shell state, navigation and IPC.

export const COMPACT_SIDEBAR_QUERY = "(max-width: 860px)";

/** Compact-sidebar drawer: makes the workspace inert, traps focus and closes on Escape. */
export function useCompactSidebarDrawer(
  compactSidebar: boolean,
  sidebarOpen: boolean,
  sidebar: RefObject<HTMLElement | null>,
  sidebarToggle: RefObject<HTMLButtonElement | null>,
  setSidebarOpen: (open: boolean) => void,
) {
  useEffect(() => {
    if (!compactSidebar || !sidebarOpen || !sidebar.current) return;
    const drawer = sidebar.current;
    const workspace = drawer.parentElement?.querySelector<HTMLElement>(":scope > .workspace") ?? null;
    const workspaceWasInert = workspace?.inert ?? false;
    if (workspace) workspace.inert = true;
    const focusable = () => [...drawer.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
    const focusDrawer = () => {
      const active = drawer.querySelector<HTMLElement>('.sidebar-item[aria-current="page"]');
      (active ?? focusable()[0] ?? drawer).focus();
    };
    const frame = requestAnimationFrame(focusDrawer);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSidebarOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) {
        event.preventDefault();
        drawer.focus();
        return;
      }
      const first = controls[0]!;
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof Node && drawer.contains(event.target)) return;
      event.stopPropagation();
      focusDrawer();
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin, true);
      if (workspace) workspace.inert = workspaceWasInert;
      if (window.matchMedia(COMPACT_SIDEBAR_QUERY).matches) {
        requestAnimationFrame(() => sidebarToggle.current?.focus());
      }
    };
  }, [compactSidebar, sidebarOpen]);
}

export function TitleBar({
  copy,
  language,
  surface,
  devProfile,
  sidebarOpen,
  sidebarToggle,
  toggleSidebar,
}: {
  copy: Copy;
  language: Language;
  surface: Surface;
  devProfile: boolean;
  sidebarOpen: boolean;
  sidebarToggle: RefObject<HTMLButtonElement | null>;
  toggleSidebar: () => void;
}) {
  return (
    <header className="app-titlebar draggable">
      <div className="titlebar-left no-drag">
        <IconButton
          buttonRef={sidebarToggle}
          icon="sidebar"
          label={sidebarOpen ? copy.hideSidebar : copy.showSidebar}
          controls="app-sidebar"
          expanded={sidebarOpen}
          onClick={toggleSidebar}
        />
        {devProfile ? <span className="titlebar-dev-profile">{copy.devBadge}</span> : null}
      </div>
      <div className="titlebar-location"><span>NEKODEX</span><span aria-hidden="true">/</span><strong>{({ overview: copy.overview, accounts: copy.accountsNav, browser: copy.browser, tasks: taskCenterTitle(language), setup: copy.connectionsNav, mcp: copy.connectionsNav, activity: copy.activity, settings: copy.settings, updates: updateCopyFor(language).title })[surface]}</strong></div>
    </header>
  );
}

export function SidebarGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section className="sidebar-group">
      <h2>{label}</h2>
      <div>{children}</div>
    </section>
  );
}

export function SidebarItem({
  active,
  badge,
  icon,
  label,
  onClick,
  tone,
}: {
  active: boolean;
  badge?: ReactNode;
  icon: IconName;
  label: string;
  onClick: () => void;
  tone?: "update";
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`sidebar-item${active ? " is-active" : ""}${tone === "update" ? " is-update" : ""}`}
      onClick={onClick}
      type="button"
    >
      <Icon name={icon} />
      <span>{label}</span>
      {badge ? <i className="sidebar-item-badge">{badge}</i> : null}
    </button>
  );
}

export function ActionDot({ pulse = false, tone }: { pulse?: boolean; tone: "required" | "optional" | "error" }) {
  return <i aria-hidden="true" className={`action-dot is-${tone}${pulse ? " is-pulse" : ""}`} />;
}

export function ErrorToast({ copy, message, onDismiss }: { copy: Copy; message: string; onDismiss: () => void }) {
  return (
    <div
      className="error-toast"
      role="alert"
    >
      <StateDot state="error" />
      <span>
        <strong>{copy.error}</strong>
        <p>{message}</p>
      </span>
      <button onClick={onDismiss} type="button">{copy.dismiss}</button>
    </div>
  );
}

export function BiggerContextRecommendation({
  busy,
  checked,
  copy,
  onChange,
  onClose,
}: {
  busy: boolean;
  checked: boolean;
  copy: Copy;
  onChange: (checked: boolean) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useModalFocus(true, dialog, onClose, { closeAllowed: !busy });
  return createPortal(
    <div
      aria-busy={busy}
      aria-describedby="bigger-context-recommendation-body"
      aria-labelledby="bigger-context-recommendation-title"
      aria-modal="true"
      className="bigger-context-recommendation-backdrop"
      ref={dialog}
      role="dialog"
      tabIndex={-1}
    >
      <section
        className="bigger-context-recommendation"
      >
        <header className="bigger-context-recommendation-header">
          <small>{copy.biggerContext}</small>
          <h2 id="bigger-context-recommendation-title">{copy.biggerContextRecommendationTitle}</h2>
        </header>
        <p className="bigger-context-recommendation-body" id="bigger-context-recommendation-body">{copy.biggerContextRecommendationBody}</p>
        <div className="bigger-context-recommendation-toggle">
          <div>
            <strong>{copy.biggerContext}</strong>
            <p>{copy.biggerContextRecommendationToggleBody}</p>
          </div>
          <Switch label={copy.biggerContext} checked={checked} disabled={busy} onChange={onChange} />
        </div>
        {checked ? <p className="bigger-context-recommendation-restart">{copy.contextClientRefreshBody}</p> : null}
        <footer>
          <button className="button-secondary" data-modal-autofocus disabled={busy} onClick={onClose} type="button">{copy.close}</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export function LaunchLoading() {
  return (
    <main className="launch-loading" role="status" aria-busy="true">
      <BrandMark />
      <span />
      <span className="visually-hidden">Loading…</span>
    </main>
  );
}

export function FatalMessage({ message, onRetry, retryLabel }: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <main className="fatal-message">
      <BrandMark />
      <h1>NEKODEX</h1>
      <p role="alert">{message}</p>
      {onRetry ? <PrimaryButton onClick={onRetry}>{retryLabel}</PrimaryButton> : null}
    </main>
  );
}
