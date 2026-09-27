// The actual UA observed from the approved Chrome connection is compatibility
// metadata for the session handoff, never authentication evidence.
function validatedChromeUserAgent(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 512 || !/^Mozilla\/5\.0 [\x20-\x7e]+$/.test(value)
    || !/\bChrome\/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\b/.test(value) || /Electron\//.test(value)) {
    throw new Error('Captured Chrome user agent is invalid');
  }
  return value;
}

// Cloudflare binds its clearance cookie to the user agent and its challenge compares the request
// header with navigator.userAgent inside a cross-site frame. Chromium keeps the app-wide fallback
// UA in such frames even when a view overrides its own, and the bundled Chromium's client hints
// always report its real version. NEKODEX therefore presents one UA everywhere: the engine's own
// reduced Chromium UA, without the app and Electron versions that change on every update.
function stableChromiumUserAgent(defaultUserAgent, chromeVersion) {
  const platform = /^Mozilla\/5\.0 (\([^()]+\))/.exec(String(defaultUserAgent ?? ''))?.[1];
  const major = /^([0-9]+)\./.exec(String(chromeVersion ?? ''))?.[1];
  if (!platform || !major) throw new Error('Chromium user agent could not be derived');
  return `Mozilla/5.0 ${platform} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

module.exports = { stableChromiumUserAgent, validatedChromeUserAgent };
