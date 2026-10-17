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
  const turnBusy = browser?.status === "running";
  const unrelatedOperation = operation?.status === "running" && operation.name !== "passkey-login";
  const existingChromeAvailable = interactionMode === "automatic"
    && ["darwin", "win32", "linux"].includes(platform) && browser?.authenticated !== true
    // macOS uses the selected account's profile-first transaction, including secondary accounts.
    // Other platforms still use the legacy primary-account importer.
    && (platform === "darwin" || !browser?.accountId || browser.accountId === "default");
  const existingChromeWaiting = existingChromeAvailable && (browser?.loginKind === "existing-chrome"
    || browser?.existingChromeLogin?.active === true
    || (operation?.name === "existing-chrome-login" && operation.status === "running"));
  const otherExistingChromeOperation = operation?.status === "running" && operation.name !== "existing-chrome-login";

  return {
    // Login can still be waiting while the page reports signed-out or ready.
    // The main process owns this lock; page loading is not a reliable proxy.
    // Explicit navigation cancels and joins a read-only check in the host. Its "testing"
    // status alone must not disable the very controls needed to recover a stuck page.
    navigationLocked: browser?.navigationLocked === true || browser?.loginInProgress === true || turnBusy || passkeyWaiting || existingChromeWaiting,
    passkeyAvailable,
    passkeyWaiting,
    passkeyCanImport: passkeyWaiting && browser?.passkeyLogin?.canImport === true,
    // An embedded login can be replaced by the dedicated Chrome passkey flow.
    passkeyBlocked: !passkeyAvailable || turnBusy || unrelatedOperation || existingChromeWaiting,
    existingChromeAvailable,
    existingChromeWaiting,
    // An embedded sign-in holds the account (the pool refuses a Chrome import meanwhile; only passkey has a hand-off).
    existingChromeBlocked: !existingChromeAvailable || turnBusy
      || (platform === "darwin" ? unrelatedOperation : otherExistingChromeOperation) || passkeyWaiting
      || (platform !== "darwin" && browser?.loginInProgress === true && !existingChromeWaiting),
  };
}
