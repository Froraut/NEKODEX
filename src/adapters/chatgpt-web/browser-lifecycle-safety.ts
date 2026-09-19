/** Retry only an acquired, settled transport; an unseen late CDP connection is not safe to replace. */
export function canRetryOwnedPageRebind(error: unknown, state: {
  retry: number; actionSettled: boolean; hasConnection: boolean; aborted: boolean;
}): boolean {
  if (state.retry !== 0 || !state.actionSettled || !state.hasConnection || state.aborted) return false;
  const cause = error instanceof Error ? error.cause : undefined;
  return error instanceof Error && (error.name === "TimeoutError"
    || error.name === "ChatGptBrowserObservationTimeoutError"
    || (cause instanceof Error && cause.name === "TimeoutError"));
}

/** Silence is insufficient: require a disconnected exact owner and a retired broker. */
export function canRetireDetachedToolDelivery(state: {
  exactOwner: boolean; brokerRetired: boolean; hasObservers: boolean; activeToolCalls: number | undefined;
  peerActive: boolean; disconnectedAt: number; outstandingSince: number | undefined;
  lastProgressAt: number | undefined; now: number;
}): boolean {
  return state.exactOwner && state.brokerRetired && !state.hasObservers && !state.peerActive
    && state.activeToolCalls === 0 && state.outstandingSince !== undefined
    && state.now - Math.max(state.disconnectedAt, state.outstandingSince, state.lastProgressAt ?? 0) >= 30 * 60_000;
}
