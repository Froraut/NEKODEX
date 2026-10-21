import type { NativeAccountsSnapshot } from './native-accounts-types';

/** A signed-in Native profile whose models are offline and can be restored by its explicit inspection. */
export interface NativeModelsOfflineTarget {
  profileId: string;
  epoch: string;
  label: string;
  /** An inventory transaction is already running; the check cannot be started again. */
  checking: boolean;
  /** The profile's last inspection did not reach a confirmed catalog. */
  lastCheckUnconfirmed: boolean;
}

/**
 * Presentation-only projection. Main deliberately keeps Native models offline after every restart:
 * the inventory owner accepts only an explicit user action (it contacts OpenAI and rewrites the profile
 * config under its lease) and a historical receipt never reconstructs catalog authority. This helper
 * only chooses which signed-in profile the one-click "Inspect account and models" banner targets.
 * It starts nothing and never replays a receipt.
 */
export function nativeModelsOfflineTarget(snapshot: NativeAccountsSnapshot | null | undefined): NativeModelsOfflineTarget | null {
  if (!snapshot?.available) return null;
  // Any held execution owner (ready, preparing or failed) is managed by its own close action.
  if (snapshot.execution?.ownerHeld) return null;
  const candidates = snapshot.profiles.filter(profile => profile.state === 'signed-in-checking'
    && !(profile.login && ['prepared', 'running', 'pending', 'cancel-requested'].includes(profile.login.state)));
  if (!candidates.length) return null;
  const receipts = snapshot.inventory?.receipts ?? [];
  const latest = (profileId: string, epoch: string) => receipts
    .filter(row => row.profileId === profileId && row.epoch === epoch)
    .reduce<(typeof receipts)[number] | undefined>((best, row) => !best || row.updatedAt > best.updatedAt ? row : best, undefined);
  // The last-used profile is the one inspected most recently; otherwise keep the authority's order.
  const ranked = candidates.map((profile, index) => ({ profile, index, receipt: latest(profile.id, profile.epoch) }))
    .sort((a, b) => (b.receipt?.updatedAt ?? -1) - (a.receipt?.updatedAt ?? -1) || a.index - b.index);
  const { profile, receipt } = ranked[0]!;
  return { profileId: profile.id, epoch: profile.epoch, label: profile.label,
    checking: Boolean(snapshot.inventory?.activeCount),
    lastCheckUnconfirmed: Boolean(receipt && !receipt.ownerHeld && receipt.state === 'unknown') };
}
