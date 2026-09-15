export type EffortState = { min: number; max: number; value: number };
type OperationOptions = { signal: AbortSignal; timeout: number };

/** Follow observed changes, including UI jumps, and require a stable target. */
export async function stabilizeEffortSlider(options: {
  target: number;
  read: (options: OperationOptions) => Promise<EffortState | null | undefined>;
  press: (key: "ArrowLeft" | "ArrowRight", options: OperationOptions) => Promise<void>;
  signal?: AbortSignal;
}): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason ?? new Error("Effort selection cancelled"));
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const deadline = Date.now() + 8_000;
  const deadlineTimer = setTimeout(() => controller.abort(new Error("Effort selection timed out")), 8_000);
  const operation = async <T>(run: (options: OperationOptions) => Promise<T>): Promise<T> => {
    controller.signal.throwIfAborted();
    const timeout = Math.max(1, Math.min(1_000, deadline - Date.now()));
    let rejectAbort!: () => void;
    const interrupted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    const timer = setTimeout(() => controller.abort(new Error("Effort operation timed out")), timeout);
    try { return await Promise.race([run({ signal: controller.signal, timeout }), interrupted]); }
    finally { clearTimeout(timer); controller.signal.removeEventListener("abort", rejectAbort); }
  };
  let stableSince: number | undefined;
  let lastPressedValue: number | undefined;
  let lastPressAt = 0;
  let presses = 0;
  try {
    for (;;) {
      const state = await operation(options.read);
      if (!state || ![state.min, state.max, state.value].every(Number.isInteger)
        || state.min > state.max || state.value < state.min || state.value > state.max
        || options.target < state.min || options.target > state.max) {
        throw new Error("ChatGPT effort slider lost its semantic ARIA range");
      }
      const now = Date.now();
      if (state.value === options.target) {
        stableSince ??= now;
        if (now - stableSince >= 300) return;
      } else {
        stableSince = undefined;
        // Let a pending render settle before retrying a no-op key press.
        if (state.value !== lastPressedValue || now - lastPressAt >= 750) {
          if (++presses > 12) throw new Error("ChatGPT effort slider exceeded its key-press limit");
          await operation(op => options.press(state.value < options.target ? "ArrowRight" : "ArrowLeft", op));
          lastPressedValue = state.value;
          lastPressAt = Date.now();
        }
      }
      await operation(() => new Promise<void>(resolve => setTimeout(resolve, 50)));
    }
  } finally {
    clearTimeout(deadlineTimer);
    options.signal?.removeEventListener("abort", cancel);
    controller.abort();
  }
}
