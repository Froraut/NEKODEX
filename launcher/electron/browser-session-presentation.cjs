'use strict';

const SESSION_OPERATIONS = new Set(['ChatGPT login', 'ChatGPT passkey login', 'session refresh', 'session verification retry', 'session inspection']);
const SUPERSEDED_LOGIN_ERRORS = new Set(['chrome-account-unverified', 'session-verification-failed', 'passkey-verification-failed']);

/** Called only after a current successful composer/Temporary Chat/session probe.
 * Its presentation result changes no authentication, account or model authority. */
function verifiedSessionPresentation(host) {
  if (host.activeTraceId) return { status: 'running', message: 'ChatGPT is working' };
  if (!host.manualOperation) return { status: 'ready', message: 'ChatGPT is ready' };
  const previous = host.state;
  const superseded = previous?.status === 'error' && (SUPERSEDED_LOGIN_ERRORS.has(previous.message)
    || /^ChatGPT session verification unavailable(?:\s*:|$)/.test(previous.message ?? ''));
  if (SESSION_OPERATIONS.has(host.manualOperation) && superseded) return { status: 'ready', message: 'ChatGPT is ready' };
  return {};
}

module.exports = { verifiedSessionPresentation };
