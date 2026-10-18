import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

const PREFIX = "/Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework/Versions/3.9";
const CANDIDATE = "/Applications/Xcode.app/Contents/Developer/usr/bin/python3";
const STDLIB = join(PREFIX, "lib/python3.9"), LIBRARY = join(PREFIX, "Python3");
const LIMITS = { files: 2048, directories: 256, bytes: 64 * 1024 * 1024, fileBytes: 20 * 1024 * 1024 };
interface Pin { path: string; dev: string; ino: string; size: number; mtimeNs: string; ctimeNs: string; mode: number; kind: "file" | "directory" | "link"; sha256?: string; target?: string }
export interface AdmittedPythonRuntime {
  readonly kind: "python"; readonly executable: string; readonly executableSha256: string;
  readonly basePrefix: string; readonly stdlibRoot: string; readonly closureDigest: string;
  readonly readRoots: readonly string[]; readonly readFiles: readonly string[];
  readonly versionFamily: "3.9"; readonly origin: "root-owned-apple-xcode-framework";
  readonly closureFiles: number; readonly closureBytes: number;
}
const admitted = new WeakMap<AdmittedPythonRuntime, readonly Pin[]>();
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function metadata(path: string, kind: Pin["kind"]): Pin {
  const stat = lstatSync(path, { bigint: true });
  if (stat.uid !== 0n || kind !== "link" && (stat.mode & 0o022n) !== 0n
    || kind === "directory" && !stat.isDirectory() || kind === "file" && !stat.isFile() || kind === "link" && !stat.isSymbolicLink()) throw new Error("Python runtime closure must remain root-owned and protected");
  if (kind !== "link" && realpathSync(path) !== path) throw new Error("Python runtime closure must be canonical");
  return { path, dev: String(stat.dev), ino: String(stat.ino), size: Number(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs), mode: Number(stat.mode), kind };
}
function sameMetadata(pin: Pin): void {
  const current = metadata(pin.path, pin.kind);
  if (["dev", "ino", "size", "mtimeNs", "ctimeNs", "mode"].some(key => current[key as keyof Pin] !== pin[key as keyof Pin])
    || pin.kind === "link" && readlinkSync(pin.path) !== pin.target) throw new Error("Admitted Python runtime closure changed");
}
function filePin(path: string): Pin {
  const before = metadata(path, "file");
  if (before.size > LIMITS.fileBytes) throw new Error("Python runtime dependency exceeds the admission bound");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (String(opened.dev) !== before.dev || String(opened.ino) !== before.ino) throw new Error("Python dependency changed during admission");
    const digest = sha256(readFileSync(fd)); sameMetadata(before); return { ...before, sha256: digest };
  } finally { closeSync(fd); }
}
/** Passive, fixed Apple candidate only. No PATH lookup, shim execution, Python
 * startup, site import, installer, subprocess or caller-selected runtime root. */
export function admitApplePythonRuntime(): AdmittedPythonRuntime {
  if (process.platform !== "darwin") throw new Error("Selected Python resources require the macOS runtime boundary");
  const executable = realpathSync(CANDIDATE);
  if (executable !== join(PREFIX, "bin/python3.9")) throw new Error("The fixed Apple Python candidate resolved outside its reviewed framework");
  const pins = new Map<string, Pin>(); let files = 0, directories = 0, bytes = 0;
  const addDirectory = (path: string) => {
    if (pins.has(path)) return;
    if (++directories > LIMITS.directories) throw new Error("Python runtime directory closure exceeds its bound");
    pins.set(path, metadata(path, "directory"));
  };
  const addFile = (path: string) => {
    if (pins.has(path)) return;
    if (++files > LIMITS.files) throw new Error("Python runtime file closure exceeds its bound");
    const pin = filePin(path); bytes += pin.size; if (bytes > LIMITS.bytes) throw new Error("Python runtime dependency closure exceeds its byte bound"); pins.set(path, pin);
  };
  const addLink = (path: string, expected: string) => {
    const pin = metadata(path, "link"); if (realpathSync(path) !== expected) throw new Error("Python runtime link escapes its exact admitted dependency");
    pins.set(path, { ...pin, target: readlinkSync(path) });
  };
  const walk = (path: string) => {
    addDirectory(path);
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name), stat = lstatSync(child);
      if (stat.isDirectory()) walk(child);
      else if (stat.isFile()) addFile(child);
      else if (stat.isSymbolicLink() && [join(STDLIB, "config-3.9-darwin/libpython3.9.dylib"), join(STDLIB, "config-3.9-darwin/libpython3.9.a")].includes(child)) addLink(child, LIBRARY);
      else throw new Error("Python runtime contains an unadmitted dependency or link");
    }
  };
  walk(STDLIB); addFile(executable); addFile(LIBRARY);
  addLink(CANDIDATE, executable); addLink(join(PREFIX, "lib/libpython3.9.dylib"), LIBRARY);
  for (const path of [PREFIX, join(PREFIX, "bin"), join(PREFIX, "lib"), dirname(CANDIDATE)]) addDirectory(path);
  const zip = join(PREFIX, "lib/python39.zip");
  try { lstatSync(zip); addFile(zip); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const closure = [...pins.values()].sort((a, b) => a.path.localeCompare(b.path)); closure.forEach(sameMetadata);
  const runtime: AdmittedPythonRuntime = Object.freeze({ kind: "python", executable, executableSha256: pins.get(executable)!.sha256!, basePrefix: PREFIX,
    stdlibRoot: STDLIB, closureDigest: sha256(JSON.stringify(closure)), readRoots: Object.freeze([STDLIB]),
    readFiles: Object.freeze([executable, LIBRARY, ...(pins.has(zip) ? [zip] : [])]), versionFamily: "3.9", origin: "root-owned-apple-xcode-framework",
    closureFiles: files, closureBytes: bytes });
  admitted.set(runtime, Object.freeze(closure)); return runtime;
}
export function assertAdmittedPythonRuntime(runtime: AdmittedPythonRuntime): void {
  const pins = admitted.get(runtime);
  if (!pins) throw new Error("Python interpreter requires an owner-created runtime admission");
  pins.forEach(sameMetadata);
  // Every root-protected dependency was hashed at admission. Kernel ctime/inode
  // pins fence later changes; the executable itself is rehashed at dispatch.
  if (filePin(runtime.executable).sha256 !== runtime.executableSha256) throw new Error("Admitted Python executable changed");
}
/** Status is passive and cheap; complete dependency validation belongs to the
 * one immediate dispatch boundary, not UI refreshes or per-resource checks. */
export function pythonRuntimeStatus(runtime?: AdmittedPythonRuntime): { supported: boolean; reason?: string; executable?: string; executableSha256?: string; closureDigest?: string } {
  if (!runtime || !admitted.has(runtime)) return { supported: false, reason: "No admitted fixed Apple Python runtime" };
  try {
    const pins = admitted.get(runtime)!;
    for (const path of [runtime.executable, runtime.basePrefix, runtime.stdlibRoot]) sameMetadata(pins.find(pin => pin.path === path)!);
    return { supported: true, executable: runtime.executable, executableSha256: runtime.executableSha256, closureDigest: runtime.closureDigest };
  } catch { return { supported: false, reason: "Admitted Python runtime identity changed" }; }
}

/** Fixed application-owned bootstrap. No selected Python is read or compiled
 * until the kernel sandbox is applied and the sealed control FD is closed. */
export const SKILL_PYTHON_BOOTSTRAP = String.raw`
import sys, os, json, time, ctypes, hashlib
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    config = json.load(handle)
if not (sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode):
    raise SystemExit(125)
if os.path.realpath(sys.executable) != config["executable"] or os.path.realpath(sys.base_prefix) != config["basePrefix"] or sys.version_info[:2] != (3, 9):
    raise SystemExit(125)
for entry in sys.path:
    if not entry or not os.path.isabs(entry) or not (entry == config["stdlibZip"] or os.path.realpath(entry) == config["stdlibRoot"] or os.path.realpath(entry).startswith(config["stdlibRoot"] + os.sep)):
        raise SystemExit(125)
limit = time.monotonic() + 2
while True:
    try:
        with open(config["launchPermit"], "r", encoding="ascii") as permit:
            if permit.read() == "owned":
                break
    except OSError:
        pass
    if time.monotonic() > limit:
        raise SystemExit(125)
    time.sleep(0.01)
lib = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
lib.sandbox_init.argtypes = [ctypes.c_char_p, ctypes.c_uint64, ctypes.c_void_p]
lib.sandbox_init.restype = ctypes.c_int
if lib.sandbox_init(config["profile"].encode("utf-8"), 0, None) != 0:
    raise SystemExit(125)
os.write(3, b"sealed\n")
os.close(3)
with open(config["entry"], "rb") as selected:
    source = selected.read(32769)
if len(source) > 32768 or hashlib.sha256(source).hexdigest() != config["entryDigest"]:
    raise SystemExit(125)
sys.argv = [config["entry"]] + config["argv"]
sys.path = [os.path.dirname(config["entry"]), config["codeRoot"]] + sys.path
namespace = {"__name__": "__main__", "__file__": config["entry"], "__package__": None, "__cached__": None}
exec(compile(source, config["entry"], "exec", dont_inherit=True), namespace)
`;
export const SKILL_PYTHON_BOOTSTRAP_SHA256 = sha256(SKILL_PYTHON_BOOTSTRAP);
