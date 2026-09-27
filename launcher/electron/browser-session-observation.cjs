// Reads ChatGPT's session endpoint from inside a loaded ChatGPT page. Cloudflare's clearance
// cookie is partitioned to the ChatGPT top-level site and bound to the page's user agent and
// client hints. A request from outside the page carries neither, so Cloudflare answers it with
// a 403 challenge whose cookies then churn the page's own bot-management state.
// Only the fields needed for identity leave the page; tokens never do.

const SESSION_OBSERVATION_TIMEOUT_MS = 5_000;
const SESSION_PAYLOAD_LIMIT = 256 * 1024;

function sessionObservationScript(timeoutMs = SESSION_OBSERVATION_TIMEOUT_MS) {
  return `(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ${Number(timeoutMs)});
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "include", cache: "no-store",
        headers: { accept: "application/json" }, signal: controller.signal,
      });
      const endpoint = new URL(response.url);
      if (endpoint.origin !== location.origin || endpoint.pathname !== "/api/auth/session") {
        return { failure: "session endpoint redirected" };
      }
      if (!response.ok || !(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
        return { failure: "session HTTP " + response.status };
      }
      const text = await response.text();
      if (text.length > ${SESSION_PAYLOAD_LIMIT}) return { failure: "session payload was too large" };
      const payload = JSON.parse(text);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { payload: null };
      const source = payload.user;
      const user = source && typeof source === "object" && !Array.isArray(source)
        ? (Object.keys(source).length === 0 ? {} : {
          present: true,
          ...(typeof source.id === "string" ? { id: source.id } : {}),
          ...(typeof source.email === "string" ? { email: source.email } : {}),
          ...(typeof source.name === "string" ? { name: source.name } : {}),
        })
        : null;
      return { payload: {
        user,
        expires: payload.expires ?? null,
        error: payload.error ? String(payload.error).slice(0, 80) : null,
      } };
    } catch (error) {
      return { failure: error && error.name === "AbortError" ? "session request timed out" : "session request failed" };
    } finally { clearTimeout(timer); }
  })()`;
}

/** Resolves the reduced session payload, or rejects with the observed failure. */
async function observeChatGptSession(contents, { timeoutMs = SESSION_OBSERVATION_TIMEOUT_MS, signal } = {}) {
  if (!contents || contents.isDestroyed()) throw new Error("session page is unavailable");
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("session request timed out")), timeoutMs + 2_000);
  });
  const aborted = signal ? new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }) : null;
  aborted?.catch(() => {});
  try {
    const result = await Promise.race([
      contents.executeJavaScript(sessionObservationScript(timeoutMs)),
      deadline, ...(aborted ? [aborted] : []),
    ]);
    if (!result || typeof result !== "object") throw new Error("session request failed");
    if (typeof result.failure === "string") throw new Error(result.failure);
    return result.payload;
  } finally { clearTimeout(timer); }
}

module.exports = { SESSION_OBSERVATION_TIMEOUT_MS, observeChatGptSession, sessionObservationScript };
