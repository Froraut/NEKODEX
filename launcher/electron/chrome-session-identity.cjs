const { createHash, randomUUID } = require('node:crypto');
const { validatePasskeyLoginState } = require('./passkey-login-state.cjs');

const FINGERPRINT = /^[a-f0-9]{64}$/;
const SESSION_ENDPOINT = 'https://chatgpt.com/api/auth/session';
const VERIFIED_CAPTURE = Symbol('nekodex-verified-capture');

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
      throw new Error('Session verification unavailable');
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
    if (!identity) throw Object.assign(new Error('Chrome returned an unverified ChatGPT account'), { code: 'chrome-account-unverified' });
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

const isVerifiedCaptureTransfer = transfer => Boolean(transfer && transfer[VERIFIED_CAPTURE] === true
  && transfer.verifiedIdentity && FINGERPRINT.test(transfer.verifiedIdentity.principalFingerprint)
  && typeof transfer.commit === 'function' && typeof transfer.rollback === 'function');

module.exports = { isVerifiedCaptureTransfer, sessionIdentity, verifiedCaptureTransfer, verifyCapturedAccount };
