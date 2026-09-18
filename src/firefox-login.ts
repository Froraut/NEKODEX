import { Database } from "bun:sqlite";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sanitizeBrowserLoginStorageState, type BrowserLoginStorageState, type SystemBrowserLoginCapture, type SystemBrowserLoginOptions } from "./browser-login";
import { revealOwnedLoginBrowser } from "./passkey-login-control";

/** Bounded Mozilla LZ4 block decoder for the disposable profile's session-cookie snapshot. */
export function decodeFirefoxSession(data: Buffer): unknown {
  if (data.length < 12 || data.subarray(0, 8).toString('binary') !== 'mozLz40\0') throw new Error('Invalid Firefox session header');
  const size = data.readUInt32LE(8);
  if (size > 20_000_000) throw new Error('Firefox session exceeds capture limit');
  const out = Buffer.alloc(size); let input = 12, output = 0;
  const byte = () => { if (input >= data.length) throw new Error('Truncated Firefox session'); return data[input++]!; };
  const length = (base: number) => {
    let result = base;
    if (base === 15) { let extra; do { extra = byte(); result += extra; if (result > size) throw new Error('Invalid Firefox block length'); } while (extra === 255); }
    return result;
  };
  while (input < data.length) {
    const token = byte(), literals = length(token >> 4);
    if (input + literals > data.length || output + literals > size) throw new Error('Invalid Firefox literal span');
    data.copy(out, output, input, input + literals); input += literals; output += literals;
    if (input === data.length) break;
    const offset = byte() | byte() << 8, count = length(token & 15) + 4;
    if (!offset || offset > output || output + count > size) throw new Error('Invalid Firefox match span');
    for (let index = 0; index < count; index++) { out[output] = out[output - offset]!; output++; }
  }
  if (output !== size) throw new Error('Incomplete Firefox session');
  return JSON.parse(out.toString('utf8'));
}

export function readFirefoxLoginCookies(profile: string): BrowserLoginStorageState {
  const cookies: BrowserLoginStorageState['cookies'] = [];
  const append = (row: Record<string, unknown>, session: boolean) => {
    // Partitioned/container cookies cannot safely become ordinary Electron cookies.
    const attrs = row.originAttributes;
    if (attrs && (typeof attrs === 'string' ? attrs !== '' : Object.values(attrs as object).some(value => value !== 0 && value !== '' && value !== false))) return;
    if (row.isPartitioned) return;
    if (typeof row.host !== 'string' || typeof row.name !== 'string' || typeof row.value !== 'string') return;
    cookies.push({ name: row.name, value: row.value, domain: row.host, path: typeof row.path === 'string' ? row.path : '/',
      expires: session ? -1 : Number(row.expiry), httpOnly: Boolean(row.isHttpOnly ?? row.httponly),
      secure: Boolean(row.isSecure ?? row.secure), sameSite: row.sameSite === 2 ? 'Strict' : row.sameSite === 1 ? 'Lax' : 'None' });
  };
  const dbPath = join(profile, 'cookies.sqlite');
  if (existsSync(dbPath)) {
    if (statSync(dbPath).size > 20_000_000) throw new Error('Firefox cookie database exceeds capture limit');
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db.query('SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite, originAttributes FROM moz_cookies LIMIT 10001').all() as Record<string, unknown>[];
      if (rows.length > 10000) throw new Error('Firefox cookie capture limit exceeded');
      for (const row of rows) append(row, false);
    } finally { db.close(); }
  }
  const sessionPath = join(profile, 'sessionstore.jsonlz4');
  if (existsSync(sessionPath)) {
    if (statSync(sessionPath).size > 20_000_000) throw new Error('Firefox session file exceeds capture limit');
    const session = decodeFirefoxSession(readFileSync(sessionPath)) as { cookies?: Record<string, unknown>[] };
    if (session.cookies && (!Array.isArray(session.cookies) || session.cookies.length > 10000)) throw new Error('Invalid Firefox session cookies');
    for (const row of session.cookies ?? []) append(row, true);
  }
  const filtered = sanitizeBrowserLoginStorageState({ cookies, origins: [] });
  const distinct = new Map(filtered.cookies.map(cookie => [`${cookie.domain}\0${cookie.path}\0${cookie.name}`, cookie]));
  return { cookies: [...distinct.values()], origins: [] };
}

export async function captureFirefoxLogin(executable: string, storageStatePath: string, options: SystemBrowserLoginOptions): Promise<SystemBrowserLoginCapture> {
  if (process.platform !== 'darwin' || !existsSync(executable)) throw new Error('Install Firefox on this Mac before selecting Firefox passkey login');
  const duration = options.timeoutMs ?? 600_000;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid Firefox login timeout');
  options.signal?.throwIfAborted();
  mkdirSync(dirname(storageStatePath), { recursive: true, mode: 0o700 });
  const profile = mkdtempSync(join(dirname(storageStatePath), 'firefox-login-'));
  // Only this disposable profile is changed; preserve the user's normal Firefox profiles.
  writeFileSync(join(profile, 'user.js'), 'user_pref("browser.sessionstore.privacy_level", 0);\nuser_pref("browser.startup.page", 3);\nuser_pref("browser.shell.checkDefaultBrowser", false);\n', { mode: 0o600 });
  let child: ChildProcess | undefined;
  let exited = false, continued = false;
  try {
    await new Promise<void>((resolve, reject) => {
      child = spawn(executable, ['-no-remote', '-profile', profile, '-new-window', 'https://chatgpt.com/?temporary-chat=true'], { stdio: 'ignore' });
      const abort = () => { child?.kill('SIGTERM'); reject(options.signal?.reason ?? new Error('Firefox login cancelled')); };
      const timer = setTimeout(() => { child?.kill('SIGTERM'); reject(new Error('Firefox passkey sign-in timed out')); }, duration);
      const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
      options.signal?.addEventListener('abort', abort, { once: true });
      child.once('spawn', () => options.onBrowserReady?.(() => revealOwnedLoginBrowser(child!, executable, profile), new Date(Date.now() + duration).toISOString()));
      child.once('error', error => { cleanup(); reject(error); });
      child.once('exit', () => { exited = true; cleanup(); continued ? resolve() : reject(new Error('Firefox closed before Continue was selected')); });
      void options.continuation.then(() => {
        if (!child || exited || child.exitCode !== null || child.signalCode !== null) return;
        continued = true; child.kill('SIGTERM');
      }, error => { cleanup(); reject(error); });
    });
    options.signal?.throwIfAborted();
    const storageState = readFirefoxLoginCookies(profile);
    if (!storageState.cookies.length) throw new Error('No ChatGPT login was captured from the dedicated Firefox profile; sign in and retry');
    return { storageState, marker: { version: 1, captureComplete: true, source: 'isolated-normal-browser-profile', capturedAt: new Date().toISOString() } };
  } finally {
    if (child?.pid && !exited && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 5000);
        child!.once('exit', () => { exited = true; clearTimeout(timer); resolve(); });
      });
      if (!exited && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 5000);
          child!.once('exit', () => { exited = true; clearTimeout(timer); resolve(); });
        });
      }
    }
    if (!child?.pid || exited || child.exitCode !== null || child.signalCode !== null) rmSync(profile, { recursive: true, force: true });
    else throw new Error('Firefox login process did not exit; its disposable profile was preserved for recovery');
  }
}
