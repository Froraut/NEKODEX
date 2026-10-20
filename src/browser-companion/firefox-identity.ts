/** The reviewed Firefox artifact ID is stable; its moz-extension UUID is profile-specific. */
export const FIREFOX_COMPANION_ID = "browser-companion@nekodex.local";
const firefoxOrigin = /^moz-extension:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Called only with the explicit local-user pin, never a network Origin header. */
export function companionExtensionOrigin(extensionId: unknown, pinnedOrigin?: unknown): string {
  if (typeof extensionId !== "string") throw new Error("An exact companion extension ID is required");
  if (/^[a-p]{32}$/.test(extensionId)) {
    const expected = `chrome-extension://${extensionId}`;
    if (pinnedOrigin !== undefined && pinnedOrigin !== expected) throw new Error("Chrome extension origin does not match its exact extension ID");
    return expected;
  }
  if (extensionId !== FIREFOX_COMPANION_ID || typeof pinnedOrigin !== "string" || !firefoxOrigin.test(pinnedOrigin)) {
    throw new Error("Enter the exact Chrome extension ID, or the Firefox companion ID and its pinned moz-extension UUID origin");
  }
  return pinnedOrigin;
}
