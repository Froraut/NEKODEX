import type { Copy } from "./i18n";

export function passkeyFailureText(code: string | null, copy: Copy): string {
  switch (code) {
    case "passkey-timeout":
    case "passkey-handoff-timeout":
      return copy.passkeyTimedOut;
    case "passkey-reveal-failed":
      return copy.passkeyRevealFailed;
    case "passkey-capture-failed":
    case "passkey-validation-failed":
    case "passkey-cleanup-failed":
    case "passkey-verification-failed":
    case "passkey-import-failed":
    default:
      return copy.passkeyFailed;
  }
}
