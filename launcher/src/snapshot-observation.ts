import type { BrowserState, SnapshotObservation } from './types';

export function observationOf(value: { observation?: SnapshotObservation }): SnapshotObservation | null {
  const stamp = value.observation;
  return stamp && typeof stamp.sourceId === 'string' && stamp.sourceId.length > 0
    && Number.isSafeInteger(stamp.revision) && stamp.revision >= 0 ? stamp : null;
}
export const observationCovers = (value: SnapshotObservation, required: SnapshotObservation) =>
  value.sourceId === required.sourceId && value.revision >= required.revision;

/** Compare only the same host instance; legacy states retain arrival ordering. */
export function newerBrowserState(current: BrowserState | null, candidate: BrowserState | null): BrowserState | null {
  if (!candidate) return current;
  if (!current) return candidate;
  const before = observationOf(current), next = observationOf(candidate);
  return before && next && observationCovers(before, next) ? current : candidate;
}
