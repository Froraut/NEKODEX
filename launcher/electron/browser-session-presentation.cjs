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

/** A retired operation's result is not the health of its still-usable home
 * document. Only the host's exact current verified document may establish this;
 * renderer colours, old account evidence and retained task outcomes cannot. */
function idleSessionPresentation(host) {
  const failure = host.browserPresentationError, proof = host.verifiedHomeDocument;
  const state = host.state, contents = host.view?.webContents;
  if (!failure || failure.owner !== 'operation' || state?.status !== 'error' || state.message !== failure.message
    || host.activeTraceId || host.manualOperation || host.loginOperation || host.readOnlyInspection
    || !contents || contents.isDestroyed() || contents.isLoadingMainFrame?.() || contents.isCrashed?.()
    || host.primaryNavigationFailed || host.primaryRendererReady !== true
    || host.primaryRendererRecovering || host.primaryRendererRecoveryTimer || host.primaryUnresponsiveTimer
    || state.loading || !state.authenticated || state.authenticationStatus !== 'verified' || state.authenticationIssue
    || !proof || proof.contents !== contents || failure.contents !== contents
    || proof.documentRevision !== (host.primaryDocumentRevision ?? 0)
    || failure.documentRevision !== (host.primaryDocumentRevision ?? 0)
    || proof.identityEpoch !== host.authIdentityEpoch || proof.principalFingerprint !== host.authPrincipalFingerprint
    || proof.sessionFingerprint !== host.authSessionFingerprint
    || proof.verifiedAt !== state.lastVerifiedAt || proof.verifiedAt !== state.authenticationCheckedAt
    || proof.url !== contents.getURL()) return null;
  return { status: 'ready', message: 'ChatGPT is ready' };
}

module.exports = { verifiedSessionPresentation, idleSessionPresentation };
