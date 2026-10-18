import { Database } from "bun:sqlite";
import { chmodSync, closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sha256 } from "./config";
import { readPrivateMetadata, writePrivateMetadata } from "./private-metadata";
import { snapshotLocalSkillSource, type LocalSkillSourceManifest, type SelectedSkill, type SkillIdentity, type SkillRootGrant } from "./skills";
import { validateToolScope } from "./journal";
import type { ToolScope } from "./types";
import { readRetainedSkillResources, snapshotSkillPackageSource, UNSUPPORTED_SKILL_RESOURCES, skillResourceDescriptors, selectedSkillPromptBytes, type SkillPackageSelection, type SkillResource } from "./skill-resources";

export interface ManagedSkillVersion {
  versionId: string; lineageId: string; label: string; contentDigest: string; bytes: number;
  manifestDigest: string; sourceLocator: string; createdAt: number; revoked: boolean; forgotten: boolean;
  packageDigest?: string; resourceCount?: number;
}
export interface ManagedSkillAction {
  actionId: string; fingerprint: string; state: "reviewing" | "reviewed" | "committing" | "imported" | "outcome_unknown";
  versionId: string; lineageId: string; label: string; manifest: LocalSkillSourceManifest; manifestDigest: string;
  reviewDigest: string; stage: string; target: string; createdAt: number;
}
export interface ManagedSkillLimits { maxActions: number; /** Historical option name; includes all retained text and binary bytes. */ maxRetainedTextBytes: number }
export interface ManagedSkillReview { action: ManagedSkillAction; content?: string; resources?: SkillResource[] }
function identity(value: string): void { if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error("Invalid managed skill action identity"); }
function digest(value: string): void { if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid managed skill version digest"); }
function privateText(path: string): string {
  if (realpathSync(path) !== path || lstatSync(path).isSymbolicLink()) throw new Error("Managed skill content must remain canonical");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd); if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 128 * 1024) throw new Error("Managed skill content is not a bounded private file");
    const buffer = Buffer.alloc(128 * 1024 + 1); let count = 0;
    while (count < buffer.length) { const read = readSync(fd, buffer, count, buffer.length - count, null); if (!read) break; count += read; }
    const end = fstatSync(fd); const current = lstatSync(path);
    if (count > 128 * 1024 || end.ino !== stat.ino || end.dev !== stat.dev || end.mtimeMs !== stat.mtimeMs || end.ctimeMs !== stat.ctimeMs || current.ino !== stat.ino || current.dev !== stat.dev || current.isSymbolicLink()) throw new Error("Managed skill content changed during read");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, count));
  } finally { closeSync(fd); }
}
/** One durable metadata owner plus immutable selected text/image trees. No code execution. */
export class ManagedSkillStore {
  private db: Database;
  private root: string;
  private limits: ManagedSkillLimits;
  constructor(home: string, limits: Partial<ManagedSkillLimits> = {}) {
    this.limits = { maxActions: limits.maxActions ?? 512, maxRetainedTextBytes: limits.maxRetainedTextBytes ?? 64 * 1024 * 1024 };
    if (!Number.isInteger(this.limits.maxActions) || this.limits.maxActions < 1 || this.limits.maxActions > 512 || !Number.isSafeInteger(this.limits.maxRetainedTextBytes) || this.limits.maxRetainedTextBytes < 1 || this.limits.maxRetainedTextBytes > 64 * 1024 * 1024) throw new Error("Invalid managed skill storage limits");
    if (process.platform === "win32") throw new Error("Private managed skill storage requires an unavailable Windows ACL backend");
    this.root = join(home, "managed-skills"); mkdirSync(this.root, { recursive: true, mode: 0o700 });
    if (realpathSync(this.root) !== this.root || (lstatSync(this.root).mode & 0o077) !== 0) throw new Error("Managed skill home must be canonical and private");
    const path = join(this.root, "metadata.sqlite");
    if (existsSync(path)) { const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("Managed skill metadata must be private"); }
    this.db = new Database(path, { create: true }); chmodSync(path, 0o600);
    this.db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS skill_actions(id TEXT PRIMARY KEY, receipt TEXT NOT NULL); CREATE TABLE IF NOT EXISTS skill_versions(id TEXT PRIMARY KEY, metadata TEXT NOT NULL); CREATE TABLE IF NOT EXISTS skill_attachments(scope_key TEXT PRIMARY KEY, packet TEXT NOT NULL)");
  }
  private rawAction(actionId: string): ManagedSkillAction | undefined {
    identity(actionId); const row = this.db.query("SELECT receipt FROM skill_actions WHERE id=?").get(actionId) as { receipt: string } | null; return row ? JSON.parse(row.receipt) : undefined;
  }
  private saveAction(action: ManagedSkillAction): void { this.db.query("INSERT INTO skill_actions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET receipt=excluded.receipt").run(action.actionId, JSON.stringify(action)); }
  private packetAt(path: string, action: ManagedSkillAction): { manifest: LocalSkillSourceManifest; content: string; resources: SkillResource[] } {
    if (realpathSync(path) !== path || !lstatSync(path).isDirectory()) throw new Error("Managed skill version directory changed");
    const marker = readPrivateMetadata(join(path, "manifest.json")) as { versionId: string; lineageId: string; manifest: LocalSkillSourceManifest; manifestDigest: string };
    if (!marker || marker.versionId !== action.versionId || marker.lineageId !== action.lineageId || marker.manifestDigest !== action.manifestDigest || sha256(JSON.stringify(marker.manifest)) !== action.manifestDigest) throw new Error("Managed skill version manifest identity mismatch");
    const content = privateText(join(path, "SKILL.md"));
    if (sha256(content) !== action.manifest.identity.digest || Buffer.byteLength(content) !== action.manifest.identity.bytes) throw new Error("Managed skill immutable content digest changed");
    return { manifest: marker.manifest, content, resources: readRetainedSkillResources(path, marker.manifest) };
  }
  private register(action: ManagedSkillAction): ManagedSkillVersion {
    this.packetAt(action.target, action);
    const metadata: ManagedSkillVersion = { versionId: action.versionId, lineageId: action.lineageId, label: action.label, contentDigest: action.manifest.identity.digest, bytes: action.manifest.package?.totalBytes ?? action.manifest.identity.bytes, manifestDigest: action.manifestDigest, sourceLocator: action.manifest.locator, createdAt: action.createdAt, revoked: false, forgotten: false,
      ...(action.manifest.package ? { packageDigest: action.manifest.package.packageDigest, resourceCount: action.manifest.package.resources.length } : {}) };
    const current = this.version(action.versionId);
    if (current) {
      if (current.manifestDigest !== metadata.manifestDigest || current.contentDigest !== metadata.contentDigest || current.lineageId !== metadata.lineageId) throw new Error("Managed skill version identity conflict");
      return current;
    }
    const count = (this.db.query("SELECT count(*) n FROM skill_versions").get() as { n: number }).n; if (count >= 256) throw new Error("Managed skill retained version limit reached");
    this.db.query("INSERT INTO skill_versions VALUES(?,?)").run(action.versionId, JSON.stringify(metadata)); return metadata;
  }
  action(actionId: string): ManagedSkillAction | undefined {
    const action = this.rawAction(actionId); if (!action) return undefined;
    if (action.stage !== join(this.root, "reviews", sha256(actionId)) || action.target !== join(this.root, "versions", action.versionId)) throw new Error("Managed skill intent path mismatch");
    if (action.state === "committing" && existsSync(action.target)) {
      try { this.db.transaction(() => { this.register(action); this.saveAction({ ...action, state: "imported" }); })(); return { ...action, state: "imported" }; }
      catch { return { ...action, state: "outcome_unknown" }; }
    }
    if (action.state === "reviewing" && existsSync(action.stage)) {
      try { this.packetAt(action.stage, action); const reviewed = { ...action, state: "reviewed" as const }; this.saveAction(reviewed); return reviewed; }
      catch { return { ...action, state: "outcome_unknown" }; }
    }
    if (["reviewing", "committing"].includes(action.state)) return { ...action, state: "outcome_unknown" };
    return action;
  }
  inspect(actionId: string): ManagedSkillReview | undefined {
    const action = this.action(actionId); if (!action) return undefined;
    if (action.state === "outcome_unknown") return { action };
    const packet = this.packetAt(action.state === "imported" ? action.target : action.stage, action);
    return { action, content: packet.content, ...(action.manifest.package ? { resources: packet.resources } : {}) };
  }
  review(actionId: string, grant: SkillRootGrant, selected: SkillIdentity, label: string, updateLineageId?: string): { action: ManagedSkillAction; content: string } {
    return this.reviewSource(actionId, grant, selected, label, updateLineageId);
  }
  reviewPackage(actionId: string, grant: SkillRootGrant, selection: SkillPackageSelection, label: string, updateLineageId?: string): { action: ManagedSkillAction; content: string; resources: SkillResource[] } {
    const reviewed = this.reviewSource(actionId, grant, selection.identity, label, updateLineageId, selection.resources);
    return { ...reviewed, resources: reviewed.resources ?? [] };
  }
  private reviewSource(actionId: string, grant: SkillRootGrant, selected: SkillIdentity, label: string, updateLineageId?: string, resourcePaths?: string[]): { action: ManagedSkillAction; content: string; resources?: SkillResource[] } {
    identity(actionId); if (typeof label !== "string" || !label.trim() || label.length > 200) throw new Error("Managed skill label must be bounded text");
    const snapshot = resourcePaths === undefined ? { ...snapshotLocalSkillSource(grant, selected), resources: [] } : snapshotSkillPackageSource(grant, { identity: selected, resources: resourcePaths });
    const lineageId = sha256(JSON.stringify(["local-user-text", snapshot.manifest.locator]));
    if (updateLineageId && (lineageId !== updateLineageId || !this.list(true).versions.some(row => row.lineageId === updateLineageId))) throw new Error("Managed skill update must retain its selected local source lineage");
    const manifestDigest = sha256(JSON.stringify(snapshot.manifest)); const versionId = sha256(JSON.stringify([lineageId, manifestDigest, selected.digest, ...(snapshot.manifest.package ? [snapshot.manifest.package.packageDigest] : [])]));
    const fingerprint = sha256(JSON.stringify([lineageId, versionId, label])); const existing = this.action(actionId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("Managed skill action identity conflict");
      if (existing.state === "outcome_unknown") return { action: existing, content: "" };
      const packet = this.packetAt(existing.state === "imported" ? existing.target : existing.stage, existing);
      return { action: existing, content: packet.content, ...(existing.manifest.package ? { resources: packet.resources } : {}) };
    }
    const action: ManagedSkillAction = { actionId, fingerprint, state: "reviewing", versionId, lineageId, label: label.trim(), manifest: snapshot.manifest, manifestDigest, reviewDigest: sha256(JSON.stringify([manifestDigest, selected.digest, label.trim(), ...(snapshot.manifest.package ? [snapshot.manifest.package.packageDigest] : [])])), stage: join(this.root, "reviews", sha256(actionId)), target: join(this.root, "versions", versionId), createdAt: Date.now() };
    this.db.transaction(() => {
      if (this.rawAction(actionId)) throw new Error("Managed skill action already admitted; inspect its retained receipt");
      const usage = this.capacity();
      const versions = (this.db.query("SELECT count(*) n FROM skill_versions").get() as { n: number }).n;
      if (usage.actions >= this.limits.maxActions || usage.reservedTextBytes + (snapshot.manifest.package?.totalBytes ?? selected.bytes) * 2 > this.limits.maxRetainedTextBytes || (!this.version(versionId) && versions >= 256)) throw new Error("Managed skill retained storage capacity reached; existing reviews, versions and references are preserved");
      this.saveAction(action);
    })();
    mkdirSync(dirname(action.stage), { recursive: true, mode: 0o700 });
    mkdirSync(action.stage, { recursive: false, mode: 0o700 });
    writePrivateMetadata(join(action.stage, "manifest.json"), { versionId, lineageId, manifest: snapshot.manifest, manifestDigest });
    const fd = openSync(join(action.stage, "SKILL.md"), "wx", 0o400); try { writeFileSync(fd, snapshot.content); fsyncSync(fd); } finally { closeSync(fd); }
    if (snapshot.manifest.package) {
      const resourceRoot = join(action.stage, "resources"); mkdirSync(resourceRoot, { mode: 0o700 });
      const directories = new Set([resourceRoot]);
      for (const resource of snapshot.resources) {
        const path = join(resourceRoot, resource.relativePath); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        for (let directory = dirname(path); directory !== resourceRoot; directory = dirname(directory)) directories.add(directory);
        const fd = openSync(path, "wx", 0o400); try { writeFileSync(fd, resource.kind === "image" ? Buffer.from(resource.data, "base64") : resource.content); fsyncSync(fd); } finally { closeSync(fd); }
      }
      for (const directory of [...directories].sort((a, b) => b.length - a.length)) { const fd = openSync(directory, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
    }
    const directory = openSync(action.stage, "r"); try { fsyncSync(directory); } finally { closeSync(directory); }
    const reviewed = { ...action, state: "reviewed" as const }; this.packetAt(action.stage, action);
    const sourceNow = snapshot.manifest.package ? snapshotSkillPackageSource(grant, { identity: selected, resources: resourcePaths! }) : snapshotLocalSkillSource(grant, selected);
    if (sha256(JSON.stringify(sourceNow.manifest)) !== manifestDigest) throw new Error("Managed skill source changed while retaining the review");
    this.saveAction(reviewed); return { action: reviewed, content: snapshot.content, ...(snapshot.manifest.package ? { resources: snapshot.resources } : {}) };
  }
  commit(actionId: string, reviewDigest: string, currentGrant: SkillRootGrant): ManagedSkillAction {
    const action = this.action(actionId); if (!action) throw new Error("Managed skill review receipt missing");
    if (action.reviewDigest !== reviewDigest) throw new Error("Exact reviewed managed skill approval required");
    if (action.state === "imported") return action;
    if (action.state !== "reviewed" || action.reviewDigest !== reviewDigest) throw new Error("Exact reviewed managed skill approval required; unknown import cannot replay");
    const current = action.manifest.package ? snapshotSkillPackageSource(currentGrant, { identity: action.manifest.identity, resources: action.manifest.package.resources.map(row => row.relativePath) }) : snapshotLocalSkillSource(currentGrant, action.manifest.identity);
    if (sha256(JSON.stringify(current.manifest)) !== action.manifestDigest) throw new Error("Managed skill source changed after review; review its new version explicitly");
    this.packetAt(action.stage, action);
    this.db.transaction(() => { const raw = this.rawAction(actionId); if (raw?.state !== "reviewed") throw new Error("Managed skill import already admitted"); this.saveAction({ ...action, state: "committing" }); })();
    mkdirSync(dirname(action.target), { recursive: true, mode: 0o700 });
    if (!existsSync(action.target)) renameSync(action.stage, action.target); else this.packetAt(action.target, action);
    const parent = openSync(dirname(action.target), "r"); try { fsyncSync(parent); } finally { closeSync(parent); }
    this.db.transaction(() => { this.register(action); this.saveAction({ ...action, state: "imported" }); })(); return { ...action, state: "imported" };
  }
  version(versionId: string): ManagedSkillVersion | undefined {
    digest(versionId); const row = this.db.query("SELECT metadata FROM skill_versions WHERE id=?").get(versionId) as { metadata: string } | null; return row ? JSON.parse(row.metadata) : undefined;
  }
  list(includeForgotten = false) {
    const versions = (this.db.query("SELECT metadata FROM skill_versions ORDER BY rowid DESC LIMIT 256").all() as { metadata: string }[]).map(row => JSON.parse(row.metadata) as ManagedSkillVersion);
    const attachments = (this.db.query("SELECT packet FROM skill_attachments ORDER BY rowid DESC LIMIT 64").all() as { packet: string }[]).map(row => JSON.parse(row.packet) as { scope: ToolScope; versionIds: string[] });
    const actions = (this.db.query("SELECT receipt FROM skill_actions ORDER BY rowid DESC LIMIT 64").all() as { receipt: string }[]).map(row => JSON.parse(row.receipt) as ManagedSkillAction).map(action => ({ actionId: action.actionId, label: action.label, state: action.state, versionId: action.versionId, lineageId: action.lineageId, reviewDigest: action.reviewDigest }));
    return { versions: versions.filter(row => includeForgotten || !row.forgotten), retainedVersions: versions.length, forgottenVersions: versions.filter(row => row.forgotten).length, attachments, actions, capacity: { ...this.capacity(), ...this.limits }, cleanup: "not-performed; immutable referenced versions retained" };
  }
  private capacity(): { actions: number; reservedTextBytes: number } {
    const usage = this.db.query("SELECT count(*) n, COALESCE(sum(COALESCE(json_extract(receipt,'$.manifest.package.totalBytes'),json_extract(receipt,'$.manifest.identity.bytes'))),0) bytes FROM skill_actions").get() as { n: number; bytes: number };
    // Reserve both a retained review copy and a published immutable copy; no reclamation is assumed.
    return { actions: usage.n, reservedTextBytes: usage.bytes * 2 };
  }
  private retainedVersion(versionId: string) {
    const version = this.version(versionId); if (!version || version.revoked || version.forgotten) throw new Error("Managed skill version is revoked, forgotten or unavailable");
    const actionRow = this.db.query("SELECT receipt FROM skill_actions WHERE json_extract(receipt,'$.versionId')=? AND json_extract(receipt,'$.state')='imported' LIMIT 1").get(versionId) as { receipt: string } | null;
    if (!actionRow) throw new Error("Managed skill immutable import receipt missing");
    const action = JSON.parse(actionRow.receipt) as ManagedSkillAction;
    return { version, action, packet: this.packetAt(action.target, action) };
  }
  content(versionId: string): SelectedSkill {
    const { version, action, packet } = this.retainedVersion(versionId);
    const resources = skillResourceDescriptors(packet.resources);
    return { id: `managed:${versionId}`, grantId: `managed:${version.lineageId}`, relativePath: `${versionId}/SKILL.md`, source: "user", digest: version.contentDigest, bytes: version.bytes, versionId,
      ...(packet.resources.some(resource => resource.kind === "image" || resource.kind === "script") ? { promptBytes: selectedSkillPromptBytes(action.manifest.identity.bytes, resources) } : {}),
      content: packet.content, role: "selected-skill-instructions", precedence: "below-system-developer-user",
      ...(action.manifest.package ? { packageDigest: action.manifest.package.packageDigest, resources, unsupportedResources: UNSUPPORTED_SKILL_RESOURCES } : {}) };
  }
  /** Internal read of an already selected immutable package, never a general filesystem API. */
  readResource(scope: ToolScope, versionId: string, packageDigest: string, relativePath: string, resourceDigest: string): SkillResource {
    validateToolScope(scope); digest(versionId); digest(packageDigest); digest(resourceDigest);
    const row = this.db.query("SELECT packet FROM skill_attachments WHERE scope_key=?").get(JSON.stringify([scope.taskId, scope.generation])) as { packet: string } | null;
    if (!row || !(JSON.parse(row.packet).versionIds as string[]).includes(versionId)) throw new Error("Managed skill package is not attached to this task generation");
    const { action, packet } = this.retainedVersion(versionId);
    const resource = packet.resources.find(row => row.relativePath === relativePath);
    if (action.manifest.package?.packageDigest !== packageDigest || !resource || resource.digest !== resourceDigest) throw new Error("Managed skill selected resource identity or package digest changed");
    return resource;
  }
  attach(scope: ToolScope, versionId: string): SelectedSkill {
    validateToolScope(scope); const content = this.content(versionId); const version = this.version(versionId)!;
    const key = JSON.stringify([scope.taskId, scope.generation]);
    this.db.transaction(() => {
      const row = this.db.query("SELECT packet FROM skill_attachments WHERE scope_key=?").get(key) as { packet: string } | null;
      const prior = row ? JSON.parse(row.packet).versionIds as string[] : [];
      // Replacing a lineage is itself an explicit attachment; imports/updates never do this.
      const versionIds = [...prior.filter(id => this.version(id)?.lineageId !== version.lineageId), versionId];
      if (versionIds.length > 16 || versionIds.reduce((sum, id) => { const packet = this.content(id); return sum + (packet.promptBytes ?? packet.bytes); }, 0) > 128 * 1024) throw new Error("Managed skill selected content limit exceeded");
      const count = (this.db.query("SELECT count(*) n FROM skill_attachments").get() as { n: number }).n; if (!row && count >= 64) throw new Error("Managed skill task scope limit reached");
      this.db.query("INSERT INTO skill_attachments VALUES(?,?) ON CONFLICT(scope_key) DO UPDATE SET packet=excluded.packet").run(key, JSON.stringify({ scope, versionIds }));
    })(); return content;
  }
  selected(scope: ToolScope): SelectedSkill[] {
    validateToolScope(scope); const row = this.db.query("SELECT packet FROM skill_attachments WHERE scope_key=?").get(JSON.stringify([scope.taskId, scope.generation])) as { packet: string } | null;
    return row ? (JSON.parse(row.packet).versionIds as string[]).map(id => this.content(id)) : [];
  }
  detach(scope: ToolScope, versionId: string): void {
    validateToolScope(scope); digest(versionId); const key = JSON.stringify([scope.taskId, scope.generation]);
    this.db.transaction(() => { const row = this.db.query("SELECT packet FROM skill_attachments WHERE scope_key=?").get(key) as { packet: string } | null;
      if (row) { const packet = JSON.parse(row.packet); packet.versionIds = packet.versionIds.filter((id: string) => id !== versionId); this.db.query("UPDATE skill_attachments SET packet=? WHERE scope_key=?").run(JSON.stringify(packet), key); }
    })();
  }
  revoke(versionId: string, forget = false): ManagedSkillVersion {
    const version = this.version(versionId); if (!version) throw new Error("Managed skill version missing");
    const next = { ...version, revoked: true, forgotten: version.forgotten || forget };
    this.db.query("UPDATE skill_versions SET metadata=? WHERE id=?").run(JSON.stringify(next), versionId); return next;
  }
  close(): void { this.db.close(); }
}
