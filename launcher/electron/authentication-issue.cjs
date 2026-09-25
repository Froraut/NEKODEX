// Export only fixed diagnostic codes, never a provider body, URL, principal or token.
function authenticationIssue(message) {
  const value = typeof message === 'string' ? message : '';
  if (/timed out/.test(value)) return 'timeout';
  if (/session HTTP (401|403)|session endpoint redirected/.test(value)) return 'access';
  if (/session HTTP 429/.test(value)) return 'rate-limit';
  if (/session HTTP 5\d\d|session request failed/.test(value)) return 'network';
  if (/principal identity|browser session changed/.test(value)) return 'identity';
  if (/session refresh was rejected/.test(value)) return 'expired';
  if (/not JSON|payload|expiry/.test(value)) return 'response';
  if (/not loaded|not ready|Waiting for ChatGPT|surface unavailable/.test(value)) return 'browser';
  return 'unknown';
}
module.exports = { authenticationIssue };
