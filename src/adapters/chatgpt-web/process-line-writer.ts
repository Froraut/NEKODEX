import type { Writable } from "node:stream";
import { asError } from "../../lib/errors";
import { CHATGPT_HELPER_FRAME_BYTES, CHATGPT_HELPER_PENDING_BYTES, assertByteLimit } from "./resource-budgets";

export interface ProcessLineWriter {
  write(line: string): boolean;
  close(): void;
}

export function createProcessLineWriter(
  stream: Writable,
  onFailure: (error: Error) => void,
  options: { maxLineBytes?: number; maxPendingBytes?: number } = {},
): ProcessLineWriter {
  let writable = true;
  const maxLineBytes = options.maxLineBytes ?? CHATGPT_HELPER_FRAME_BYTES;
  const maxPendingBytes = options.maxPendingBytes ?? CHATGPT_HELPER_PENDING_BYTES;
  assertByteLimit(0, maxLineBytes, "Browser helper IPC frame");
  assertByteLimit(0, maxPendingBytes, "Browser helper IPC output queue");

  const fail = (error: unknown): void => {
    if (!writable) return;
    writable = false;
    onFailure(asError(error));
  };

  // A failed Windows anonymous pipe emits an error even when write() also receives
  // an error callback. Keeping this listener installed prevents an Electron helper
  // from turning an expected parent disconnect into an uncaught main-process error.
  stream.on("error", fail);

  return {
    write(line: string): boolean {
      if (!writable || stream.destroyed || stream.writableEnded) return false;
      try {
        const bytes = Buffer.byteLength(line, "utf8");
        assertByteLimit(bytes, maxLineBytes, "Browser helper IPC frame");
        assertByteLimit(stream.writableLength + bytes + 1, maxPendingBytes, "Browser helper IPC output queue");
        stream.write(`${line}\n`, error => {
          if (error) fail(error);
        });
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    },
    close(): void {
      writable = false;
    },
  };
}
