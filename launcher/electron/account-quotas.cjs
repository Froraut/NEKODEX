const { validateAccountId } = require("./account-registry.cjs");

const CHATGPT_ORIGIN = "https://chatgpt.com";
const SESSION_URL = `${CHATGPT_ORIGIN}/api/auth/session`;
const CODEX_USAGE_URL = `${CHATGPT_ORIGIN}/backend-api/wham/usage`;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_SUCCESS_TTL_MS = 60_000;
const DEFAULT_FAILURE_TTL_MS = 15_000;
const DEFAULT_MIN_REFRESH_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RETRY_AFTER_MS = 5 * 60 * 1_000;
const MAX_ACCESS_TOKEN_BYTES = 64 * 1024;
const MAX_ACCOUNT_ID_LENGTH = 256;
const MAX_ADDITIONAL_BUCKETS = 32;
const MAX_BUCKET_ID_LENGTH = 160;
const MAX_BUCKET_LABEL_LENGTH = 160;
const MAX_JS_DATE_MILLISECONDS = 8_640_000_000_000_000;

class QuotaReadError extends Error {
  constructor(code) {
    super(code);
    this.name = "QuotaReadError";
    this.code = code;
  }
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function requireEvidenceEpoch(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("evidenceEpoch must be a non-negative safe integer");
  }
  return value;
}

function cloneResult(value) {
  return JSON.parse(JSON.stringify(value));
}

function projectFreshness(value, now) {
  const result = cloneResult(value);
  if (result.availability !== "available") return result;
  const freshUntil = typeof result.freshUntil === "string" ? Date.parse(result.freshUntil) : Number.NaN;
  result.freshness = result.refreshError === null && Number.isFinite(freshUntil) && now < freshUntil
    ? "fresh" : "stale";
  return result;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanFiniteNumber(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value)
    && value >= minimum && value <= maximum ? value : null;
}

function cleanUnixTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) return null;
  const milliseconds = value * 1_000;
  return Number.isFinite(milliseconds) && milliseconds <= MAX_JS_DATE_MILLISECONDS
    && !Number.isNaN(new Date(milliseconds).getTime()) ? value : null;
}

function cleanBoundedString(value, maximumLength, { required = false } = {}) {
  if (typeof value !== "string" || value.length > maximumLength
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)
    || (required && !value)) return null;
  return value || null;
}

function cleanWindow(value) {
  const window = isPlainObject(value) ? value : {};
  const usedPercent = cleanFiniteNumber(window.used_percent, 0, 100);
  const durationSeconds = cleanFiniteNumber(window.limit_window_seconds, 1, Number.MAX_SAFE_INTEGER);
  return {
    usedPercent,
    remainingPercent: usedPercent === null ? null : Math.max(0, 100 - usedPercent),
    windowDurationMins: durationSeconds === null ? null : Math.ceil(durationSeconds / 60),
    resetsAt: cleanUnixTimestamp(window.reset_at),
  };
}

function cleanBucket(rateLimit, id, name = null, normalModelSlug = null) {
  const details = isPlainObject(rateLimit) ? rateLimit : null;
  return {
    id,
    name,
    normalModelSlug,
    allowed: details && typeof details.allowed === "boolean" ? details.allowed : null,
    limitReached: details && typeof details.limit_reached === "boolean"
      ? details.limit_reached : null,
    primary: cleanWindow(details?.primary_window),
    secondary: cleanWindow(details?.secondary_window),
  };
}

function cleanAdditionalBuckets(value) {
  if (!Array.isArray(value)) return { buckets: [], truncated: false };
  const buckets = [];
  const ids = new Set();
  for (const candidate of value) {
    if (!isPlainObject(candidate)) continue;
    const id = cleanBoundedString(candidate.metered_feature, MAX_BUCKET_ID_LENGTH, { required: true });
    if (id === null || ids.has(id)) continue;
    ids.add(id);
    // Keep scanning malformed and duplicate trailing entries: truncation means
    // that a real unique bucket was omitted, not merely that the raw array was long.
    if (buckets.length >= MAX_ADDITIONAL_BUCKETS) {
      return { buckets, truncated: true };
    }
    buckets.push(cleanBucket(
      candidate.rate_limit,
      id,
      cleanBoundedString(candidate.limit_name, MAX_BUCKET_LABEL_LENGTH),
      cleanBoundedString(candidate.normal_model_slug, MAX_BUCKET_ID_LENGTH),
    ));
  }
  return { buckets, truncated: false };
}

function normalizeUsage(payload, localAccountId, tokenAccountId, fetchedAt) {
  if (!isPlainObject(payload)) throw new QuotaReadError("invalid_response");
  if (payload.account_id !== undefined
    && (typeof payload.account_id !== "string" || payload.account_id !== tokenAccountId)) {
    throw new QuotaReadError("account_mismatch");
  }
  const additional = cleanAdditionalBuckets(payload.additional_rate_limits);
  const planType = cleanBoundedString(payload.plan_type, 80);
  return {
    availability: "available",
    coverage: "reported_buckets",
    accountId: localAccountId,
    fetchedAt,
    planType,
    accountBucket: cleanBucket(payload.rate_limit, "codex"),
    additionalBuckets: additional.buckets,
    additionalBucketsTruncated: additional.truncated,
  };
}

function unavailable(accountId, reason, checkedAt, retryAt = null) {
  return {
    availability: "unavailable",
    coverage: "none",
    freshness: "stale",
    freshUntil: null,
    refreshError: reason,
    accountId,
    checkedAt,
    reason,
    retryAt,
    planType: null,
    accountBucket: cleanBucket(null, "codex"),
    additionalBuckets: [],
    additionalBucketsTruncated: false,
  };
}

function exactResponse(response, expectedUrl) {
  // Electron Session.fetch constructs a GlobalResponse with an empty URL (documented
  // limitation). Reject redirects in the transport below; never manufacture a final URL.
  // A nonempty mismatched URL still indicates an unexpected response and is rejected.
  return response.redirected !== true && (response.url === "" || response.url === expectedUrl)
    && (response.status < 300 || response.status >= 400);
}

function isJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  return /(?:^|\s|;)application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|\s*$)/i.test(contentType);
}

async function readBoundedJson(response, maximumBytes) {
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader !== null) {
    const length = Number(lengthHeader);
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
      throw new QuotaReadError("response_too_large");
    }
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new QuotaReadError("invalid_response");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new QuotaReadError("invalid_response");
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new QuotaReadError("response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new QuotaReadError("invalid_response"); }
  try { return JSON.parse(text); }
  catch { throw new QuotaReadError("invalid_response"); }
}

function jwtPayload(accessToken) {
  if (typeof accessToken !== "string" || !accessToken
    || Buffer.byteLength(accessToken, "utf8") > MAX_ACCESS_TOKEN_BYTES) {
    throw new QuotaReadError("unsupported_session");
  }
  const parts = accessToken.split(".");
  if (parts.length !== 3 || !parts[1] || !/^[A-Za-z0-9_-]+$/.test(parts[1])) {
    throw new QuotaReadError("unsupported_session");
  }
  let decoded;
  try {
    decoded = Buffer.from(parts[1], "base64url");
    if (decoded.byteLength > MAX_ACCESS_TOKEN_BYTES) throw new Error("oversized JWT payload");
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
  } catch {
    throw new QuotaReadError("unsupported_session");
  }
  if (!isPlainObject(decoded)) throw new QuotaReadError("unsupported_session");
  if (decoded.exp !== undefined
    && (!Number.isFinite(decoded.exp) || decoded.exp * 1_000 <= Date.now())) {
    throw new QuotaReadError("session_expired");
  }
  return decoded;
}

function tokenAccountId(accessToken) {
  const payload = jwtPayload(accessToken);
  const auth = payload["https://api.openai.com/auth"];
  const accountId = isPlainObject(auth) ? auth.chatgpt_account_id : null;
  if (typeof accountId !== "string" || !accountId || accountId.trim() !== accountId
    || accountId.length > MAX_ACCOUNT_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(accountId)) {
    throw new QuotaReadError("unsupported_session");
  }
  return accountId;
}

function retryAfterTimestamp(response, now) {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isSafeInteger(seconds) ? now + Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS) : null;
  }
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) && timestamp > now
    ? Math.min(timestamp, now + MAX_RETRY_AFTER_MS) : null;
}

function operationalReason(error) {
  if (error instanceof QuotaReadError) return error.code;
  if (error && typeof error === "object" && error.name === "AbortError") return "timeout";
  return "request_failed";
}

class AccountQuotaReader {
  constructor({
    timeoutMs = DEFAULT_TIMEOUT_MS,
    successTtlMs = DEFAULT_SUCCESS_TTL_MS,
    failureTtlMs = DEFAULT_FAILURE_TTL_MS,
    minRefreshMs = DEFAULT_MIN_REFRESH_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    now = Date.now,
  } = {}) {
    this.timeoutMs = requirePositiveInteger(timeoutMs, "timeoutMs");
    this.successTtlMs = requirePositiveInteger(successTtlMs, "successTtlMs");
    this.failureTtlMs = requirePositiveInteger(failureTtlMs, "failureTtlMs");
    this.minRefreshMs = requirePositiveInteger(minRefreshMs, "minRefreshMs");
    this.maxResponseBytes = requirePositiveInteger(maxResponseBytes, "maxResponseBytes");
    if (this.maxResponseBytes > DEFAULT_MAX_RESPONSE_BYTES) {
      throw new TypeError("maxResponseBytes cannot exceed 256 KiB");
    }
    if (typeof now !== "function") throw new TypeError("now must be a function");
    this.now = now;
    this.accounts = new Map();
  }

  clear(accountId) {
    validateAccountId(accountId);
    const current = this.accounts.get(accountId);
    this.accounts.delete(accountId);
    current?.controller?.abort();
  }

  snapshot(electronSession, accountId, evidenceEpoch) {
    validateAccountId(accountId);
    if (!electronSession || typeof electronSession.fetch !== "function") {
      throw new TypeError("An Electron Session with fetch support is required");
    }
    requireEvidenceEpoch(evidenceEpoch);
    const current = this.accounts.get(accountId);
    return current?.session === electronSession && current.evidenceEpoch === evidenceEpoch
      && current.result ? projectFreshness(current.result, this.now()) : null;
  }

  async read(electronSession, accountId, evidenceEpoch, { refresh = false } = {}) {
    validateAccountId(accountId);
    if (!electronSession || typeof electronSession.fetch !== "function") {
      throw new TypeError("An Electron Session with fetch support is required");
    }
    requireEvidenceEpoch(evidenceEpoch);
    if (typeof refresh !== "boolean") throw new TypeError("refresh must be a boolean");

    const now = this.now();
    const current = this.accounts.get(accountId);
    const sameOwner = current?.session === electronSession && current.evidenceEpoch === evidenceEpoch;
    if (sameOwner && current.inflight) return cloneResult(await current.inflight);
    if (sameOwner && current.result
      && (!refresh || now < current.nextRefreshAt)
      && now < current.expiresAt) {
      return projectFreshness(current.result, now);
    }
    if (sameOwner && current.result && refresh && now < current.nextRefreshAt) {
      return projectFreshness(current.result, now);
    }

    if (current && !sameOwner) current.controller?.abort();
    const state = sameOwner ? current : {
      session: electronSession,
      evidenceEpoch,
      result: null,
      expiresAt: 0,
      nextRefreshAt: 0,
      inflight: null,
      controller: null,
    };
    state.nextRefreshAt = now + this.minRefreshMs;
    state.controller = new AbortController();
    state.inflight = this.#readLive(electronSession, accountId, state.controller).then(({ result, retryAt }) => {
      if (this.accounts.get(accountId) !== state
        || state.session !== electronSession || state.evidenceEpoch !== evidenceEpoch) {
        return unavailable(accountId, "stale_read", new Date(this.now()).toISOString());
      }
      const completedAt = this.now();
      if (result.availability === "available") {
        state.result = {
          ...result,
          freshness: "fresh",
          freshUntil: new Date(completedAt + this.successTtlMs).toISOString(),
          refreshError: null,
        };
      } else if (state.result?.availability === "available") {
        // The same browser session and evidence epoch still own these values. Preserve their
        // observation time, but expose the failed refresh and never call them current.
        state.result = {
          ...state.result,
          freshness: "stale",
          checkedAt: result.checkedAt,
          retryAt: result.retryAt ?? null,
          refreshError: result.reason ?? "request_failed",
        };
      } else {
        state.result = result;
      }
      state.expiresAt = completedAt + (result.availability === "available"
        ? this.successTtlMs : this.failureTtlMs);
      if (retryAt !== null) {
        state.nextRefreshAt = Math.max(state.nextRefreshAt, retryAt);
        state.expiresAt = Math.max(state.expiresAt, retryAt);
      }
      return state.result;
    }).finally(() => {
      state.inflight = null;
      state.controller = null;
    });
    this.accounts.set(accountId, state);
    return cloneResult(await state.inflight);
  }

  async #readLive(electronSession, accountId, controller) {
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let retryAt = null;
    try {
      const sessionResponse = await electronSession.fetch(SESSION_URL, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        bypassCustomProtocolHandlers: true,
        referrerPolicy: "no-referrer",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!exactResponse(sessionResponse, SESSION_URL)) throw new QuotaReadError("redirected");
      if (sessionResponse.status === 401) throw new QuotaReadError("signed_out");
      if (!sessionResponse.ok || !isJsonResponse(sessionResponse)) {
        throw new QuotaReadError("session_unavailable");
      }
      const sessionPayload = await readBoundedJson(sessionResponse, this.maxResponseBytes);
      if (!isPlainObject(sessionPayload)) throw new QuotaReadError("unsupported_session");
      const accessToken = sessionPayload.accessToken;
      const remoteAccountId = tokenAccountId(accessToken);

      const usageResponse = await electronSession.fetch(CODEX_USAGE_URL, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        bypassCustomProtocolHandlers: true,
        referrerPolicy: "no-referrer",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          "chatgpt-account-id": remoteAccountId,
        },
        signal: controller.signal,
      });
      if (!exactResponse(usageResponse, CODEX_USAGE_URL)) throw new QuotaReadError("redirected");
      if (usageResponse.status === 401 || usageResponse.status === 403) {
        throw new QuotaReadError("codex_auth_unsupported");
      }
      if (usageResponse.status === 429) {
        retryAt = retryAfterTimestamp(usageResponse, this.now());
        throw new QuotaReadError("rate_limited");
      }
      if (!usageResponse.ok || !isJsonResponse(usageResponse)) {
        throw new QuotaReadError("usage_unavailable");
      }
      const payload = await readBoundedJson(usageResponse, this.maxResponseBytes);
      return {
        result: normalizeUsage(payload, accountId, remoteAccountId, new Date(this.now()).toISOString()),
        retryAt: null,
      };
    } catch (error) {
      const checkedAt = new Date(this.now()).toISOString();
      return {
        result: unavailable(accountId, operationalReason(error), checkedAt,
          retryAt === null ? null : new Date(retryAt).toISOString()),
        retryAt,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = {
  AccountQuotaReader,
  CODEX_USAGE_URL,
  DEFAULT_MAX_RESPONSE_BYTES,
};
