import { createHash } from "node:crypto";
import { parseDataUrl } from "../image";
import { CODEX_INPUT_FILES_MAX_COUNT as CHATGPT_MAX_INPUT_IMAGES, codexFileMimeType, decodeCodexFileBase64, sanitizeCodexFileName } from "../../responses/file-content";
import { chatGptWebInputImageExtension, validateChatGptWebInputImage } from "./input-image-validation";
import { ChatGptWebAdapterError } from "./adapter-error";
import { validateSkillFiles } from "./skill-attachments";
import type { ChatGptWebPromptImage, ChatGptWebPromptFile, CompiledChatGptWebPrompt } from "./prompt";

export function chatGptImageFilePayloads(images: ChatGptWebPromptImage[]): Array<{ name: string; mimeType: string; buffer: Buffer }> {
  if (images.length > CHATGPT_MAX_INPUT_IMAGES) {
    throw new Error(`ChatGPT web accepts at most ${CHATGPT_MAX_INPUT_IMAGES} input images per Codex turn`);
  }
  let totalBytes = 0;
  return images.map(image => {
    const invalid = validateChatGptWebInputImage(image.imageUrl);
    if (invalid) throw new Error(`ChatGPT web input image ${image.ref} ${invalid}`);
    const parsed = parseDataUrl(image.imageUrl)!;
    const extension = chatGptWebInputImageExtension(parsed.mediaType)!;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(parsed.base64) || parsed.base64.length % 4 !== 0) {
      throw new Error(`ChatGPT web input image ${image.ref} contains invalid base64 data`);
    }
    const buffer = Buffer.from(parsed.base64, "base64");
    if (buffer.length === 0) throw new Error(`ChatGPT web input image ${image.ref} is empty`);
    if (buffer.length > 20_000_000) throw new Error(`ChatGPT web input image ${image.ref} exceeds 20 MB`);
    totalBytes += buffer.length;
    if (totalBytes > 50_000_000) throw new Error("ChatGPT web input images exceed the 50 MB per-turn limit");
    return { name: `${image.ref}.${extension}`, mimeType: parsed.mediaType.toLowerCase(), buffer };
  });
}

export function chatGptDocumentFilePayloads(files: ChatGptWebPromptFile[]): Array<{ name: string; mimeType: string; buffer: Buffer }> {
  if (files.length > CHATGPT_MAX_INPUT_IMAGES) {
    throw new Error(`ChatGPT web accepts at most ${CHATGPT_MAX_INPUT_IMAGES} input files per Codex turn`);
  }
  const names = new Set<string>();
  const refs = new Set<string>();
  let totalBytes = 0;
  return files.map(file => {
    if (sanitizeCodexFileName(file.name) !== file.name
      || codexFileMimeType(file.name, file.mimeType) !== file.mimeType
      || !/^codex-input-file-[1-9][0-9]*$/.test(file.ref)
      || !/^[a-f0-9]{64}$/.test(file.sha256)
      || (file.source !== "inline" && file.source !== "authorized_file_id")
      || (file.fileId !== undefined && (file.source !== "authorized_file_id" || !file.fileId))) {
      throw new Error(`ChatGPT web input file ${JSON.stringify(file.name)} has an invalid verified manifest`);
    }
    if (names.has(file.name) || refs.has(file.ref)) {
      throw new Error(`ChatGPT web input file ${JSON.stringify(file.name)} has a duplicate filename or attachment reference`);
    }
    names.add(file.name);
    refs.add(file.ref);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64) || file.base64.length % 4 !== 0) {
      throw new Error(`ChatGPT web input file ${JSON.stringify(file.name)} contains invalid base64 data`);
    }
    const buffer = decodeCodexFileBase64(file.base64, `ChatGPT web input file ${JSON.stringify(file.name)}`);
    if (buffer.length !== file.size || buffer.length === 0 || buffer.length > 20_000_000) {
      throw new Error(`ChatGPT web input file ${JSON.stringify(file.name)} size does not match its verified manifest`);
    }
    if (createHash("sha256").update(buffer).digest("hex") !== file.sha256) {
      throw new Error(`ChatGPT web input file ${JSON.stringify(file.name)} bytes do not match its verified manifest`);
    }
    totalBytes += buffer.length;
    if (totalBytes > 50_000_000) throw new Error("ChatGPT web input files exceed the 50 MB per-turn limit");
    return { name: file.name, mimeType: file.mimeType, buffer };
  });
}

export function assertChatGptPromptAttachments(prompt: CompiledChatGptWebPrompt): void {
  if (prompt.images.length + (prompt.files?.length ?? 0) + (prompt.skillFiles?.length ?? 0) > CHATGPT_MAX_INPUT_IMAGES) {
    throw new ChatGptWebAdapterError(
      "Selected files, skills, and images exceed ChatGPT's 10 attachments per message; reduce attachments before retrying.",
      { status: 400, errorType: "invalid_request_error", code: "too_many_attachments", retryable: false },
    );
  }
  validateSkillFiles(prompt.skillFiles);
}

export function chatGptPromptFilePayloads(
  prompt: CompiledChatGptWebPrompt,
): Array<{ name: string; mimeType: string; buffer: Buffer }> {
  assertChatGptPromptAttachments(prompt);
  const files = [
    ...chatGptImageFilePayloads(prompt.images),
    ...chatGptDocumentFilePayloads(prompt.files ?? []),
    ...(prompt.skillFiles ?? []).map(file => ({
    name: file.name, mimeType: "text/plain", buffer: Buffer.from(file.text, "utf8"),
    })),
  ];
  if (files.reduce((sum, file) => sum + file.buffer.length, 0) > 50_000_000) {
    throw new Error("ChatGPT web attachments exceed the 50 MB per-turn limit");
  }
  return files;
}

/** Shared verified bytes; transport ownership and selected-skill authority stay with callers. */
export interface PreparedChatGptAttachment {
  name: string;
  mimeType: string;
  buffer: Buffer;
  size: number;
  sha256: string;
}

export function prepareChatGptAttachments(prompt: CompiledChatGptWebPrompt): PreparedChatGptAttachment[] {
  return chatGptPromptFilePayloads(prompt).map(payload => ({
    ...payload,
    size: payload.buffer.length,
    sha256: createHash("sha256").update(payload.buffer).digest("hex"),
  }));
}
