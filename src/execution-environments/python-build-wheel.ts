import { createHash } from 'node:crypto';
import { Inflate } from 'fflate';
import { safeVmPath, sha256, vmAssert } from './protocol';

export interface PythonBuildWheel {
  filename: string; name: string; version: string; artifactSha256: string;
  requires: string[]; providesExtra: string[]; requiresPython?: string; native: boolean; files: Map<string, Uint8Array>;
}
const MAX = 16 * 1024 * 1024;
const decode = (b: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(b);
const normalize = (s: string) => s.toLowerCase().replace(/[-_.]+/g, '-');
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
function crc32(data: Uint8Array) { let c = 0xffffffff; for (const n of data) c = crcTable[(c ^ n) & 255]! ^ c >>> 8; return (c ^ 0xffffffff) >>> 0; }
function headers(b: Uint8Array) {
  vmAssert(b.length <= 131072, 'python-build-metadata-limit'); const text = decode(b); vmAssert(!text.includes('\0'), 'python-build-metadata-invalid');
  const h = new Map<string, string[]>(); let key = '';
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (!line) break;
    if (/^[ \t]/.test(line)) { vmAssert(key, 'python-build-metadata-invalid'); h.get(key)![h.get(key)!.length - 1] += ' ' + line.trim(); continue; }
    const m = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*([^\x00-\x08\x0b-\x1f\x7f]*)$/.exec(line); vmAssert(m, 'python-build-metadata-invalid'); key = m[1]!.toLowerCase(); h.set(key, [...h.get(key) ?? [], m[2]!]);
  }
  return { h, one(key: string, optional = false) { const v = h.get(key); vmAssert(optional && !v || v?.length === 1, 'python-build-metadata-invalid'); return v?.[0]; } };
}
/** Inspects untrusted bytes without executing/importing any member. The same
 * bounded validator handles explicitly selected build dependencies and outputs. */
export function inspectPythonBuildWheel(input: Uint8Array, filename: string, options: { buildDependency?: boolean; budget?: { bytes: number; files: number } } = {}): PythonBuildWheel {
  const data = Buffer.from(input), m = /^([A-Za-z0-9_]+)-([A-Za-z0-9_.+!]+)-(py3|py2\.py3|cp314)-(none|cp314)-(any|linux_aarch64)\.whl$/.exec(filename);
  vmAssert(m && ((m[3] === 'cp314' && m[4] === 'cp314' && m[5] === 'linux_aarch64') || (m[3] !== 'cp314' && m[4] === 'none' && m[5] === 'any')), 'python-build-wheel-abi-unsupported');
  vmAssert(data.length >= 22 && data.length <= MAX, 'python-build-wheel-limit'); const end = data.length - 22;
  vmAssert(data.readUInt32LE(end) === 0x06054b50 && !data.readUInt16LE(end + 20) && !data.readUInt16LE(end + 4) && !data.readUInt16LE(end + 6), 'python-build-zip-invalid');
  const count = data.readUInt16LE(end + 10), central = data.readUInt32LE(end + 16);
  vmAssert(count > 0 && count <= 4096 && count === data.readUInt16LE(end + 8) && central + data.readUInt32LE(end + 12) === end, 'python-build-zip-invalid');
  if (options.budget) { options.budget.files += count; vmAssert(options.budget.files <= 4096, 'python-build-wheel-aggregate-limit'); }
  let at = central, total = 0; const seen = new Set<string>(), files = new Map<string, Uint8Array>(), spans: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    vmAssert(at + 46 <= end && data.readUInt32LE(at) === 0x02014b50, 'python-build-zip-invalid');
    const flags = data.readUInt16LE(at + 8), method = data.readUInt16LE(at + 10), crc = data.readUInt32LE(at + 16), packed = data.readUInt32LE(at + 20), size = data.readUInt32LE(at + 24), nl = data.readUInt16LE(at + 28), local = data.readUInt32LE(at + 42), mode = data.readUInt32LE(at + 38) >>> 16;
    vmAssert(!(flags & ~0x800) && [0, 8].includes(method) && !data.readUInt16LE(at + 30) && !data.readUInt16LE(at + 32) && !data.readUInt16LE(at + 34) && nl > 0 && at + 46 + nl <= end && size <= MAX && (total += size) <= 64 * 1024 * 1024, 'python-build-zip-unsupported');
    if (options.budget) { options.budget.bytes += size; vmAssert(options.budget.bytes <= 64 * 1024 * 1024, 'python-build-wheel-aggregate-limit'); }
    const raw = data.subarray(at + 46, at + 46 + nl), path = decode(raw), directory = path.endsWith('/'); safeVmPath(directory ? path.slice(0, -1) : path);
    vmAssert(!seen.has(path.toLowerCase()) && (!(mode & 0xf000) || (mode & 0xf000) === (directory ? 0x4000 : 0x8000)), 'python-build-wheel-path-invalid'); seen.add(path.toLowerCase());
    vmAssert((options.buildDependency || !/\.(pth|pyc|pyo|dylib|dll|pyd|exe|a|o)$/i.test(path) && !/(^|\/)(sitecustomize|usercustomize)\.py$/i.test(path)) && !path.split('/').some(p => p.endsWith('.data')), 'python-build-wheel-scheme-unsupported');
    vmAssert(local + 30 + nl <= central && data.readUInt32LE(local) === 0x04034b50 && data.readUInt16LE(local + 6) === flags && data.readUInt16LE(local + 8) === method && data.readUInt32LE(local + 14) === crc && data.readUInt32LE(local + 18) === packed && data.readUInt32LE(local + 22) === size && data.readUInt16LE(local + 26) === nl && !data.readUInt16LE(local + 28) && data.subarray(local + 30, local + 30 + nl).equals(raw), 'python-build-zip-invalid');
    const start = local + 30 + nl; vmAssert(start + packed <= central, 'python-build-zip-invalid'); spans.push([local, start + packed]);
    let bytes: Uint8Array;
    if (method === 0) bytes = data.subarray(start, start + packed);
    else { let length = 0, final = false; const chunks: Buffer[] = []; const stream = new Inflate((b, f) => { length += b.length; vmAssert(length <= size, 'python-build-zip-expansion'); chunks.push(Buffer.from(b)); final ||= f; });
      vmAssert(packed > 0, 'python-build-zip-invalid'); for (let n = 0; n < packed; n += 512) stream.push(data.subarray(start + n, Math.min(start + packed, start + n + 512)), n + 512 >= packed);
      vmAssert(final, 'python-build-zip-invalid'); bytes = Buffer.concat(chunks); }
    vmAssert(bytes.length === size && crc32(bytes) === crc && (!directory || size === 0), 'python-build-zip-crc');
    if (!directory) files.set(path, Uint8Array.from(bytes)); at += 46 + nl;
  }
  vmAssert(at === end, 'python-build-zip-invalid'); spans.sort((a, b) => a[0] - b[0]); let position = 0;
  for (const [start, finish] of spans) { vmAssert(start === position, 'python-build-zip-overlap'); position = finish; } vmAssert(position === central, 'python-build-zip-invalid');
  for (const path of files.keys()) { const p = path.split('/'); p.pop(); while (p.length) { vmAssert(!files.has(p.join('/')), 'python-build-wheel-path-collision'); p.pop(); } }
  const name = normalize(m[1]!), version = m[2]!, base = `${m[1]}-${version}.dist-info`, dist = [...new Set([...files.keys()].filter(p => p.split('/')[0]!.endsWith('.dist-info')).map(p => p.split('/')[0]))];
  vmAssert(dist.length === 1 && dist[0] === base && files.has(base + '/METADATA') && files.has(base + '/WHEEL') && files.has(base + '/RECORD'), 'python-build-wheel-identity');
  const h = headers(files.get(base + '/METADATA')!), w = headers(files.get(base + '/WHEEL')!), native = m[3] === 'cp314';
  vmAssert(/^(1\.[12]|2\.[0-4])$/.test(h.one('metadata-version')!) && normalize(h.one('name')!) === name && h.one('version') === version && w.one('wheel-version') === '1.0' && w.one('root-is-purelib') === String(!native) && !h.h.has('dynamic') && !w.h.has('build'), 'python-build-wheel-metadata');
  const tags = (m[3] === 'py2.py3' ? ['py2', 'py3'] : [m[3]]).map(p => `${p}-${m[4]}-${m[5]}`); vmAssert(JSON.stringify([...(w.h.get('tag') ?? [])].sort()) === JSON.stringify(tags.sort()), 'python-build-wheel-tag-mismatch');
  let nativeCount = 0;
  for (const [path, bytes] of files) {
    if (path.endsWith('.so')) { nativeCount++; vmAssert(native && path.endsWith('.cpython-314-aarch64-linux-musl.so') && bytes.length >= 64 && Buffer.from(bytes.subarray(0, 4)).equals(Buffer.from([127, 69, 76, 70])) && bytes[4] === 2 && bytes[5] === 1 && bytes[16] === 3 && bytes[17] === 0 && bytes[18] === 183 && bytes[19] === 0, 'python-build-native-abi-mismatch'); }
    else vmAssert(options.buildDependency || ![0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcafebabf, 0xcefaedfe, 0xcffaedfe, 0xbebafeca, 0xbfbafeca].includes(bytes.length >= 4 ? Buffer.from(bytes).readUInt32BE(0) : 0) && !(bytes[0] === 127 && bytes[1] === 69 && bytes[2] === 76 && bytes[3] === 70) && !(bytes[0] === 77 && bytes[1] === 90), 'python-build-hidden-native-content');
  }
  vmAssert(!native || nativeCount > 0, 'python-build-native-content-missing');
  const rows = new Map<string, string[]>(); for (const line of decode(files.get(base + '/RECORD')!).replace(/\r\n/g, '\n').split('\n')) { if (!line) continue; const r = /^([^,"\r\n]+),([^,"\r\n]*),([^,"\r\n]*)$/.exec(line); vmAssert(r && !rows.has(r[1]!), 'python-build-wheel-record'); rows.set(r[1]!, [r[2]!, r[3]!]); }
  vmAssert(rows.size === files.size, 'python-build-wheel-record'); for (const [path, bytes] of files) { const r = rows.get(path); vmAssert(r && (path === base + '/RECORD' ? r[0] === '' && r[1] === '' : r[0] === 'sha256=' + createHash('sha256').update(bytes).digest('base64url') && r[1] === String(bytes.length)), 'python-build-wheel-record'); }
  return { filename, name, version, artifactSha256: sha256(data), requires: h.h.get('requires-dist') ?? [], providesExtra: h.h.get('provides-extra') ?? [], requiresPython: h.one('requires-python', true), native, files };
}
