export const CHATGPT_COMPOSER_DOCUMENT_END_KEY = process.platform === "darwin"
  ? "Meta+ArrowDown"
  : "Control+End";
export const CHATGPT_COMPOSER_SELECT_ALL_KEY = process.platform === "darwin"
  ? "Meta+A"
  : "Control+A";

export function throwIfPromptAttachmentAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("ChatGPT prompt attachment aborted", "AbortError");
}

export function withBrowserTurnAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("ChatGPT web turn aborted", "AbortError"));
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const onAbort = () => rejectPromise(new DOMException("ChatGPT web turn aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolvePromise, rejectPromise).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export function browserStageAbortSignal(stageSignal: AbortSignal, turnSignal?: AbortSignal): AbortSignal {
  return turnSignal ? AbortSignal.any([stageSignal, turnSignal]) : stageSignal;
}
