import type { CodexThreadMetadata } from './native-threads-types';

/** Parent links are authoritative; a fork relation never makes a thread a subagent. */
export function nativeThreadRows(threads: CodexThreadMetadata[]) {
  const byId = new Map(threads.map(thread => [thread.id, thread]));
  const children = new Map<string, CodexThreadMetadata[]>();
  const roots: CodexThreadMetadata[] = [];
  for (const thread of byId.values()) {
    if (thread.parentThreadId && thread.parentThreadId !== thread.id && byId.has(thread.parentThreadId)) {
      const siblings = children.get(thread.parentThreadId) || [];
      siblings.push(thread); children.set(thread.parentThreadId, siblings);
    } else roots.push(thread);
  }
  const result: Array<{ thread: CodexThreadMetadata; depth: number; parentMissing: boolean }> = [];
  const visited = new Set<string>();
  const append = (thread: CodexThreadMetadata) => {
    const stack = [{ thread, depth: 0 }];
    while (stack.length) {
      const row = stack.pop()!;
      if (visited.has(row.thread.id)) continue;
      visited.add(row.thread.id);
      result.push({ ...row, parentMissing: Boolean(row.thread.parentThreadId && !byId.has(row.thread.parentThreadId)) });
      const descendants = children.get(row.thread.id) || [];
      for (let index = descendants.length - 1; index >= 0; index--) {
        stack.push({ thread: descendants[index]!, depth: row.depth + 1 });
      }
    }
  };
  roots.forEach(append);
  // Defensive cycle handling preserves every server row exactly once without inventing ancestry.
  for (const thread of byId.values()) if (!visited.has(thread.id)) append(thread);
  return result;
}

export function mergeNativeThreads(previous: CodexThreadMetadata[], incoming: CodexThreadMetadata[]) {
  const rows = new Map(previous.map(thread => [thread.id, thread]));
  for (const thread of incoming) rows.set(thread.id, thread);
  return [...rows.values()];
}

/** Native idle/notLoaded are observations, never authority to reuse an external executor.
 * The installed public protocol has no cooperative owner-release/exclusive lease. */
export function nativeExternalThreadControl(thread: CodexThreadMetadata) {
  return { threadId: thread.id, sessionId: thread.sessionId, parentThreadId: thread.parentThreadId,
    resumeAvailable: false as const, exclusiveHandoffAvailable: false as const,
    executionOwner: 'unverified' as const, reason: 'exclusive-owner-contract-unavailable' as const };
}
