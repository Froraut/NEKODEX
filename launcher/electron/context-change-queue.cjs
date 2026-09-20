// One persisted setting, applied only between turns. The runtime still acquires
// its atomic idle drain; the preliminary check avoids rejecting live requests.
function createContextChangeQueue({ read, write, ready, apply, onApplied,
  schedule = fn => setTimeout(fn, 2000), unschedule = clearTimeout }) {
  let timer = null;
  let checking = false;
  let applying = false;
  let stopped = false;
  let revision = 0;
  function wake() {
    if (stopped || timer || typeof read().pendingBiggerContext !== "boolean" || read().contextChangeError) return;
    timer = schedule(() => { timer = null; void flush(); });
    timer?.unref?.();
  }
  async function flush() {
    if (stopped || checking || applying) return;
    const desired = read().pendingBiggerContext;
    if (typeof desired !== "boolean" || read().contextChangeError) return;
    const requestedRevision = revision;
    checking = true;
    try {
      const isReady = await ready();
      if (stopped || requestedRevision !== revision || !isReady) return;
      if (read().pendingBiggerContext !== desired) return;
      if (read().experimentalBiggerContext === desired) {
        write({ pendingBiggerContext: null, contextChangeError: null });
        return;
      }
      applying = true;
      write({ contextChangeApplying: true });
      await apply(desired);
      if (stopped) return;
      // Report the mode that actually committed, even if a newer choice is queued.
      onApplied(desired);
      if (requestedRevision === revision && read().pendingBiggerContext === desired) write({ pendingBiggerContext: null });
    } catch (error) {
      if (!stopped && requestedRevision === revision && read().pendingBiggerContext === desired
        && !["RUNTIME_NOT_IDLE", "RUNTIME_BUSY"].includes(error?.code)) {
        write({ contextChangeError: String(error?.message || error).slice(0, 600) });
      }
    } finally {
      checking = false;
      applying = false;
      if (!stopped && read().contextChangeApplying) write({ contextChangeApplying: false });
      wake();
    }
  }
  return {
    request(enabled) {
      if (typeof enabled !== "boolean") throw new Error("Context mode must be a boolean");
      if (stopped) throw new Error("Context change queue is stopped");
      revision += 1;
      if (!applying && read().experimentalBiggerContext === enabled) {
        if (timer) unschedule(timer);
        timer = null;
        write({ pendingBiggerContext: null, contextChangeError: null });
        return read();
      }
      write({ pendingBiggerContext: enabled, contextChangeError: null });
      wake();
      return read();
    },
    cancel() {
      if (applying) throw new Error("Wait for the context change to finish");
      if (stopped) throw new Error("Context change queue is stopped");
      revision += 1;
      write({ pendingBiggerContext: null, contextChangeError: null });
      if (timer) unschedule(timer);
      timer = null;
      return read();
    },
    start: wake,
    flush,
    stop() { stopped = true; revision += 1; if (timer) unschedule(timer); timer = null; },
  };
}
module.exports = { createContextChangeQueue };
