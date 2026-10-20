import { inspectSelectedPdfBytes, SKILL_PACKAGE_LIMITS, type SkillResourceDocument, type SkillResourceDocumentIdentity } from "./skill-resources";

export interface SkillPdfProjection {
  state: "completed" | "failed" | "unknown" | "unavailable";
  sourceSha256: string; sourceBytes: number; coverage: "text-layer-only";
  extractor: { provider: "macos-pdfkit"; version: 1; executableSha256?: string; sourceSha256?: string };
  text?: string; pageCount?: number; pagesWithText?: number; pagesWithoutText?: number; reason?: string;
  owner?: { supervisor: { pid: number; start: string }; child: { pid: number; start: string } | null; sealed: boolean; reaped: boolean; reason: string | null };
}
const hash = /^[a-f0-9]{64}$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Only the immutable store supplies data. Neither paths nor raw PDF bytes are model arguments. */
export function selectedPdfBytes(resource: SkillResourceDocument): Buffer {
  if (resource.kind !== "document" || resource.format !== "pdf" || resource.mediaType !== "application/pdf"
    || resource.role !== "selected-skill-source-material" || !hash.test(resource.digest)
    || !Number.isSafeInteger(resource.bytes) || resource.bytes < 8 || resource.bytes > SKILL_PACKAGE_LIMITS.maxPdfBytes
    || typeof resource.data !== "string" || resource.data.length !== 4 * Math.ceil(resource.bytes / 3)) throw new Error("Selected PDF resource identity is invalid");
  const bytes = Buffer.from(resource.data, "base64");
  if (bytes.length !== resource.bytes || bytes.toString("base64") !== resource.data || inspectSelectedPdfBytes(bytes).digest !== resource.digest) throw new Error("Selected PDF resource bytes changed");
  return bytes;
}

export function unavailablePdfProjection(source: Pick<SkillResourceDocumentIdentity, "digest" | "bytes">, reason: string): SkillPdfProjection {
  return { state: "unavailable", sourceSha256: source.digest, sourceBytes: source.bytes, coverage: "text-layer-only",
    extractor: { provider: "macos-pdfkit", version: 1 }, reason };
}

/** Whitelist the trusted leaf receipt before UI/model delivery; no raw data, paths or diagnostics are copied. */
export function projectPdfExtraction(value: unknown, source: Pick<SkillResourceDocumentIdentity, "digest" | "bytes">): SkillPdfProjection {
  if (!record(value) || !["completed", "failed", "unknown", "unavailable"].includes(String(value.state))
    || value.sourceSha256 !== source.digest || value.sourceBytes !== source.bytes || value.coverage !== "text-layer-only"
    || !record(value.extractor) || value.extractor.provider !== "macos-pdfkit" || value.extractor.version !== 1) throw new Error("Selected PDF extraction receipt identity is invalid");
  const extractor: SkillPdfProjection["extractor"] = { provider: "macos-pdfkit", version: 1 };
  for (const field of ["executableSha256", "sourceSha256"] as const) {
    const pin = value.extractor[field];
    if (pin !== undefined) { if (typeof pin !== "string" || !hash.test(pin)) throw new Error("Selected PDF extractor pin is invalid"); extractor[field] = pin; }
  }
  const result: SkillPdfProjection = { state: value.state as SkillPdfProjection["state"], sourceSha256: source.digest, sourceBytes: source.bytes, coverage: "text-layer-only", extractor };
  for (const field of ["pageCount", "pagesWithText", "pagesWithoutText"] as const) {
    const count = value[field];
    if (count !== undefined) { if (!Number.isSafeInteger(count) || Number(count) < 0) throw new Error("Selected PDF extraction coverage is invalid"); result[field] = count as number; }
  }
  if (typeof value.reason === "string") {
    if (Buffer.byteLength(value.reason) > 512 || value.reason.includes("\0")) throw new Error("Selected PDF extraction reason exceeds bounds");
    result.reason = value.reason;
  }
  if (result.state === "completed") {
    if (typeof value.text !== "string" || !value.text.trim() || value.text.includes("\0")
      || Buffer.byteLength(value.text) > SKILL_PACKAGE_LIMITS.maxPdfTextBytes || Buffer.from(value.text).toString("utf8") !== value.text
      || !extractor.executableSha256 || !result.pageCount || result.pageCount > SKILL_PACKAGE_LIMITS.maxPdfPages
      || result.pagesWithText === undefined || result.pagesWithoutText === undefined || result.pagesWithText < 1
      || result.pagesWithText + result.pagesWithoutText !== result.pageCount) throw new Error("Selected PDF text or coverage exceeds supported bounds");
    result.text = value.text;
  }
  if (value.owner !== undefined) {
    const owner = value.owner;
    const identity = (candidate: unknown): candidate is { pid: number; start: string } => record(candidate)
      && Number.isSafeInteger(candidate.pid) && Number(candidate.pid) > 0 && typeof candidate.start === "string" && /^\d+:\d+$/.test(candidate.start);
    if (!record(owner) || !identity(owner.supervisor) || !(owner.child === null || identity(owner.child))
      || typeof owner.sealed !== "boolean" || typeof owner.reaped !== "boolean" || !(owner.reason === null || typeof owner.reason === "string" && owner.reason.length <= 512)
      || result.state === "completed" && (!owner.sealed || !owner.reaped)) throw new Error("Selected PDF owner receipt is invalid");
    result.owner = { supervisor: { ...owner.supervisor }, child: owner.child === null ? null : { ...owner.child }, sealed: owner.sealed, reaped: owner.reaped, reason: owner.reason as string | null };
  }
  return result;
}

