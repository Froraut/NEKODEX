import { zstdDecompress } from "node:zlib";

const MAX_ENCODED_REQUEST_BYTES = 64 * 1024 * 1024;
const MAX_DECODED_REQUEST_BYTES = 128 * 1024 * 1024;
const INVALID_ZSTD_DATA_CODES = new Set([
  "Z_DATA_ERROR",
  "ZSTD_error_prefix_unknown",
  "ZSTD_error_corruption_detected",
  "ZSTD_error_checksum_wrong",
  "ZSTD_error_srcSize_wrong",
  "ZSTD_error_literals_headerWrong",
  "ZSTD_error_frameParameter_unsupported",
  "ZSTD_error_version_unsupported",
  "ZSTD_error_dictionary_wrong",
  "ZSTD_error_dictionary_corrupted",
  "ZSTD_error_dstSize_tooSmall",
]);

/** Only validation failures created at the body boundary may become client HTTP statuses. */
export class NativeRequestBodyError extends Error {
  constructor(message: string, readonly status: 400 | 413 | 415) {
    super(message);
    this.name = "NativeRequestBodyError";
  }
}

function assertWithinLimit(bytes: number, limit: number, label: string): void {
  if (bytes > limit) throw new NativeRequestBodyError(`${label} exceeds ${limit} bytes`, 413);
}

/** Collect opaque request bytes with a streaming size limit and abort-aware cleanup. */
export async function readRequestBodyBytes(
  request: Request,
  maxBytes = MAX_ENCODED_REQUEST_BYTES,
): Promise<Uint8Array<ArrayBuffer>> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    const error = new NativeRequestBodyError(`Encoded request body exceeds ${maxBytes} bytes`, 413);
    // Reject immediately even when this is one branch of a tee: cancellation can wait for the
    // other branch, but the oversized request must not keep this branch's source live.
    void request.body?.cancel(error).catch(() => {});
    throw error;
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

export async function readJsonRequestBody(
  request: Request,
  maxEncodedBytes = MAX_ENCODED_REQUEST_BYTES,
  maxDecodedBytes = MAX_DECODED_REQUEST_BYTES,
): Promise<unknown> {
  const contentEncoding = (request.headers.get("content-encoding") ?? "identity").trim().toLowerCase();
  if (contentEncoding !== "" && contentEncoding !== "identity" && contentEncoding !== "zstd") {
    throw new NativeRequestBodyError(`Unsupported Content-Encoding: ${contentEncoding}`, 415);
  }
  const encoded = await readRequestBodyBytes(request, maxEncodedBytes);
  let decoded: Uint8Array;
  if (contentEncoding === "" || contentEncoding === "identity") {
    decoded = encoded;
  } else {
    // Enforce the output budget inside the native decoder, before a complete oversized result
    // can be allocated. Bun.zstdDecompress has no corresponding output-size option.
    decoded = await new Promise<Buffer>((resolve, reject) => {
      zstdDecompress(encoded, { maxOutputLength: maxDecodedBytes }, (error, output) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          reject(code === "ERR_BUFFER_TOO_LARGE"
            ? new NativeRequestBodyError(`Decoded request body exceeds ${maxDecodedBytes} bytes`, 413)
            : code && INVALID_ZSTD_DATA_CODES.has(code)
              ? new NativeRequestBodyError(error.message, 400)
              : error);
        } else {
          resolve(output);
        }
      });
    });
  }

  assertWithinLimit(decoded.byteLength, maxDecodedBytes, "Decoded request body");
  request.signal.throwIfAborted();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new NativeRequestBodyError(error.message, 400);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new NativeRequestBodyError(error.message, 400);
  }
}

/** Replace a decoded wire representation while preserving request authority and cancellation. */
export function createInternalJsonRequest(source: Request, url: string, body: unknown): Request {
  const headers = new Headers(source.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body), signal: source.signal });
}
