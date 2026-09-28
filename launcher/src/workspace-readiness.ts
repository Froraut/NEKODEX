import { modelConnectionReadiness, setupNextStep } from "./setup-progress";
import { runtimeCapabilities } from "./launcher-readiness";
import type { BrowserState, LauncherSnapshot } from "./types";

export type WorkspaceAction =
  | "retry-session"
  | "open-accounts"
  | "open-setup"
  | "open-tools"
  | "repair-web"
  | "open-browser"
  | "wait";

export type WorkspaceReason =
  | "session-checking"
  | "session-unavailable"
  | "session-signed-out"
  | "browser-check-required"
  | "core-not-installed"
  | "catalog-unavailable"
  | "catalog-waiting"
  | "picker-confirmation-required"
  | "tools-not-installed"
  | "tools-not-verified"
  | "web-repair-active"
  | "web-repair-available"
  | "web-checking"
  | "web-degraded"
  | "web-unavailable"
  | "runtime-checking"
  | "runtime-unavailable"
  | "workspace-ready";

export type WorkspaceCapabilityStatus = "ready" | "degraded" | "unavailable" | "checking" | "unknown";
export type WorkspaceAuthenticationStatus = "unknown" | "verified" | "signed-out" | "unavailable";

export interface WorkspaceRuntimeReadiness {
  runtimeStatus?: string | null;
  nativeAvailability?: "unknown" | "ready" | "degraded" | "unavailable" | null;
  webAvailability?: "unknown" | "ready" | "degraded" | "unavailable" | null;
  brokerReady?: boolean | null;
  tunnelStatus?: string | null;
  transitionActive?: boolean;
  tunnelRepair?: { eligible: boolean; active: boolean; reason?: string | null } | null;
}

export interface WorkspaceReadinessInput {
  manual: boolean;
  development: boolean;
  authenticationStatus: WorkspaceAuthenticationStatus;
  smokePassed: boolean;
  installed: boolean;
  catalogVerified: boolean;
  catalogUnavailable?: boolean;
  pickerConfirmed: boolean;
  toolsInstalled: boolean;
  toolsVerified: boolean;
  runtime?: WorkspaceRuntimeReadiness | null;
}

export interface WorkspaceReadiness {
  action: WorkspaceAction;
  reason: WorkspaceReason;
  native: WorkspaceCapabilityStatus;
  web: WorkspaceCapabilityStatus;
  tools: WorkspaceCapabilityStatus;
  /** One derived status per connection; every surface shows these (word, dot and action together). */
  connections: WorkspaceConnections;
}

/**
 * The status of one connection. The key picks the status word, `dot` the StateDot and `action` the row's action
 * word, so the three can never disagree ("Verified" only ever appears with the ready dot).
 */
export type ConnectionStatusKey =
  | "verified"                 // checked and ready
  | "installed"                // Manual mode: the model side exists; NEKODEX does not check the catalog
  | "manual"                   // Manual mode session: the user signs in and sends turns themselves
  | "checking"                 // a check or a start is in progress
  | "waiting-for-codex"        // installed; Codex has not requested the catalog yet
  | "confirm-in-codex"         // the user still has to confirm the models in the Codex picker
  | "needs-sign-in"
  | "verification-unavailable" // the session could not be checked (not proof of sign-out)
  | "catalog-unavailable"
  | "needs-setup"              // a required connection is not set up
  | "not-connected"            // an optional connection is not set up
  | "needs-attention"          // set up, but degraded
  | "unavailable";             // set up, but not available right now

/** StateDot state: green ready, amber busy/attention, grey idle, rose error. */
export type ConnectionDot = "ready" | "busy" | "idle" | "error";
/** The short action cue of a connection row ("Manage ›"). */
export type ConnectionAction = "manage" | "connect" | "sign-in" | "retry" | "open" | "open-routing-checks";

export interface ConnectionStatus {
  key: ConnectionStatusKey;
  dot: ConnectionDot;
  action: ConnectionAction;
  /** Nothing is needed here: the connection is verified (or, in Manual mode, not NEKODEX's to check). */
  ready: boolean;
}

export interface WorkspaceConnections {
  session: ConnectionStatus;
  models: ConnectionStatus;
  tools: ConnectionStatus;
}

const transitioning = new Set(["starting", "recovering", "stopping"]);

function runtimeCapability(
  availability: WorkspaceRuntimeReadiness["nativeAvailability"],
  runtimeStatus: string | null | undefined,
): WorkspaceCapabilityStatus {
  if (transitioning.has(runtimeStatus ?? "")) return "checking";
  if (availability === "ready" || availability === "degraded" || availability === "unavailable") return availability;
  return "unknown";
}

function webCapability(input: WorkspaceReadinessInput): WorkspaceCapabilityStatus {
  if (input.authenticationStatus === "signed-out") return "unavailable";
  if (input.authenticationStatus === "unavailable") return "unknown";
  if (input.authenticationStatus === "unknown") return "checking";
  return runtimeCapability(input.runtime?.webAvailability, input.runtime?.runtimeStatus);
}

function toolsCapability(input: WorkspaceReadinessInput): WorkspaceCapabilityStatus {
  if (!input.toolsInstalled) return "unavailable";
  if (input.runtime?.tunnelRepair?.active || transitioning.has(input.runtime?.tunnelStatus ?? "")) return "checking";
  if (input.runtime?.webAvailability === "unavailable") return "unavailable";
  if (input.runtime?.webAvailability === "degraded" || input.runtime?.brokerReady === false) return "degraded";
  if (input.runtime?.webAvailability === "unknown") return "checking";
  if (["degraded", "failed"].includes(input.runtime?.tunnelStatus ?? "")) return "degraded";
  if (input.runtime?.webAvailability === "ready" && input.runtime?.brokerReady === true
    && input.runtime?.tunnelStatus === "ready" && input.toolsVerified) return "ready";
  if (input.toolsVerified) return input.runtime?.tunnelStatus ? "degraded" : "unknown";
  return "unknown";
}

const status = (key: ConnectionStatusKey, dot: ConnectionDot, action: ConnectionAction, ready = false): ConnectionStatus =>
  ({ key, dot, action, ready });

function sessionConnection(input: WorkspaceReadinessInput): ConnectionStatus {
  if (input.manual) return status("manual", "idle", "manage", true);
  if (input.authenticationStatus === "verified") return status("verified", "ready", "manage", true);
  if (input.authenticationStatus === "unknown") return status("checking", "busy", "open");
  // Not proof of sign-out: the next step is to check the session again, not to sign in.
  if (input.authenticationStatus === "unavailable") return status("verification-unavailable", "busy", "retry");
  return status("needs-sign-in", "busy", "sign-in");
}

function modelsConnection(input: WorkspaceReadinessInput, native: WorkspaceCapabilityStatus,
  web: WorkspaceCapabilityStatus): ConnectionStatus {
  if (!input.manual && input.catalogUnavailable === true) return status("catalog-unavailable", "error", "open-routing-checks");
  const models = modelConnectionReadiness(input);
  if (models === "not-installed") return status("needs-setup", "idle", "connect");
  if (models === "catalog-pending") return status("waiting-for-codex", "busy", "open");
  if (models === "picker-pending") return status("confirm-in-codex", "busy", "open");
  // The setup facts hold; whether the models can run right now is the runtime's report: the native route (the DEV
  // profile has none, so its "unavailable" is expected) and, in Automatic mode, the ChatGPT Web route.
  if (native === "checking") return status("checking", "busy", "open");
  if (native === "unavailable" && !input.development) return status("unavailable", "error", "open");
  if (native === "degraded") return status("needs-attention", "busy", "open");
  if (!input.manual && input.authenticationStatus === "verified") {
    if (input.runtime?.tunnelRepair?.active || input.runtime?.webAvailability === "unknown" || web === "checking") {
      return status("checking", "busy", "open");
    }
    // Web models cannot run (native ones may): the same problem the headline reports as the Web transport.
    if (web === "degraded" || web === "unavailable") return status("needs-attention", "busy", "open");
  }
  return input.manual ? status("installed", "ready", "manage", true) : status("verified", "ready", "manage", true);
}

function toolsConnection(input: WorkspaceReadinessInput, tools: WorkspaceCapabilityStatus): ConnectionStatus {
  if (tools === "ready") return status("verified", "ready", "manage", true);
  if (tools === "checking") return status("checking", "busy", "open");
  if (tools === "degraded") return status("needs-attention", "busy", "open");
  if (tools === "unavailable" && input.toolsInstalled) return status("unavailable", "error", "open");
  // Not set up (or set up without a verified connector): required in Manual mode, optional otherwise.
  return input.manual ? status("needs-setup", "idle", "connect") : status("not-connected", "idle", "connect");
}

export function deriveWorkspaceReadiness(input: WorkspaceReadinessInput): WorkspaceReadiness {
  const native = input.installed
    ? runtimeCapability(input.runtime?.nativeAvailability, input.runtime?.runtimeStatus)
    : "unavailable";
  const web = webCapability(input);
  const tools = toolsCapability(input);
  const connections: WorkspaceConnections = {
    session: sessionConnection(input),
    models: modelsConnection(input, native, web),
    tools: toolsConnection(input, tools),
  };
  const result = (action: WorkspaceAction, reason: WorkspaceReason): WorkspaceReadiness => ({
    action, reason, native, web, tools, connections,
  });

  if (!input.manual) {
    if (input.authenticationStatus === "unknown") return result("wait", "session-checking");
    if (input.authenticationStatus === "unavailable") return result("retry-session", "session-unavailable");
    if (input.authenticationStatus === "signed-out") return result("open-accounts", "session-signed-out");
    if (input.runtime?.tunnelRepair?.active) return result("wait", "web-repair-active");
    if (input.runtime?.transitionActive === true || transitioning.has(input.runtime?.runtimeStatus ?? "")) {
      return result("wait", "runtime-checking");
    }
    if (input.catalogUnavailable === true) return result("open-setup", "catalog-unavailable");
  }

  const next = setupNextStep({
    manual: input.manual,
    signedIn: input.authenticationStatus === "verified",
    smokePassed: input.smokePassed,
    installed: input.installed,
    catalogVerified: input.catalogVerified,
    pickerConfirmed: input.pickerConfirmed,
    toolsInstalled: input.toolsInstalled,
    toolsVerified: input.toolsVerified,
    development: input.development,
  });
  if (next === "test") return result("open-setup", "browser-check-required");
  if (next === "install") return result("open-setup", "core-not-installed");
  if (next === "catalog") return result("open-setup", "catalog-waiting");
  if (next === "confirm") return result("open-setup", "picker-confirmation-required");

  if (input.runtime?.tunnelRepair?.active) return result("wait", "web-repair-active");
  if (input.runtime?.transitionActive === true || transitioning.has(input.runtime?.runtimeStatus ?? "")) {
    return result("wait", "runtime-checking");
  }
  if (input.runtime?.tunnelRepair?.eligible === true) return result("repair-web", "web-repair-available");

  if (!input.manual && input.runtime) {
    if (input.runtime.webAvailability === "unknown" || web === "checking") {
      return result("wait", "web-checking");
    }
    if (input.runtime.webAvailability === "degraded") {
      return result(input.toolsInstalled ? "open-tools" : "open-setup", "web-degraded");
    }
    if (input.runtime.webAvailability === "unavailable") {
      return result(input.toolsInstalled ? "open-tools" : "open-setup", "web-unavailable");
    }
  }

  if (next === "tools") {
    return result("open-tools", input.toolsInstalled ? "tools-not-verified" : "tools-not-installed");
  }

  const models = modelConnectionReadiness({
    manual: input.manual,
    installed: input.installed,
    catalogVerified: input.catalogVerified,
    pickerConfirmed: input.pickerConfirmed,
    development: input.development,
  });
  if (models !== "available") return result("open-setup", "core-not-installed");
  if (native === "checking") return result("wait", "runtime-checking");
  // The DEV profile has no native route; its runtime always reports native as unavailable.
  if (native === "unavailable" && !input.development) return result("open-setup", "runtime-unavailable");
  return result("open-browser", "workspace-ready");
}

/**
 * The Models and Codex route tab covers the ChatGPT session and the model route (its setup rows 1-3): it reports the
 * session while the session needs something, then the model route.
 */
export function modelsTabConnection(connections: WorkspaceConnections): ConnectionStatus {
  return connections.session.ready ? connections.models : connections.session;
}

/**
 * The readiness input every surface derives from the same launcher facts, so Overview, Connections and the shell
 * agree. `toolsVerified` is the current connector proof (launcher-readiness `currentToolProof`).
 */
export function workspaceReadinessInput({ snapshot, browser, catalogFailure, toolsVerified }: {
  snapshot: LauncherSnapshot;
  browser: BrowserState | null;
  catalogFailure: string | null;
  toolsVerified: boolean;
}): WorkspaceReadinessInput {
  const manual = snapshot.state.browserInteractionMode === "manual";
  const authenticationStatus = browser?.authenticationStatus
    ?? (browser?.authenticated ? "verified" : browser?.status === "signed-out" ? "signed-out" : "unknown");
  return {
    manual,
    development: snapshot.profile === "development",
    authenticationStatus: manual ? "verified" : authenticationStatus,
    smokePassed: snapshot.smokePassed,
    installed: snapshot.state.coreSetupComplete === true,
    catalogUnavailable: Boolean(catalogFailure),
    catalogVerified: snapshot.state.codexCatalogVerified === true,
    pickerConfirmed: snapshot.state.codexPickerConfirmed === true,
    toolsInstalled: snapshot.state.mcpRuntimeInstalled === true && snapshot.mcpCredentialsConfigured,
    toolsVerified,
    runtime: { ...(runtimeCapabilities(snapshot) ?? {}), transitionActive: Boolean(snapshot.lifecycle?.transition) },
  };
}
