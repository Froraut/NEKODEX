import { modelConnectionReadiness, setupNextStep } from "./setup-progress";

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

export function deriveWorkspaceReadiness(input: WorkspaceReadinessInput): WorkspaceReadiness {
  const native = input.installed
    ? runtimeCapability(input.runtime?.nativeAvailability, input.runtime?.runtimeStatus)
    : "unavailable";
  const web = webCapability(input);
  const tools = toolsCapability(input);
  const result = (action: WorkspaceAction, reason: WorkspaceReason): WorkspaceReadiness => ({
    action, reason, native, web, tools,
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
  if (native === "unavailable") return result("open-setup", "runtime-unavailable");
  return result("open-browser", "workspace-ready");
}
