import { zstdDecompress } from "node:zlib";

const MAX_ENCODED_REQUEST_BYTES = 64 * 1024 * 1024;
const MAX_DECODED_REQUEST_BYTES = 128 * 1024 * 1024;

function assertWithinLimit(bytes: number, limit: number, label: string): void {
  if (bytes > limit) throw new Error(`${label} exceeds ${limit} bytes`);
}

/** Collect opaque request bytes with a streaming size limit and abort-aware cleanup. */
export async function readRequestBodyBytes(
  request: Request,
  maxBytes = MAX_ENCODED_REQUEST_BYTES,
): Promise<Uint8Array<ArrayBuffer>> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength)) {
    assertWithinLimit(declaredLength, maxBytes, "Encoded request body");
  }
  if (!request.body) {
    request.signal.throwIfAborted();
    return new Uint8Array();
  }
  const reader = request.body.getReader();
  const onAbort = () => { void reader.cancel(request.signal.reason).catch(() => {}); };
  request.signal.addEventListener("abort", onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    request.signal.throwIfAborted();
    while (true) {
      const chunk = await reader.read();
      request.signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      assertWithinLimit(bytes, maxBytes, "Encoded request body");
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks, bytes);
  } catch (error) {
    // Stop an unknown-length/chunked sender as soon as it crosses the budget. arrayBuffer()
    // followed by a size check would already have retained the whole request in memory.
    // Request.clone() tees the stream; cancelling one branch waits for the other branch.
    // Do not let an unread native-passthrough clone delay the explicit size-limit failure.
    void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    request.signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

export async function readJsonRequestBody(request: Request): Promise<unknown> {
  const contentEncoding = (request.headers.get("content-encoding") ?? "identity").trim().toLowerCase();
  if (contentEncoding !== "" && contentEncoding !== "identity" && contentEncoding !== "zstd") {
    throw new Error(`Unsupported Content-Encoding: ${contentEncoding}`);
  }
  const encoded = await readRequestBodyBytes(request);
  let decoded: Uint8Array;
  if (contentEncoding === "" || contentEncoding === "identity") {
    decoded = encoded;
  } else {
    // Enforce the output budget inside the native decoder, before a complete oversized result
    // can be allocated. Bun.zstdDecompress has no corresponding output-size option.
    decoded = await new Promise<Buffer>((resolve, reject) => {
      zstdDecompress(encoded, { maxOutputLength: MAX_DECODED_REQUEST_BYTES }, (error, output) => {
        if (error) {
          reject((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE"
            ? new Error(`Decoded request body exceeds ${MAX_DECODED_REQUEST_BYTES} bytes`)
            : error);
        } else {
          resolve(output);
        }
      });
    });
  }

  request.signal.throwIfAborted();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  return JSON.parse(text) as unknown;
}
