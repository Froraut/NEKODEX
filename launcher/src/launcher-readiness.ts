import { accountToolsStep } from './account-tools-onboarding';
import type { BrowserState, LauncherSnapshot, OperationState, RuntimeCapabilities as RuntimeCapabilitiesProjection } from "./types";

export function connectorProofMismatch(snapshot: LauncherSnapshot): boolean {
  const verifiedName = snapshot.state.setupConnectorName;
  return typeof verifiedName === "string" && verifiedName !== snapshot.connectorName;
}

export function runtimeCapabilities(snapshot: LauncherSnapshot): RuntimeCapabilitiesProjection | null {
  return snapshot.runtimeCapabilities ?? snapshot.lifecycle ?? null;
}

function localToolsRuntimeReady(snapshot: LauncherSnapshot): boolean {
  return runtimeCapabilities(snapshot)?.tunnelStatus === "ready";
}

export function currentToolProof(snapshot: LauncherSnapshot, operation: OperationState | null,
  browser: BrowserState | null = snapshot.browser): boolean {
  if (!localToolsRuntimeReady(snapshot) || (snapshot.profile === "production"
      && snapshot.state.browserInteractionMode === "automatic"
      && operation?.name === "runtime-start" && operation.status === "failed")) return false;
  const scoped = browser?.accountTools;
  if (scoped) {
    if (scoped.accountId !== browser.accountId || scoped.interactionMode !== snapshot.state.browserInteractionMode) return false;
    if (scoped.interactionMode === 'automatic') {
      return accountToolsStep({ authenticated: browser.authenticated, authenticationStatus: browser.authenticationStatus,
        checked: scoped.checked, connectorReady: scoped.connectorReady }, scoped.tunnelReady) === 'verified';
    }
  } else if (snapshot.browser?.accountTools) {
    // The live browser changed before its scoped observation arrived; never borrow the old global proof.
    return false;
  }
  // Manual mode retains its explicit local-runtime check; connector selection is manual for each turn.
  // Older snapshots without account-scoped evidence keep their existing setup contract.
  return snapshot.state.mcpSetupComplete === true && !connectorProofMismatch(snapshot);
}
