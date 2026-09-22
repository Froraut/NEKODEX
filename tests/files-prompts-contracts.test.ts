import { expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { CODEX_INPUT_FILE_MAX_BYTES, decodeCodexFileBase64, resolveInlineCodexFile, sanitizeCodexFileName } from "../src/responses/file-content";
import { prepareChatGptAttachments } from "../src/adapters/chatgpt-web/attachment-payloads";
import { materializeChatGptManualAttachments } from "../src/adapters/chatgpt-web/manual-attachments";
import type { CompiledChatGptWebPrompt } from "../src/adapters/chatgpt-web/prompt";
import { acquireChatGptResponseArtifacts } from "../src/adapters/chatgpt-web/artifacts";

const file = { ...resolveInlineCodexFile("report.txt", "aGVsbG8="), ref: "codex-input-file-1" };
const prompt: CompiledChatGptWebPrompt = { text: "read", images: [], files: [file] };

test("bounded decoder accepts exact limit and refuses oversize before decoding", () => {
  const exact = Buffer.alloc(CODEX_INPUT_FILE_MAX_BYTES, 97).toString("base64");
  expect(decodeCodexFileBase64(exact, "file").length).toBe(CODEX_INPUT_FILE_MAX_BYTES);
  const oversized = Buffer.alloc(CODEX_INPUT_FILE_MAX_BYTES + 1, 97).toString("base64");
  const from = spyOn(Buffer, "from");
  try {
    expect(() => resolveInlineCodexFile("large.txt", oversized)).toThrow("20 MB");
    expect(from).not.toHaveBeenCalled();
  } finally { from.mockRestore(); }
});

test("bounded decoder retains whitespace tolerance and canonical padding checks", () => {
  expect(decodeCodexFileBase64(" Y Q = = \n", "file").toString()).toBe("a");
  expect(decodeCodexFileBase64("YWI=", "file").toString()).toBe("ab");
  for (const value of ["YR==", "YWJ="]) expect(() => decodeCodexFileBase64(value, "file")).toThrow("canonical");
  for (const value of ["", "Y===", "YQ="]) expect(() => decodeCodexFileBase64(value, "file")).toThrow("valid base64");
});

test("Manual and shared payloads agree on bytes and reject mutated manifests before disk writes", async () => {
  const home = await mkdtemp(join(tmpdir(), "lane07-manual-"));
  const previous = process.env.CODEX_CHATGPT_WEB_HOME;
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  try {
    for (const mutation of [{ size: file.size + 1 }, { sha256: "0".repeat(64) }]) {
      const invalid = { ...prompt, files: [{ ...file, ...mutation }] };
      expect(() => prepareChatGptAttachments(invalid)).toThrow("verified manifest");
      await expect(materializeChatGptManualAttachments("trace_invalid", invalid)).rejects.toThrow("verified manifest");
      expect(await readdir(home)).toEqual([]);
    }
    const [prepared] = prepareChatGptAttachments(prompt);
    const [manual] = await materializeChatGptManualAttachments("trace_valid", prompt);
    expect((await readFile(manual!.path)).equals(prepared!.buffer)).toBe(true);
    expect(manual).toMatchObject({ name: prepared!.name, size: prepared!.size, sha256: prepared!.sha256 });
  } finally {
    if (previous === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});

test("mixed attachment count and total bytes are checked across kinds", () => {
  const images = Array.from({ length: 10 }, (_, i) => ({ ref: `codex-input-image-${i + 1}`, imageUrl: "data:image/png;base64,YQ==" }));
  expect(() => prepareChatGptAttachments({ ...prompt, images })).toThrow("10 attachments");
  const imageUrl = `data:image/png;base64,${Buffer.alloc(18_000_000, 97).toString("base64")}`;
  const bigFile = { ...resolveInlineCodexFile("large.txt", Buffer.alloc(18_000_000, 97).toString("base64")), ref: file.ref };
  expect(() => prepareChatGptAttachments({ text: "", images: images.slice(0, 2).map(image => ({ ...image, imageUrl })), files: [bigFile] })).toThrow("50 MB");
});

test("Manual rejects skill files before materializing them", async () => {
  await expect(materializeChatGptManualAttachments("trace_skill", { ...prompt, skillFiles: [{ name: "skill.txt", text: "content" }] })).rejects.toThrow("does not support skill");
});

test("portable core names and Electron lease names share separator and Unicode policy", async () => {
  const { createTaskArtifactDownloadGuard } = createRequire(import.meta.url)("../launcher/electron/task-artifact-download.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lane07-names-"));
  const guard = createTaskArtifactDownloadGuard(new EventEmitter());
  const input = { webContentsId: 42, traceId: "trace_names", assistantTurnId: "turn", taskDirectory: directory, partialPath: join(directory, ".file.partial") };
  try {
    for (const name of ["folder/report.txt", "folder\\report.txt", "folder／report.txt", "folder＼report.txt"]) {
      expect(() => sanitizeCodexFileName(name)).toThrow("plain filename");
      expect(() => guard.register({ ...input, expectedFilename: name })).toThrow("filename");
    }
    expect(sanitizeCodexFileName("  Отчёт.txt  ")).toBe("Отчёт.txt");
    const lease = guard.register({ ...input, expectedFilename: "  Отчёт.txt  " });
    const settled = lease.completion.catch(() => undefined);
    expect(guard.has(lease.leaseId)).toBe(true);
    guard.cancel(lease.leaseId);
    await settled;
  } finally { guard.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("guarded receipt mismatch reaches receipt validation and cleans the partial", async () => {
  const root = await mkdtemp(join(tmpdir(), "lane07-receipt-"));
  const directory = join(root, "artifacts", "trace_receipt");
  const partial = join(directory, ".receipt.partial");
  const stages: string[] = [];
  const card = { hover: async () => { stages.push("hover"); } };
  const control = { evaluate: async () => ({ label: "report.txt", depth: 1 }), locator: () => card, click: async () => { stages.push("click"); } };
  const controls = { filter: () => controls, count: async () => 1, nth: () => control };
  try {
    await expect(acquireChatGptResponseArtifacts(
      { url: () => "https://chatgpt.com/c/test" } as never,
      { getByRole: () => controls } as never,
      "trace_receipt", "turn", undefined,
      { taskDirectory: directory, networkGuard: {
        register: async () => { await writeFile(partial, "hello"); stages.push("written"); return { leaseId: `artifact_${"a".repeat(32)}` }; },
        wait: async () => {
          expect(await readFile(partial, "utf8")).toBe("hello");
          stages.push("receipt");
          return { leaseId: `artifact_${"a".repeat(32)}`, traceId: "wrong_trace", assistantTurnId: "turn", filename: "report.txt", partialPath: partial, receivedBytes: 5, downloadAuthority: "chatgpt.com" };
        },
        cancel: async () => { stages.push("cancel"); },
      } },
    )).rejects.toMatchObject({
      message: "ChatGPT artifact acquisition failed at promotion [artifact_promotion_failed]",
      cause: { message: "Launcher artifact receipt does not match the bound ChatGPT response download" },
    });
    expect(stages).toEqual(["hover", "written", "click", "receipt", "cancel"]);
    expect(await readdir(directory)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
