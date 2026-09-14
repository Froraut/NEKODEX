// One persisted setting, applied only between turns. The runtime still acquires
// its atomic idle drain; the preliminary check avoids rejecting live requests.
function createContextChangeQueue({ read, write, ready, apply, onApplied,
  schedule = fn => setTimeout(fn, 2000), unschedule = clearTimeout }) {
  let timer = null;
  let applying = false;
  let stopped = false;
  function wake() {
    if (stopped || timer || typeof read().pendingBiggerContext !== "boolean" || read().contextChangeError) return;
    timer = schedule(() => { timer = null; void flush(); });
    timer?.unref?.();
  }
  async function flush() {
    if (stopped || applying) return;
    const desired = read().pendingBiggerContext;
    if (typeof desired !== "boolean" || read().contextChangeError) return;
    applying = true;
    try {
      if (!await ready()) return;
      if (read().pendingBiggerContext !== desired) return;
      if (read().experimentalBiggerContext === desired) {
        write({ pendingBiggerContext: null, contextChangeError: null });
        return;
      }
      write({ contextChangeApplying: true });
      await apply(desired);
      onApplied(desired);
      if (read().pendingBiggerContext === desired) write({ pendingBiggerContext: null });
    } catch (error) {
      if (!["RUNTIME_NOT_IDLE", "RUNTIME_BUSY"].includes(error?.code)) {
        write({ contextChangeError: String(error?.message || error).slice(0, 600) });
      }
    } finally {
      applying = false;
      if (read().contextChangeApplying) write({ contextChangeApplying: false });
      wake();
    }
  }
  return {
    request(enabled) {
      if (typeof enabled !== "boolean") throw new Error("Context mode must be a boolean");
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
      write({ pendingBiggerContext: null, contextChangeError: null });
      if (timer) unschedule(timer);
      timer = null;
      return read();
    },
    start: wake,
    flush,
    stop() { stopped = true; if (timer) unschedule(timer); timer = null; },
  };
}
module.exports = { createContextChangeQueue };
