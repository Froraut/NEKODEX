import type { LauncherSnapshot, OperationState, RuntimeCapabilities as RuntimeCapabilitiesProjection } from "./types";

export function connectorProofMismatch(snapshot: LauncherSnapshot): boolean {
  const verifiedName = snapshot.state.setupConnectorName;
  return typeof verifiedName === "string" && verifiedName !== snapshot.connectorName;
}

export function runtimeCapabilities(snapshot: LauncherSnapshot): RuntimeCapabilitiesProjection | null {
  return snapshot.runtimeCapabilities ?? snapshot.lifecycle ?? null;
}

export function localToolsRuntimeReady(snapshot: LauncherSnapshot): boolean {
  return runtimeCapabilities(snapshot)?.tunnelStatus === "ready";
}

export function currentToolProof(snapshot: LauncherSnapshot, operation: OperationState | null): boolean {
  return snapshot.state.mcpSetupComplete === true
    && !connectorProofMismatch(snapshot)
    && localToolsRuntimeReady(snapshot)
    && !(snapshot.profile === "production"
      && snapshot.state.browserInteractionMode === "automatic"
      && operation?.name === "runtime-start" && operation.status === "failed");
}
