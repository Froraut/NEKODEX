import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { sha256 } from "./config";
import { inspectBoundedImageBytes } from "../../launcher/electron/owned-native-images.cjs";
import { snapshotLocalSkillSource, type LocalSkillSourceManifest, type SkillIdentity, type SkillRootGrant } from "./skills";

export const SKILL_PACKAGE_LIMITS = Object.freeze({ maxResources: 16, maxResourceBytes: 32 * 1024, maxTotalBytes: 128 * 1024, maxImageBytes: 160 * 1024, maxImages: 8, maxImagePixels: 32 * 1024 * 1024, maxMixedBytes: 512 * 1024 });
export const UNSUPPORTED_SKILL_RESOURCES = Object.freeze(["unselected-scripts-and-other-executables", "binary-assets-other-than-selected-png-jpeg", "network-resources", "automatic-linked-resource-discovery"]);
export interface SkillPackageSelection { identity: SkillIdentity; resources: string[] }
export interface SkillResourceTextIdentity { relativePath: string; mediaType: "text/markdown" | "text/plain" | "application/json" | "text/csv"; digest: string; bytes: number }
export interface SkillResourceText extends SkillResourceTextIdentity { content: string; role: "selected-skill-source-material"; kind?: never }
export interface SkillResourceImageIdentity { relativePath: string; mediaType: "image/png" | "image/jpeg"; digest: string; bytes: number; kind: "image"; width: number; height: number }
export interface SkillResourceImage extends SkillResourceImageIdentity { data: string; role: "selected-skill-source-material"; content?: never }
export interface SkillResourceScriptIdentity { relativePath: string; mediaType: "text/javascript"; digest: string; bytes: number; kind: "script" }
export interface SkillResourceScript extends SkillResourceScriptIdentity { content: string; role: "selected-skill-source-material" }
export type SkillResourceIdentity = SkillResourceTextIdentity | SkillResourceImageIdentity | SkillResourceScriptIdentity;
export type SkillResource = SkillResourceText | SkillResourceImage | SkillResourceScript;
export type SkillResourceDescriptor = SkillResourceText | Omit<SkillResourceImage, "data"> | (Omit<SkillResourceScript, "content"> & { content?: never });
export interface SkillSourcePin { dev: string; ino: string; size: number; mtimeNs: string; ctimeNs: string }
interface SkillPackageManifestBase {
  packageDigest: string; totalBytes: number;
  directory: { dev: string; ino: string };
  resources: (SkillResourceIdentity & { source: SkillSourcePin })[];
}
export type SkillPackageManifest = SkillPackageManifestBase & ({ version: 1; kind: "selected-local-text-package" } | { version: 2; kind: "selected-local-mixed-package" } | { version: 3; kind: "selected-local-executable-package" });
export interface SkillPackageSnapshot { manifest: LocalSkillSourceManifest; content: string; resources: SkillResource[] }
/** Model projection never contains image pixels or script code. Text v1 projections retain their existing shape. */
export function skillResourceDescriptors(resources: SkillResource[]): SkillResourceDescriptor[] {
  return resources.map(resource => resource.kind === "image" ? (({ data: _data, ...metadata }) => metadata)(resource)
    : resource.kind === "script" ? (({ content: _content, ...metadata }) => metadata)(resource) : resource);
}
export function selectedSkillPromptBytes(instructionBytes: number, resources: SkillResourceDescriptor[]): number {
  const metadata = resources.filter(resource => resource.kind === "image" || resource.kind === "script");
  return instructionBytes + resources.reduce((sum, resource) => sum + (resource.kind ? 0 : resource.bytes), 0)
    + (metadata.length ? Buffer.byteLength(JSON.stringify(metadata)) : 0);
}
function within(root: string, path: string) { const value = relative(root, path); return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`)); }
export function classifySkillResourcePath(relativePath: string): { supported: boolean; mediaType?: SkillResourceIdentity["mediaType"]; reason?: string } {
  if (typeof relativePath !== "string" || relativePath.length > 512 || isAbsolute(relativePath) || relativePath.includes("\\") || relativePath.split("/").some(part => !part || part === "." || part === ".." || part.startsWith(".") || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(part))) return { supported: false, reason: "Resource must be an explicit safe relative path within references/, assets/ or scripts/" };
  const parts = relativePath.split("/");
  if (!["references", "assets", "scripts"].includes(parts[0]!) || parts.length < 2 || parts.length > 6 || parts.some(part => /^(?:secrets?|credentials?|tokens?|passwords?)(?:[._-]|$)/i.test(part))) return { supported: false, reason: "Only selected reference, asset or bounded JavaScript paths are supported; secret stores and other executable resources are unavailable" };
  const extension = relativePath.split(".").at(-1)?.toLowerCase();
  if (parts[0] === "scripts") return extension === "js" || extension === "mjs" ? { supported: true, mediaType: "text/javascript" } : { supported: false, reason: "Only explicitly selected .js/.mjs scripts are supported" };
  const mediaTypes: Record<string, SkillResourceIdentity["mediaType"]> = { md: "text/markdown", txt: "text/plain", json: "application/json", csv: "text/csv", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
  const mediaType = extension && Object.hasOwn(mediaTypes, extension) ? mediaTypes[extension] : undefined;
  return mediaType ? { supported: true, mediaType } : { supported: false, reason: "Other scripts, binary assets and network resources are unsupported" };
}
function readResource(root: string, relativePath: string, privateFile = false): { value: SkillResource; source: SkillSourcePin } {
  const kind = classifySkillResourcePath(relativePath); if (!kind.supported) throw new Error(`Selected skill resource is unsupported: ${kind.reason}`);
  const image = kind.mediaType === "image/png" || kind.mediaType === "image/jpeg";
  const limit = image ? SKILL_PACKAGE_LIMITS.maxImageBytes : SKILL_PACKAGE_LIMITS.maxResourceBytes;
  const path = join(root, relativePath);
  if (!within(root, path) || realpathSync(root) !== root || realpathSync(path) !== path) throw new Error("Selected skill resource escaped its canonical package root");
  // Canonical equality rejects symlinks in every existing component, including an internal link.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(limit) || (privateFile && (before.mode & 0o777n) !== 0o400n)) throw new Error("Selected skill resource exceeds private resource bounds");
    const bytes = Buffer.alloc(limit + 1); let count = 0;
    while (count < bytes.length) { const read = readSync(fd, bytes, count, bytes.length - count, null); if (!read) break; count += read; }
    const after = fstatSync(fd, { bigint: true }); const current = statSync(path, { bigint: true });
    if (count > limit || BigInt(count) !== before.size || current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size || current.mtimeNs !== before.mtimeNs || current.ctimeNs !== before.ctimeNs || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || realpathSync(path) !== path || realpathSync(root) !== root) throw new Error("Selected skill resource changed during bounded read");
    const retained = bytes.subarray(0, count);
    const source = { dev: before.dev.toString(), ino: before.ino.toString(), size: count, mtimeNs: before.mtimeNs.toString(), ctimeNs: before.ctimeNs.toString() };
    if (image) {
      const metadata = inspectBoundedImageBytes(retained, kind.mediaType as "image/png" | "image/jpeg");
      return { value: { relativePath, mediaType: metadata.mimeType, digest: metadata.sha256, bytes: count, kind: "image", width: metadata.width, height: metadata.height, data: retained.toString("base64"), role: "selected-skill-source-material" }, source };
    }
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(retained);
    if (content.includes("\0")) throw new Error("Selected skill resource is not supported UTF-8 text");
    if (kind.mediaType === "text/javascript") return { value: { relativePath, mediaType: "text/javascript", digest: sha256(retained), bytes: count, kind: "script", content, role: "selected-skill-source-material" }, source };
    return { value: { relativePath, mediaType: kind.mediaType as SkillResourceText["mediaType"], digest: sha256(retained), bytes: count, content, role: "selected-skill-source-material" }, source };
  } finally { closeSync(fd); }
}
function resourceIdentity(resource: SkillResourceIdentity): SkillResourceIdentity {
  const { relativePath, mediaType, digest, bytes } = resource;
  if ("kind" in resource && resource.kind === "script") return { relativePath, mediaType: "text/javascript", digest, bytes, kind: "script" };
  return "kind" in resource && resource.kind === "image"
    ? { relativePath, mediaType: resource.mediaType, digest, bytes, kind: "image", width: resource.width, height: resource.height }
    : { relativePath, mediaType: mediaType as SkillResourceTextIdentity["mediaType"], digest, bytes };
}
function packageDigest(instructions: { digest: string; bytes: number }, resources: SkillResourceIdentity[]) {
  const executable = resources.some(resource => "kind" in resource && resource.kind === "script");
  const mixed = resources.some(resource => "kind" in resource && resource.kind === "image");
  return sha256(JSON.stringify([executable ? "selected-local-executable-package-v3" : mixed ? "selected-local-mixed-package-v2" : "selected-local-text-package-v1", instructions, resources.map(resourceIdentity)]));
}
function validatePackageBounds(instructionBytes: number, resources: SkillResource[]): number {
  const images = resources.filter(resource => resource.kind === "image");
  const totalBytes = instructionBytes + resources.reduce((sum, resource) => sum + resource.bytes, 0);
  const executable = resources.some(resource => resource.kind === "script");
  const textBytes = instructionBytes + resources.reduce((sum, resource) => sum + (resource.kind ? 0 : resource.bytes), 0);
  if (textBytes > SKILL_PACKAGE_LIMITS.maxTotalBytes || totalBytes > (images.length || executable ? SKILL_PACKAGE_LIMITS.maxMixedBytes : SKILL_PACKAGE_LIMITS.maxTotalBytes)
    || images.length > SKILL_PACKAGE_LIMITS.maxImages || images.reduce((sum, image) => sum + image.width * image.height, 0) > SKILL_PACKAGE_LIMITS.maxImagePixels)
    throw new Error("Selected skill package aggregate text/image/script limit exceeded");
  return totalBytes;
}
/** Reads only the explicit selection; links in instructions never trigger reads or execution. */
export function snapshotSkillPackageSource(grant: SkillRootGrant, selection: SkillPackageSelection): SkillPackageSnapshot {
  if (!Array.isArray(selection.resources) || selection.resources.length > SKILL_PACKAGE_LIMITS.maxResources || new Set(selection.resources).size !== selection.resources.length) throw new Error("Selected skill package resource count or identity exceeds bounds");
  const snapshot = snapshotLocalSkillSource(grant, selection.identity); const root = dirname(snapshot.manifest.file.path);
  const before = statSync(root, { bigint: true }); if (!before.isDirectory() || realpathSync(root) !== root || !within(grant.root, root)) throw new Error("Selected skill package root is unavailable");
  const selected = [...selection.resources].sort().map(path => readResource(root, path));
  const totalBytes = validatePackageBounds(snapshot.manifest.identity.bytes, selected.map(resource => resource.value));
  // Recheck all exact pins after the last read, not just the first file's digest.
  if (JSON.stringify(snapshotLocalSkillSource(grant, selection.identity).manifest) !== JSON.stringify(snapshot.manifest)) throw new Error("Selected skill package instruction source changed");
  for (const resource of selected) if (JSON.stringify(readResource(root, resource.value.relativePath)) !== JSON.stringify(resource)) throw new Error("Selected skill package source changed during capture");
  const after = statSync(root, { bigint: true }); if (after.dev !== before.dev || after.ino !== before.ino || realpathSync(root) !== root) throw new Error("Selected skill package directory changed during capture");
  const resources = selected.map(resource => resource.value);
  const format = resources.some(resource => resource.kind === "script") ? { version: 3 as const, kind: "selected-local-executable-package" as const } : resources.some(resource => resource.kind === "image") ? { version: 2 as const, kind: "selected-local-mixed-package" as const } : { version: 1 as const, kind: "selected-local-text-package" as const };
  snapshot.manifest.package = { ...format, packageDigest: packageDigest({ digest: selection.identity.digest, bytes: selection.identity.bytes }, resources), totalBytes,
    directory: { dev: before.dev.toString(), ino: before.ino.toString() }, resources: selected.map(({ value, source }) => ({ ...resourceIdentity(value), source })) };
  return { ...snapshot, resources };
}
/** Rechecks the complete selected immutable resource tree before any model/source delivery. */
export function readRetainedSkillResources(versionRoot: string, manifest: LocalSkillSourceManifest): SkillResource[] {
  const packet = manifest.package; if (!packet) return [];
  if (!(packet.version === 1 && packet.kind === "selected-local-text-package" || packet.version === 2 && packet.kind === "selected-local-mixed-package" || packet.version === 3 && packet.kind === "selected-local-executable-package") || !Array.isArray(packet.resources) || packet.resources.length > SKILL_PACKAGE_LIMITS.maxResources) throw new Error("Managed skill package manifest is unsupported");
  const root = join(versionRoot, "resources");
  if (realpathSync(root) !== root || !lstatSync(root).isDirectory() || (lstatSync(root).mode & 0o077) !== 0) throw new Error("Managed skill package tree is not private and canonical");
  const expected = new Set(packet.resources.map(row => row.relativePath)); let entries = 0;
  const walk = (directory: string, prefix: string, depth: number): void => {
    if (depth > 6) throw new Error("Managed skill package tree depth limit exceeded");
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (++entries > SKILL_PACKAGE_LIMITS.maxResources * 6) throw new Error("Managed skill package tree entry limit exceeded");
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name; const path = join(directory, entry.name);
      if (entry.isSymbolicLink() || realpathSync(path) !== path) throw new Error("Managed skill package tree contains an unsupported link");
      if (entry.isDirectory()) { if ((lstatSync(path).mode & 0o077) !== 0 || ![...expected].some(name => name.startsWith(`${rel}/`))) throw new Error("Managed skill package tree has an undeclared or nonprivate directory"); walk(path, rel, depth + 1); }
      else if (!entry.isFile() || !expected.has(rel)) throw new Error("Managed skill package tree has an undeclared file");
    }
  };
  walk(root, "", 0);
  const resources = packet.resources.map(row => {
    const value = readResource(root, row.relativePath, true).value;
    if (JSON.stringify(resourceIdentity(value)) !== JSON.stringify(resourceIdentity(row))) throw new Error("Managed skill immutable resource digest changed");
    return value;
  });
  const bytes = validatePackageBounds(manifest.identity.bytes, resources);
  if ((resources.some(resource => resource.kind === "script") ? packet.version !== 3 : resources.some(resource => resource.kind === "image") ? packet.version !== 2 : packet.version !== 1) || packet.totalBytes !== bytes || new Set(resources.map(row => row.relativePath)).size !== resources.length || packet.packageDigest !== packageDigest({ digest: manifest.identity.digest, bytes: manifest.identity.bytes }, resources)) throw new Error("Managed skill package digest or aggregate bounds changed");
  return resources;
}
