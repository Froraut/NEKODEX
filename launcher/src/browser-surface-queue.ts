/** Serialize native activation only; a pending page reveal must not delay deactivation. */
export function enqueueBrowserSurfaceCommand<T>(previous: Promise<unknown>, isCurrent: () => boolean,
  setActive: () => Promise<T>, show?: () => Promise<unknown>): {
    queueTail: Promise<T | undefined>; result: Promise<T | undefined>;
  } {
  const queueTail = previous.catch(() => {}).then(async () => {
    if (!isCurrent()) return;
    return setActive();
  });
  const result = queueTail.then(async value => {
    if (show && isCurrent()) await show();
    return value;
  }).catch(cause => {
    if (isCurrent()) throw cause;
    return undefined;
  });
  return { queueTail, result };
}
