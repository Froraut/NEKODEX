import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

/** Read through one file descriptor with an allocation bound, including concurrent growth. */
export function readBoundedUtf8File(path: string, maxBytes = 4 * 1024 * 1024): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Invalid file byte limit");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    if (!fstatSync(fd).isFile()) throw new Error("Diagnostic input is not a regular file");
    const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1));
    for (;;) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, maxBytes - bytes + 1), null);
      if (!count) break;
      bytes += count;
      if (bytes > maxBytes) throw new Error("File exceeds diagnostic byte limit");
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes));
  } finally { closeSync(fd); }
}
