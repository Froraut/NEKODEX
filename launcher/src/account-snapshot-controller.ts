import type { AccountPoolSnapshot, BrowserState, SnapshotObservation } from './types';
import { observationOf, observationCovers as covers } from './snapshot-observation';

/** One reader; host revisions settle notification races, local epochs fence mutations. */
export function createAccountSnapshotController({ read, defer, onSnapshot, onLoading, onFailure }: {
  read: () => Promise<AccountPoolSnapshot>;
  defer: (action: () => void) => () => void;
  onSnapshot: (value: AccountPoolSnapshot) => void;
  onLoading: (value: boolean) => void;
  onFailure: () => void;
}) {
  let disposed = false, inFlight = false, revision = 0, hardRevision = 0;
  let cancelScheduled: (() => void) | null = null;
  let required: SnapshotObservation | null = null;
  let accepted: SnapshotObservation | null = null;
  const retiredSources = new Set<string>();
  const retirePreviousSource = (stamp: SnapshotObservation) => {
    if (!required || required.sourceId === stamp.sourceId) return;
    retiredSources.add(required.sourceId);
    if (retiredSources.size > 32) retiredSources.delete(retiredSources.values().next().value!);
  };
  const schedule = (invalidate = true, hard = true) => {
    if (disposed) return;
    if (invalidate) { revision++; if (hard) hardRevision++; }
    if (!cancelScheduled && !inFlight) cancelScheduled = defer(load);
  };
  const load = () => {
    cancelScheduled = null;
    if (disposed || inFlight) return;
    inFlight = true;
    onLoading(true);
    const requestedRevision = revision, requestedHardRevision = hardRevision;
    let settledRevision = -1;
    let request: Promise<AccountPoolSnapshot>;
    try { request = read(); } catch (cause) { request = Promise.reject(cause); }
    void request.then(value => {
      if (disposed || requestedHardRevision !== hardRevision) return;
      const stamp = observationOf(value);
      if (stamp && retiredSources.has(stamp.sourceId)) return;
      // Versioned host data can already contain the event that overtook this
      // IPC request. Legacy hosts retain the conservative local revision guard.
      if (stamp && required && stamp.sourceId === required.sourceId && !covers(stamp, required)) return;
      if (requestedRevision !== revision && !(stamp && required && covers(stamp, required))) return;
      if (stamp) { retirePreviousSource(stamp); accepted = stamp; required = stamp; }
      else accepted = required = null;
      settledRevision = revision;
      onSnapshot(value);
    }).catch(() => {
      if (disposed || requestedRevision !== revision || requestedHardRevision !== hardRevision) return;
      settledRevision = revision;
      onFailure();
    }).finally(() => {
      inFlight = false;
      if (disposed) return;
      if (settledRevision !== revision) schedule(false);
      else onLoading(false);
    });
  };
  return {
    start(immediate: boolean) { if (immediate) load(); else schedule(); },
    refresh: () => schedule(),
    observe(value: BrowserState) {
      if (disposed) return;
      const stamp = observationOf(value);
      if (!stamp) { required = accepted = null; schedule(); return; }
      if (retiredSources.has(stamp.sourceId)) return;
      if (accepted && covers(accepted, stamp)) return;
      if (required && covers(required, stamp)) return;
      // A different pool instance cannot validate reads from its predecessor.
      const changedSource = required !== null && required.sourceId !== stamp.sourceId;
      retirePreviousSource(stamp);
      required = stamp;
      if (changedSource) accepted = null;
      schedule(true, changedSource);
    },
    apply(value: AccountPoolSnapshot) {
      if (disposed) return;
      revision++; hardRevision++;
      const stamp = observationOf(value);
      if ((!stamp || !retiredSources.has(stamp.sourceId)) && (!stamp || !required || covers(stamp, required))) {
        if (stamp) { accepted = stamp; required = stamp; }
        onSnapshot(value);
      }
      schedule(false);
    },
    dispose() { disposed = true; cancelScheduled?.(); cancelScheduled = null; },
  };
}
