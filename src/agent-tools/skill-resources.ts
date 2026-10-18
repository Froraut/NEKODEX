import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { sha256 } from "./config";
import { snapshotLocalSkillSource, type LocalSkillSourceManifest, type SkillIdentity, type SkillRootGrant } from "./skills";

export const SKILL_PACKAGE_LIMITS = Object.freeze({ maxResources: 16, maxResourceBytes: 32 * 1024, maxTotalBytes: 128 * 1024 });
export const UNSUPPORTED_SKILL_RESOURCES = Object.freeze(["scripts-and-executables", "binary-assets", "network-resources", "automatic-linked-resource-discovery"]);
export interface SkillPackageSelection { identity: SkillIdentity; resources: string[] }
export interface SkillResourceIdentity { relativePath: string; mediaType: "text/markdown" | "text/plain" | "application/json" | "text/csv"; digest: string; bytes: number }
export interface SkillResourceText extends SkillResourceIdentity { content: string; role: "selected-skill-source-material" }
export interface SkillSourcePin { dev: string; ino: string; size: number; mtimeNs: string; ctimeNs: string }
export interface SkillPackageManifest {
  version: 1; kind: "selected-local-text-package"; packageDigest: string; totalBytes: number;
  directory: { dev: string; ino: string };
  resources: (SkillResourceIdentity & { source: SkillSourcePin })[];
}
export interface SkillPackageSnapshot { manifest: LocalSkillSourceManifest; content: string; resources: SkillResourceText[] }
function within(root: string, path: string) { const value = relative(root, path); return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`)); }
export function classifySkillResourcePath(relativePath: string): { supported: boolean; mediaType?: SkillResourceIdentity["mediaType"]; reason?: string } {
  if (typeof relativePath !== "string" || relativePath.length > 512 || isAbsolute(relativePath) || relativePath.includes("\\") || relativePath.split("/").some(part => !part || part === "." || part === ".." || part.startsWith(".") || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(part))) return { supported: false, reason: "Resource must be an explicit safe relative path within references/ or assets/" };
  const parts = relativePath.split("/");
  if (!["references", "assets"].includes(parts[0]!) || parts.length < 2 || parts.length > 6 || parts.some(part => /^(?:secrets?|credentials?|tokens?|passwords?)(?:[._-]|$)/i.test(part))) return { supported: false, reason: "Only selected reference or text-template paths are supported; secret stores and executable resources are unavailable" };
  const extension = relativePath.split(".").at(-1)?.toLowerCase();
  const mediaTypes: Record<string, SkillResourceIdentity["mediaType"]> = { md: "text/markdown", txt: "text/plain", json: "application/json", csv: "text/csv" };
  const mediaType = extension && Object.hasOwn(mediaTypes, extension) ? mediaTypes[extension] : undefined;
  return mediaType ? { supported: true, mediaType } : { supported: false, reason: "Scripts, binary assets and network resources are unsupported" };
}
function readText(root: string, relativePath: string, privateFile = false): { value: SkillResourceText; source: SkillSourcePin } {
  const kind = classifySkillResourcePath(relativePath); if (!kind.supported) throw new Error(`Selected skill resource is unsupported: ${kind.reason}`);
  const path = join(root, relativePath);
  if (!within(root, path) || realpathSync(root) !== root || realpathSync(path) !== path) throw new Error("Selected skill resource escaped its canonical package root");
  // Canonical equality rejects symlinks in every existing component, including an internal link.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(SKILL_PACKAGE_LIMITS.maxResourceBytes) || (privateFile && (before.mode & 0o077n) !== 0n)) throw new Error("Selected skill resource exceeds private text bounds");
    const bytes = Buffer.alloc(SKILL_PACKAGE_LIMITS.maxResourceBytes + 1); let count = 0;
    while (count < bytes.length) { const read = readSync(fd, bytes, count, bytes.length - count, null); if (!read) break; count += read; }
    const after = fstatSync(fd, { bigint: true }); const current = statSync(path, { bigint: true });
    if (count > SKILL_PACKAGE_LIMITS.maxResourceBytes || BigInt(count) !== before.size || current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size || current.mtimeNs !== before.mtimeNs || current.ctimeNs !== before.ctimeNs || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || realpathSync(path) !== path || realpathSync(root) !== root) throw new Error("Selected skill resource changed during bounded read");
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, count));
    if (content.includes("\0")) throw new Error("Selected skill resource is not supported UTF-8 text");
    return { value: { relativePath, mediaType: kind.mediaType!, digest: sha256(bytes.subarray(0, count)), bytes: count, content, role: "selected-skill-source-material" },
      source: { dev: before.dev.toString(), ino: before.ino.toString(), size: count, mtimeNs: before.mtimeNs.toString(), ctimeNs: before.ctimeNs.toString() } };
  } finally { closeSync(fd); }
}
function packageDigest(instructions: { digest: string; bytes: number }, resources: SkillResourceIdentity[]) {
  return sha256(JSON.stringify(["selected-local-text-package-v1", instructions, resources.map(({ relativePath, mediaType, digest, bytes }) => ({ relativePath, mediaType, digest, bytes }))]));
}
/** Reads only the explicit selection; links in instructions never trigger reads or execution. */
export function snapshotSkillPackageSource(grant: SkillRootGrant, selection: SkillPackageSelection): SkillPackageSnapshot {
  if (!Array.isArray(selection.resources) || selection.resources.length > SKILL_PACKAGE_LIMITS.maxResources || new Set(selection.resources).size !== selection.resources.length) throw new Error("Selected skill package resource count or identity exceeds bounds");
  const snapshot = snapshotLocalSkillSource(grant, selection.identity); const root = dirname(snapshot.manifest.file.path);
  const before = statSync(root, { bigint: true }); if (!before.isDirectory() || realpathSync(root) !== root || !within(grant.root, root)) throw new Error("Selected skill package root is unavailable");
  const selected = [...selection.resources].sort().map(path => readText(root, path));
  const totalBytes = snapshot.manifest.identity.bytes + selected.reduce((sum, resource) => sum + resource.value.bytes, 0);
  if (totalBytes > SKILL_PACKAGE_LIMITS.maxTotalBytes) throw new Error("Selected skill package aggregate text limit exceeded");
  // Recheck all exact pins after the last read, not just the first file's digest.
  if (JSON.stringify(snapshotLocalSkillSource(grant, selection.identity).manifest) !== JSON.stringify(snapshot.manifest)) throw new Error("Selected skill package instruction source changed");
  for (const resource of selected) if (JSON.stringify(readText(root, resource.value.relativePath)) !== JSON.stringify(resource)) throw new Error("Selected skill package source changed during capture");
  const after = statSync(root, { bigint: true }); if (after.dev !== before.dev || after.ino !== before.ino || realpathSync(root) !== root) throw new Error("Selected skill package directory changed during capture");
  const resources = selected.map(resource => resource.value);
  snapshot.manifest.package = { version: 1, kind: "selected-local-text-package", packageDigest: packageDigest({ digest: selection.identity.digest, bytes: selection.identity.bytes }, resources), totalBytes,
    directory: { dev: before.dev.toString(), ino: before.ino.toString() }, resources: selected.map(({ value: { content: _content, role: _role, ...value }, source }) => ({ ...value, source })) };
  return { ...snapshot, resources };
}
/** Rechecks the complete selected immutable resource tree before any model/source delivery. */
export function readRetainedSkillResources(versionRoot: string, manifest: LocalSkillSourceManifest): SkillResourceText[] {
  const packet = manifest.package; if (!packet) return [];
  if (packet.version !== 1 || packet.kind !== "selected-local-text-package" || !Array.isArray(packet.resources) || packet.resources.length > SKILL_PACKAGE_LIMITS.maxResources) throw new Error("Managed skill package manifest is unsupported");
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
    const value = readText(root, row.relativePath, true).value;
    if (value.digest !== row.digest || value.bytes !== row.bytes || value.mediaType !== row.mediaType) throw new Error("Managed skill immutable resource digest changed");
    return value;
  });
  const bytes = manifest.identity.bytes + resources.reduce((sum, resource) => sum + resource.bytes, 0);
  if (bytes > SKILL_PACKAGE_LIMITS.maxTotalBytes || packet.totalBytes !== bytes || new Set(resources.map(row => row.relativePath)).size !== resources.length || packet.packageDigest !== packageDigest({ digest: manifest.identity.digest, bytes: manifest.identity.bytes }, resources)) throw new Error("Managed skill package digest or aggregate bounds changed");
  return resources;
}
