import type { Copy } from "./i18n";
import type { Language } from './types';
import { profileLoginFailureText } from './profile-login-copy';

export function passkeyFailureText(code: string | null, copy: Copy, language: Language = 'en'): string {
  const profile = profileLoginFailureText(code, language);
  if (profile) return profile;
  switch (code) {
    case "chrome-account-mismatch":
      return copy.passkeyFailed;
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
