export type AccountRoutingMode = "selected" | "balanced";

export interface AccountMetadata {
  id: string;
  label: string;
  enabled: boolean;
}

export interface AccountRegistrySnapshot {
  accounts: AccountMetadata[];
  selectedId: string;
  mode: AccountRoutingMode;
}

/** All methods are synchronous and return detached snapshots; invalid input or IO throws. */
export interface AccountRegistry {
  snapshot(): AccountRegistrySnapshot;
  list(): AccountRegistrySnapshot;
  /** Generates an enabled UUID account and selects it. The new id is snapshot.selectedId. */
  add(label: string): AccountRegistrySnapshot;
  /** May select a disabled account; selected-mode scheduling must then fail. */
  select(id: string): AccountRegistrySnapshot;
  /** Preserves selectedId; disabling the last enabled account throws. */
  setEnabled(id: string, enabled: boolean): AccountRegistrySnapshot;
  setMode(mode: AccountRoutingMode): AccountRegistrySnapshot;
}

/** One main-process instance per trusted absolute coreHome; persists only registry config. */
export function createAccountRegistry(coreHome: string): AccountRegistry;
/** Returns the id unchanged or throws; accepts exactly default or canonical lower-case UUIDs. */
export function validateAccountId(value: unknown): string;
