import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const OUTPUT_MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/plain",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".zip": "application/zip",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".xls": "application/vnd.ms-excel",
};

function findZipEndOfCentralDirectory(bytes: Buffer): number {
  const first = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= first; offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function validateZipEntryName(raw: Buffer): string {
  let name: string;
  try {
    name = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw new Error("ZIP artifact contains a non-UTF-8 entry name");
  }
  if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/")
    || /^[A-Za-z]:/.test(name) || name.split("/").some(part => part === ".." || part === ".")) {
    throw new Error(`ZIP artifact contains an unsafe entry name: ${JSON.stringify(name)}`);
  }
  return name;
}

/** Structural validation only. Archives remain inert and are never extracted. */
export function validateChatGptZipContainer(bytes: Buffer, extension: string): void {
  const eocd = findZipEndOfCentralDirectory(bytes);
  if (eocd < 0 || eocd + 22 > bytes.length) throw new Error("ZIP artifact has no bounded end-of-central-directory record");
  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocd + 8);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  const commentLength = bytes.readUInt16LE(eocd + 20);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount || entryCount > 10_000
    || centralOffset + centralSize !== eocd || eocd + 22 + commentLength !== bytes.length) {
    throw new Error("ZIP artifact uses an unsupported multi-disk, ZIP64, excessive, or inconsistent directory");
  }

  const names = new Set<string>();
  let offset = centralOffset;
  let expandedBytes = 0;
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > eocd || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("ZIP artifact central directory is malformed");
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const entryCommentLength = bytes.readUInt16LE(offset + 32);
    const externalAttributes = bytes.readUInt32LE(offset + 38);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + entryCommentLength;
    const unixType = (externalAttributes >>> 16) & 0xf000;
    if (flags & 0x1 || unixType === 0xa000 || ![0, 8].includes(method) || next > eocd
      || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff
      || localOffset + 30 > centralOffset || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("ZIP artifact contains encrypted, unsupported, ZIP64, or malformed entries");
    }
    const name = validateZipEntryName(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const localDataStart = localNameStart + localNameLength + localExtraLength;
    if (localDataStart + compressedSize > centralOffset
      || !bytes.subarray(localNameStart, localNameStart + localNameLength)
        .equals(bytes.subarray(offset + 46, offset + 46 + nameLength))) {
      throw new Error("ZIP artifact local entry does not match its central directory");
    }
    if (names.has(name)) throw new Error(`ZIP artifact contains duplicate entry ${JSON.stringify(name)}`);
    names.add(name);
    expandedBytes += uncompressedSize;
    if (expandedBytes > 500_000_000 || (compressedSize > 0 && uncompressedSize / compressedSize > 200)) {
      throw new Error("ZIP artifact declares an excessive expanded size or compression ratio");
    }
    offset = next;
  }
  if (offset !== eocd) throw new Error("ZIP artifact central directory length is inconsistent");

  const required = extension === ".xlsx"
    ? ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"]
    : extension === ".docx"
    ? ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]
    : extension === ".pptx"
    ? ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml"]
    : extension === ".ods"
    ? ["mimetype", "content.xml"]
    : [];
  if (required.some(name => !names.has(name))) {
    throw new Error(`${extension} artifact is missing required Office container entries`);
  }
}

export async function artifactMimeType(name: string, path: string, firstBytes: Uint8Array): Promise<string> {
  const extension = extname(name).toLowerCase();
  const mimeType = OUTPUT_MIME_TYPES[extension];
  if (!mimeType) throw new Error(`Downloaded ChatGPT artifact ${JSON.stringify(name)} has an unsupported output type`);
  const bytes = Buffer.from(firstBytes);
  const matches = mimeType === "application/pdf" ? bytes.subarray(0, 5).toString("ascii") === "%PDF-"
    : mimeType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : mimeType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mimeType === "image/gif" ? ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
    : mimeType === "image/webp" ? bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP"
    : mimeType === "application/vnd.ms-excel" ? bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    : mimeType === "application/zip" || [".xlsx", ".docx", ".pptx", ".ods"].includes(extension)
    ? bytes.length >= 4 && [0x04034b50, 0x06054b50].includes(bytes.readUInt32LE(0))
    : !bytes.includes(0);
  if (!matches) throw new Error(`Downloaded ChatGPT artifact ${JSON.stringify(name)} bytes do not match ${mimeType}`);
  if (extension === ".json") {
    try { JSON.parse(await readFile(path, "utf8")); }
    catch { throw new Error(`Downloaded ChatGPT artifact ${JSON.stringify(name)} is not valid JSON`); }
  }
  if ([".zip", ".xlsx", ".docx", ".pptx", ".ods"].includes(extension)) {
    validateChatGptZipContainer(await readFile(path), extension);
  }
  return mimeType;
}
