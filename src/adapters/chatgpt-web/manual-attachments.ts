import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getConfigDir } from "../../config";
import { parseDataUrl } from "../image";
import { chatGptWebInputImageExtension, validateChatGptWebInputImage } from "./input-image-validation";
import type { CompiledChatGptWebPrompt } from "./prompt";

export interface ChatGptManualAttachment {
  name: string;
  path: string;
  mimeType: string;
  size: number;
  sha256: string;
}

export async function materializeChatGptManualAttachments(
  traceId: string,
  prompt: CompiledChatGptWebPrompt,
): Promise<ChatGptManualAttachment[]> {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(traceId)) throw new Error("Manual attachment trace identity is invalid");
  const payloads = [
    ...prompt.images.map(image => {
      const invalid = validateChatGptWebInputImage(image.imageUrl);
      if (invalid) throw new Error(`Manual input image ${image.ref} ${invalid}`);
      const parsed = parseDataUrl(image.imageUrl)!;
      return {
        name: `${image.ref}.${chatGptWebInputImageExtension(parsed.mediaType)!}`,
        mimeType: parsed.mediaType.toLowerCase(),
        bytes: Buffer.from(parsed.base64, "base64"),
      };
    }),
    ...(prompt.files ?? []).map(file => ({
      name: file.name,
      mimeType: file.mimeType,
      bytes: Buffer.from(file.base64, "base64"),
    })),
    ...(prompt.skillFiles ?? []).map(file => ({
      name: file.name,
      mimeType: "text/plain",
      bytes: Buffer.from(file.text, "utf8"),
    })),
  ];
  if (payloads.length > 10) throw new Error("Manual mode supports at most 10 attachments per message");
  const total = payloads.reduce((sum, payload) => sum + payload.bytes.length, 0);
  if (total > 50_000_000) throw new Error("Manual mode attachments exceed the 50 MB per-turn limit");
  const directory = join(getConfigDir(), "manual-attachments", traceId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const out: ChatGptManualAttachment[] = [];
  for (const payload of payloads) {
    const sha256 = createHash("sha256").update(payload.bytes).digest("hex");
    const path = join(directory, payload.name);
    if (existsSync(path)) {
      const existing = await readFile(path);
      if (createHash("sha256").update(existing).digest("hex") !== sha256) {
        throw new Error(`Manual attachment path already contains different bytes: ${path}`);
      }
    } else {
      await writeFile(path, payload.bytes, { mode: 0o600, flag: "wx" });
    }
    out.push({ name: payload.name, path, mimeType: payload.mimeType, size: payload.bytes.length, sha256 });
  }
  return out;
}

export function chatGptManualAttachmentInstructions(files: readonly ChatGptManualAttachment[]): string {
  if (files.length === 0) return "No files need to be attached for this turn.";
  return [
    "Attach every local file below to the same ChatGPT composer before confirming Sent. Verify that ChatGPT shows each exact filename; the Manual bridge cannot confirm attachment pills itself.",
    ...files.map(file => `- ${file.name}: ${file.path} (${file.mimeType}, ${file.size} bytes, SHA-256 ${file.sha256})`),
    "If any file is missing or rejected, mark the Manual turn failed instead of sending or confirming it.",
  ].join("\n");
}
