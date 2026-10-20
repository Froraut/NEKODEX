import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

// Updated only with the reviewed fixed helper source, never from a live binary.
export const SKILL_PDF_HELPER_SOURCE_SHA256 = "24fea731ddc213e9c2d2c8133f5bd01113d1388274eec65ed7ba3b107d11f52b";
export interface PinnedSkillPdfHelper { readonly executable: string; readonly executableSha256: string; readonly sourceSha256: string; readonly development: boolean }
const pins = new WeakMap<PinnedSkillPdfHelper, { manifest: string; manifestSha256: string; metadata: string }>();
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function metadata(files: readonly string[]): string {
  return files.map(file => { const st = lstatSync(file, { bigint: true }); if (!st.isFile() || st.isSymbolicLink() || realpathSync(file) !== file || (st.mode & 0o022n)) throw new Error("PDF helper metadata changed"); return [st.dev, st.ino, st.size, st.mode, st.mtimeNs, st.ctimeNs].join(":"); }).join("|");
}
function readPinnedFile(file: string, maxBytes: number): Buffer {
  const before = lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || realpathSync(file) !== file || (before.mode & 0o022n) !== 0n || before.size > BigInt(maxBytes)) throw new Error("PDF helper files must be canonical, protected and bounded");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error("PDF helper identity changed");
    const data = readFileSync(fd), after = lstatSync(file, { bigint: true });
    if (data.length > maxBytes || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) throw new Error("PDF helper changed during pin validation");
    return data;
  } finally { closeSync(fd); }
}
function inspect(executable: string, platform: string, arch: string): PinnedSkillPdfHelper | undefined {
  try { lstatSync(executable); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  if (!(lstatSync(executable).mode & 0o111)) throw new Error("PDF helper is not executable");
  const manifestPath = join(dirname(executable), "manifest.json"), raw = readPinnedFile(manifestPath, 16384), manifest = JSON.parse(raw.toString("utf8"));
  if (manifest.version !== 1 || manifest.provider !== "macos-pdfkit" || manifest.target !== `${platform}-${arch}` || manifest.sourceSha256 !== SKILL_PDF_HELPER_SOURCE_SHA256 || typeof manifest.development !== "boolean" || manifest.probe !== manifest.development) throw new Error("PDF helper source/build identity differs");
  const executableSha256 = hash(readPinnedFile(executable, 16 * 1024 * 1024));
  if (manifest.executableSha256 !== executableSha256) throw new Error("PDF helper executable differs from its build receipt");
  const value = Object.freeze({ executable, executableSha256, sourceSha256: SKILL_PDF_HELPER_SOURCE_SHA256, development: manifest.development });
  pins.set(value, { manifest: manifestPath, manifestSha256: hash(raw), metadata: metadata([executable, manifestPath]) }); return value;
}
/** Passive status check only; dispatch still rehashes the exact bytes. */
export function assertPinnedSkillPdfHelperMetadata(helper: PinnedSkillPdfHelper): void {
  const pin = pins.get(helper); if (!pin || metadata([helper.executable, pin.manifest]) !== pin.metadata) throw new Error("PDF helper metadata changed");
}
export function assertPinnedSkillPdfHelper(helper: PinnedSkillPdfHelper): void {
  const pin = pins.get(helper); if (!pin) throw new Error("PDF helper requires an owner-resolved fixed layout");
  if (hash(readPinnedFile(pin.manifest, 16384)) !== pin.manifestSha256 || hash(readPinnedFile(helper.executable, 16 * 1024 * 1024)) !== helper.executableSha256) throw new Error("PDF helper pin changed");
}
export function resolveDevelopmentSkillPdfHelper(sourceEntryUrl: string, options: { platform?: NodeJS.Platform; arch?: string } = {}): PinnedSkillPdfHelper | undefined {
  const platform = options.platform ?? process.platform, arch = options.arch ?? process.arch;
  if (platform !== "darwin" || !["arm64", "x64"].includes(arch)) return undefined;
  const entry = fileURLToPath(sourceEntryUrl);
  if (basename(entry) !== "cli.ts" || basename(dirname(entry)) !== "src") return undefined;
  if (!lstatSync(entry).isFile() || realpathSync(entry) !== entry) throw new Error("PDF helper source entry is invalid");
  const root = dirname(dirname(entry));
  if (JSON.parse(readPinnedFile(join(root, "package.json"), 65536).toString()).name !== "codex-chatgpt-web") throw new Error("PDF source package identity changed");
  if (hash(readPinnedFile(join(root, "launcher/native/skill-pdf-helper.m"), 128 * 1024)) !== SKILL_PDF_HELPER_SOURCE_SHA256) throw new Error("PDF helper source changed; rebuild the reviewed source first");
  return inspect(join(root, "launcher/electron/skill-pdf-helper", `${platform}-${arch}`, "nekodex-skill-pdf-helper"), platform, arch);
}
/** Installed layout only. A missing relocated helper never selects a checkout,
 * PATH executable or an unpinned caller-supplied file. */
export function resolveSkillPdfHelper(options: { runtimeEntry?: string; platform?: NodeJS.Platform; arch?: string; explicit?: PinnedSkillPdfHelper } = {}): PinnedSkillPdfHelper | undefined {
  const platform = options.platform ?? process.platform, arch = options.arch ?? process.arch;
  if (platform !== "darwin" || !["arm64", "x64"].includes(arch)) return undefined;
  if (options.explicit) { assertPinnedSkillPdfHelper(options.explicit); return options.explicit; }
  const entry = options.runtimeEntry ?? process.argv[1];
  if (!entry || !isAbsolute(entry) || basename(entry) !== "cli.js") return undefined;
  try { if (realpathSync(entry) !== entry) return undefined; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  return inspect(join(dirname(entry), "skill-pdf-helper", `${platform}-${arch}`, "nekodex-skill-pdf-helper"), platform, arch);
}
