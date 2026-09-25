/** Attributes that invalidate both submission and response DOM evidence. */
export const CHATGPT_DOM_REVISION_ATTRIBUTES = [
  "aria-hidden",
  "aria-label",
  "aria-busy",
  "aria-disabled",
  "aria-expanded",
  "class",
  "data-item-anchor",
  "data-is-last-node",
  "data-message-author-role",
  "data-state",
  "data-streaming-response-status",
  "data-testid",
  "data-turn",
  "data-turn-id",
  "data-turn-id-container",
  "data-turn-key",
  "data-conversation-role",
  "data-user-message-bubble",
  "data-markdown-text-style",
  "disabled",
  "hidden",
  "inert",
  "open",
  "role",
  "start",
  "style",
] as const;

/** Caller-owned revision cache shape shared by the submission and response DOM readers. */
export interface ChatGptDomRevisionCache<T> {
  key?: string;
  snapshot?: T;
  fullScans?: number;
  cacheHits?: number;
}

/** A fresh snapshot replaces the cached evidence; an unchanged revision reuses it and counts a hit. */
export function recordDomRevisionObservation<T>(
  cache: ChatGptDomRevisionCache<T> | undefined,
  observed: { key: string; snapshot?: T },
): void {
  if (observed.snapshot && cache) {
    cache.key = observed.key;
    cache.snapshot = observed.snapshot;
    cache.fullScans = (cache.fullScans ?? 0) + 1;
  } else if (!observed.snapshot && cache?.snapshot) {
    cache.cacheHits = (cache.cacheHits ?? 0) + 1;
  }
}
