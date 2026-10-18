import { closeSync, constants, fstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { sha256 } from "./config";

export interface SkillRootGrant {
  id: string;
  /** An explicit user selected canonical directory. This grants read-only access here alone. */
  root: string;
  source: "user" | "workspace" | "official-plugin" | "vendor-plugin";
  label: string;
}
export interface SkillIdentity { id: string; grantId: string; relativePath: string; source: SkillRootGrant["source"]; digest: string; bytes: number }
export interface SelectedSkill extends SkillIdentity { content: string; role: "selected-skill-instructions"; precedence: "below-system-developer-user" }
function inside(root: string, path: string): boolean {
  const rel = relative(root, path); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}
/** Content is untrusted instructions. Metadata or a mention never grants filesystem authority. */
export class ReadOnlySkillLibrary {
  private roots = new Map<string, SkillRootGrant>();
  constructor(grants: SkillRootGrant[], private maxBytes = 128 * 1024) {
    if (grants.length > 32 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 512 * 1024) throw new Error("Invalid skill library bounds");
    for (const grant of grants) {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(grant.id) || this.roots.has(grant.id) || !isAbsolute(grant.root) || realpathSync(grant.root) !== grant.root || !statSync(grant.root).isDirectory() || !["user", "workspace", "official-plugin", "vendor-plugin"].includes(grant.source)) throw new Error("Invalid explicit skill root grant");
      this.roots.set(grant.id, structuredClone(grant));
    }
  }
  private read(grant: SkillRootGrant, relativePath: string): SelectedSkill {
    if (typeof relativePath !== "string" || isAbsolute(relativePath) || relativePath.split(/[\\/]/).some(part => part === "..") || !relativePath.endsWith("SKILL.md")) throw new Error("Invalid selected skill path");
    const path = realpathSync(join(grant.root, relativePath));
    if (!inside(grant.root, path) || !inside(grant.root, realpathSync(grant.root))) throw new Error("Skill escapes its approved root");
    // Reject final symlinks and read a bounded file through one descriptor, not a stat/read race.
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd); if (!stat.isFile() || stat.size > this.maxBytes) throw new Error("Skill content exceeds library bounds");
      const bytes = Buffer.alloc(this.maxBytes + 1); let count = 0;
      while (count <= this.maxBytes) { const read = readSync(fd, bytes, count, bytes.length - count, null); if (!read) break; count += read; }
      const currentPath = realpathSync(join(grant.root, relativePath));
      const currentStat = statSync(currentPath);
      if (count > this.maxBytes || !inside(grant.root, currentPath) || currentPath !== path || currentStat.dev !== stat.dev || currentStat.ino !== stat.ino || realpathSync(grant.root) !== grant.root) throw new Error("Skill content changed or escaped its root");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count));
      const canonicalPath = relative(grant.root, path).split(sep).join("/");
      return { id: `${grant.id}:${canonicalPath}`, grantId: grant.id, relativePath: canonicalPath, source: grant.source, digest: sha256(bytes.subarray(0, count)), bytes: count, content, role: "selected-skill-instructions", precedence: "below-system-developer-user" };
    } finally { closeSync(fd); }
  }
  /** Bounded scan of granted roots only, excluding symlink directories and hidden dependencies. */
  discover(grantId: string, options: { maxEntries?: number; maxDepth?: number } = {}): { skills: SkillIdentity[]; truncated: boolean } {
    const grant = this.roots.get(grantId); if (!grant) throw new Error("Skill root is not granted");
    const maxEntries = options.maxEntries ?? 200; const maxDepth = options.maxDepth ?? 3;
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 500 || !Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 6) throw new Error("Invalid skill discovery bounds");
    const skills: SkillIdentity[] = []; let inspected = 0; let truncated = false;
    const walk = (directory: string, depth: number): void => {
      if (!inside(grant.root, realpathSync(directory))) throw new Error("Skill directory escaped its root");
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (++inspected > maxEntries) { truncated = true; return; }
        if (entry.isSymbolicLink() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const path = join(directory, entry.name);
        if (entry.isFile() && entry.name === "SKILL.md") {
          const { content: _content, role: _role, precedence: _precedence, ...identity } = this.read(grant, relative(grant.root, path)); skills.push(identity);
        } else if (entry.isDirectory() && depth < maxDepth) walk(path, depth + 1);
        if (truncated) return;
      }
    };
    walk(grant.root, 0); return { skills, truncated };
  }
  select(identity: SkillIdentity): SelectedSkill {
    const grant = this.roots.get(identity.grantId); if (!grant) throw new Error("Skill root is not granted");
    const current = this.read(grant, identity.relativePath);
    if (current.id !== identity.id || current.digest !== identity.digest || current.source !== identity.source) throw new Error("Selected skill identity or digest changed");
    return current;
  }
}
