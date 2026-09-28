import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Badge, Button, cx, Icon, Mark, Notice, SettingRow as KitSettingRow, StateDot, Switch as KitSwitch, Toast, type IconName } from "./design";
import type { Copy } from "./i18n";
import { IconButton, useModalFocus } from "./launcher-ui";
import { shellCopy, systemLanguage } from "./shell-copy";
import { taskCenterTitle } from "./task-center-copy";
import type { Language, Surface } from "./types";
import { updateCopyFor } from "./update-copy";
import "./surfaces/shell.css";

// Presentational shell chrome for App (design-system AppShell, Sidebar and TitleBar markup): title bar,
// sidebar pieces, dialogs and the compact-drawer focus trap. App keeps shell state, navigation and IPC.

export const COMPACT_SIDEBAR_QUERY = "(max-width: 860px)";

/** Compact-sidebar drawer: makes the rest of the shell inert, traps focus and closes on Escape. */
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
    // The titlebar and the workspace share the main column of the shell.
    const main = drawer.parentElement?.querySelector<HTMLElement>(":scope > .nk-shell__main") ?? null;
    const mainWasInert = main?.inert ?? false;
    if (main) main.inert = true;
    const focusable = () => [...drawer.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
    const focusDrawer = () => {
      const active = drawer.querySelector<HTMLElement>('.nk-nav-item[aria-current="page"]');
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
      if (main) main.inert = mainWasInert;
      if (window.matchMedia(COMPACT_SIDEBAR_QUERY).matches) {
        requestAnimationFrame(() => sidebarToggle.current?.focus());
      }
    };
  }, [compactSidebar, sidebarOpen]);
}

/** Where the macOS traffic lights sit; the real controls are drawn by the OS (hidden on Windows and Linux). */
export function WindowControlsReserve({ className }: { className: string }) {
  return <span aria-hidden="true" className={className} />;
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
  const surfaceLabel = ({ overview: copy.overview, accounts: copy.accountsNav, browser: copy.browser, tasks: taskCenterTitle(language), setup: copy.connectionsNav, mcp: copy.connectionsNav, activity: copy.activity, settings: copy.settings, updates: updateCopyFor(language).title })[surface];
  // Nested surfaces add one crumb: Connections / Models and Codex route · Local tools connector.
  const nested = surface === "setup" ? copy.modelsConnectionTab : surface === "mcp" ? copy.toolsConnectionTab : null;
  const trail = [copy.product, surfaceLabel, ...(nested ? [nested] : [])];
  return (
    <header className="nk-titlebar">
      {sidebarOpen ? null : (
        <div className="nk-titlebar__lead">
          <WindowControlsReserve className="nk-titlebar__controls" />
          <IconButton
            buttonRef={sidebarToggle}
            controls="app-sidebar"
            expanded={false}
            icon="sidebar"
            label={copy.showSidebar}
            onClick={toggleSidebar}
          />
        </div>
      )}
      <ol aria-label={shellCopy(language).location} className="nk-titlebar__trail">
        {trail.map((crumb, index) => (
          <li aria-current={index === trail.length - 1 && index > 0 ? "page" : undefined} key={index}>{crumb}</li>
        ))}
      </ol>
      {/* At most one quiet status: the DEV tag replaces the Local workspace pill. The pill gives way before the
          location does (it ellipsizes down to its icon, surfaces/shell.css). */}
      {devProfile ? <span className="nk-dev-tag">{copy.devBadge}</span> : (
        <div className="nk-titlebar__end" title={copy.localWorkspace}>
          <Badge className="nk-titlebar__status" icon="globe" shape="pill" tone="outline">
            <span className="nk-titlebar__status-label">{copy.localWorkspace}</span>
          </Badge>
        </div>
      )}
    </header>
  );
}

/** A group of nav items. The label is not a heading (the page's h1 comes first in the outline); it names the group. */
export function SidebarGroup({ children, label }: { children: ReactNode; label: string }) {
  const labelId = useId();
  return (
    <div aria-labelledby={labelId} className="nk-nav-group" role="group">
      <span className="nk-nav-group__label" id={labelId}>{label}</span>
      <div>{children}</div>
    </div>
  );
}

export function SidebarItem({
  active,
  badge,
  icon,
  label,
  onClick,
  status,
  tone,
}: {
  active: boolean;
  /** An attention dot (ActionDot) or a count; give it words in `status`. */
  badge?: ReactNode;
  icon: IconName;
  label: string;
  onClick: () => void;
  /** What the badge says, in words: the item's description (screen readers) and tooltip (pointer). */
  status?: string;
  tone?: "update";
}) {
  const statusId = useId();
  return (
    <>
      <button
        aria-current={active ? "page" : undefined}
        aria-describedby={status ? statusId : undefined}
        // sidebar-item: stable hook for the measure-* scripts; the look comes from nk-nav-item.
        className={cx("nk-nav-item", "sidebar-item", tone === "update" && "is-update")}
        onClick={onClick}
        title={status ? `${label}: ${status}` : undefined}
        type="button"
      >
        <Icon className="nk-icon" name={icon} />
        <span>{label}</span>
        {!badge ? null : typeof badge === "string" || typeof badge === "number"
          ? <i aria-hidden={status ? "true" : undefined} className="nk-nav-item__badge">{badge}</i> : badge}
      </button>
      {/* Outside the button, so the status describes the item without changing its name. */}
      {status ? <span className="nk-visually-hidden" id={statusId}>{status}</span> : null}
    </>
  );
}

/** Attention dot on a nav item: required (amber), optional (yellow) or error (rose). */
export function ActionDot({ pulse = false, tone }: { pulse?: boolean; tone: "required" | "optional" | "error" }) {
  return (
    <StateDot
      className={cx("nk-action-dot", tone === "required" && !pulse && "is-static", tone !== "required" && pulse && "is-pulse")}
      state={tone === "required" ? "busy" : tone}
    />
  );
}

export function ErrorToast({ copy, message, onDismiss }: { copy: Copy; message: string; onDismiss: () => void }) {
  return (
    <Toast dismissLabel={copy.dismiss} fixed onDismiss={onDismiss} title={copy.error} tone="error">
      {message}
    </Toast>
  );
}

export function BiggerContextRecommendation({
  busy,
  checked,
  copy,
  error,
  onChange,
  onClose,
}: {
  busy: boolean;
  checked: boolean;
  copy: Copy;
  /** A failed save, shown in the dialog (the page's toast would sit behind it). */
  error?: string | null;
  onChange: (checked: boolean) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useModalFocus(true, dialog, onClose, { closeAllowed: !busy });
  // The design system's Dialog markup, kept here so the dialog keeps its ids, aria-describedby and aria-busy.
  // Like the kit Dialog, Escape and a press on the backdrop close it (not while the change is saving).
  return createPortal(
    <div className="nk-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section
        aria-busy={busy}
        aria-describedby="bigger-context-recommendation-body"
        aria-labelledby="bigger-context-recommendation-title"
        aria-modal="true"
        className="nk-dialog"
        ref={dialog}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <small>{copy.biggerContext}</small>
          <h2 id="bigger-context-recommendation-title">{copy.biggerContextRecommendationTitle}</h2>
        </header>
        <div className="nk-dialog__body">
          <p id="bigger-context-recommendation-body">{copy.biggerContextRecommendationBody}</p>
          <KitSettingRow
            className="nk-dialog__setting"
            control={<KitSwitch busy={busy} checked={checked} label={copy.biggerContext} onChange={onChange} />}
            description={copy.biggerContextRecommendationToggleBody}
            title={copy.biggerContext}
          />
          {error ? <Notice className="nk-dialog__error" title={copy.error} tone="error">{error}</Notice> : null}
          {checked ? <p className="nk-dialog__note">{copy.contextClientRefreshBody}</p> : null}
        </div>
        <footer>
          <Button data-modal-autofocus disabled={busy} onClick={onClose}>{copy.close}</Button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

/** Before the first snapshot. `language`: the saved language when known, else the system language. */
export function LaunchLoading({ language = systemLanguage() }: { language?: Language }) {
  return (
    <main aria-busy="true" className="nk-launch">
      <span aria-hidden="true" className="nk-launch__drag" />
      <Mark size={48} />
      <span aria-hidden="true" className="nk-launch__line" />
      <span className="nk-visually-hidden" role="status">{shellCopy(language).loading}</span>
    </main>
  );
}

/** The launcher could not start: what failed (the heading), the cause, and a retry. */
export function FatalMessage({ language = systemLanguage(), message, onRetry, retryLabel }: {
  language?: Language;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <main className="nk-launch">
      <span aria-hidden="true" className="nk-launch__drag" />
      <Mark size={48} />
      <h1>{shellCopy(language).startupFailed}</h1>
      <p role="alert">{message}</p>
      {onRetry ? <Button onClick={onRetry} variant="primary">{retryLabel}</Button> : null}
    </main>
  );
}

