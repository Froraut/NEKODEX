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

// Cloudflare binds its clearance cookie to the user agent. Electron's default UA carries the
// app and Electron versions, so every NEKODEX update would invalidate the clearance. Present
// the engine's own reduced Chromium UA instead: it matches the client hints and TLS of the
// bundled Chromium and changes only with its major version.
function stableChromiumUserAgent(defaultUserAgent, chromeVersion) {
  const platform = /^Mozilla\/5\.0 (\([^()]+\))/.exec(String(defaultUserAgent ?? ''))?.[1];
  const major = /^([0-9]+)\./.exec(String(chromeVersion ?? ''))?.[1];
  if (!platform || !major) throw new Error('Chromium user agent could not be derived');
  return `Mozilla/5.0 ${platform} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/** One UA for every surface of an account: the approved Chrome UA, else the stable engine UA. */
function accountUserAgent(savedUserAgent, defaultUserAgent, chromeVersion) {
  let saved;
  try { saved = validatedChromeUserAgent(savedUserAgent); } catch { saved = undefined; }
  return saved ?? stableChromiumUserAgent(defaultUserAgent, chromeVersion);
}

module.exports = { accountUserAgent, stableChromiumUserAgent, validatedChromeUserAgent };
