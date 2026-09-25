import { createHash } from "node:crypto";
import { extname } from "node:path";

export const CODEX_INPUT_FILE_MAX_BYTES = 20_000_000;
export const CODEX_INPUT_FILES_MAX_COUNT = 10;

export const SUPPORTED_CODEX_FILE_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export interface ResolvedCodexFile {
  name: string;
  mimeType: string;
  base64: string;
  size: number;
  sha256: string;
  source: "inline" | "authorized_file_id";
  fileId?: string;
}

export type CodexFileIdResolver = (fileId: string) => {
  name: string;
  mimeType?: string;
  data: Uint8Array;
} | undefined;

const EXTENSION_MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/plain",
  ".csv": "text/csv",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function sanitizeCodexFileName(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > 160 || /[\/\\]/.test(normalized)
    || /[\u0000-\u001f\u007f]/.test(normalized) || normalized === "." || normalized === "..") {
    throw new Error("input_file filename must be a plain filename of at most 160 characters");
  }
  return normalized;
}

export function codexFileMimeType(name: string, declared?: string): string {
  const normalized = declared?.split(";", 1)[0]?.trim().toLowerCase();
  const inferred = EXTENSION_MIME_TYPES[extname(name).toLowerCase()];
  const mimeType = normalized || inferred;
  if (!mimeType || !SUPPORTED_CODEX_FILE_MIME_TYPES.has(mimeType)) {
    throw new Error(`input_file ${JSON.stringify(name)} has an unsupported type; use PDF, CSV, text, PNG, JPEG, GIF, or WebP`);
  }
  if (inferred && inferred !== mimeType) {
    throw new Error(`input_file ${JSON.stringify(name)} type ${mimeType} conflicts with its filename`);
  }
  return mimeType;
}

export function decodeCodexFileBase64(value: string, label: string): Buffer {
  const compact = value.replace(/\s+/g, "");
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new Error(`${label} must contain valid base64 bytes`);
  }
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  const size = compact.length / 4 * 3 - padding;
  if (size > CODEX_INPUT_FILE_MAX_BYTES) {
    throw new Error(`${label} exceeds the 20 MB per-file limit`);
  }
  // Canonical padding requires the unused bits of the final sextet to be zero.
  // Check these directly, without allocating a second encoded copy of the bytes.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const last = alphabet.indexOf(compact[compact.length - padding - 1]!);
  if (size === 0 || (padding === 2 && (last & 15) !== 0) || (padding === 1 && (last & 3) !== 0)) {
    throw new Error(`${label} must contain canonical base64 bytes`);
  }
  return Buffer.from(compact, "base64");
}

function assertFileSignature(bytes: Uint8Array, mimeType: string, name: string): void {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const signatureMatches = mimeType === "application/pdf"
    ? starts(0x25, 0x50, 0x44, 0x46, 0x2d)
    : mimeType === "image/png"
    ? starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    : mimeType === "image/jpeg"
    ? starts(0xff, 0xd8, 0xff)
    : mimeType === "image/gif"
    ? Buffer.from(bytes.subarray(0, 6)).toString("ascii") === "GIF87a"
      || Buffer.from(bytes.subarray(0, 6)).toString("ascii") === "GIF89a"
    : mimeType === "image/webp"
    ? Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
      && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
    : !bytes.includes(0);
  if (!signatureMatches) throw new Error(`input_file ${JSON.stringify(name)} bytes do not match ${mimeType}`);
  if (mimeType.startsWith("text/")) {
    const decoded = Buffer.from(bytes).toString("utf8");
    if (Buffer.from(decoded, "utf8").compare(Buffer.from(bytes)) !== 0) {
      throw new Error(`input_file ${JSON.stringify(name)} must be valid UTF-8 text`);
    }
  }
}

function resolvedFile(
  nameValue: string,
  mimeTypeValue: string | undefined,
  bytes: Uint8Array,
  source: ResolvedCodexFile["source"],
  fileId?: string,
): ResolvedCodexFile {
  const name = sanitizeCodexFileName(nameValue);
  const mimeType = codexFileMimeType(name, mimeTypeValue);
  if (bytes.length === 0) throw new Error(`input_file ${JSON.stringify(name)} is empty`);
  if (bytes.length > CODEX_INPUT_FILE_MAX_BYTES) {
    throw new Error(`input_file ${JSON.stringify(name)} exceeds the 20 MB per-file limit`);
  }
  assertFileSignature(bytes, mimeType, name);
  return {
    name,
    mimeType,
    base64: Buffer.from(bytes).toString("base64"),
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    source,
    ...(fileId ? { fileId } : {}),
  };
}

export function resolveInlineCodexFile(filename: string | undefined, fileData: unknown): ResolvedCodexFile {
  if (typeof fileData !== "string") throw new Error("input_file.file_data must be a base64 string or base64 data URL");
  const dataUrl = /^data:([^;,]+);base64,(.*)$/s.exec(fileData);
  const declaredMimeType = dataUrl?.[1];
  const bytes = decodeCodexFileBase64(dataUrl?.[2] ?? fileData, "input_file.file_data");
  const inferredExtension = declaredMimeType
    ? Object.entries(EXTENSION_MIME_TYPES).find(([, mimeType]) => mimeType === declaredMimeType.toLowerCase())?.[0]
    : undefined;
  const name = filename ?? (inferredExtension ? `attachment${inferredExtension}` : "");
  if (!name) throw new Error("input_file with raw base64 file_data requires filename");
  return resolvedFile(name, declaredMimeType, bytes, "inline");
}

export function resolveCodexFileId(
  fileId: string,
  filename: string | undefined,
  resolver: CodexFileIdResolver | undefined,
): ResolvedCodexFile {
  if (!resolver) {
    throw new Error("input_file file_id is unresolved; file content was not sent. This route has no authorized file resolver.");
  }
  const resolved = resolver(fileId);
  if (!resolved) throw new Error(`input_file file_id ${JSON.stringify(fileId)} is not available from the authorized resolver`);
  if (filename && sanitizeCodexFileName(filename) !== sanitizeCodexFileName(resolved.name)) {
    throw new Error("input_file filename does not match the authorized file_id result");
  }
  return resolvedFile(resolved.name, resolved.mimeType, resolved.data, "authorized_file_id", fileId);
}
