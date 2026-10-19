/** Serialize native surface changes, dropping superseded intent before it reaches IPC. */
export function enqueueBrowserSurfaceCommand<T>(previous: Promise<unknown>, isCurrent: () => boolean,
  setActive: () => Promise<T>, show?: () => Promise<unknown>): Promise<T | undefined> {
  return previous.catch(() => {}).then(async () => {
    if (!isCurrent()) return;
    const result = await setActive();
    if (show && isCurrent()) await show();
    return result;
  });
}
