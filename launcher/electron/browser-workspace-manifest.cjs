const fs = require("node:fs");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");

const VERSION = 1;
const MAX_WORKSPACES = 16;
const MAX_LOCATION_LENGTH = 2_048;
const CHATGPT_ORIGIN = "https://chatgpt.com";
const BLOCKED_PATH = /^\/(?:auth|login|logout|sign-in|signin|sign-up|signup|api\/auth)(?:\/|$)/i;
const PRINCIPAL_FINGERPRINT = /^[a-f0-9]{64}$/;

function text(value, maximum = 128) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;
}

function finite(value, fallback, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value)))
    : fallback;
}

function isTemporaryChat(value) {
  try {
    const location = new URL(value);
    return location.searchParams.get("temporary-chat") === "true"
      || /^\/temporary-chat(?:\/|$)/i.test(location.pathname);
  } catch {
    return false;
  }
}

function safeWorkspaceLocation(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LOCATION_LENGTH) return null;
  try {
    const location = new URL(value);
    if (location.origin !== CHATGPT_ORIGIN || location.username || location.password
      || BLOCKED_PATH.test(location.pathname) || isTemporaryChat(location.href)) return null;
    location.hash = "";
    location.search = "";
    return location.href.length <= MAX_LOCATION_LENGTH ? location.href : null;
  } catch {
    return null;
  }
}

function normalizeBounds(value) {
  if (!value || typeof value !== "object") return null;
  const width = finite(value.width, 1_100, 480, 16_384);
  const height = finite(value.height, 800, 360, 16_384);
  const bounds = { width, height };
  if (Number.isFinite(value.x) && Number.isFinite(value.y)) {
    bounds.x = finite(value.x, 0, -32_768, 32_768);
    bounds.y = finite(value.y, 0, -32_768, 32_768);
  }
  return bounds;
}

function normalizeEntry(value) {
  if (!value || typeof value !== "object") return null;
  const id = text(value.id);
  const groupId = text(value.groupId);
  if (!id || !groupId) return null;
  const location = safeWorkspaceLocation(value.location);
  const unsupportedTemporary = value.restore === "unsupported-temporary";
  if (!location && !unsupportedTemporary) return null;
  return {
    id,
    groupId,
    location,
    restore: unsupportedTemporary ? "unsupported-temporary" : "supported",
    principalFingerprint: typeof value.principalFingerprint === "string"
      && PRINCIPAL_FINGERPRINT.test(value.principalFingerprint) ? value.principalFingerprint : null,
    bounds: normalizeBounds(value.bounds),
    maximized: value.maximized === true,
    fullscreen: value.fullscreen === true,
    lastActiveAt: Number.isFinite(value.lastActiveAt) && value.lastActiveAt > 0
      ? Math.round(value.lastActiveAt) : 0,
  };
}

function normalizeManifest(value, accountId) {
  const expectedAccount = text(accountId);
  if (!expectedAccount || !value || typeof value !== "object" || value.version !== VERSION
    || value.accountId !== expectedAccount || !Array.isArray(value.entries)) {
    return { version: VERSION, accountId: expectedAccount, entries: [] };
  }
  const seen = new Set();
  const entries = [];
  for (const candidate of value.entries) {
    const entry = normalizeEntry(candidate);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
    if (entries.length === MAX_WORKSPACES) break;
  }
  entries.sort((left, right) => left.lastActiveAt - right.lastActiveAt);
  return { version: VERSION, accountId: expectedAccount, entries };
}

class BrowserWorkspaceManifest {
  constructor(filePath, accountId) {
    this.filePath = filePath;
    this.accountId = accountId;
    this.lastReadStatus = "unread";
  }

  read() {
    if (!this.filePath) {
      this.lastReadStatus = "disabled";
      return normalizeManifest(null, this.accountId);
    }
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      const manifest = normalizeManifest(value, this.accountId);
      this.lastReadStatus = value?.version === VERSION && value?.accountId === this.accountId
        ? "ready" : "rejected";
      return manifest;
    } catch (error) {
      this.lastReadStatus = error?.code === "ENOENT" ? "missing" : "corrupt";
      return normalizeManifest(null, this.accountId);
    }
  }

  write(entries) {
    const manifest = normalizeManifest({ version: VERSION, accountId: this.accountId, entries }, this.accountId);
    if (this.filePath) {
      writePrivateFileAtomic(this.filePath, `${JSON.stringify(manifest, null, 2)}\n`, { durable: true });
      this.lastReadStatus = "ready";
    }
    return manifest;
  }
}

module.exports = {
  BrowserWorkspaceManifest,
  CHATGPT_ORIGIN,
  MAX_WORKSPACES,
  VERSION,
  isTemporaryChat,
  normalizeBounds,
  normalizeManifest,
  safeWorkspaceLocation,
};
