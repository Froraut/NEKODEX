import type { LogRecord } from './types';

export type LauncherLogEntry = { id: number; record: LogRecord };
export type LauncherLogStore = ReturnType<typeof createLauncherLogStore>;
const limit = 300;

/** Renderer-only presentation history. Durable logging remains in Electron. */
export function createLauncherLogStore() {
  let entries: LauncherLogEntry[] = [];
  let pending: LauncherLogEntry[] = [];
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const cancelPendingNotification = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const getSnapshot = () => {
    if (pending.length) {
      entries = [...entries, ...pending].slice(-limit);
      pending = [];
    }
    return entries;
  };
  const notify = () => {
    if (!listeners.size || timer !== null) return;
    // Bound React work during log bursts; do not depend on animation frames in
    // hidden/minimized windows. Task, error and lifecycle IPC stay immediate.
    timer = setTimeout(() => {
      timer = null;
      getSnapshot();
      for (const listener of listeners) listener();
    }, 100);
  };
  return {
    getSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) cancelPendingNotification();
      };
    },
    append(record: LogRecord) {
      pending.push({ id: ++sequence, record });
      if (pending.length > limit) pending.splice(0, pending.length - limit);
      notify();
    },
    seed(snapshot: LogRecord[], duringRead: LogRecord[]) {
      const key = (record: LogRecord) => JSON.stringify([record.at, record.level, record.event, record.detail]);
      const known = new Set(snapshot.map(key));
      entries = [...snapshot, ...duringRead.filter(record => !known.has(key(record)))].slice(-limit)
        .map(record => ({ id: ++sequence, record }));
      pending = [];
      notify();
    },
    cancelPendingNotification,
  };
}
