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
module.exports = { validatedChromeUserAgent };
