import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateChatGptWebInputImage } from "../src/adapters/chatgpt-web/input-image-validation";
import { materializeChatGptManualAttachments } from "../src/adapters/chatgpt-web/manual-attachments";
import { chatGptImageFilePayloads } from "../src/adapters/chatgpt-web/browser-worker";

const url = (base64: string) => `data:image/png;base64,${base64}`;

test("image preflight enforces transport encoding, MIME and exact decoded-size bounds", () => {
  expect(validateChatGptWebInputImage("https://example.com/a.png")).toContain("inline base64");
  expect(validateChatGptWebInputImage("data:image/bmp;base64,YQ==")).toContain("unsupported media type");
  expect(validateChatGptWebInputImage(url(""))).toBe("is empty");
  for (const invalid of ["!!!!", "YQ=", "YQ===", "Y Q==", "=AAA"]) {
    expect(validateChatGptWebInputImage(url(invalid))).toContain("invalid base64");
  }
  const imageUrl = "data:IMAGE/PNG;base64,iVBORw0KGgo=";
  expect(validateChatGptWebInputImage(imageUrl)).toBeNull();
  expect(chatGptImageFilePayloads([{ ref: "codex-input-image-1", imageUrl }])[0]!.buffer)
    .toEqual(Buffer.from("iVBORw0KGgo=", "base64"));
  // These share the same encoded length: padding decides whether the payload is over the limit.
  expect(validateChatGptWebInputImage(url(Buffer.alloc(20_000_000).toString("base64")))).toBeNull();
  expect(validateChatGptWebInputImage(url(Buffer.alloc(20_000_001).toString("base64")))).toBe("exceeds 20 MB");
  expect(validateChatGptWebInputImage(url("A".repeat(26_666_672)))).toBe("exceeds 20 MB");
});

test("Manual image rejection happens before attachment directories are created", async () => {
  const root = await mkdtemp(join(tmpdir(), "nekodex-image-preflight-"));
  const previous = process.env.CODEX_CHATGPT_WEB_HOME;
  process.env.CODEX_CHATGPT_WEB_HOME = root;
  try {
    for (const base64 of ["", "!!!!", "YQ="]) {
      await expect(materializeChatGptManualAttachments("image-test", {
        text: "", images: [{ ref: "codex-input-image-1", imageUrl: url(base64) }],
      })).rejects.toThrow();
    }
    expect(await readdir(root)).toEqual([]);
  } finally {
    if (previous === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});
