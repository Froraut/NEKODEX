import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync, chmodSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { Inflate } from "fflate";
import { clean as cleanVersion, valid as validVersion, validRange, satisfies as pep440Satisfies, explain as parseVersion, compare as compareVersion } from "@renovatebot/pep440";
import { assertAdmittedPythonRuntime, pythonRuntimeStatus, type AdmittedPythonRuntime } from "./skill-python-runtime";

export const SKILL_PYTHON_ENVIRONMENT_LIMITS = Object.freeze({ wheels: 16, artifactBytes: 8 * 1024 * 1024, artifactTotalBytes: 32 * 1024 * 1024,
  files: 4096, fileBytes: 2 * 1024 * 1024, expandedBytes: 64 * 1024 * 1024, actions: 32, registryBytes: 2 * 1024 * 1024, manifestBytes: 2 * 1024 * 1024 });
export interface SkillPythonEnvironmentPackage { name: string; version: string; artifactSha256: string }
export interface SkillPythonEnvironmentDescriptor {
  environmentId: string; runtimeClosureDigest: string; lockDigest: string; policyVersion: 1;
  packages: SkillPythonEnvironmentPackage[]; fileCount: number; bytes: number; state: "ready" | "unavailable"; reason?: string;
}
export interface SkillPythonEnvironmentAction {
  actionId: string; reviewDigest: string; state: "reviewed" | "prepared" | "ready" | "failed" | "unknown";
  ownerHeld: boolean; terminal: boolean; environment?: SkillPythonEnvironmentDescriptor; reason?: string;
}
export interface SkillPythonEnvironmentReview extends SkillPythonEnvironmentAction { state: "reviewed"; limitations: string[] }
/** Main-only authority; never serialize this object, its readRoot or the store root. */
export interface AdmittedPythonEnvironment {
  readonly kind: "python-environment"; readonly environmentId: string; readonly runtimeClosureDigest: string;
  readonly closureDigest: string; readonly readRoot: string; readonly packages: readonly SkillPythonEnvironmentPackage[];
}
interface FileRow { path: string; sha256: string; bytes: number }
interface Manifest { version: 1; policyVersion: 1; environmentId: string; runtimeClosureDigest: string; lockDigest: string;
  packages: SkillPythonEnvironmentPackage[]; files: FileRow[]; bytes: number }
interface PrivateAction { actionId: string; reviewDigest: string; state: SkillPythonEnvironmentAction["state"]; manifest: Manifest; reason?: string }
interface Registry { version: 1; actions: PrivateAction[] }
interface Pin { path: string; dev: bigint; ino: bigint; mtimeNs: bigint; ctimeNs: bigint; size: bigint; mode: bigint }
const brands = new WeakMap<AdmittedPythonEnvironment, { runtime: AdmittedPythonRuntime; pins: Pin[]; validate: () => void }>();
const HASH = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const L = SKILL_PYTHON_ENVIRONMENT_LIMITS;
const digest = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const encoded = (data: unknown) => JSON.stringify(data);
class PythonEnvironmentError extends Error {
  constructor(readonly reason: string) { super(reason); this.name = "PythonEnvironmentError"; }
}
function reject(reason: string): never { throw new PythonEnvironmentError(reason); }
/** Only fixed owner validation reasons are public; filesystem/runtime/parser
 * exceptions may contain private paths and must never become UI/model output. */
export function pythonEnvironmentPublicReason(error: unknown): string {
  return error instanceof PythonEnvironmentError ? error.reason : "Python environment runtime or storage is unavailable; inspect the exact action receipt";
}
export function asPythonEnvironmentPublicError(cause: unknown): Error {
  return new PythonEnvironmentError(pythonEnvironmentPublicReason(cause));
}
export function isPythonEnvironmentError(cause: unknown): boolean {
  return cause instanceof PythonEnvironmentError;
}
function pin(path: string, directory = false): Pin {
  const s = lstatSync(path, { bigint: true });
  if (s.uid !== BigInt(process.getuid!()) || (s.mode & 0o077n) || (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1n) || realpathSync(path) !== path) reject("Python environment private path identity is unsafe");
  return { path, dev: s.dev, ino: s.ino, mtimeNs: s.mtimeNs, ctimeNs: s.ctimeNs, size: s.size, mode: s.mode };
}
function readPrivate(path: string, max: number): Buffer {
  const before = pin(path); if (before.size > BigInt(max)) reject("Python environment file exceeds its bound");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd, { bigint: true }); if (opened.dev !== before.dev || opened.ino !== before.ino) reject("Python environment file changed");
    const data = readBounded(fd, max); const after = pin(path);
    if (["dev", "ino", "size", "mtimeNs", "ctimeNs", "mode"].some(k => after[k as keyof Pin] !== before[k as keyof Pin])) reject("Python environment file changed");
    return data;
  } finally { closeSync(fd); }
}
function readBounded(fd: number, max: number): Buffer { const chunks: Buffer[] = []; let size = 0;
  while (true) { const chunk = Buffer.alloc(Math.min(65536, max + 1 - size)); const count = readSync(fd, chunk); if (!count) break; size += count; if (size > max) reject("File grew beyond its bounded snapshot"); chunks.push(chunk.subarray(0, count)); } return Buffer.concat(chunks, size);
}
function syncDir(path: string): void { const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }
function createFile(path: string, bytes: string | Uint8Array, mode = 0o400): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function privateDir(path: string, create = false): void { if (!existsSync(path) && create) { mkdirSync(path, { mode: 0o700 }); syncDir(dirname(path)); } pin(path, true); }
function pathName(value: string): string {
  if (!value || value.length > 240 || !/^[A-Za-z0-9_.+!\/-]+$/.test(value) || value.startsWith("/") || value.endsWith("/") || value.split("/").some(p => !p || p === "." || p === "..")) reject("Unsupported wheel member path");
  if (value.split("/").some(p => /\.data$/i.test(p) || p === "__pycache__") || /\.(pth|so|dylib|dll|pyd|pyc|pyo|exe|a|o)$/i.test(value) || /(^|\/)(sitecustomize|usercustomize|setup)\.py$/i.test(value) || /(^|\/)(direct_url\.json|pyvenv\.cfg)$/i.test(value)) reject("Wheel contains unsupported native, startup, editable or installation-scheme content");
  return value;
}
function plainVersion(value: string): string {
  if (typeof value !== "string" || value.length > 128 || !validVersion(value)) reject("Invalid PEP 440 Python distribution version"); return cleanVersion(value)!;
}
function normalizedName(value: string): string {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,100}[A-Za-z0-9])?$/.test(value)) reject("Unsupported Python distribution name"); return value.toLowerCase().replace(/[-_.]+/g, "-");
}
/** Maintained PEP 440 implementation. PEP 508 markers/extras/direct URLs remain
 * explicitly unsupported; they are rejected before accepting a wheel closure. */
function satisfies(version: string, spec: string): boolean {
  if (spec.length > 512 || !validRange(spec)) reject("Invalid PEP 440 dependency constraint");
  // Explicit artifact selection opts into that artifact's prerelease; it is not
  // resolver discovery. Fix the dependency's documented simplified exclusive
  // comparison using its maintained version parser/order and PyPA rules:
  // https://packaging.python.org/en/latest/specifications/version-specifiers/#exclusive-ordered-comparison
  // In particular >1.7.post2 must accept 1.7.post3, and <1.0rc2 accepts 1.0rc1.
  return spec.split(",").every(part => {
    const exclusive = /^\s*([<>])\s*([^=].*?)\s*$/.exec(part);
    if (!exclusive) return pep440Satisfies(version, part, { prereleases: true });
    const candidate = parseVersion(version), bound = parseVersion(exclusive[2]!); if (!candidate || !bound) reject("Invalid exclusive Python version bound");
    const sameBase = compareVersion(candidate.base_version, bound.base_version) === 0, order = compareVersion(version, exclusive[2]!);
    return exclusive[1] === "<" ? order < 0 && !(sameBase && candidate.is_prerelease && !bound.is_prerelease)
      : order > 0 && !(sameBase && (candidate.local !== null || candidate.is_postrelease && !bound.is_postrelease));
  });
}
function headers(bytes: Buffer): Map<string, string[]> {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); if (text.includes("\0") || bytes.length > 128 * 1024) reject("Malformed wheel metadata");
  const result = new Map<string, string[]>(); let key: string | undefined;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!line) break;
    if (/^[ \t]/.test(line)) { if (!key) reject("Malformed wheel metadata continuation"); const values = result.get(key)!; values[values.length - 1] += " " + line.trim(); continue; }
    const m = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/.exec(line); if (!m || /[\r\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(line)) reject("Malformed wheel metadata header");
    key = m[1]!.toLowerCase(); const rows = result.get(key) ?? []; rows.push(m[2]!); result.set(key, rows);
  } return result;
}
function one(h: Map<string, string[]>, key: string, required?: true): string;
function one(h: Map<string, string[]>, key: string, required: false): string | undefined;
function one(h: Map<string, string[]>, key: string, required = true): string | undefined {
  const rows = h.get(key); if (!rows) { if (required) reject("Wheel metadata is missing a required field"); return; }
  if (rows.length !== 1) reject("Ambiguous repeated wheel metadata field"); return rows[0];
}
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
function crc32(data: Uint8Array): number { let c = 0xffffffff; for (const b of data) c = crcTable[(c ^ b) & 255]! ^ c >>> 8; return (c ^ 0xffffffff) >>> 0; }
/** Central/local cross-validation precedes bounded streaming DEFLATE. ZIP64,
 * encrypted entries, data descriptors and links are explicitly unsupported. */
function unpack(data: Buffer, budget: { bytes: number; files: number }): Map<string, Buffer> {
  if (data.length < 22 || data.length > L.artifactBytes) reject("Wheel artifact exceeds its bound");
  const end = data.length - 22;
  if (data.readUInt32LE(end) !== 0x06054b50 || data.readUInt16LE(end + 20) || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) reject("Unsupported ZIP end record");
  const count = data.readUInt16LE(end + 10), centralSize = data.readUInt32LE(end + 12), central = data.readUInt32LE(end + 16);
  if (count !== data.readUInt16LE(end + 8) || !count || count > L.files || central + centralSize !== end) reject("Malformed or oversized ZIP directory");
  budget.files += count; if (budget.files > L.files) reject("Selected wheel entries exceed the aggregate file bound");
  const rows: { name: string; start: number; end: number; compressed: number; expanded: number; method: number; crc: number; directory: boolean }[] = [];
  const names = new Set<string>(); let at = central, expandedTotal = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || data.readUInt32LE(at) !== 0x02014b50) reject("Malformed ZIP central entry");
    const flags = data.readUInt16LE(at + 8), method = data.readUInt16LE(at + 10), crc = data.readUInt32LE(at + 16), compressed = data.readUInt32LE(at + 20), expanded = data.readUInt32LE(at + 24);
    const nl = data.readUInt16LE(at + 28), extra = data.readUInt16LE(at + 30), comment = data.readUInt16LE(at + 32), local = data.readUInt32LE(at + 42), mode = data.readUInt32LE(at + 38) >>> 16;
    if ((flags & ~0x800) || ![0, 8].includes(method) || extra || comment || data.readUInt16LE(at + 34) || at + 46 + nl > end || !nl || expanded > L.fileBytes || compressed > L.artifactBytes) reject("Unsupported ZIP flags, extras, method or member size");
    const rawName = data.subarray(at + 46, at + 46 + nl), decoded = new TextDecoder("utf-8", { fatal: true }).decode(rawName), directory = decoded.endsWith("/");
    const name = pathName(directory ? decoded.slice(0, -1) : decoded), folded = name.toLowerCase();
    const type = mode & 0xf000;
    if (names.has(folded) || type && type !== (directory ? 0x4000 : 0x8000) || directory && (expanded || compressed)) reject("Duplicate, linked or nonregular ZIP member"); names.add(folded);
    if (local + 30 > central || data.readUInt32LE(local) !== 0x04034b50 || data.readUInt16LE(local + 6) !== flags || data.readUInt16LE(local + 8) !== method || data.readUInt32LE(local + 14) !== crc || data.readUInt32LE(local + 18) !== compressed || data.readUInt32LE(local + 22) !== expanded || data.readUInt16LE(local + 26) !== nl || data.readUInt16LE(local + 28) || !data.subarray(local + 30, local + 30 + nl).equals(rawName)) reject("ZIP local and central records differ");
    const start = local + 30 + nl; if (start + compressed > central) reject("ZIP member overlaps its directory");
    expandedTotal += expanded; budget.bytes += expanded; if (expandedTotal > L.expandedBytes || budget.bytes > L.expandedBytes) reject("Wheel expanded bytes exceed their aggregate bound");
    rows.push({ name, start: local, end: start + compressed, compressed, expanded, method, crc, directory }); at += 46 + nl;
  }
  if (at !== end) reject("Unparsed ZIP directory data");
  const ordered = [...rows].sort((a, b) => a.start - b.start); let previous = 0;
  for (const r of ordered) { if (r.start !== previous) reject("ZIP payload contains gaps or overlapping members"); previous = r.end; }
  if (previous !== central) reject("Unparsed ZIP payload data");
  const files = new Map<string, Buffer>();
  for (const r of rows) {
    const start = r.end - r.compressed; let bytes: Buffer;
    if (r.method === 0) bytes = Buffer.from(data.subarray(start, r.end));
    else {
      let actual = 0; const chunks: Buffer[] = []; let finalSeen = false;
      const inflate = new Inflate((chunk, final) => { actual += chunk.length; if (actual > r.expanded || actual > L.fileBytes) reject("Wheel expands beyond its declared bound"); chunks.push(Buffer.from(chunk)); finalSeen ||= final; });
      if (!r.compressed) reject("Malformed empty DEFLATE member");
      for (let p = start; p < r.end; p += 512) inflate.push(data.subarray(p, Math.min(p + 512, r.end)), p + 512 >= r.end);
      if (!finalSeen) reject("Incomplete wheel DEFLATE stream"); bytes = Buffer.concat(chunks, actual);
    }
    if (bytes.length !== r.expanded || crc32(bytes) !== r.crc) reject("Wheel member CRC or size mismatch");
    if (!r.directory) { if (bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || bytes[0] === 0x4d && bytes[1] === 0x5a || [0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcafebabf, 0xcefaedfe, 0xcffaedfe, 0xbebafeca, 0xbfbafeca].includes(bytes.length >= 4 ? bytes.readUInt32BE(0) : 0)) reject("Native code is unsupported in pure Python environments"); files.set(r.name, bytes); }
  }
  const fileNames = new Set([...files.keys()].map(n => n.toLowerCase()));
  for (const name of fileNames) { const parts = name.split("/"); parts.pop(); while (parts.length) { if (fileNames.has(parts.join("/"))) reject("Wheel file/directory collision"); parts.pop(); } }
  return files;
}
interface Wheel { pkg: SkillPythonEnvironmentPackage; files: Map<string, Buffer>; requires: string[] }
function wheel(bytes: Buffer, filename: string, runtime: AdmittedPythonRuntime, budget: { bytes: number; files: number }): Wheel {
  const m = /^([A-Za-z0-9_.]+)-([A-Za-z0-9_.+!]+)-(py3|py2\.py3)-none-any\.whl$/.exec(filename); if (!m) reject("Only selected pure py3/py2.py3-none-any wheels without build tags are supported");
  const name = normalizedName(m[1]!), version = plainVersion(m[2]!), files = unpack(bytes, budget);
  const dist = [...new Set([...files.keys()].filter(p => p.split("/")[0]!.endsWith(".dist-info")).map(p => p.split("/")[0]!))];
  const expected = `${name.replace(/-/g, "_")}-${version}.dist-info`;
  if (dist.length !== 1 || dist[0]!.toLowerCase() !== expected) reject("Wheel metadata directory identity does not match its filename");
  const base = dist[0]!, metadata = files.get(base + "/METADATA"), wh = files.get(base + "/WHEEL"), record = files.get(base + "/RECORD");
  if (!metadata || !wh || !record) reject("Wheel requires METADATA, WHEEL and RECORD");
  const h = headers(metadata), w = headers(wh), mv = one(h, "metadata-version")!;
  if (!/^(1\.[12]|2\.[0-4])$/.test(mv) || normalizedName(one(h, "name")!) !== name || plainVersion(one(h, "version")!) !== version || one(w, "wheel-version") !== "1.0" || one(w, "root-is-purelib") !== "true" || w.has("build") || h.has("dynamic") || h.has("requires-external")) reject("Unsupported or inconsistent wheel metadata");
  const tags = w.get("tag") ?? []; const expectedTags = m[3] === "py3" ? ["py3-none-any"] : ["py2-none-any", "py3-none-any"];
  if (tags.length !== expectedTags.length || new Set(tags).size !== tags.length || tags.some(tag => !expectedTags.includes(tag))) reject("Wheel compatibility tags do not match its filename");
  const py = one(h, "requires-python", false); if (py && (!runtime.pythonVersion || !satisfies(runtime.pythonVersion, py))) reject("Wheel does not support the exact admitted Python version");
  // Accepted paths exclude commas/quotes/newlines, so this restricted RECORD
  // grammar unambiguously covers every accepted archive path; other CSV is refused.
  const rows = new Map<string, [string, string]>(); const text = new TextDecoder("utf-8", { fatal: true }).decode(record);
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!line) continue; const r = /^([^,"\r\n]+),([^,"\r\n]*),([^,"\r\n]*)$/.exec(line); if (!r || rows.has(r[1]!)) reject("Unsupported or duplicate wheel RECORD row"); rows.set(r[1]!, [r[2]!, r[3]!]);
  }
  if (rows.size !== files.size) reject("Wheel RECORD does not cover exactly its files");
  for (const [path, data] of files) {
    const r = rows.get(path); if (!r) reject("Wheel RECORD omits a member");
    if (path === base + "/RECORD") { if (r[0] || r[1]) reject("Wheel RECORD self-row must be unhashed"); }
    else if (r[0] !== "sha256=" + createHash("sha256").update(data).digest("base64url") || r[1] !== String(data.length)) reject("Wheel RECORD hash or size mismatch");
  }
  return { pkg: { name, version, artifactSha256: digest(bytes) }, files, requires: h.get("requires-dist") ?? [] };
}
function validateManifest(m: Manifest): void {
  if (!m || m.version !== 1 || m.policyVersion !== 1 || !HASH.test(m.environmentId) || !HASH.test(m.runtimeClosureDigest) || !HASH.test(m.lockDigest) || !Array.isArray(m.packages) || !m.packages.length || m.packages.length > L.wheels || !Array.isArray(m.files) || !m.files.length || m.files.length > L.files) reject("Malformed Python environment manifest");
  const names = new Set<string>(); for (const p of m.packages) { if (normalizedName(p.name) !== p.name || plainVersion(p.version) !== p.version || !HASH.test(p.artifactSha256) || names.has(p.name)) reject("Malformed Python environment lock"); names.add(p.name); }
  let bytes = 0; const seen = new Set<string>(); for (const f of m.files) { pathName(f.path); if (!HASH.test(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes < 0 || f.bytes > L.fileBytes || seen.has(f.path.toLowerCase())) reject("Malformed Python environment tree"); seen.add(f.path.toLowerCase()); bytes += f.bytes; }
  if (bytes !== m.bytes || bytes > L.expandedBytes || digest(encoded(m.packages)) !== m.lockDigest || manifestId(m) !== m.environmentId) reject("Python environment manifest digest mismatch");
}
function manifestId(m: Omit<Manifest, "environmentId"> | Manifest): string { return digest(encoded({ version: m.version, policyVersion: m.policyVersion, runtimeClosureDigest: m.runtimeClosureDigest, lockDigest: m.lockDigest, packages: m.packages, files: m.files, bytes: m.bytes })); }
function metadataUnchanged(pins: Pin[]): void { for (const old of pins) { const now = pin(old.path, (old.mode & 0o170000n) === 0o040000n); if (["dev", "ino", "size", "mtimeNs", "ctimeNs", "mode"].some(k => old[k as keyof Pin] !== now[k as keyof Pin])) reject("Admitted Python environment changed"); } }
export function assertAdmittedPythonEnvironment(environment: AdmittedPythonEnvironment, runtime: AdmittedPythonRuntime): void {
  const brand = brands.get(environment); if (!brand || brand.runtime !== runtime || environment.runtimeClosureDigest !== runtime.closureDigest) reject("Python environment requires an exact owner-created runtime admission");
  assertAdmittedPythonRuntime(runtime); metadataUnchanged(brand.pins); brand.validate();
}
export function pythonEnvironmentStatus(environment?: AdmittedPythonEnvironment, runtime?: AdmittedPythonRuntime): { supported: boolean; reason?: string; environmentId?: string; closureDigest?: string } {
  if (!environment || !runtime || brands.get(environment)?.runtime !== runtime || !pythonRuntimeStatus(runtime).supported) return { supported: false, reason: "No matching admitted Python environment/runtime" };
  try { metadataUnchanged(brands.get(environment)!.pins); return { supported: true, environmentId: environment.environmentId, closureDigest: environment.closureDigest }; }
  catch { return { supported: false, reason: "Admitted Python environment identity changed" }; }
}

/** Pure offline wheel preparation. No resolver, pip, subprocess, package import,
 * setup/build hook, site processing or network. Explicit user calls alone write. */
export class SkillPythonEnvironmentStore {
  private readonly home: string;
  private readonly unsettled = new Set<string>();
  constructor(private readonly options: { home: string; runtime?: AdmittedPythonRuntime; getRuntime?: () => AdmittedPythonRuntime | undefined }) {
    if (!isAbsolute(options.home) || options.home.includes("\0")) reject("Python environment home must be an absolute owner path"); this.home = options.home;
  }
  private runtime(): AdmittedPythonRuntime { const runtime = this.options.getRuntime?.() ?? this.options.runtime; if (!runtime) reject("No admitted Python runtime"); assertAdmittedPythonRuntime(runtime); return runtime; }
  private mutation<T>(action: () => T): T {
    if (process.platform !== "darwin") reject("Python environment mutation requires the macOS advisory-lock boundary");
    this.runtime(); this.root(true);
    // Darwin XNU bsd/sys/fcntl.h: O_EXLOCK=0x20, O_NONBLOCK=0x04.
    // The persistent inode is never unlinked; kernel close/death releases its
    // advisory lock. No PID tombstone, timeout takeover or generic process kill.
    const path = join(this.home, ".lock"), fd = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | 0x20 | 0x04, 0o600);
    try {
      const before = pin(path), opened = fstatSync(fd, { bigint: true });
      if (opened.dev !== before.dev || opened.ino !== before.ino) reject("Python environment mutation lock identity changed");
      const result = action(); const after = pin(path); if (after.dev !== before.dev || after.ino !== before.ino) reject("Python environment mutation lock identity changed"); return result;
    } finally { closeSync(fd); }
  }
  private root(create = false): boolean {
    if (!existsSync(this.home)) { if (!create) return false; privateDir(dirname(this.home)); privateDir(this.home, true); }
    privateDir(this.home); return true;
  }
  private key(create = false): Buffer {
    this.root(create); const path = join(this.home, "integrity.key");
    if (!existsSync(path) && create) { createFile(path, randomBytes(32)); syncDir(this.home); }
    const key = readPrivate(path, 32); if (key.length !== 32) reject("Invalid Python environment integrity key"); return key;
  }
  private signed(value: unknown): string { const body = encoded(value); return encoded({ body, signature: createHmac("sha256", this.key()).update(body).digest("hex") }); }
  private verified<T>(path: string, max = L.manifestBytes): T {
    const e = JSON.parse(readPrivate(path, max).toString("utf8")); if (typeof e.body !== "string" || typeof e.signature !== "string" || !HASH.test(e.signature)) reject("Malformed signed Python environment record");
    const expected = createHmac("sha256", this.key()).update(e.body).digest(); if (!timingSafeEqual(expected, Buffer.from(e.signature, "hex"))) reject("Python environment record signature mismatch"); return JSON.parse(e.body) as T;
  }
  private checkedRegistry(state: Registry): Registry {
    if (state.version !== 1 || !Array.isArray(state.actions) || state.actions.length > L.actions) reject("Malformed Python environment registry");
    const ids = new Set<string>(); for (const a of state.actions) { if (!UUID.test(a.actionId) || ids.has(a.actionId) || !HASH.test(a.reviewDigest) || !["reviewed", "prepared", "ready", "failed", "unknown"].includes(a.state)) reject("Malformed Python environment action"); ids.add(a.actionId); validateManifest(a.manifest); if (a.reviewDigest !== digest(encoded(a.manifest))) reject("Python environment review identity mismatch"); }
    return state;
  }
  private committed(): Registry {
    if (!this.root() || !existsSync(join(this.home, "registry.json"))) return { version: 1, actions: [] };
    return this.checkedRegistry(this.verified<Registry>(join(this.home, "registry.json"), L.registryBytes));
  }
  private pending(base: Registry): { state: Registry; action: PrivateAction } | undefined {
    if (!this.root() || !existsSync(join(this.home, "registry.pending"))) return;
    const next = this.checkedRegistry(this.verified<Registry>(join(this.home, "registry.pending"), L.registryBytes));
    const changes = next.actions.filter(a => encoded(a) !== encoded(base.actions.find(b => b.actionId === a.actionId)));
    if (changes.length !== 1 || base.actions.some(a => !next.actions.some(b => b.actionId === a.actionId))) reject("Contradictory pending Python environment publication");
    const action = changes[0]!, before = base.actions.find(a => a.actionId === action.actionId);
    if (!before ? action.state !== "reviewed" || next.actions.length !== base.actions.length + 1
      : next.actions.length !== base.actions.length || before.reviewDigest !== action.reviewDigest || encoded(before.manifest) !== encoded(action.manifest)
        || !(before.state === "reviewed" && action.state === "prepared" || ["prepared", "unknown"].includes(before.state) && ["ready", "prepared", "unknown"].includes(action.state)
          || before.state === "unknown" && action.state === "reviewed" || before.state === "ready" && action.state === "ready")) reject("Invalid pending Python environment transition");
    return { state: next, action };
  }
  private registry(): Registry {
    const base = this.committed(), pending = this.pending(base); if (!pending) return base;
    return { version: 1, actions: pending.state.actions.map(a => a.actionId === pending.action.actionId ? { ...a, state: "unknown", reason: "Durable pending publication requires explicit reconciliation" } : a) };
  }
  private holdPending(pending: { state: Registry; action: PrivateAction }): Registry {
    const holding: Registry = { version: 1, actions: pending.state.actions.map(a => a.actionId === pending.action.actionId ? { ...a, state: "unknown", reason: "Pending publication retained without preparation replay" } : a) };
    // Durable held identity precedes moving pending evidence. A crash at either
    // rename leaves the same action unknown, never an unheld reviewed action.
    const path = join(this.home, "registry.reconcile");
    if (existsSync(path)) { if (encoded(this.checkedRegistry(this.verified<Registry>(path, L.registryBytes))) !== encoded(holding)) reject("Foreign reconciliation publication is preserved"); }
    else createFile(path, this.signed(holding));
    renameSync(path, join(this.home, "registry.json")); syncDir(this.home);
    const evidence = join(this.home, "transactions"); privateDir(evidence, true);
    const source = join(this.home, "registry.pending"), bytes = readPrivate(source, L.registryBytes), destination = join(evidence, digest(bytes) + ".json");
    if (existsSync(destination)) reject("Existing pending publication evidence is preserved");
    renameSync(source, destination); syncDir(evidence); syncDir(this.home); return holding;
  }
  private publish(state: Registry): void {
    const bytes = this.signed(state); if (Buffer.byteLength(bytes) + state.actions.length * 1024 > L.registryBytes) reject("Python environment registry capacity reached");
    const path = join(this.home, "registry.json"), next = join(this.home, "registry.pending"); if (existsSync(next)) reject("Python environment publication requires exact inspection");
    createFile(next, bytes); if (existsSync(path)) pin(path); renameSync(next, path); syncDir(this.home);
  }
  private descriptor(m: Manifest, ready: boolean, reason?: string): SkillPythonEnvironmentDescriptor {
    const runtime = this.options.getRuntime?.() ?? this.options.runtime;
    if (!runtime || !pythonRuntimeStatus(runtime).supported || runtime.closureDigest !== m.runtimeClosureDigest) return { environmentId: m.environmentId, runtimeClosureDigest: m.runtimeClosureDigest, lockDigest: m.lockDigest, policyVersion: 1, packages: structuredClone(m.packages), fileCount: m.files.length, bytes: m.bytes, state: "unavailable", reason: "Matching admitted runtime is unavailable" };
    return { environmentId: m.environmentId, runtimeClosureDigest: m.runtimeClosureDigest, lockDigest: m.lockDigest, policyVersion: 1, packages: structuredClone(m.packages), fileCount: m.files.length, bytes: m.bytes, state: ready ? "ready" : "unavailable", ...(reason ? { reason } : {}) };
  }
  private envRoot(id: string): string { if (!HASH.test(id)) reject("Invalid Python environment identity"); return join(this.home, "environments", id); }
  private verifyTree(root: string, m: Manifest): Pin[] {
    privateDir(root); const stored = this.verified<Manifest>(join(root, "manifest.json")); validateManifest(stored); if (encoded(stored) !== encoded(m)) reject("Python environment published manifest differs");
    const data = join(root, "data"), pins: Pin[] = [pin(root, true), pin(join(root, "manifest.json")), pin(data, true)]; const actual: string[] = [], expectedDirs = new Set<string>();
    if (pins[1]!.mode & 0o222n || pins[2]!.mode & 0o222n || dirname(root) === join(this.home, "environments") && pins[0]!.mode & 0o222n) reject("Python environment code/data must remain read-only");
    for (const f of m.files) { const parts = f.path.split("/"); parts.pop(); while (parts.length) { expectedDirs.add(parts.join("/")); parts.pop(); } }
    const walk = (dir: string, rel = "") => { for (const name of readdirSync(dir).sort()) { const path = join(dir, name), r = rel ? rel + "/" + name : name, s = lstatSync(path), current = pin(path, s.isDirectory());
      if (current.mode & 0o222n) reject("Python environment code/data must remain read-only"); pins.push(current);
      if (s.isDirectory()) { if (!expectedDirs.has(r)) reject("Unreviewed Python environment directory"); walk(path, r); } else actual.push(r);
    } };
    walk(data); actual.sort(); if (actual.length !== m.files.length || actual.some((path, i) => path !== m.files[i]!.path)) reject("Python environment tree membership changed");
    for (const f of m.files) { const bytes = readPrivate(join(data, f.path), L.fileBytes); if (bytes.length !== f.bytes || digest(bytes) !== f.sha256) reject("Python environment content changed"); } return pins;
  }
  private project(a: PrivateAction): SkillPythonEnvironmentAction {
    const held = this.unsettled.has(a.actionId) || a.state === "prepared";
    const state = held ? "unknown" : a.state, reason = held ? "Preparation outcome requires explicit reconciliation; never replay" : a.reason;
    return { actionId: a.actionId, reviewDigest: a.reviewDigest, state, ownerHeld: state === "prepared" || state === "unknown", terminal: state === "ready" || state === "failed", environment: this.descriptor(a.manifest, state === "ready", reason), ...(reason ? { reason } : {}) };
  }
  review(actionId: string, input: { wheelPaths: string[] }, explicitUserAction: true): SkillPythonEnvironmentReview {
    if (explicitUserAction !== true || !UUID.test(actionId)) reject("Wheel review requires an explicit user action and opaque action ID");
    return this.mutation(() => this.reviewLocked(actionId, input, explicitUserAction));
  }
  private reviewLocked(actionId: string, input: { wheelPaths: string[] }, explicitUserAction: true): SkillPythonEnvironmentReview {
    if (explicitUserAction !== true || !UUID.test(actionId)) reject("Wheel review requires an explicit user action and opaque action ID");
    const runtime = this.runtime(), previous = this.registry().actions.find(a => a.actionId === actionId); if (previous) reject("Python environment action ID was already consumed; inspect its exact outcome");
    if (!input || !Array.isArray(input.wheelPaths) || !input.wheelPaths.length || input.wheelPaths.length > L.wheels || new Set(input.wheelPaths).size !== input.wheelPaths.length) reject("Select one to sixteen wheel artifacts");
    let total = 0; const artifacts: { bytes: Buffer; name: string }[] = [];
    for (const path of input.wheelPaths) {
      if (typeof path !== "string" || !isAbsolute(path) || realpathSync(path) !== path || !path.endsWith(".whl")) reject("Select canonical .whl files");
      const before = lstatSync(path, { bigint: true }); if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(L.artifactBytes)) reject("Selected wheel is not a bounded regular file");
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); let bytes: Buffer;
      try { const s = fstatSync(fd, { bigint: true }); if (s.dev !== before.dev || s.ino !== before.ino) reject("Selected wheel changed"); bytes = readBounded(fd, L.artifactBytes); const after = lstatSync(path, { bigint: true }); if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.ctimeNs !== before.ctimeNs || after.mtimeNs !== before.mtimeNs) reject("Selected wheel changed"); } finally { closeSync(fd); }
      total += bytes!.length; if (total > L.artifactTotalBytes) reject("Selected wheel aggregate exceeds its bound"); artifacts.push({ bytes: bytes!, name: basename(path) });
    }
    const budget = { bytes: 0, files: 0 }, wheels = artifacts.map(a => wheel(a.bytes, a.name, runtime, budget)), packages = wheels.map(w => w.pkg).sort((a, b) => a.name.localeCompare(b.name)), names = new Map(packages.map(p => [p.name, p]));
    if (names.size !== packages.length) reject("Select exactly one artifact per normalized distribution");
    for (const w of wheels) for (const raw of w.requires) {
      const r = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\(([^()]+)\)|([<>=!].*))?$/.exec(raw); if (!r) reject("Unsupported Requires-Dist marker, extra, URL or requirement grammar");
      const dependency = names.get(normalizedName(r[1]!)); if (!dependency || (r[2] || r[3]) && !satisfies(dependency.version, (r[2] || r[3])!)) reject("Selected wheel dependency closure is incomplete or incompatible");
    }
    const content = new Map<string, Buffer>(), folded = new Set<string>(); let expanded = 0;
    for (const w of wheels) for (const [path, bytes] of w.files) { if (folded.has(path.toLowerCase())) reject("Selected wheels collide in the installed file tree"); folded.add(path.toLowerCase()); content.set(path, bytes); expanded += bytes.length; }
    if (content.size > L.files || expanded > L.expandedBytes) reject("Selected environment exceeds its extracted bounds");
    for (const path of content.keys()) { const parts = path.split("/"); parts.pop(); while (parts.length) { if (folded.has(parts.join("/").toLowerCase())) reject("Selected wheels have a file/directory collision"); parts.pop(); } }
    const core = { version: 1 as const, policyVersion: 1 as const, runtimeClosureDigest: runtime.closureDigest, lockDigest: digest(encoded(packages)), packages, files: [...content].map(([path, bytes]) => ({ path, sha256: digest(bytes), bytes: bytes.length })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), bytes: expanded };
    const manifest: Manifest = { ...core, environmentId: manifestId(core) }; validateManifest(manifest);
    const state = this.registry(); if (state.actions.length >= L.actions || state.actions.some(a => this.project(a).ownerHeld)) reject("Python environment capacity or unresolved preparation blocks new writes");
    this.root(true); this.key(true); privateDir(join(this.home, "reviews"), true); privateDir(join(this.home, "environments"), true);
    const root = join(this.home, "reviews", actionId); if (existsSync(root)) reject("Existing review storage requires exact inspection"); privateDir(root, true); privateDir(join(root, "data"), true); privateDir(join(root, "wheels"), true);
    for (const artifact of artifacts) createFile(join(root, "wheels", digest(artifact.bytes) + ".whl"), artifact.bytes);
    chmodSync(join(root, "wheels"), 0o500); syncDir(join(root, "wheels"));
    this.writeTree(join(root, "data"), manifest, path => content.get(path)!); createFile(join(root, "manifest.json"), this.signed(manifest)); syncDir(root);
    const action: PrivateAction = { actionId, reviewDigest: digest(encoded(manifest)), state: "reviewed", manifest }; state.actions.push(action); this.publish(state);
    return { ...this.project(action), state: "reviewed", limitations: ["pure-any-wheels-only", "pep440-requirements-no-pep508-markers-extras-or-direct-urls", "explicit-artifact-prerelease-selection", "offline-no-resolver-pip-build-hooks-or-package-import", "site-and-startup-processing-disabled"] };
  }
  private writeTree(root: string, m: Manifest, bytes: (path: string) => Buffer): void {
    for (const f of m.files) { const path = join(root, f.path); const parts = f.path.split("/"); parts.pop(); let dir = root; for (const part of parts) { dir = join(dir, part); privateDir(dir, true); } const data = bytes(f.path); if (data.length !== f.bytes || digest(data) !== f.sha256) reject("Reviewed wheel bytes changed before publication"); createFile(path, data); }
    const seal = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (lstatSync(path).isDirectory()) seal(path); } chmodSync(dir, 0o500); syncDir(dir); }; seal(root);
  }
  prepare(actionId: string, reviewDigest: string, explicitUserAction: true): SkillPythonEnvironmentAction {
    if (explicitUserAction !== true || !UUID.test(actionId) || typeof reviewDigest !== "string" || !HASH.test(reviewDigest)) reject("Environment preparation requires exact explicit review");
    return this.mutation(() => this.prepareLocked(actionId, reviewDigest, explicitUserAction));
  }
  private prepareLocked(actionId: string, reviewDigest: string, explicitUserAction: true): SkillPythonEnvironmentAction {
    if (explicitUserAction !== true || !UUID.test(actionId) || typeof reviewDigest !== "string" || !HASH.test(reviewDigest)) reject("Environment preparation requires exact explicit review");
    const runtime = this.runtime(), state = this.registry(), action = state.actions.find(a => a.actionId === actionId); if (!action || action.reviewDigest !== reviewDigest) reject("Python environment review identity changed");
    if (action.state !== "reviewed" || this.unsettled.has(actionId)) return this.project(action);
    if (action.manifest.runtimeClosureDigest !== runtime.closureDigest || state.actions.some(a => a !== action && this.project(a).ownerHeld)) reject("Runtime changed or a prior environment preparation remains unresolved");
    const root = join(this.home, "reviews", actionId); this.verifyTree(root, action.manifest);
    privateDir(join(root, "wheels"));
    if (readdirSync(join(root, "wheels")).length !== action.manifest.packages.length) reject("Reviewed artifact snapshot membership changed");
    for (const pkg of action.manifest.packages) { if (digest(readPrivate(join(root, "wheels", pkg.artifactSha256 + ".whl"), L.artifactBytes)) !== pkg.artifactSha256) reject("Reviewed wheel artifact snapshot changed"); }
    action.state = "prepared";
    try { this.publish(state); } catch (error) { this.unsettled.add(actionId); throw error; } // durable intent before any environment publication
    try {
      const destination = this.envRoot(action.manifest.environmentId);
      if (existsSync(destination)) this.verifyTree(destination, action.manifest);
      else {
        const candidate = join(this.home, "environments", ".prepare-" + actionId); if (existsSync(candidate)) reject("Existing preparation candidate requires exact inspection"); privateDir(candidate, true); privateDir(join(candidate, "data"), true);
        this.writeTree(join(candidate, "data"), action.manifest, path => readPrivate(join(root, "data", path), L.fileBytes));
        createFile(join(candidate, "manifest.json"), this.signed(action.manifest)); chmodSync(candidate, 0o500); syncDir(candidate);
        this.verifyTree(candidate, action.manifest); renameSync(candidate, destination); syncDir(dirname(destination));
      }
      this.verifyTree(destination, action.manifest); action.state = "ready"; this.publish(state); return this.project(action);
    } catch { this.unsettled.add(actionId); return { actionId, reviewDigest, state: "unknown", ownerHeld: true, terminal: false, environment: this.descriptor(action.manifest, false), reason: "Preparation may have published; inspect exact action, never replay" }; }
  }
  inspect(actionId: string): SkillPythonEnvironmentAction | null { if (!UUID.test(actionId)) reject("Invalid environment action ID"); const action = this.registry().actions.find(a => a.actionId === actionId); return action ? this.project(action) : null; }
  reconcile(actionId: string, explicitUserAction: true): SkillPythonEnvironmentAction {
    if (explicitUserAction !== true || !UUID.test(actionId)) reject("Reconciliation requires an explicit exact user action");
    return this.mutation(() => this.reconcileLocked(actionId, explicitUserAction));
  }
  private reconcileLocked(actionId: string, explicitUserAction: true): SkillPythonEnvironmentAction {
    if (explicitUserAction !== true || !UUID.test(actionId)) reject("Reconciliation requires an explicit exact user action");
    const runtime = this.runtime(), base = this.committed(), pending = this.pending(base);
    if (pending && pending.action.actionId !== actionId) reject("Reconcile the exact pending environment action first");
    if (pending && pending.action.manifest.runtimeClosureDigest !== runtime.closureDigest) reject("Pending environment belongs to a different runtime closure");
    const state = pending ? this.holdPending(pending) : base, action = state.actions.find(a => a.actionId === actionId); if (!action) reject("Unknown Python environment action");
    if (!["prepared", "unknown"].includes(action.state) && !this.unsettled.has(actionId)) return this.project(action);
    if (action.manifest.runtimeClosureDigest !== runtime.closureDigest) return this.project(action);
    if (pending?.action.state === "reviewed") {
      try { this.verifyTree(join(this.home, "reviews", actionId), action.manifest); } catch { return this.project(action); }
      action.state = "reviewed"; action.reason = "Exact reviewed snapshot recovered; no preparation was replayed";
      try { this.publish(state); this.unsettled.delete(actionId); return this.project(action); } catch { this.unsettled.add(actionId); return this.project({ ...action, state: "unknown" }); }
    }
    try { this.verifyTree(this.envRoot(action.manifest.environmentId), action.manifest); } catch { return this.project(action); }
    // Observe only the already-published immutable tree, then settle the same
    // action. No extraction, copy, rename, install or preparation replay.
    action.state = "ready"; action.reason = "Exact published environment verified without replay";
    try { this.publish(state); this.unsettled.delete(actionId); return this.project(action); } catch { this.unsettled.add(actionId); return { ...this.project({ ...action, state: "unknown" }), reason: "Exact environment is published; local settlement remains uncertain" }; }
  }
  actions(): SkillPythonEnvironmentAction[] { return this.registry().actions.map(action => this.project(action)); }
  list(): SkillPythonEnvironmentDescriptor[] {
    const rows = this.registry().actions, result = new Map<string, SkillPythonEnvironmentDescriptor>();
    for (const a of rows) { const ready = this.project(a).state === "ready"; if (!result.has(a.manifest.environmentId) || ready) result.set(a.manifest.environmentId, this.descriptor(a.manifest, ready, ready ? undefined : "Environment is not durably ready; inspect its exact action")); } return [...result.values()];
  }
  admit(environmentId: string): AdmittedPythonEnvironment {
    const runtime = this.runtime(), action = this.registry().actions.find(a => a.manifest.environmentId === environmentId && this.project(a).state === "ready"); if (!action || action.manifest.runtimeClosureDigest !== runtime.closureDigest) reject("No exact ready Python environment for this runtime");
    const root = this.envRoot(environmentId), pins = this.verifyTree(root, action.manifest);
    const environment: AdmittedPythonEnvironment = Object.freeze({ kind: "python-environment", environmentId, runtimeClosureDigest: runtime.closureDigest, closureDigest: environmentId, readRoot: join(root, "data"), packages: Object.freeze(action.manifest.packages.map(p => Object.freeze({ ...p }))) });
    brands.set(environment, { runtime, pins, validate: () => { this.verifyTree(root, action.manifest); } }); return environment;
  }
}
