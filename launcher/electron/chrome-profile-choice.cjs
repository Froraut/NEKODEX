const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { validateAccountId } = require('./account-registry.cjs');
const { createChromeProfileBindingStore } = require('./chrome-profile-binding.cjs');
const { showChromeProfilePicker } = require('./chrome-profile-picker.cjs');

const profileId = value => typeof value === 'string' && /^(Default|Profile [1-9][0-9]{0,5})$/.test(value);
const email = value => {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().toLowerCase();
  return candidate.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
};
const safeName = (value, fallback) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || fallback
  : fallback;

function readProfiles(root) {
  const file = path.join(root, 'Local State');
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error('Chrome profile list is unavailable');
  const cache = JSON.parse(fs.readFileSync(file, 'utf8'))?.profile?.info_cache;
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return [];
  // Profile names and optional Google email are display metadata only. They never establish ChatGPT identity.
  return Object.entries(cache).filter(([id, value]) => profileId(id) && value && typeof value === 'object' && !Array.isArray(value))
    .map(([id, value]) => ({ id, googleEmail: email(value.user_name), name: safeName(value.name, id) }))
    .filter(profile => { try { const s = fs.lstatSync(path.join(root, profile.id)); return s.isDirectory() && !s.isSymbolicLink(); } catch { return false; } });
}

function selectMatch(profiles, _accountLabel, saved) {
  return saved && profiles.find(profile => profile.id === saved.profileId) || null;
}

function createProfileClaim(port, now = Date.now()) {
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid Chrome profile claim port');
  const nonce = randomBytes(24).toString('base64url');
  return Object.freeze({ version: 1, nonce,
    url: `http://127.0.0.1:${port}/nekodex-profile-claim-v1/${nonce}`,
    openedAt: new Date(now).toISOString() });
}

async function createProfileClaimServer({ signal, timeoutMs = 15_000 } = {}) {
  signal?.throwIfAborted();
  let claim;
  let settled = false;
  let resolveLoaded;
  let rejectLoaded;
  let timer;
  const loaded = new Promise((resolve, reject) => { resolveLoaded = resolve; rejectLoaded = reject; });
  // A launch error can occur before the caller starts waiting for Chrome's GET.
  void loaded.catch(() => {});
  const server = createServer((request, response) => {
    if (settled || request.method !== 'GET' || !claim
      || request.headers.host !== new URL(claim.url).host
      || request.url !== new URL(claim.url).pathname) {
      response.writeHead(404, { Connection: 'close' }); response.end(); return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff', Connection: 'close' });
    response.once('finish', () => finish());
    response.end('<!doctype html><meta charset="utf-8"><title>NEKODEX</title><p>NEKODEX is verifying the selected Chrome profile. This temporary tab will close automatically.</p>');
  });
  const finish = error => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    server.close();
    server.closeAllConnections();
    if (error) rejectLoaded(error); else resolveLoaded();
  };
  const abort = () => finish(signal.reason || new Error('Chrome profile claim cancelled'));
  const cleanup = () => finish(new Error('Chrome profile claim closed'));
  server.requestTimeout = timeoutMs;
  server.headersTimeout = timeoutMs;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    claim = createProfileClaim(server.address().port);
    timer = setTimeout(() => {
      const error = new Error('Chrome did not open the selected profile verification page. Retry the import.');
      error.code = 'chrome-profile-claim-missing';
      finish(error);
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    return { claim, loaded, cleanup };
  } catch (error) { finish(error); throw error; }
}

function validLaunchUrl(url) {
  if (url === 'https://chatgpt.com/?temporary-chat=true') return true;
  const match = typeof url === 'string' && /^http:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})\/nekodex-profile-claim-v1\/[A-Za-z0-9_-]{32}$/.exec(url);
  return !!match && Number(match[1]) >= 1024 && Number(match[1]) <= 65535;
}

function openProfile(executable, id, url = 'https://chatgpt.com/?temporary-chat=true') {
  if (!profileId(id) || typeof executable !== 'string' || !path.isAbsolute(executable) || !validLaunchUrl(url)) {
    throw new Error('Invalid Chrome profile launch');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [`--profile-directory=${id}`, '--new-window', url],
      { detached: true, stdio: 'ignore', shell: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function createChromeProfileChoice({ root, coreHome, BrowserWindow, window, executable, language,
  launch = openProfile, picker = showChromeProfilePicker, bindingStore = createChromeProfileBindingStore(coreHome) }) {
  return async ({ accountId, signal }) => {
    validateAccountId(accountId);
    signal?.throwIfAborted();
    let profiles;
    try { profiles = readProfiles(root); }
    catch {
      throw new Error(language() === 'ru'
        ? 'Не удалось прочитать список профилей Chrome. Проверьте доступ NEKODEX; новый профиль автоматически не создавался.'
        : 'Could not read Chrome profiles. Check NEKODEX access; no new profile was created.');
    }
    const saved = bindingStore.read(accountId);
    const selection = await picker({ BrowserWindow, parent: window(), profiles,
      selectedId: selectMatch(profiles, null, saved)?.id ?? null, language: language(), signal });
    signal?.throwIfAborted();
    if (!selection || selection.kind === 'cancel') return { kind: 'cancel' };
    if (selection.kind === 'new') return { kind: 'new' };
    const selected = profiles.find(profile => profile.id === selection.profile?.id);
    if (!selected) throw new Error('Selected Chrome profile is no longer available');
    const binding = bindingStore.begin(accountId, selected);
    try { await launch(executable(), selected.id, 'https://chatgpt.com/?temporary-chat=true'); }
    catch (error) { binding.rollback(); throw error; }
    let claimPrepared = false;
    let claimServer;
    return {
      kind: 'existing', profile: selected, previousBinding: binding.previous,
      corruptPreviousBinding: binding.corruptPreviousFile,
      async prepareCapture() {
        if (claimPrepared) throw new Error('Chrome profile capture was already prepared');
        signal?.throwIfAborted();
        claimPrepared = true;
        // Chrome command-line launch rejects about:blank with a fragment. Serve an inert
        // one-use loopback page and wait for its GET; spawning Chrome alone is no receipt.
        claimServer = await createProfileClaimServer({ signal });
        try {
          await launch(executable(), selected.id, claimServer.claim.url);
          await claimServer.loaded;
          signal?.throwIfAborted();
          return claimServer.claim;
        } catch (error) { binding.rollback(); throw error; }
        finally { claimServer.cleanup(); }
      },
      cleanupCapture: () => claimServer?.cleanup(),
      commitBinding: identity => binding.commit(identity),
      rollbackBinding: () => binding.rollback(),
    };
  };
}

module.exports = { createChromeProfileChoice, createProfileClaim, createProfileClaimServer, openProfile, readProfiles, selectMatch };
