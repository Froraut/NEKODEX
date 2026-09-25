// Cancellation helpers for the in-process update controller and preparation.
// The detached worker set copied by update-staging.cjs stays self-contained
// and must not require this module.
function abortReason(signal, fallback = "Update preparation was cancelled") {
  return signal?.reason instanceof Error ? signal.reason : new Error(fallback);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

module.exports = { abortReason, throwIfAborted };
