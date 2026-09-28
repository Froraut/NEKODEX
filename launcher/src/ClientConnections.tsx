import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ClientConnectionAction, ClientConnectionsSnapshot, Language } from "./types";
import { Badge, Button, Checkbox, Disclosure, Icon, Notice, Select } from "./design";
import type { Status, Tone } from "./design";
import { clientConnectionsCopy } from "./client-connections-copy";
import "./surfaces/connections.css";

/** Where a confirmation or an error belongs: the whole list (reading the status) or the row that caused it. */
type FeedbackTarget = "list" | "api" | "claude" | "provider";
interface Feedback { target: FeedbackTarget; tone: "success" | "error"; text: string }

const actionTarget = (action: ClientConnectionAction): FeedbackTarget =>
  action.startsWith("api-") ? "api" : action.startsWith("claude-") ? "claude" : "provider";

export function ClientConnections({ language, busy, configured, devProfile }: {
  language: Language; busy: boolean; configured: boolean; devProfile: boolean;
}) {
  const copy = clientConnectionsCopy(language);
  const [status, setStatus] = useState<ClientConnectionsSnapshot | null>(null);
  // One message at a time, shown next to what it is about; a new read or change replaces it.
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<"mixed" | "web-only" | null>(null);
  const inFlight = useRef(false), mounted = useRef(true);
  // The row whose action is running: when the change removes the button that had focus (Disconnect → Connect),
  // focus moves to that row's first action instead of falling to <body>.
  const focusRow = useRef<Element | null>(null);
  const modeId = useId();
  const errorText = (cause: unknown, fallback: string) => cause instanceof Error && cause.message ? cause.message : fallback;
  const load = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setFeedback(null);
    try {
      const next = await window.codexWebLauncher!.getClientConnections();
      if (mounted.current) setStatus(next);
    } catch (cause) {
      if (mounted.current) setFeedback({ target: "list", tone: "error", text: errorText(cause, copy.loadFailed) });
    } finally { inFlight.current = false; if (mounted.current) setPending(false); }
  };
  useEffect(() => {
    mounted.current = true;
    if (configured && !devProfile) void load();
    return () => { mounted.current = false; };
  }, [configured, devProfile]);
  const act = async (action: ClientConnectionAction) => {
    if (busy || inFlight.current || devProfile) return;
    const target = actionTarget(action);
    focusRow.current = document.activeElement?.closest(".nk-clients__row") ?? null;
    inFlight.current = true; setPending(true); setFeedback(null);
    try {
      const next = await window.codexWebLauncher!.changeClientConnection(action);
      if (!mounted.current) return;
      setStatus(next);
      const done = action.startsWith("provider-picker-") ? copy.pickerRestart
        : action.startsWith("provider-") ? copy.codexRestart
          : action === "claude-connect" ? copy.claudeRestart : null;
      if (action.startsWith("provider-") && !action.startsWith("provider-picker-")) setMode(null);
      if (done) setFeedback({ target, tone: "success", text: done });
    } catch (cause) {
      if (mounted.current) setFeedback({ target, tone: "error", text: errorText(cause, copy.changeFailed) });
    } finally { inFlight.current = false; if (mounted.current) setPending(false); }
  };
  const copyKey = async () => {
    if (busy || inFlight.current || devProfile) return;
    inFlight.current = true; setPending(true); setFeedback(null);
    try {
      await window.codexWebLauncher!.copyClientApiKey();
      if (mounted.current) setFeedback({ target: "api", tone: "success", text: copy.copied });
    } catch (cause) {
      if (mounted.current) setFeedback({ target: "api", tone: "error", text: errorText(cause, copy.changeFailed) });
    } finally { inFlight.current = false; if (mounted.current) setPending(false); }
  };
  useEffect(() => {
    const row = focusRow.current;
    if (pending || !row) return;
    focusRow.current = null;
    if (!row.isConnected || (document.activeElement && document.activeElement !== document.body)) return;
    row.querySelector<HTMLElement>(".nk-clients__actions :is(button, select):not(:disabled)")?.focus({ preventScroll: true });
  }, [pending, status]);
  const feedbackFor = (target: FeedbackTarget) => feedback?.target === target
    ? <Notice tone={feedback.tone}>{feedback.text}</Notice> : null;
  const locked = busy || pending || devProfile;
  const providerShown = Boolean(status?.provider.installed && status.provider.active);
  // Claude Code settings can exist while the connection still needs a refresh (the row says why).
  const claudeState: { status: string; dot: Status; tone?: Tone } | null = status
    ? status.claude.installed && status.claude.ready ? { status: copy.configured, dot: "ready", tone: "success" }
      : status.claude.installed ? { status: copy.needsAttention, dot: "busy", tone: "warning" }
        : { status: copy.missing, dot: "idle" }
    : null;
  return <Disclosure className="nk-clients" hint={`${copy.claude}, ${copy.api}`} title={copy.title}>
    <div className="nk-connections__stack nk-connections__disclosure-content">
    <div className="nk-clients__intro">
      <p>{copy.body}</p>
      {configured && !devProfile ? <Button busy={pending} disabled={locked} icon="reload" onClick={() => void load()} size="sm" variant="ghost">
        {copy.refresh}
      </Button> : null}
    </div>
    {!configured || devProfile ? <Notice>{devProfile ? copy.dev : copy.setup}</Notice> : <>
      {pending && !status ? <p className="nk-connections__status" role="status">{copy.loading}</p> : null}
      {feedbackFor("list")}
      {status && claudeState ? <>
        <ClientRow
          actions={<>
            <Button disabled={locked} onClick={() => void act(status.api.enabled ? "api-disable" : "api-enable")} size="sm">
              {status.api.enabled ? copy.disable : copy.enable}
            </Button>
            {status.api.enabled ? <Button disabled={locked} onClick={() => void copyKey()} size="sm">{copy.copy}</Button> : null}
          </>}
          body={copy.apiBody}
          dot={status.api.enabled ? "ready" : "idle"}
          label={copy.api}
          status={status.api.enabled ? copy.enabled : copy.disabled}
          tone={status.api.enabled ? "success" : undefined}
        >
          {status.api.enabled ? <p><code className="nk-clients__code">{status.api.baseUrl}</code></p> : null}
          {feedbackFor("api")}
          {/* Opening the disclosure is the first click; the danger button inside confirms the replacement. */}
          {status.api.enabled ? <details className="nk-connections__nested">
            <summary><Icon className="nk-icon" focusable="false" name="chevron" size={14} />{copy.rotate}</summary>
            <p>{copy.rotateBody}</p>
            <Button disabled={locked} onClick={() => void act("api-rotate")} size="sm" variant="danger">{copy.rotate}</Button>
          </details> : null}
        </ClientRow>
        <ClientRow
          actions={<>
            <Button disabled={locked} onClick={() => void act("claude-connect")} size="sm">{status.claude.installed ? copy.reconnect : copy.connect}</Button>
            {status.claude.installed ? <Button disabled={locked} onClick={() => void act("claude-disconnect")} size="sm" variant="ghost">{copy.disconnect}</Button> : null}
          </>}
          body={copy.claudeBody}
          dot={claudeState.dot}
          label={copy.claude}
          status={claudeState.status}
          tone={claudeState.tone}
        >
          {status.claude.issue ? <p className="nk-clients__issue" role="status">{status.claude.issue}</p> : null}
          {feedbackFor("claude")}
        </ClientRow>
        {status.provider.issue && !providerShown ? <Notice tone="error">{status.provider.issue}</Notice> : null}
        {providerShown ? <section aria-label={copy.provider} className="nk-clients__row">
          <div className="nk-clients__copy">
            <label className="nk-clients__label" htmlFor={modeId}>{copy.provider}</label>
            <p>{copy.providerBody}</p>
            {status.provider.issue ? <p className="nk-clients__issue" role="alert">{status.provider.issue}</p> : null}
          </div>
          <div className="nk-clients__actions">
            <Select disabled={locked} id={modeId} onChange={value => setMode(value as "mixed" | "web-only")}
              options={[{ value: "mixed", label: copy.mixed }, { value: "web-only", label: copy.web }]}
              value={mode ?? status.provider.mode} />
            <Button disabled={locked || !mode || mode === status.provider.mode} size="sm"
              onClick={() => void act(mode === "web-only" ? "provider-web-only" : "provider-mixed")}>{copy.apply}</Button>
          </div>
          {status.provider.mode === "mixed" && status.provider.picker ? <div className="nk-clients__extra">
            <div className="nk-clients__picker">
              <Checkbox checked={status.provider.picker === "on"} disabled={locked} label={copy.picker}
                onChange={checked => void act(checked ? "provider-picker-on" : "provider-picker-off")} />
              <p>{copy.pickerBody}</p>
            </div>
          </div> : null}
          {feedback?.target === "provider" ? <div className="nk-clients__extra">{feedbackFor("provider")}</div> : null}
        </section> : null}
        {/* A provider change that removed the provider row still reports its outcome. */}
        {!providerShown ? feedbackFor("provider") : null}
      </> : null}
    </>}
    </div>
  </Disclosure>;
}

/**
 * One client: name with its status badge and explanation, its actions right-aligned; details (the base URL, key
 * replacement, the outcome of the last change) follow under both, so a stacked row keeps its actions next to its name.
 */
function ClientRow({ actions, body, children, dot, label, status, tone }: {
  actions: ReactNode; body: string; children?: ReactNode; dot: Status; label: string; status: string; tone?: Tone;
}) {
  const details = (Array.isArray(children) ? children : [children]).some(Boolean);
  return <section aria-label={label} className="nk-clients__row">
    <div className="nk-clients__copy">
      <strong className="nk-clients__label">{label}<Badge dot={dot} tone={tone}>{status}</Badge></strong>
      <p>{body}</p>
    </div>
    <div className="nk-clients__actions">{actions}</div>
    {details ? <div className="nk-clients__extra">{children}</div> : null}
  </section>;
}
