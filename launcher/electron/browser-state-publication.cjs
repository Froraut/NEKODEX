// Hosts inside a pool signal a change without constructing a discarded snapshot.
// Standalone hosts retain synchronous snapshot delivery for existing consumers.
function publishBrowserSnapshot(host) {
  if (host.requestStatePublication) host.requestStatePublication();
  else host.publishState?.(host.snapshot());
}

/** Batch presentation only. Callers must retire authority/evidence synchronously. */
function createSnapshotPublisher({ read, send, available, onError }) {
  let pending = null, disposed = false;
  return {
    request() {
      if (disposed || pending !== null) return;
      pending = setImmediate(() => {
        pending = null;
        if (disposed || !available()) return;
        try { send(read()); }
        catch (error) { onError(error); }
      });
      pending.unref?.();
    },
    dispose() {
      disposed = true;
      if (pending !== null) clearImmediate(pending);
      pending = null;
    },
  };
}

module.exports = { publishBrowserSnapshot, createSnapshotPublisher };
