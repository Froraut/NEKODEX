'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest('hex');
const invalid = message => { throw new Error(`SSH config alias: ${message}`); };
function readConfig(file) {
  if (!path.isAbsolute(file) || fs.realpathSync(file) !== file) invalid('config must be a canonical regular file without links.');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > 65536n || (before.mode & 0o022n) !== 0n) invalid('config must be at most 64 KiB and not writable by other users.');
    const buffer = Buffer.alloc(65537); let count = 0;
    while (count < buffer.length) { const read = fs.readSync(fd, buffer, count, buffer.length - count, null); if (!read) break; count += read; }
    const bytes = buffer.subarray(0, count), after = fs.fstatSync(fd, { bigint: true }), current = fs.statSync(file, { bigint: true });
    const pin = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
    if (bytes.length > 65536 || pin(before) !== pin(after) || pin(before) !== pin(current) || fs.realpathSync(file) !== file) invalid('config changed while reading; reconnect.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) invalid('config is not supported text.');
    return { text, pin: pin(before), sha256: digest(bytes) };
  } finally { fs.closeSync(fd); }
}
function tokens(line) {
  const result = []; let value = '', quote = null, escaped = false, started = false;
  for (const char of line) {
    if (escaped) { value += char; escaped = false; started = true; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (quote) { if (char === quote) quote = null; else value += char; started = true; continue; }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (char === '#') break;
    if (char === '=' && result.length === 1 && !started) continue;
    if (/\s/.test(char) || char === '=' && result.length === 0) { if (started) { result.push(value); value = ''; started = false; } continue; }
    value += char; started = true;
  }
  if (quote || escaped) invalid('unterminated quote or line continuation is unsupported.');
  if (started) result.push(value);
  return result;
}
function hostMatch(patterns, alias) {
  let matched = false;
  for (const entry of patterns) {
    const negative = entry.startsWith('!'), pattern = negative ? entry.slice(1) : entry;
    if (!pattern || !/^[A-Za-z0-9_.?*:-]+$/.test(pattern)) invalid('unsupported Host pattern.');
    const expression = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    if (expression.test(alias)) { if (negative) return false; matched = true; }
  }
  return matched;
}
/** A bounded data-only Host subset; never calls ssh -G or evaluates config commands. */
function resolveSshConfigAlias(profile, context = {}) {
  const home = context.home ?? os.homedir(), file = context.configPath ?? path.join(home, '.ssh', 'config');
  const source = readConfig(file), values = {}, identities = []; let active = true, matchedHost = false;
  const lines = source.text.split(/\r?\n/); if (lines.length > 2048) invalid('config line limit exceeded.');
  for (const line of lines) {
    const [rawName, ...args] = tokens(line); if (!rawName) continue; const name = rawName.toLowerCase();
    // These can affect later Host blocks; silently skipping them would invent a destination.
    if (name === 'include' || name === 'match') invalid(`${rawName} is unsupported; use an explicit supported Host block.`);
    if (name === 'host') { if (!args.length) invalid('Host needs a pattern.'); active = hostMatch(args, profile.hostname); matchedHost ||= active; continue; }
    if (!active) continue;
    if (!['hostname', 'user', 'port', 'identityfile', 'identitiesonly', 'hostkeyalias'].includes(name)) invalid(`directive ${rawName} is unsupported; no connection was started.`);
    if (args.length !== 1 || !args[0]) invalid(`${rawName} needs one value.`);
    if (name === 'identityfile') { if (identities.length >= 8) invalid('at most eight IdentityFile values are supported.'); identities.push(args[0]); }
    else if (!Object.hasOwn(values, name)) values[name] = args[0];
  }
  if (!matchedHost) invalid('no supported Host block matches this alias.');
  const hostname = values.hostname ?? profile.hostname, username = profile.username || values.user || context.username || os.userInfo().username;
  if (values.port !== undefined && !/^[0-9]{1,5}$/.test(values.port)) invalid('Port must be decimal.');
  const port = profile.port ?? (values.port === undefined ? 22 : Number(values.port));
  if (!/^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/.test(hostname) || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(username)
    || !Number.isInteger(port) || port < 1 || port > 65535) invalid('resolved hostname, user or port is unsupported.');
  const options = [];
  if (values.identitiesonly !== undefined) {
    if (!['yes', 'no'].includes(values.identitiesonly.toLowerCase())) invalid('IdentitiesOnly must be yes or no.');
    options.push('-o', `IdentitiesOnly=${values.identitiesonly.toLowerCase()}`);
  }
  if (values.hostkeyalias !== undefined) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,252}$/.test(values.hostkeyalias)) invalid('HostKeyAlias is unsupported.');
    options.push('-o', `HostKeyAlias=${values.hostkeyalias}`);
  }
  const identityPins = [];
  if (identities.some(identity => identity.toLowerCase() === 'none') && identities.length !== 1) invalid('IdentityFile none cannot be mixed with other identities in this subset.');
  for (let identity of identities) {
    if (identity.toLowerCase() === 'none') { options.push('-o', 'IdentityFile=none'); continue; }
    identity = identity.replace(/^~(?=\/|$)/, home).replace(/%([dhrnp%])/g, (_match, token) => ({ d: home, h: hostname, r: username, n: profile.hostname, p: String(port), '%': '%' })[token] ?? invalid('unsupported IdentityFile token.'));
    if (!path.isAbsolute(identity) || /[%\u0000-\u001f]/.test(identity)) invalid('IdentityFile must resolve to an absolute path with supported tokens.');
    identity = path.normalize(identity);
    // Metadata only: this owner never reads private key bytes.
    let pin = null;
    try { const stat = fs.lstatSync(identity, { bigint: true }); if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(identity) !== identity) invalid('IdentityFile must be a canonical regular file.'); pin = [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    identityPins.push({ path: identity, pin }); options.push('-i', identity);
  }
  const snapshot = { version: 1, alias: profile.hostname, file, sourcePin: source.pin, sourceSha256: source.sha256, hostname, username, port, options, identityPins };
  return Object.freeze({ ...snapshot, fingerprint: digest(JSON.stringify(snapshot)) });
}
function assertSshConfigSnapshot(snapshot) {
  const source = readConfig(snapshot.file);
  if (source.pin !== snapshot.sourcePin || source.sha256 !== snapshot.sourceSha256) invalid('config changed; disconnect and reconnect before further work.');
  for (const identity of snapshot.identityPins) {
    let pin = null;
    try { const stat = fs.lstatSync(identity.path, { bigint: true }); if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(identity.path) !== identity.path) invalid('IdentityFile changed; reconnect.'); pin = [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (pin !== identity.pin) invalid('IdentityFile metadata changed; reconnect.');
  }
}
module.exports = { resolveSshConfigAlias, assertSshConfigSnapshot };
