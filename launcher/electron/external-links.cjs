const dns = require("node:dns");
const net = require("node:net");

const DEFAULT_GESTURE_WINDOW_MS = 2_500;
const DEFAULT_DNS_TIMEOUT_MS = 3_000;
const MAX_DNS_ADDRESSES = 32;

function normalizedHostname(value) {
  const hostname = String(value || '').toLowerCase().replace(/\.$/, '');
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function mappedIpv4(value) {
  if (!value.startsWith('::ffff:')) return null;
  const suffix = value.slice('::ffff:'.length);
  if (net.isIP(suffix) === 4) return suffix;
  const words = suffix.split(':');
  if (words.length !== 2 || words.some(word => !/^[a-f0-9]{1,4}$/.test(word))) return null;
  const high = Number.parseInt(words[0], 16), low = Number.parseInt(words[1], 16);
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join('.');
}

function publicAddress(address) {
  const normalized = normalizedHostname(address).split("%")[0];
  const kind = net.isIP(normalized);
  if (kind === 4) {
    const parts = normalized.split(".").map(Number);
    const [a, b] = parts;
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19)));
  }
  if (kind === 6) {
    const value = normalized;
    if (value === "::" || value === "::1" || value.startsWith("fe8")
      || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")
      || value.startsWith("fc") || value.startsWith("fd")) return false;
    const mapped = mappedIpv4(value);
    if (mapped) return publicAddress(mapped);
    return true;
  }
  return false;
}

function externalWebUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("External link is invalid"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("External link must use public HTTP or HTTPS without credentials");
  }
  const hostname = normalizedHostname(url.hostname);
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")
    || hostname.endsWith(".local") || hostname.endsWith(".internal")
    || (!net.isIP(hostname) && !hostname.includes("."))) {
    throw new Error("Local external links are blocked");
  }
  if (net.isIP(hostname) && !publicAddress(hostname)) throw new Error("Private external links are blocked");
  return url;
}

function createExternalLinkBroker({
  shell,
  logger,
  isVisible,
  lookup = dns.promises.lookup,
  clock = Date.now,
  gestureWindowMs = DEFAULT_GESTURE_WINDOW_MS,
  dnsTimeoutMs = DEFAULT_DNS_TIMEOUT_MS,
}) {
  if (!shell || typeof shell.openExternal !== "function" || typeof isVisible !== "function") {
    throw new TypeError("External-link broker requires shell and visibility ownership");
  }
  const owned = new Map();

  function register(contents) {
    if (!contents || contents.isDestroyed() || owned.has(contents)) return;
    const state = { gestureAt: 0 };
    const markKeyboard = (_event, input) => {
      if (input?.type === "keyDown" && input.isAutoRepeat !== true && ["Enter", " "].includes(input.key)) {
        state.gestureAt = clock();
      }
    };
    const markMouse = (_event, input) => {
      if (input?.type === "mouseUp" && input.button === "left") state.gestureAt = clock();
    };
    const invalidate = () => { state.gestureAt = 0; };
    const destroy = () => unregister(contents);
    Object.assign(state, { markKeyboard, markMouse, invalidate, destroy });
    owned.set(contents, state);
    contents.on("before-input-event", markKeyboard);
    contents.on("before-mouse-event", markMouse);
    contents.on("blur", invalidate);
    contents.on("did-start-navigation", invalidate);
    contents.once("destroyed", destroy);
  }

  function unregister(contents) {
    const state = owned.get(contents);
    if (!state) return;
    owned.delete(contents);
    contents.off("before-input-event", state.markKeyboard);
    contents.off("before-mouse-event", state.markMouse);
    contents.off("blur", state.invalidate);
    contents.off("did-start-navigation", state.invalidate);
    contents.off("destroyed", state.destroy);
  }

  async function open(contents, value, context = "remote") {
    const state = owned.get(contents);
    const url = externalWebUrl(value);
    const origin = url.origin;
    try {
      if (!state || contents.isDestroyed() || !isVisible(contents)
        || clock() - state.gestureAt < 0 || clock() - state.gestureAt > gestureWindowMs) {
        throw new Error("External link requires a recent gesture on the visible browser surface");
      }
      // Consume the gesture before asynchronous DNS/open work so one click authorizes one link.
      state.gestureAt = 0;
      const hostname = normalizedHostname(url.hostname);
      if (!net.isIP(hostname)) {
        let timer;
        const addresses = await Promise.race([
          lookup(hostname, { all: true, verbatim: true }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('External link DNS lookup timed out')), dnsTimeoutMs); }),
        ]).finally(() => clearTimeout(timer));
        if (!Array.isArray(addresses) || addresses.length === 0 || addresses.length > MAX_DNS_ADDRESSES
          || addresses.some(entry => !publicAddress(entry?.address))) {
          throw new Error("External link resolved to a local or private address");
        }
      }
      await shell.openExternal(url.toString());
      logger?.info?.("browser.external_url_opened", { origin, context });
      return true;
    } catch (error) {
      logger?.warn?.("browser.external_url_rejected", {
        origin,
        context,
        errorType: error?.name || "Error",
      });
      throw error;
    }
  }

  return {
    register,
    unregister,
    open,
    destroy() { for (const contents of [...owned.keys()]) unregister(contents); },
  };
}

module.exports = { DEFAULT_DNS_TIMEOUT_MS, DEFAULT_GESTURE_WINDOW_MS, MAX_DNS_ADDRESSES,
  createExternalLinkBroker, externalWebUrl, normalizedHostname, publicAddress };
