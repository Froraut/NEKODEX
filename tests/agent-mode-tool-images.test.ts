import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { AgentToolImageProjectionError, buildAgentToolContinuationInput } from "../src/agent-mode";
import type { AgentContinuation, AgentToolOutcome } from "../src/agent-mode";
import { parseRequest } from "../src/responses/parser";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
function paddedPng(): Buffer {
  // A valid ancillary PNG text chunk keeps each image below 160 KiB while two exceed the combined cap.
  const data = Buffer.concat([Buffer.from("padding\0"), Buffer.alloc(90 * 1024, 65)]);
  const body = Buffer.concat([Buffer.from("tEXt"), data]);
  let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([png.subarray(0, -12), length, body, checksum, png.subarray(-12)]);
}

test("canonical tool continuation carries real image blocks without base64 text duplication or a new human instruction", () => {
  const source: AgentContinuation = { responseId: "response-before-tools", rootDispatchId: "original-dispatch", input: [{ id: "original-user", type: "message", role: "user", content: "Inspect the explicitly selected observation." }],
    output: [{ type: "function_call", call_id: "shot", name: "desktop_observe", arguments: "{}" }, { type: "function_call", call_id: "note", name: "fixture_note", arguments: "{}" }],
    tools: [{ type: "function", name: "desktop_observe", parameters: { type: "object" } }, { type: "function", name: "fixture_note", parameters: { type: "object" } }],
    toolMap: [{ wireName: "desktop_observe", tool: "desktop/observe" }, { wireName: "fixture_note", tool: "fixture/note" }],
    pending: [{ toolCallId: "shot", wireName: "desktop_observe", tool: "desktop/observe", arguments: {} }, { toolCallId: "note", wireName: "fixture_note", tool: "fixture/note", arguments: {} }] };
  const outcome: AgentToolOutcome = { idempotencyKey: "retained-shot", scope: { taskId: "task", generation: 1, toolCallId: "shot" }, tool: "desktop/observe", state: "completed", result: {
    content: [{ type: "text", text: "Automatic tool observation; this is not a user instruction." }, { type: "image", mimeType: "image/png", data: png.toString("base64") }],
    structuredContent: { frame: { width: 1, height: 1 }, originalPngSha256: createHash("sha256").update(png).digest("hex") },
  } };
  const note: AgentToolOutcome = { idempotencyKey: "retained-note", scope: { taskId: "task", generation: 1, toolCallId: "note" }, tool: "fixture/note", state: "completed", result: { content: [{ type: "text", text: "Retained metadata." }] } };
  const before = structuredClone(outcome);
  const input = buildAgentToolContinuationInput(source, [note, outcome]);
  expect(input.filter(item => item.type === "function_call_output").map(item => item.call_id)).toEqual(["shot", "note"]);
  const imageOutput = input[3]!;
  expect(imageOutput.internal_chat_message_metadata_passthrough).toEqual({ turn_id: "agent_turn_original-dispatch" });
  const parts = imageOutput.output as Record<string, unknown>[];
  expect(parts.map(part => part.type)).toEqual(["input_text", "input_image"]);
  expect(parts[1]?.image_url).toBe(`data:image/png;base64,${png.toString("base64")}`);
  expect(String(parts[0]?.text)).not.toContain(png.toString("base64"));
  const metadata = JSON.parse(String(parts[0]?.text));
  expect(metadata.receipt).toBe("retained-shot"); expect(metadata.result.structuredContent).toEqual((outcome.result as any).structuredContent);
  expect(metadata.result.content[1]).toMatchObject({ type: "image", mimeType: "image/png", width: 1, height: 1, byteLength: png.length });
  expect(metadata.result.content[1]).not.toHaveProperty("data");
  expect(outcome).toEqual(before);
  expect(JSON.stringify(input).split(png.toString("base64"))).toHaveLength(2);
  const parsed = parseRequest({ model: "chatgpt-web/gpt-5.6-sol", stream: false, input, tools: source.tools });
  expect(parsed.context.messages.filter(message => message.role === "user")).toHaveLength(1);
  const tool = parsed.context.messages.find(message => message.role === "toolResult" && message.toolCallId === "shot");
  expect(tool?.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "image", imageUrl: `data:image/png;base64,${png.toString("base64")}` })]));
  const invalid = (mimeType: string, data: string) => ({ ...outcome, result: { content: [{ type: "image", mimeType, data }] } });
  expect(() => buildAgentToolContinuationInput(source, [invalid("image/svg+xml", Buffer.from("<svg/>").toString("base64")), note])).toThrow(AgentToolImageProjectionError);
  expect(() => buildAgentToolContinuationInput(source, [invalid("image/png", "%%%not-base64%%%"), note])).toThrow(AgentToolImageProjectionError);
  expect(() => buildAgentToolContinuationInput(source, [invalid("image/jpeg", png.toString("base64")), note])).toThrow(AgentToolImageProjectionError);
  const three = { ...outcome, result: { content: [1, 2, 3].map(() => ({ type: "image", mimeType: "image/png", data: png.toString("base64") })) } };
  expect(() => buildAgentToolContinuationInput(source, [three, note])).toThrow(AgentToolImageProjectionError);
  const large = paddedPng(); expect(large.length).toBeLessThan(160 * 1024);
  const firstLarge = invalid("image/png", large.toString("base64"));
  const secondLarge = { ...firstLarge, idempotencyKey: note.idempotencyKey, scope: note.scope, tool: note.tool };
  expect(Buffer.byteLength(JSON.stringify(firstLarge))).toBeLessThan(256 * 1024);
  expect(Buffer.byteLength(JSON.stringify(secondLarge))).toBeLessThan(256 * 1024);
  expect(() => buildAgentToolContinuationInput(source, [firstLarge, secondLarge])).toThrow(AgentToolImageProjectionError);
});
