/** Browser-safe projections only. Credentials and authorization response parameters never cross IPC. */
export interface OAuthProviderConfig {
  providerId: string;
  label: string;
  accountId: string;
  epoch: number;
  resource: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  clientId: string;
  redirectUriMode?: 'loopback-port-variable' | 'loopback-exact';
  /** Public registered callback URI; never an authorization response URL. */
  redirectUri?: string;
  scopes: string[];
  codeChallengeMethodsSupported: string[];
  authorizationResponseIssParameterSupported?: boolean;
}
export type OAuthConnectionState = 'disconnected' | 'authorization_pending' | 'connected' | 'expired'
  | 'refresh_pending' | 'revocation_pending' | 'revoked' | 'unavailable';
export interface OAuthProviderStatus {
  providerId: string;
  label: string;
  resource: string;
  issuer: string;
  scopes: string[];
  state: OAuthConnectionState;
  expiresAt?: number;
  canRefresh: boolean;
  canRevoke: boolean;
  /** OAuth grants resource access; each consequential tool call still needs its ToolJournal approval. */
  toolApprovalRequired: true;
  reason?: string;
}
export interface AgentOAuthPanelPort {
  list(): Promise<OAuthProviderStatus[]>;
  begin(input: { providerId: string; explicitUserAction: true }): Promise<OAuthProviderStatus>;
  cancel(input: { providerId: string; explicitUserAction: true }): Promise<OAuthProviderStatus>;
  refresh(input: { providerId: string; explicitUserAction: true }): Promise<OAuthProviderStatus>;
  revoke(input: { providerId: string; explicitUserAction: true }): Promise<OAuthProviderStatus>;
  pickProvider?(): Promise<{ cancelled: boolean; review?: OAuthProviderRegistrationReview }>;
  registerProvider?(input: { reviewId: string; reviewDigest: string; explicitUserAction: true }): Promise<OAuthProviderRegistrationReview>;
}
export interface OAuthProviderRegistrationReview {
  reviewId: string; reviewDigest: string; scope: { accountId: string; epoch: string };
  providerId: string; label: string; resource: string; issuer: string;
  authorizationEndpoint: string; tokenEndpoint: string; revocationEndpoint?: string;
  clientId: string; scopes: string[]; metadataDigest: string;
  redirectUriMode?: 'loopback-port-variable' | 'loopback-exact'; redirectUri?: string;
  registrationEvidenceUrl: string; resourceMetadataUrl: string; authorizationServerMetadataUrl: string;
  state: 'reviewed' | 'registered'; authorizationStarted: false; toolApprovalRequired: true;
}
