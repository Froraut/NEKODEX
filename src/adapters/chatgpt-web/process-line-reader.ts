import type { Readable } from "node:stream";
import { CHATGPT_HELPER_FRAME_BYTES, assertByteLimit } from "./resource-budgets";

/** Bound a JSONL frame before retaining or decoding it, including when no newline arrives. */
export function createProcessLineReader(
  stream: Readable,
  onLine: (line: string) => void,
  onFailure: (error: Error) => void,
  options: { maxLineBytes?: number; onClose?: () => void } = {},
): { close(): void } {
  const maxLineBytes = options.maxLineBytes ?? CHATGPT_HELPER_FRAME_BYTES;
  assertByteLimit(0, maxLineBytes, "Browser helper IPC frame");
  let storage = Buffer.alloc(0);
  let length = 0;
  let closed = false;
  const close = (notify = true): void => {
    if (closed) return;
    closed = true;
    stream.off("data", onData);
    stream.off("end", onEnd);
    stream.off("close", onEnd);
    stream.pause();
    storage = Buffer.alloc(0);
    length = 0;
    if (notify) options.onClose?.();
  };
  const fail = (error: unknown): void => {
    if (closed) return;
    // Failure owns shutdown; do not report a clean EOF before reporting the primary error.
    close(false);
    onFailure(error instanceof Error ? error : new Error(String(error)));
  };
  const append = (part: Buffer): void => {
    assertByteLimit(length + part.length, maxLineBytes, "Browser helper IPC frame");
    if (length + part.length > storage.length) {
      const next = Buffer.allocUnsafe(Math.min(maxLineBytes, Math.max(4096, storage.length * 2, length + part.length)));
      storage.copy(next, 0, 0, length);
      storage = next;
    }
    part.copy(storage, length);
    length += part.length;
  };
  const deliver = (): void => {
    const line = storage.toString("utf8", 0, length > 0 && storage[length - 1] === 13 ? length - 1 : length);
    length = 0;
    // A large completed frame must not pin its backing allocation for the helper's lifetime.
    if (storage.length > 64 * 1024) storage = Buffer.alloc(0);
    onLine(line);
  };
  const onData = (value: Buffer | string): void => {
    if (closed) return;
    try {
      const chunk = typeof value === "string" ? Buffer.from(value, "utf8") : value;
      let offset = 0;
      while (!closed && offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline;
        append(chunk.subarray(offset, end));
        if (newline < 0) break;
        deliver();
        offset = newline + 1;
      }
    } catch (error) { fail(error); }
  };
  const onEnd = (): void => {
    if (closed) return;
    try { if (length > 0) deliver(); }
    catch (error) { fail(error); return; }
    close();
  };
  stream.on("data", onData);
  stream.once("end", onEnd);
  stream.once("close", onEnd);
  stream.on("error", fail);
  return { close };
}
