function inspectionAbortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  return Object.assign(new Error("Browser check cancelled"), { name: "AbortError" });
}

// Observe abandoned promises so cancellation cannot leave an unhandled rejection. The
// caller owns the underlying navigation/helper and must cancel it before releasing its lease.
function awaitInspection(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    const abort = () => reject(inspectionAbortError(signal));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

module.exports = { awaitInspection, inspectionAbortError };
