import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
/** Exact installed bytes, separate from registry tarball integrity and an entrypoint hash. */
export function installedTreeDigest(root: string): { sha256: string; files: number } {
  if (realpathSync(root) !== root) throw new Error("Installed package tree is not canonical");
  const digest = createHash("sha256"); let files = 0; let bytes = 0;
  const walk = (directory: string, depth: number): void => {
    if (depth > 32) throw new Error("Installed package tree depth limit");
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name); const stat = lstatSync(path); const rel = relative(root, path).split(sep).join("/");
      if (++files > 20_000) throw new Error("Installed package tree file limit");
      if (stat.isSymbolicLink()) {
        const target = realpathSync(path); const within = relative(root, target);
        if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error("Installed package link escapes its tree");
        digest.update(JSON.stringify([rel, "link", readlinkSync(path)]));
      } else if (stat.isDirectory()) { digest.update(JSON.stringify([rel, "directory"])); walk(path, depth + 1); }
      else if (stat.isFile()) {
        bytes += stat.size; if (bytes > 256 * 1024 * 1024) throw new Error("Installed package tree byte limit");
        digest.update(JSON.stringify([rel, createHash("sha256").update(readFileSync(path)).digest("hex")]));
      } else throw new Error("Unsupported installed package file type");
    }
  };
  walk(root, 0); return { sha256: digest.digest("hex"), files };
}
