const CHATGPT_ORIGIN = 'https://chatgpt.com';
const COOKIE_URLS = [`${CHATGPT_ORIGIN}/`, 'https://auth.openai.com/'];
const MAX_COOKIES = 4096;
const MAX_COOKIE_BYTES = 8 * 1024 * 1024;
const MAX_LOCAL_STORAGE_ENTRIES = 4096;
const MAX_LOCAL_STORAGE_BYTES = 4 * 1024 * 1024;

function allowedDomain(value) {
  if (typeof value !== 'string' || value.length > 253 || !/^\.?[a-z0-9.-]+$/i.test(value)) return null;
  const hostname = value.replace(/^\./, '').toLowerCase();
  if (hostname !== 'chatgpt.com' && !hostname.endsWith('.chatgpt.com')
    && hostname !== 'openai.com' && !hostname.endsWith('.openai.com')) return null;
  return { hostname, includeDomain: value.startsWith('.') };
}

function sanitizeCookie(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.partitionKey !== undefined) return null;
  const allowed = allowedDomain(raw.domain);
  if (!allowed || typeof raw.name !== 'string' || !raw.name || raw.name.length > 1024
    || /[\x00-\x20\x7f;,=]/.test(raw.name) || typeof raw.value !== 'string'
    || Buffer.byteLength(raw.value) > 2 * 1024 * 1024 || /[\x00-\x1f\x7f]/.test(raw.value)
    || typeof raw.path !== 'string' || !raw.path.startsWith('/') || raw.path.length > 2048
    || /[\x00-\x1f\x7f?#]/.test(raw.path) || typeof raw.secure !== 'boolean'
    || typeof raw.httpOnly !== 'boolean') return null;
  const sameSite = ['unspecified', 'no_restriction', 'lax', 'strict'].includes(raw.sameSite)
    ? raw.sameSite : 'unspecified';
  const expirationDate = raw.session === true ? undefined
    : typeof raw.expirationDate === 'number' && Number.isFinite(raw.expirationDate) && raw.expirationDate > 0
      ? raw.expirationDate : undefined;
  return {
    url: `https://${allowed.hostname}${raw.path}`,
    name: raw.name,
    value: raw.value,
    ...(allowed.includeDomain ? { domain: `.${allowed.hostname}` } : {}),
    path: raw.path,
    secure: raw.secure,
    httpOnly: raw.httpOnly,
    sameSite,
    ...(expirationDate ? { expirationDate } : {}),
  };
}

async function captureOwnedSession(contents) {
  if (!contents || contents.isDestroyed() || !contents.session?.cookies) {
    throw new Error('Owned ChatGPT browser session is unavailable for rollback');
  }
  const collections = await Promise.all(COOKIE_URLS.map(url => contents.session.cookies.get({ url })));
  const unique = new Map();
  let cookieBytes = 0;
  for (const raw of collections.flat()) {
    const cookie = sanitizeCookie(raw);
    if (!cookie) continue;
    const key = `${cookie.domain ?? new URL(cookie.url).hostname}\0${cookie.path}\0${cookie.name}`;
    const bytes = Buffer.byteLength(JSON.stringify(cookie));
    cookieBytes += bytes;
    if (cookieBytes > MAX_COOKIE_BYTES || unique.size >= MAX_COOKIES) {
      throw new Error('Owned ChatGPT rollback cookies exceed the safe in-memory limit');
    }
    unique.set(key, cookie);
  }
  let localStorage = [];
  let currentOrigin = null;
  try { currentOrigin = new URL(contents.getURL()).origin; } catch {}
  if (currentOrigin === CHATGPT_ORIGIN) {
    localStorage = await contents.executeJavaScript(`(() => {
      if (location.origin !== ${JSON.stringify(CHATGPT_ORIGIN)}) throw new Error("Unexpected rollback origin");
      if (localStorage.length > ${MAX_LOCAL_STORAGE_ENTRIES}) throw new Error("Rollback local storage has too many entries");
      const entries = [];
      let bytes = 0;
      for (let index = 0; index < localStorage.length; index += 1) {
        const name = localStorage.key(index);
        if (typeof name !== "string") continue;
        const value = localStorage.getItem(name);
        if (typeof value !== "string") continue;
        bytes += new TextEncoder().encode(name).byteLength + new TextEncoder().encode(value).byteLength;
        if (bytes > ${MAX_LOCAL_STORAGE_BYTES}) throw new Error("Rollback local storage is too large");
        entries.push({ name, value });
      }
      return entries;
    })()`, true);
    if (!Array.isArray(localStorage) || localStorage.length > MAX_LOCAL_STORAGE_ENTRIES
      || Buffer.byteLength(JSON.stringify(localStorage)) > MAX_LOCAL_STORAGE_BYTES) {
      throw new Error('Owned ChatGPT rollback local storage is invalid');
    }
    for (const entry of localStorage) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || typeof entry.name !== 'string' || typeof entry.value !== 'string') {
        throw new Error('Owned ChatGPT rollback local storage is invalid');
      }
    }
  }
  return { cookies: [...unique.values()], localStorage };
}

async function restoreOwnedSession(contents, snapshot, temporaryChatUrl) {
  if (!contents || contents.isDestroyed() || !contents.session?.cookies || !snapshot
    || !Array.isArray(snapshot.cookies) || !Array.isArray(snapshot.localStorage)) {
    throw new Error('Owned ChatGPT rollback snapshot is unavailable');
  }
  for (const cookie of snapshot.cookies) await contents.session.cookies.set(cookie);
  contents.session.flushStorageData();
  await contents.session.cookies.flushStore();
  await contents.loadURL(temporaryChatUrl);
  if (snapshot.localStorage.length > 0) {
    const serialized = JSON.stringify(snapshot.localStorage).replace(/</g, '\\u003c');
    await contents.executeJavaScript(`(() => {
      if (location.origin !== ${JSON.stringify(CHATGPT_ORIGIN)}) throw new Error("Unexpected rollback origin");
      for (const entry of ${serialized}) localStorage.setItem(entry.name, entry.value);
    })()`, true);
    await contents.loadURL(temporaryChatUrl);
  }
}

function disposeOwnedSessionSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  if (Array.isArray(snapshot.cookies)) snapshot.cookies.splice(0);
  if (Array.isArray(snapshot.localStorage)) snapshot.localStorage.splice(0);
}

module.exports = { captureOwnedSession, disposeOwnedSessionSnapshot, restoreOwnedSession, sanitizeCookie };
