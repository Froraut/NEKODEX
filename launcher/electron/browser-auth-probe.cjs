// In-page ChatGPT session probe. The page returns an observation only; the host owns probe
// sequencing, stale-probe rejection, identity epochs and published authentication state.
const { TEMPORARY_CHAT_URL } = require("./browser-navigation-policy.cjs");

const CHATGPT_AUTH_SESSION_TIMEOUT_MS = 5_000;
const AUTH_PROBE_TIMEOUT_MS = CHATGPT_AUTH_SESSION_TIMEOUT_MS + 3_000;
// Match the runtime's composer selector. Generic textboxes are not proof of a ready chat.
const COMPOSER_SELECTOR = [
  '[data-testid="prompt-textarea"]',
  "#prompt-textarea",
  '[contenteditable="true"][data-lexical-editor="true"]',
  'form:has([data-testid="send-button"]) .ProseMirror[contenteditable="true"]',
  'form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"][role="textbox"]',
].join(", ");

function visibleElementScript(selector) {
  return `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return element.isConnected
      && bounds.width > 0
      && bounds.height > 0
      && style.display !== "none"
      && style.visibility !== "hidden"
      && style.opacity !== "0";
  })`;
}

function authenticationProbeScript() {
  return `(async () => {
      const expectedUrl = new URL(${JSON.stringify(TEMPORARY_CHAT_URL)});
      const readSurface = () => {
        const composer = ${visibleElementScript(COMPOSER_SELECTOR)};
        const actualUrl = new URL(location.href);
        return {
          url: actualUrl.href,
          composer: Boolean(composer),
          temporary: actualUrl.origin === expectedUrl.origin
            && actualUrl.pathname === expectedUrl.pathname
            && actualUrl.searchParams.get("temporary-chat") === "true",
          readyState: document.readyState,
        };
      };
      const initialSurface = readSurface();
      let sessionAuthenticated = false;
      let sessionVerification = "unavailable";
      let verificationFailure = "session response unavailable";
      let accountLabel = null;
      let principalFingerprint = null;
      let sessionFingerprint = null;
      if (new URL(initialSurface.url).origin === expectedUrl.origin) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ${CHATGPT_AUTH_SESSION_TIMEOUT_MS});
        try {
          const response = await fetch("/api/auth/session", {
            credentials: "include",
            cache: "no-store",
            headers: { accept: "application/json" },
            signal: controller.signal,
          });
          const responseUrl = new URL(response.url);
          const trustedEndpoint = responseUrl.origin === expectedUrl.origin
            && responseUrl.pathname === "/api/auth/session";
          if (!trustedEndpoint) {
            verificationFailure = "session endpoint redirected";
          } else if (!response.ok) {
            // A service/protective response, including 401/403 HTML, is not an auth verdict.
            verificationFailure = "session HTTP " + response.status;
          } else if (!response.headers.get("content-type")?.includes("application/json")) {
            verificationFailure = "session response was not JSON";
          } else {
            const payload = await response.json();
            if (payload && typeof payload === "object" && !Array.isArray(payload)) {
              const user = payload.user && typeof payload.user === "object" && !Array.isArray(payload.user)
                ? payload.user
                : null;
              const sessionHasUser = user !== null && Object.keys(user).length > 0;
              const principal = typeof user?.id === "string" && user.id.trim()
                ? "id:" + user.id.trim()
                : typeof user?.email === "string" && user.email.trim()
                  ? "email:" + user.email.trim().toLowerCase()
                  : null;
              const sessionHasNoError = payload.error === undefined || payload.error === null || payload.error === "";
              const hasExpiry = payload.expires !== undefined && payload.expires !== null;
              const expiry = hasExpiry && typeof payload.expires === "string" ? Date.parse(payload.expires) : NaN;
              const expiryKnown = !hasExpiry || Number.isFinite(expiry);
              const sessionExpired = hasExpiry && expiryKnown && expiry <= Date.now();
              if (!sessionHasNoError) {
                // NextAuth reports a refresh failure while ChatGPT itself redirects to sign-in.
                // Retrying cannot repair it; name it so the launcher asks for a new sign-in.
                verificationFailure = payload.error === "RefreshAccessTokenError"
                  ? "session refresh was rejected"
                  : "session payload reported an error";
              } else if (!expiryKnown) {
                verificationFailure = "session expiry was invalid";
              } else if (!sessionHasUser || sessionExpired) {
                sessionVerification = "rejected";
              } else if (!principal) {
                verificationFailure = "session principal identity was unavailable";
              } else {
                const digestValue = async value => [...new Uint8Array(
                  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
                )]
                  .map(value => value.toString(16).padStart(2, "0")).join("");
                const stableSessionId = [payload.sessionId, payload.session_id, payload.sid]
                  .find(value => typeof value === "string" && value.trim());
                principalFingerprint = await digestValue(principal);
                sessionFingerprint = stableSessionId
                  ? await digestValue(principal + "|session:" + stableSessionId.trim())
                  : principalFingerprint;
                sessionAuthenticated = true;
                sessionVerification = "authenticated";
                const label = typeof user.email === "string" ? user.email : typeof user.name === "string" ? user.name : null;
                accountLabel = label ? label.replace(/[\\u0000-\\u001f\\u007f]/g, "").slice(0, 160) : null;
              }
            } else {
              verificationFailure = "session payload was invalid";
            }
          }
        } catch (error) {
          verificationFailure = error?.name === "AbortError" ? "session request timed out" : "session request failed";
        }
        finally { clearTimeout(timeout); }
      }
      return { ...readSurface(), sessionAuthenticated, sessionVerification, verificationFailure,
        accountLabel, principalFingerprint, sessionFingerprint };
    })()`;
}

function unavailableAuthenticationProbe() {
  return {
    url: "",
    composer: false,
    temporary: false,
    sessionAuthenticated: false,
    sessionVerification: "unavailable",
    verificationFailure: "browser inspection failed",
    principalFingerprint: null,
    sessionFingerprint: null,
    readyState: "unknown",
  };
}

module.exports = { AUTH_PROBE_TIMEOUT_MS, authenticationProbeScript, unavailableAuthenticationProbe };
