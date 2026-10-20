import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function privateFile(path: string): void {
  if (process.platform === "win32") throw new Error("Private skill metadata requires an unavailable Windows ACL backend");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 512 * 1024) throw new Error("Skill metadata must be a bounded private regular file");
}
export function readPrivateMetadata(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined; privateFile(path); return JSON.parse(readFileSync(path, "utf8"));
}
export function writePrivateMetadata(path: string, value: unknown): void {
  if (process.platform === "win32") throw new Error("Private skill metadata requires an unavailable Windows ACL backend");
  const bytes = `${JSON.stringify(value)}\n`; if (Buffer.byteLength(bytes) > 512 * 1024) throw new Error("Skill metadata limit exceeded");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); if (existsSync(path)) privateFile(path);
  const temporary = `${path}.${crypto.randomUUID()}.tmp`; const fd = openSync(temporary, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } catch (error) { rmSync(temporary, { force: true }); throw error; } finally { closeSync(fd); }
  try { renameSync(temporary, path); } catch (error) { rmSync(temporary, { force: true }); throw error; }
  const directory = openSync(dirname(path), "r"); try { fsyncSync(directory); } finally { closeSync(directory); }
}
