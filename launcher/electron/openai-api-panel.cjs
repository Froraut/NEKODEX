const { allowedAuthUrl } = require("./browser-navigation-policy.cjs");

const OPENAI_API_TUNNELS_URL = "https://platform.openai.com/settings/organization/tunnels";
const API_PANEL_URLS = Object.freeze({ tunnels: OPENAI_API_TUNNELS_URL,
  keys: "https://platform.openai.com/settings/organization/api-keys" });
function openAiApiPanelUrl(section = "tunnels") {
  if (typeof section !== "string" || !Object.hasOwn(API_PANEL_URLS, section)) {
    throw new Error("OpenAI API panel section is invalid");
  }
  return API_PANEL_URLS[section];
}

// This is a human-operated account window, never a ChatGPT turn or tool surface.
function allowedOpenAiApiPanelUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === "https:" && !url.username && !url.password && !url.port
    && (url.origin === "https://platform.openai.com" || allowedAuthUrl(value));
}

function openAiApiSessionMutation(value) {
  if (allowedAuthUrl(value)) return true;
  try {
    const url = new URL(value);
    return url.origin === "https://platform.openai.com"
      && /^\/(?:api\/auth|api\/session|auth|login|logout|sign-in|sign-out|signin|signout)(?:\/|$)/i.test(url.pathname);
  } catch { return false; }
}

function isOpenAiApiSessionMutationRequest(details) {
  if (!details || ["GET", "HEAD", "OPTIONS"].includes(String(details.method).toUpperCase())) return false;
  return openAiApiSessionMutation(details.url);
}

module.exports = { OPENAI_API_TUNNELS_URL, openAiApiPanelUrl, allowedOpenAiApiPanelUrl,
  openAiApiSessionMutation, isOpenAiApiSessionMutationRequest };
