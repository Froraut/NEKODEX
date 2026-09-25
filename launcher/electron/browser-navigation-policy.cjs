// Pure ChatGPT/auth URL policy, its navigation guard for caller-supplied contents and
// log-safe navigation fields. Browser state and webRequest wiring stay in browser-host.cjs.
const TEMPORARY_CHAT_URL = "https://chatgpt.com/?temporary-chat=true";
const SAVED_CHAT_URL = "https://chatgpt.com/";
const CHATGPT_ORIGIN = "https://chatgpt.com";
const WORKSPACE_SESSION_MUTATION_PATH = /^\/(?:api\/auth\/(?:callback|signin|signout)|backend-api\/(?:accounts\/logout|auth\/))/i;
const AUTH_PROVIDER_HOSTS = new Set([
  "auth.openai.com",
  "auth0.openai.com",
  "login.openai.com",
  "accounts.openai.com",
  "accounts.google.com",
  "login.microsoftonline.com",
  "appleid.apple.com",
  "idmsa.apple.com",
]);

function allowedAuthUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return false;
  if (parsed.hostname === "chatgpt.com") {
    return parsed.pathname === "/auth"
      || parsed.pathname.startsWith("/auth/")
      || parsed.pathname === "/login";
  }
  return AUTH_PROVIDER_HOSTS.has(parsed.hostname);
}

function allowedWorkspaceUrl(value) {
  try {
    const url = new URL(value);
    return (url.origin === CHATGPT_ORIGIN && !url.username && !url.password)
      || allowedAuthUrl(value);
  } catch { return false; }
}

function isWorkspaceSessionMutationRequest(details) {
  if (!details || ["GET", "HEAD", "OPTIONS"].includes(String(details.method).toUpperCase())) return false;
  try {
    const url = new URL(details.url);
    return url.origin === CHATGPT_ORIGIN
      ? WORKSPACE_SESSION_MUTATION_PATH.test(url.pathname)
      : AUTH_PROVIDER_HOSTS.has(url.hostname);
  } catch { return false; }
}

function guardBrowserNavigation(contents, external) {
  const guard = (event, url) => {
    if (allowedWorkspaceUrl(url)) return;
    event.preventDefault();
    // The external broker independently requires a fresh user gesture.
    void external(url);
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', (event, url, _inPlace, mainFrame) => { if (mainFrame) guard(event, url); });
}

function navigationOriginForLog(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : parsed.protocol;
  } catch {
    return "invalid-url";
  }
}

function navigationErrorForLog(error) {
  if (!error || typeof error !== "object") return { errorType: typeof error };
  const detail = {
    errorType: typeof error.name === "string" && error.name ? error.name : "Error",
  };
  if (typeof error.code === "string" || typeof error.code === "number") {
    detail.errorCode = error.code;
  }
  return detail;
}

function isAbortedNavigationError(error) {
  if (error && typeof error === "object"
    && (error.code === -3 || error.code === "ERR_ABORTED")) {
    return true;
  }
  return error instanceof Error && /\bERR_ABORTED\b/.test(error.message);
}

function isTemporaryChatUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.origin === CHATGPT_ORIGIN
    && parsed.pathname === "/"
    && parsed.searchParams.get("temporary-chat") === "true";
}

function isChatGptBackendUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.origin === CHATGPT_ORIGIN && parsed.pathname.startsWith("/backend-api/");
}

function responseHeaderIncludes(responseHeaders, name, expectedValue) {
  const expected = expectedValue.toLowerCase();
  return Object.entries(responseHeaders || {}).some(([headerName, rawValues]) => {
    if (headerName.toLowerCase() !== name.toLowerCase()) return false;
    const values = Array.isArray(rawValues) ? rawValues : [rawValues];
    return values.some(value => String(value)
      .split(",")
      .some(candidate => candidate.trim().toLowerCase() === expected));
  });
}

function isChatGptCloudflareChallengeResponse(details) {
  return details?.statusCode === 403
    && isChatGptBackendUrl(details.url)
    && responseHeaderIncludes(details.responseHeaders, "cf-mitigated", "challenge");
}

module.exports = {
  allowedAuthUrl,
  allowedWorkspaceUrl,
  CHATGPT_ORIGIN,
  guardBrowserNavigation,
  isAbortedNavigationError,
  isChatGptBackendUrl,
  isChatGptCloudflareChallengeResponse,
  isTemporaryChatUrl,
  isWorkspaceSessionMutationRequest,
  navigationErrorForLog,
  navigationOriginForLog,
  SAVED_CHAT_URL,
  TEMPORARY_CHAT_URL,
};
