import { createHash } from "node:crypto";
import type { BrowserContext } from "playwright-core";
import { atomicWriteFile, type AppConfig } from "./config";
import { readBoundedUtf8File } from "./read-bounded-file";
import type { ChatGptWebAccountCapabilities } from "./chatgpt-web-models";

export type BrowserLoginStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

interface LoginVerificationMarker {
  version: number;
  authenticated: true;
  verifiedAt: string;
  storageStateBytes: number;
  storageStateSha256: string;
  solAvailable?: boolean;
  extraHighAvailable?: boolean;
  proAvailable?: boolean;
}

const MAX_LOGIN_STORAGE_STATE_BYTES = 16 * 1024 * 1024;
const MAX_LOGIN_MARKER_BYTES = 64 * 1024;

function readLoginStorageStateText(storageStatePath: string): string {
  const text = readBoundedUtf8File(storageStatePath, MAX_LOGIN_STORAGE_STATE_BYTES);
  const parsed = JSON.parse(text) as { cookies?: unknown; origins?: unknown };
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.cookies) || !Array.isArray(parsed.origins)) {
    throw new Error("ChatGPT login state is not a valid browser storage-state document");
  }
  return text;
}

function storageStateEvidence(text: string): Pick<LoginVerificationMarker, "storageStateBytes" | "storageStateSha256"> {
  return {
    storageStateBytes: Buffer.byteLength(text, "utf8"),
    storageStateSha256: createHash("sha256").update(text, "utf8").digest("hex"),
  };
}

function readLoginVerificationMarker(storageStatePath: string): Partial<LoginVerificationMarker> {
  return JSON.parse(readBoundedUtf8File(
    loginVerificationMarkerPath(storageStatePath),
    MAX_LOGIN_MARKER_BYTES,
  )) as Partial<LoginVerificationMarker>;
}

export function loginVerificationMarkerPath(storageStatePath: string): string {
  return `${storageStatePath}.verified.json`;
}

/** Compatibility writer for callers that persist already-verified state synchronously. */
export function writeBrowserLoginVerificationMarker(
  storageStatePath: string,
  capabilities: ChatGptWebAccountCapabilities,
): void {
  publishBrowserLoginVerification(storageStatePath, capabilities, readLoginStorageStateText(storageStatePath));
}

/** Explicit evidence-bearing writer: never hashes a later destination as verified evidence. */
export function publishBrowserLoginVerification(
  storageStatePath: string,
  capabilities: ChatGptWebAccountCapabilities,
  verifiedStateText: string,
): void {
  if (readLoginStorageStateText(storageStatePath) !== verifiedStateText) {
    throw new Error("ChatGPT login state changed during verification");
  }
  const marker: LoginVerificationMarker = {
    version: 2,
    authenticated: true,
    verifiedAt: new Date().toISOString(),
    ...storageStateEvidence(verifiedStateText),
    solAvailable: capabilities.solAvailable,
    extraHighAvailable: capabilities.extraHighAvailable,
    proAvailable: capabilities.proAvailable,
  };
  atomicWriteFile(loginVerificationMarkerPath(storageStatePath), `${JSON.stringify(marker)}\n`);
}

export function storedBrowserLoginCapabilities(
  config: Pick<AppConfig, "storageStatePath">,
): Partial<ChatGptWebAccountCapabilities> {
  try {
    const text = readLoginStorageStateText(config.storageStatePath);
    const marker = readLoginVerificationMarker(config.storageStatePath);
    if (!markerMatchesSnapshot(marker, text)) return {};
    for (const field of ["solAvailable", "extraHighAvailable", "proAvailable"] as const) {
      if (marker[field] !== undefined && typeof marker[field] !== "boolean") return {};
    }
    if ((marker.extraHighAvailable === true || marker.proAvailable === true) && marker.solAvailable === false) return {};
    if (marker.proAvailable === true && marker.extraHighAvailable === false) return {};
    return {
      ...(typeof marker.solAvailable === "boolean" ? { solAvailable: marker.solAvailable } : {}),
      ...(typeof marker.extraHighAvailable === "boolean"
        ? { extraHighAvailable: marker.extraHighAvailable }
        : marker.proAvailable === true ? { extraHighAvailable: true } : {}),
      ...(typeof marker.proAvailable === "boolean" ? { proAvailable: marker.proAvailable } : {}),
    };
  } catch {
    return {};
  }
}

function authenticatedMarker(marker: Partial<LoginVerificationMarker>): boolean {
  return marker?.authenticated === true && typeof marker.verifiedAt === "string"
    && Number.isFinite(Date.parse(marker.verifiedAt));
}
function markerMatchesSnapshot(marker: Partial<LoginVerificationMarker>, text: string): boolean {
  const evidence = storageStateEvidence(text);
  return authenticatedMarker(marker) && marker.version === 2
    && marker.storageStateBytes === evidence.storageStateBytes
    && marker.storageStateSha256 === evidence.storageStateSha256;
}
export function browserLoginStateExists(config: Pick<AppConfig, "storageStatePath">): boolean {
  try {
    const text = readLoginStorageStateText(config.storageStatePath);
    return markerMatchesSnapshot(readLoginVerificationMarker(config.storageStatePath), text);
  } catch { return false; }
}

/** Version-1 authenticated markers may be upgraded only by a fresh live account inspection. */
export function browserLoginStateNeedsReverification(config: Pick<AppConfig, "storageStatePath">): boolean {
  try {
    readLoginStorageStateText(config.storageStatePath);
    const marker = readLoginVerificationMarker(config.storageStatePath);
    return authenticatedMarker(marker) && marker.version === 1;
  } catch { return false; }
}

/** Verify a single bounded snapshot and bind the published evidence to those exact bytes. */
export async function verifyBrowserLoginSnapshot(
  storageStatePath: string,
  inspect: (state: BrowserLoginStorageState) => Promise<ChatGptWebAccountCapabilities>,
): Promise<ChatGptWebAccountCapabilities> {
  const text = readLoginStorageStateText(storageStatePath);
  let eligible = false;
  try {
    const marker = readLoginVerificationMarker(storageStatePath);
    eligible = markerMatchesSnapshot(marker, text) || (authenticatedMarker(marker) && marker.version === 1);
  } catch { /* Missing or malformed evidence cannot enter the live verifier. */ }
  if (!eligible) throw new Error("ChatGPT login state is missing or cannot be safely reverified");
  // The publication comparison is not an atomic CAS; later replacements fail the digest check.
  const result = await inspect(JSON.parse(text) as BrowserLoginStorageState);
  publishBrowserLoginVerification(storageStatePath, result, text);
  return result;
}
