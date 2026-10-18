export type NativeAccountState = 'fresh' | 'login-pending' | 'signed-in-checking' | 'auth-outcome-unknown' | 'login-failed' | 'cancelled';
export type NativeAccountLoginState = 'prepared' | 'running' | 'pending' | 'cancel-requested' | 'signed-in-checking' | 'failed' | 'cancelled' | 'auth-outcome-unknown';

export interface NativeAccountLogin {
  id: string;
  state: NativeAccountLoginState;
  verificationUrl?: string;
  userCode?: string;
  reasonCode?: string;
}

export interface NativeAccountProfile {
  id: string;
  epoch: string;
  label: string;
  state: NativeAccountState;
  login?: NativeAccountLogin;
}

export interface NativeAccountsSnapshot {
  available: boolean;
  reasonCode: string | null;
  profiles: NativeAccountProfile[];
  activeCount: number;
  executionAvailable: false;
  rejectedAction?: { actionId: string; knownNotStarted: true };
  inventory?: { activeCount: number; receipts: Array<import('../electron/native-account-inventory.cjs').NativeInventoryReceipt>; models: never[]; executionAvailable: false };
  execution?: import('../electron/native-account-execution.cjs').NativeAccountExecutionSnapshot;
  receipts: Array<{
    actionId: string;
    kind: 'prepare-profile' | 'device-login' | 'cancel-login' | 'profile-config' | 'close-execution';
    profileId: string;
    epoch: string;
    loginAttemptId?: string;
    state: string;
    reasonCode?: string;
  }>;
}

export type NativeAccountsRequest =
  | { action: 'status'; actionId?: string }
  | { action: 'prepare-profile'; actionId: string; label: string }
  | { action: 'begin-device-login'; actionId: string; profileId: string; epoch: string }
  | { action: 'cancel-login'; actionId: string; loginAttemptId: string };
export type NativeInventoryRequest = { action: 'inspect-models'; actionId: string; profileId: string; epoch: string };
export type NativeExecutionCloseRequest = { action: 'close-execution'; actionId: string; profileId: string; epoch: string };

export interface NativeAccountsApi {
  request(body: NativeAccountsRequest | NativeInventoryRequest | NativeExecutionCloseRequest): Promise<NativeAccountsSnapshot>;
  openVerificationUrl(url: string): Promise<unknown>;
  copyCode?(code: string): Promise<unknown>;
}
