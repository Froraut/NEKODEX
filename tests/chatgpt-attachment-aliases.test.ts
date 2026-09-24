import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileChatGptWebPrompt } from "../src/adapters/chatgpt-web/prompt";
import { chatGptPromptFilePayloads } from "../src/adapters/chatgpt-web/browser-worker";
import { materializeChatGptManualAttachments } from "../src/adapters/chatgpt-web/manual-attachments";
import { selectedSkillFile } from "../src/adapters/chatgpt-web/skill-attachments";
import { CHATGPT_WEB_MODEL_ID } from "../src/adapters/chatgpt-web/model";
import { parseRequest } from "../src/responses/parser";
import type { CodexUserMessage } from "../src/types";

const capabilities = { localToolsEnabled: false, solAvailable: true, proAvailable: false };
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const imageUrl = `data:image/png;base64,${png.toString("base64")}`;
const inputFile = (filename: string, bytes: Buffer | string, mime = "text/plain") => ({
  type: "input_file", filename, file_data: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
});

function fixture() {
  const skill: CodexUserMessage = { role: "user", origin: "codex_skill", timestamp: 1,
    content: "<skill><name>review</name><path>/skills/review</path>Read carefully.</skill>" };
  const skillFile = selectedSkillFile(skill);
  const parsed = parseRequest({ model: CHATGPT_WEB_MODEL_ID, input: [
    { role: "user", content: [inputFile("report.txt", "old"), inputFile("report--2.txt", "literal suffix")] },
    { role: "user", content: [inputFile("report.txt", "new"), inputFile("report.txt", "new"),
      inputFile("codex-input-image-1.png", png, "image/png"), inputFile(skillFile.name, "ordinary document"),
      { type: "input_image", image_url: imageUrl }] },
  ] });
  parsed.context.messages.push(skill, skill);
  return { parsed, skillFile };
}

for (const multipart of [false, true]) {
  test(`attachment aliases preserve versions, generated names and exact bytes (${multipart ? "multipart" : "inline"})`, () => {
    const { parsed, skillFile } = fixture();
    const original = JSON.stringify(parsed.context);
    const options = { experimentalSkillAttachments: true, ...(multipart ? { experimentalMultipartParts: 2 as const } : {}) };
    const prompt = compileChatGptWebPrompt(parsed, capabilities, undefined, options);
    const again = compileChatGptWebPrompt(parsed, capabilities, undefined, options);
    expect(again).toEqual(prompt);
    expect(JSON.stringify(parsed.context)).toBe(original);
    const payloads = chatGptPromptFilePayloads(prompt);
    expect(new Set(payloads.map(file => file.name.toLowerCase())).size).toBe(payloads.length);
    expect(prompt.files).toHaveLength(5);
    expect(prompt.skillFiles).toEqual([skillFile]);
    expect(payloads.find(file => file.name === "codex-input-image-1.png")!.buffer).toEqual(png);
    expect(payloads.find(file => file.name === skillFile.name)!.buffer.toString()).toBe(skillFile.text);
    const messages = prompt.multipart
      ? prompt.multipart.parts.flatMap(part => JSON.parse(part).records).filter(record => record.kind === "message").map(record => record.message)
      : JSON.parse(prompt.text.split("<codex_context_json>\n")[1]!.split("\n</codex_context_json>")[0]!).messages;
    const refs = messages.flatMap((message: any) => message.content).filter((part: any) => part.type === "file_attachment");
    const manifest = JSON.parse(prompt.text.split("Attachment manifest: ")[1]!.split("\n")[0]!);
    for (const ref of refs) {
      const file = prompt.files!.find(file => file.ref === ref.attachment_ref)!;
      expect(ref.filename).toBe(file.name);
      expect(ref.original_filename).toBe(file.originalName);
      expect(manifest.find((entry: any) => entry.ref === file.ref)).toMatchObject({ filename: file.name, original_filename: file.originalName });
      expect(payloads.find(payload => payload.name === ref.filename)!.buffer).toEqual(Buffer.from(file.base64, "base64"));
    }
    expect(refs[2].attachment_ref).toBe(refs[3].attachment_ref);
    expect(payloads.find(file => file.name === "report.txt")!.buffer.toString()).toBe("old");
    expect(payloads.find(file => file.name === "report--2.txt")!.buffer.toString()).toBe("literal suffix");
    expect(payloads.find(file => file.name === refs[2].filename)!.buffer.toString()).toBe("new");
  });
}

test("long and case-colliding filenames materialize independently in Manual transport", async () => {
  const root = await mkdtemp(join(tmpdir(), "nekodex-aliases-"));
  const previous = process.env.CODEX_CHATGPT_WEB_HOME;
  process.env.CODEX_CHATGPT_WEB_HOME = root;
  try {
    const long = `${"a".repeat(156)}.txt`;
    const parsed = parseRequest({ model: CHATGPT_WEB_MODEL_ID, input: [{ role: "user", content: [
      inputFile(long, "one"), inputFile(long, "two"), inputFile("REPORT.txt", "three"), inputFile("report.txt", "four"),
    ] }] });
    const prompt = compileChatGptWebPrompt(parsed, { ...capabilities, localToolsEnabled: true }, "manual-test", { manualControl: true });
    const files = await materializeChatGptManualAttachments("aliases-test", prompt);
    expect(new Set(files.map(file => file.name.toLowerCase())).size).toBe(4);
    expect(files.every(file => file.name.length <= 160 && file.name.endsWith(".txt"))).toBe(true);
    expect(await Promise.all(files.map(file => readFile(file.path, "utf8")))).toEqual(["one", "two", "three", "four"]);
  } finally {
    if (previous === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});
