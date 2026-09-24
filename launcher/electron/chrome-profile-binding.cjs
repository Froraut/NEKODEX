const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const { validateAccountId } = require('./account-registry.cjs');

const VERSION = 2;
const MAX_FILE_BYTES = 1024 * 1024;
const PROFILE_ID = /^(Default|Profile [1-9][0-9]{0,5})$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;

function safeLabel(value, limit = 160) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit);
  return cleaned || null;
}

function normalizedEmail(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().toLowerCase();
  return candidate.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function validateBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const profileId = typeof value.profileId === 'string' && PROFILE_ID.test(value.profileId) ? value.profileId : null;
  const principalFingerprint = typeof value.principalFingerprint === 'string'
    && FINGERPRINT.test(value.principalFingerprint) ? value.principalFingerprint : null;
  const verifiedAt = typeof value.verifiedAt === 'string' && Number.isFinite(Date.parse(value.verifiedAt))
    ? value.verifiedAt : null;
  if (!profileId || !principalFingerprint || !verifiedAt) return null;
  const keys = Object.keys(value);
  if (keys.some(key => !['profileId', 'profileName', 'googleEmail', 'chatgptLabel', 'principalFingerprint', 'verifiedAt'].includes(key))) {
    return null;
  }
  return {
    profileId,
    profileName: safeLabel(value.profileName, 80),
    googleEmail: normalizedEmail(value.googleEmail),
    chatgptLabel: safeLabel(value.chatgptLabel),
    principalFingerprint,
    verifiedAt,
  };
}

function parseBindings(contents) {
  if (typeof contents !== 'string' || Buffer.byteLength(contents) > MAX_FILE_BYTES) return null;
  let value;
  try { value = JSON.parse(contents); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.version !== VERSION || !value.accounts || typeof value.accounts !== 'object'
    || Array.isArray(value.accounts) || Object.keys(value).some(key => !['version', 'accounts'].includes(key))) return null;
  const accounts = {};
  for (const [accountId, raw] of Object.entries(value.accounts)) {
    try { validateAccountId(accountId); } catch { return null; }
    const binding = validateBinding(raw);
    if (!binding) return null;
    accounts[accountId] = binding;
  }
  return { version: VERSION, accounts };
}

function readBindingFile(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) return { state: { version: VERSION, accounts: {} }, rawDigest: null, corrupt: true };
    const contents = fs.readFileSync(file, 'utf8');
    const state = parseBindings(contents);
    return state
      ? { state, rawDigest: createHash('sha256').update(contents).digest('hex'), corrupt: false }
      : { state: { version: VERSION, accounts: {} }, rawDigest: createHash('sha256').update(contents).digest('hex'), corrupt: true };
  } catch (error) {
    if (error.code === 'ENOENT') return { state: { version: VERSION, accounts: {} }, rawDigest: null, corrupt: false };
    return { state: { version: VERSION, accounts: {} }, rawDigest: null, corrupt: true };
  }
}

function currentDigest(file) {
  try {
    const contents = fs.readFileSync(file, 'utf8');
    return createHash('sha256').update(contents).digest('hex');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Saved Chrome profile binding is unreadable');
  }
}

function createChromeProfileBindingStore(coreHome) {
  const file = path.join(coreHome, 'chrome-profile-bindings.json');
  return {
    file,
    read(accountId) {
      validateAccountId(accountId);
      return readBindingFile(file).state.accounts[accountId] ?? null;
    },
    begin(accountId, profile) {
      validateAccountId(accountId);
      if (!profile || typeof profile !== 'object' || !PROFILE_ID.test(profile.id)) throw new Error('Invalid Chrome profile selection');
      const opened = readBindingFile(file);
      const previous = opened.state.accounts[accountId] ?? null;
      let settled = false;
      let attemptedState = null;
      return Object.freeze({
        previous,
        corruptPreviousFile: opened.corrupt,
        commit(identity, now = new Date()) {
          if (settled) throw new Error('Chrome profile binding transaction is already settled');
          if (!identity || typeof identity !== 'object' || !FINGERPRINT.test(identity.principalFingerprint)
            || !Number.isFinite(now.getTime())) throw new Error('Verified ChatGPT identity is required before saving a Chrome profile binding');
          if (currentDigest(file) !== opened.rawDigest) throw new Error('Saved Chrome profile bindings changed during sign-in; retry before saving');
          const current = readBindingFile(file);
          if (current.corrupt !== opened.corrupt) throw new Error('Saved Chrome profile bindings changed during sign-in; retry before saving');
          const binding = {
            profileId: profile.id,
            profileName: safeLabel(profile.name, 80),
            googleEmail: normalizedEmail(profile.googleEmail),
            chatgptLabel: safeLabel(identity.label),
            principalFingerprint: identity.principalFingerprint,
            verifiedAt: now.toISOString(),
          };
          const state = { version: VERSION, accounts: { ...opened.state.accounts, [accountId]: binding } };
          attemptedState = state;
          writePrivateFileAtomic(file, `${JSON.stringify(state)}\n`, { durable: true });
          settled = true;
          return binding;
        },
        rollback() {
          if (settled) return;
          if (attemptedState) {
            const current = readBindingFile(file);
            if (!current.corrupt && JSON.stringify(current.state) === JSON.stringify(attemptedState)) {
              if (opened.rawDigest === null && !opened.corrupt) fs.rmSync(file, { force: true });
              else writePrivateFileAtomic(file, `${JSON.stringify(opened.state)}\n`, { durable: true });
            }
          }
          settled = true;
        },
      });
    },
  };
}

module.exports = { VERSION, createChromeProfileBindingStore, parseBindings, validateBinding };
