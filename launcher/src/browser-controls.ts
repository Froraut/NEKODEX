import type { BrowserInteractionMode, BrowserState, OperationState } from "./types";

export function browserControls(
  browser: BrowserState | null,
  operation: OperationState | null,
  platform: string,
  interactionMode: BrowserInteractionMode,
) {
  const passkeyAvailable = interactionMode === "automatic"
    && platform === "darwin"
    && browser?.authenticated !== true;
  const passkeyWaiting = passkeyAvailable && (browser?.loginKind === "passkey"
    || browser?.passkeyLogin?.active === true
    || (operation?.name === "passkey-login" && operation.status === "running"));
  const turnBusy = browser?.status === "running" || browser?.status === "testing";
  const unrelatedOperation = operation?.status === "running" && operation.name !== "passkey-login";
  // Connector verification owns the browser session even when no browser turn is active.
  // Keep this in the shared lock so toolbar navigation and its defensive handler agree.
  const mcpVerificationRunning = operation?.status === "running" && operation.name === "mcp-verification";
  const existingChromeAvailable = interactionMode === "automatic"
    && ["darwin", "win32", "linux"].includes(platform) && browser?.authenticated !== true
    && (!browser?.accountId || browser.accountId === "default");
  const existingChromeWaiting = existingChromeAvailable && (browser?.loginKind === "existing-chrome"
    || browser?.existingChromeLogin?.active === true
    || (operation?.name === "existing-chrome-login" && operation.status === "running"));
  const otherExistingChromeOperation = operation?.status === "running" && operation.name !== "existing-chrome-login";

  return {
    // Login can still be waiting while the page reports signed-out or ready.
    // The main process owns this lock; page loading is not a reliable proxy.
    navigationLocked: browser?.navigationLocked === true || browser?.loginInProgress === true || turnBusy || passkeyWaiting || existingChromeWaiting || mcpVerificationRunning,
    passkeyAvailable,
    passkeyWaiting,
    passkeyCanImport: passkeyWaiting && browser?.passkeyLogin?.canImport === true,
    // An embedded login can be replaced by the dedicated Chrome passkey flow.
    passkeyBlocked: !passkeyAvailable || turnBusy || unrelatedOperation || existingChromeWaiting,
    existingChromeAvailable,
    existingChromeWaiting,
    existingChromeBlocked: !existingChromeAvailable || turnBusy || otherExistingChromeOperation || passkeyWaiting,
  };
}
