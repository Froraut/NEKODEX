import type { OAuthProtectedVault } from './agent-oauth.cjs';
export interface OAuthVaultBackend { readonly kind?: string; request(payload: unknown): unknown | Promise<unknown> }
export function createNativeOAuthVaultBackend(options?: { platform?: NodeJS.Platform; helperPath?: string }): OAuthVaultBackend;
/** Trusted main process only. Scope binds canonical application home and exact account/config epoch. */
export function createOAuthProtectedVault(options: {
  coreHome: string; backend?: OAuthVaultBackend; platform?: NodeJS.Platform; helperPath?: string;
}): OAuthProtectedVault;

/** Metadata only; does not launch a helper, inspect credentials, verify signing or establish an unlocked vault. */
export function oauthProtectedVaultAvailable(options?: { platform?: NodeJS.Platform; arch?: string; helperPath?: string }): boolean;
