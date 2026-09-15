import { expect, test } from "bun:test";
import { zipSync } from "fflate";
import { extractTunnelBinary, readBoundedResponse } from "../src/tunnel";

test("tunnel download stops reading when an unannounced body exceeds its byte limit", async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(4));
    },
    cancel() { cancelled = true; },
  });
  await expect(readBoundedResponse(new Response(body), 5)).rejects.toThrow("Download exceeds 5 bytes");
  expect(cancelled).toBe(true);
  expect(pulls).toBeLessThanOrEqual(3);
});

test("tunnel extraction selects one binary and rejects unsafe archive paths", () => {
  const binary = new Uint8Array([1, 2, 3]);
  const archive = zipSync({ "payload/tunnel-client": binary, "payload/unused.txt": new Uint8Array(10_000) });
  expect(extractTunnelBinary(archive, "tunnel-client")).toEqual(binary);
  const unsafe = zipSync({ "../tunnel-client": binary });
  expect(() => extractTunnelBinary(unsafe, "tunnel-client")).toThrow("unsafe entry path");
});
