import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { projectNativeToolImages } from "../src/agent-mode/native-images";
import { AgentToolImageProjectionError } from "../src/agent-mode/tool-images";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
// Inert SOF fixture: dimensions and framing exercise the shared decoder without a renderer.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 1, 0, 1, 0, 0xff, 0xd9]);
const block = (bytes = png, mimeType = "image/png") => ({ type: "image", mimeType, data: bytes.toString("base64") });
function paddedPng(): Buffer {
  const payload = Buffer.concat([Buffer.from("fixture\0"), Buffer.alloc(90 * 1024, 65)]);
  const body = Buffer.concat([Buffer.from("tEXt"), payload]);
  let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  const length = Buffer.alloc(4); length.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([png.subarray(0, -12), length, body, checksum, png.subarray(-12)]);
}

test("Native tool images retain exact receipt ownership and bytes outside text, and refuse unsupported or unbounded projections", () => {
  const source = { toolCallId: "owned-observe-1", receipt: "journal-receipt-1" };
  const image = Object.freeze({ ...block(), annotations: Object.freeze({ audience: Object.freeze(["assistant"]) }) });
  const result = Object.freeze({ content: Object.freeze([{ type: "text", text: "Selected observation" }, image, Object.freeze(block(jpeg, "image/jpeg"))]), structuredContent: Object.freeze({ observationId: "frame-1" }) });
  const before = JSON.stringify(result);
  const projected = projectNativeToolImages({ ...source, result });
  expect(JSON.stringify(result)).toBe(before);
  expect(projected.result).toEqual({ content: [result.content[0], ...[png, jpeg].map((bytes, attachmentIndex) => ({
    type: "image", mimeType: attachmentIndex ? "image/jpeg" : "image/png", byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), width: 1, height: 1, attachmentIndex, imageDelivery: { state: "included" },
  }))], structuredContent: result.structuredContent });
  for (const [index, bytes] of [png, jpeg].entries()) {
    expect(projected.images[index]).toEqual({ data: bytes.toString("base64"), mimeType: index ? "image/jpeg" : "image/png",
      byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), width: 1, height: 1,
      source: { ...source, attachmentIndex: index } });
    expect(JSON.stringify(projected.result)).not.toContain(bytes.toString("base64"));
  }
  expect(projectNativeToolImages({ ...source, result: { content: [image] } }).images).toHaveLength(1);
  const plain = { content: [{ type: "text", text: "data:image/png;base64,ordinary diagnostic string" }] };
  expect(projectNativeToolImages({ ...source, result: plain })).toEqual({ result: plain, images: [] });
  const large = block(paddedPng());
  expect(projectNativeToolImages({ ...source, result: { content: [large] } }).images).toHaveLength(1);
  for (const invalid of [
    { content: [{ ...block(), data: "malformed" }] },
    { content: [block(png, "image/jpeg")] },
    { content: [block(png, "image/webp")] },
    { content: [{ ...block(), image_url: "https://example.invalid/image" }] },
    { content: [{ type: "text", nested: block() }] },
    { content: [image], other: image },
    { structuredContent: { nested: block() } },
    { content: [{ type: "input_image", image_url: "data:image/png;base64,ignored" }] },
    { other: { type: "output_image", data: png.toString("base64") } },
    { content: [{ type: "resource", resource: { mimeType: "image/png", blob: png.toString("base64") } }] },
    { content: [block(), block(), block()] },
    { content: [large, large] },
    { content: [block(Buffer.alloc(161 * 1024))] },
  ]) expect(() => projectNativeToolImages({ ...source, result: invalid })).toThrow(AgentToolImageProjectionError);
});
