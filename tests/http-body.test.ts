import { expect, test } from "bun:test";
import { readJsonRequestBody } from "../src/http-body";

test("decodes Codex zstd-compressed JSON request bodies", async () => {
  const body = { model: "chatgpt-web/pro", reasoning: { effort: "ultra" }, input: [{ role: "user", content: "hello" }] };
  const compressed = Bun.zstdCompressSync(Buffer.from(JSON.stringify(body)));
  const encoded = new ArrayBuffer(compressed.byteLength);
  new Uint8Array(encoded).set(compressed);
  const request = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", "content-encoding": "zstd" },
    body: encoded,
  });

  expect(await readJsonRequestBody(request)).toEqual(body);
});

test("rejects unsupported request content encodings", async () => {
  const request = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", "content-encoding": "br" },
    body: "{}",
  });

  await expect(readJsonRequestBody(request)).rejects.toThrow("Unsupported Content-Encoding: br");
});

test("rejects an oversized declared body immediately even when source cancellation does not settle", async () => {
  let cancelled = false;
  const request = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "content-length": "9" },
    body: new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
        return new Promise<void>(() => {});
      },
    }),
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await expect(Promise.race([
      readJsonRequestBody(request, 8, 8),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("declared-size rejection waited for cancellation")), 100);
      }),
    ])).rejects.toThrow("Encoded request body exceeds 8 bytes");
    expect(cancelled).toBe(true);
  } finally {
    clearTimeout(timer);
  }
});

test("stops an unknown-length request at the encoded limit and cancels its source", async () => {
  const chunk = new Uint8Array(1024 * 1024);
  let pulls = 0;
  let cancelled = false;
  const request = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 68) {
          controller.error(new Error("request reader continued beyond the encoded budget"));
          return;
        }
        controller.enqueue(chunk);
      },
      cancel() { cancelled = true; },
    }),
  });

  await expect(readJsonRequestBody(request)).rejects.toThrow("Encoded request body exceeds");
  expect(cancelled).toBe(true);
  // One extra chunk may already be prefetched by the stream's default high-water mark.
  expect(pulls).toBeLessThanOrEqual(66);
});

test("bounds zstd output even when the encoded payload is very small", async () => {
  const oversized = Buffer.alloc(128 * 1024 * 1024 + 1, 0x20);
  const compressed = Bun.zstdCompressSync(oversized);
  expect(compressed.byteLength).toBeLessThan(1024 * 1024);
  const request = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", "content-encoding": "zstd" },
    body: new Uint8Array(compressed),
  });

  await expect(readJsonRequestBody(request)).rejects.toThrow("Decoded request body exceeds");
});

test("an unread request clone cannot delay an encoded-size rejection", async () => {
  const chunk = new Uint8Array(1024 * 1024);
  const request = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(chunk); },
    }),
  });
  const passthrough = request.clone();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await expect(Promise.race([
      readJsonRequestBody(request),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("size rejection waited for the unused clone")), 1_000);
      }),
    ])).rejects.toThrow("Encoded request body exceeds");
  } finally {
    clearTimeout(timer);
    await passthrough.body?.cancel();
  }
});

test("aborting a pending body read settles even with an unread request clone", async () => {
  const abort = new AbortController();
  let sourceCancelled = false;
  const request = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    signal: abort.signal,
    body: new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("{")); },
      cancel() { sourceCancelled = true; },
    }),
  });
  const passthrough = request.clone();
  const reading = readJsonRequestBody(request);
  const reason = new Error("isolated upload cancelled");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Bun.sleep(0); // Consume the first fragment and block on the still-open source.
    abort.abort(reason);
    await expect(Promise.race([
      reading,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("body cancellation remained pending")), 1_000);
      }),
    ])).rejects.toBe(reason);
  } finally {
    clearTimeout(timer);
    await passthrough.body?.cancel();
  }
  expect(sourceCancelled).toBe(true);
});

test("an already aborted upload does not read body data", async () => {
  const abort = new AbortController();
  abort.abort(new Error("upload was already cancelled"));
  let sourceCancelled = false;
  const request = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    signal: abort.signal,
    body: new ReadableStream<Uint8Array>({
      cancel() { sourceCancelled = true; },
    }),
  });
  await expect(readJsonRequestBody(request)).rejects.toThrow("upload was already cancelled");
  expect(sourceCancelled).toBe(true);
});

test("decodes chunked valid UTF-8 JSON without accepting invalid UTF-8", async () => {
  const encoded = new TextEncoder().encode(JSON.stringify({ input: "Привет" }));
  const request = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < encoded.length; index += 1) controller.enqueue(encoded.subarray(index, index + 1));
        controller.close();
      },
    }),
  });
  expect(await readJsonRequestBody(request)).toEqual({ input: "Привет" });
  await expect(readJsonRequestBody(new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    body: new Uint8Array([0xff]),
  }))).rejects.toThrow();
});
