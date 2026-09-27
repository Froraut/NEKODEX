import type { Copy } from "./i18n";
import type { Language } from "./types";
import { profileLoginFailureText } from "./profile-login-copy";

export function existingChromeFailureText(code: string | null, copy: Copy, language: Language = 'en'): string {
  const profile = profileLoginFailureText(code, language);
  if (profile) return profile;
  switch (code) {
    case "chrome-profile-access-denied": return copy.existingChromeAccessDenied;
    case "chrome-file-selection-invalid": return copy.existingChromeWrongFile;
    case "chrome-unavailable": return copy.existingChromeMissingConnection;
    case "invalid-endpoint": return copy.existingChromeInvalidConnection;
    case "chrome-permission-denied": return copy.existingChromeDenied;
    case "chrome-permission-timeout": case "existing-chrome-timeout": return copy.existingChromeTimeout;
    case "chrome-too-old": return copy.existingChromeOldVersion;
    case "chrome-disconnected": return copy.existingChromeDisconnected;
    case "invalid-response": return copy.existingChromeInvalidResponse;
    case "session-missing": return copy.existingChromeNoSession;
    case "session-verification-failed": return copy.existingChromeVerificationFailed;
    case "capture-write-failed": return copy.existingChromeCaptureFailed;
    case "launcher-authorization-failed": return copy.existingChromeAuthorizationFailed;
    case "consent-required": return copy.existingChromeConsent;
    case "cancelled": return copy.existingChromeCancelled;
    case "existing-chrome-handoff-timeout": return copy.existingChromeHandoffTimeout;
    case "existing-chrome-cleanup-failed": return copy.existingChromeCleanupFailed;
    default: return copy.existingChromeFailure;
  }
}
