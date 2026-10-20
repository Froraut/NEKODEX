export interface CredentialReference { version: 1; provider: "os-vault"; id: string; revision: string }
export interface CredentialScope { accountId: string; interactionMode: "automatic" | "manual"; tunnelId: string }
export interface PreparedCredential { version: 1; reference: CredentialReference; scope: CredentialScope; scopeHash: string; owner: string }
export function createCredentialProvider(options: { coreHome: string; helperPath?: string; backend?: { request(value: unknown): unknown } }): {
  prepare(scope: CredentialScope, secret: string): PreparedCredential;
  resolve(reference: CredentialReference, scope: CredentialScope): string;
  discardPrepared(receipt: PreparedCredential, currentReferences: CredentialReference[]): boolean;
};
