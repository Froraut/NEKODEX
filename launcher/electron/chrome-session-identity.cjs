const { createHash, randomUUID } = require('node:crypto');
const { validatePasskeyLoginState } = require('./passkey-login-state.cjs');
const { validatedChromeUserAgent } = require('./browser-user-agent.cjs');

const FINGERPRINT = /^[a-f0-9]{64}$/;
const SESSION_ENDPOINT = 'https://chatgpt.com/api/auth/session';
const VERIFIED_CAPTURE = Symbol('nekodex-verified-capture');
const DEFERRED_CAPTURE = Symbol('nekodex-deferred-capture');

function safeLabel(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160);
  return cleaned || null;
}

function sessionIdentity(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.error) return null;
  const user = payload.user && typeof payload.user === 'object' && !Array.isArray(payload.user) ? payload.user : null;
  if (!user || Object.keys(user).length === 0) return null;
  if (payload.expires !== undefined && payload.expires !== null) {
    if (typeof payload.expires !== 'string') return null;
    const expiry = Date.parse(payload.expires);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return null;
  }
  const id = typeof user.id === 'string' && user.id.trim().length <= 512 ? user.id.trim() : null;
  const email = typeof user.email === 'string' && user.email.trim().length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email.trim()) ? user.email.trim().toLowerCase() : null;
  const principal = id ? `id:${id}` : email ? `email:${email}` : null;
  if (!principal) return null;
  return {
    principalFingerprint: createHash('sha256').update(principal).digest('hex'),
    label: safeLabel(email || user.name),
  };
}

async function verifyCapturedAccount(sessionApi, transfer, { expectedPrincipalFingerprint = null, signal,
  configureSession, accountId } = {}) {
  if (expectedPrincipalFingerprint !== null && !FINGERPRINT.test(expectedPrincipalFingerprint)) {
    throw new Error('Expected ChatGPT identity is invalid');
  }
  const isolated = sessionApi.fromPartition(`nekodex-profile-verification-${randomUUID()}`, { cache: false });
  try {
    if (configureSession !== undefined) {
      if (typeof configureSession !== 'function') throw new Error('ChatGPT verification session configuration is invalid');
      await configureSession(isolated, accountId);
      signal?.throwIfAborted();
    }
    const state = validatePasskeyLoginState(transfer?.storageState);
    const userAgent = validatedChromeUserAgent(transfer?.browserUserAgent);
    if (userAgent) isolated.setUserAgent(userAgent);
    for (const cookie of state.cookies) {
      signal?.throwIfAborted();
      await isolated.cookies.set(cookie);
    }
    const response = await isolated.fetch(SESSION_ENDPOINT, {
      credentials: 'include', redirect: 'error', cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
      headers: { accept: 'application/json' },
    });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json') || !response.body) {
      // This request runs outside any page and carries no Cloudflare clearance, so ChatGPT
      // often answers it with a challenge that only a visible ChatGPT page can complete.
      const cloudflareChallenge = response.status === 403
        && /challenge/i.test(response.headers.get('cf-mitigated') ?? '');
      throw Object.assign(new Error('Session verification unavailable'), {
        code: 'session-verification-failed', httpStatus: response.status, cloudflareChallenge });
    }
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 256 * 1024) throw new Error('Session response too large');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Session verification unavailable'); }
    const identity = sessionIdentity(payload);
    if (!identity) {
      const reason = !payload || typeof payload !== 'object' || Array.isArray(payload) ? 'invalid-response'
        : payload.error ? 'provider-error'
          : !payload.user || typeof payload.user !== 'object' || Object.keys(payload.user).length === 0 ? 'missing-user'
            : payload.expires != null && (typeof payload.expires !== 'string' || !Number.isFinite(Date.parse(payload.expires))) ? 'invalid-expiry'
              : payload.expires != null && Date.parse(payload.expires) <= Date.now() ? 'expired-session' : 'missing-principal';
      throw Object.assign(new Error('Chrome returned an unverified ChatGPT account'), {
        code: 'chrome-account-unverified', verificationReason: reason, httpStatus: response.status,
        authCookieCount: state.cookies.filter(cookie => /^__Secure-(?:next-auth|authjs)\.session-token(?:\.\d+)?$/.test(cookie.name)).length,
      });
    }
    if (expectedPrincipalFingerprint && identity.principalFingerprint !== expectedPrincipalFingerprint) {
      throw Object.assign(new Error('Chrome returned a different ChatGPT account'), { code: 'chrome-account-mismatch' });
    }
    return identity;
  } finally {
    // Both resources must finish teardown, even after cancellation or a failed
    // storage clear. Successful cleanup leaves the original result/error intact.
    let cleanupFailed = false;
    try { await isolated.clearStorageData(); }
    catch { cleanupFailed = true; }
    try { await isolated.closeAllConnections(); }
    catch { cleanupFailed = true; }
    if (cleanupFailed) {
      throw Object.assign(new Error('Temporary Chrome sign-in cleanup failed'), {
        code: 'existing_chrome_cleanup_failed',
      });
    }
  }
}

function verifiedCaptureTransfer(transfer, identity, { commit = () => {}, rollback = () => {}, identityIntent = null } = {}) {
  if (!transfer || typeof transfer !== 'object' || typeof transfer.cleanup !== 'function'
    || !identity || !FINGERPRINT.test(identity.principalFingerprint)
    || typeof commit !== 'function' || typeof rollback !== 'function') {
    throw new Error('Verified ChatGPT capture transfer is invalid');
  }
  if (identityIntent !== null && (!identityIntent || typeof identityIntent !== 'object'
    || (identityIntent.knownPrincipalFingerprint !== null && !FINGERPRINT.test(identityIntent.knownPrincipalFingerprint))
    || typeof identityIntent.actualIdentityConfirmed !== 'boolean')) {
    throw new Error('Verified ChatGPT identity intent is invalid');
  }
  const verified = {
    ...transfer,
    verifiedIdentity: identity,
    identityIntent: identityIntent && Object.freeze({
      knownPrincipalFingerprint: identityIntent.knownPrincipalFingerprint,
      actualIdentityConfirmed: identityIntent.actualIdentityConfirmed,
    }),
    commit(receipt) {
      if (!receipt || receipt.authenticated !== true
        || receipt.principalFingerprint !== identity.principalFingerprint) {
        throw new Error('Installed ChatGPT identity does not match the verified capture');
      }
      return commit(receipt);
    },
    rollback,
  };
  Object.defineProperty(verified, VERIFIED_CAPTURE, { value: true, enumerable: false, configurable: false });
  return verified;
}

const isCloudflareChallengedVerification = error => error?.code === 'session-verification-failed'
  && error.cloudflareChallenge === true;

/**
 * A capture ChatGPT would not identify outside a page. The launcher installs it behind its
 * rollback snapshot, verifies the identity on the visible ChatGPT surface where the provider
 * check can be completed, and adopts that identity before any confirmation or commit.
 * `resolveIdentityIntent` runs the producer's own confirmation for the adopted identity.
 */
function deferredCaptureTransfer(transfer, { resolveIdentityIntent = async () => null, commit = () => {},
  rollback = () => {} } = {}) {
  if (!transfer || typeof transfer !== 'object' || typeof transfer.cleanup !== 'function'
    || typeof resolveIdentityIntent !== 'function' || typeof commit !== 'function' || typeof rollback !== 'function') {
    throw new Error('Deferred ChatGPT capture transfer is invalid');
  }
  let adopted = null;
  const deferred = {
    ...transfer,
    verifiedIdentity: null,
    identityIntent: null,
    async adoptIdentity(identity) {
      if (adopted) throw new Error('Deferred ChatGPT capture identity was already adopted');
      if (!identity || !FINGERPRINT.test(identity.principalFingerprint)) {
        throw new Error('Installed ChatGPT identity is invalid');
      }
      const intent = await resolveIdentityIntent(identity);
      if (intent !== null && (!intent || typeof intent !== 'object'
        || (intent.knownPrincipalFingerprint !== null && !FINGERPRINT.test(intent.knownPrincipalFingerprint))
        || typeof intent.actualIdentityConfirmed !== 'boolean')) {
        throw new Error('Verified ChatGPT identity intent is invalid');
      }
      adopted = Object.freeze({ principalFingerprint: identity.principalFingerprint, label: safeLabel(identity.label) });
      return intent && Object.freeze({ knownPrincipalFingerprint: intent.knownPrincipalFingerprint,
        actualIdentityConfirmed: intent.actualIdentityConfirmed });
    },
    commit(receipt) {
      if (!adopted || !receipt || receipt.authenticated !== true
        || receipt.principalFingerprint !== adopted.principalFingerprint) {
        throw new Error('Installed ChatGPT identity does not match the verified capture');
      }
      return commit(receipt, adopted);
    },
    rollback,
  };
  Object.defineProperty(deferred, DEFERRED_CAPTURE, { value: true, enumerable: false, configurable: false });
  return deferred;
}

const isDeferredCaptureTransfer = transfer => Boolean(transfer && transfer[DEFERRED_CAPTURE] === true
  && typeof transfer.adoptIdentity === 'function' && typeof transfer.commit === 'function'
  && typeof transfer.rollback === 'function');

const isVerifiedCaptureTransfer = transfer => Boolean(transfer && transfer[VERIFIED_CAPTURE] === true
  && transfer.verifiedIdentity && FINGERPRINT.test(transfer.verifiedIdentity.principalFingerprint)
  && typeof transfer.commit === 'function' && typeof transfer.rollback === 'function');

module.exports = { deferredCaptureTransfer, isCloudflareChallengedVerification, isDeferredCaptureTransfer,
  isVerifiedCaptureTransfer, sessionIdentity, verifiedCaptureTransfer, verifyCapturedAccount };
