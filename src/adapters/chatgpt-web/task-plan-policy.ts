import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../../config";

/** The Electron-owned policy is opt-in. An unreadable, public or unsupported file disables capture. */
export function taskPlanCaptureEnabled(coreHome = getConfigDir()): boolean {
  try {
    const directory = join(coreHome, "task-plans");
    const filename = join(directory, "policy.json");
    const parent = lstatSync(directory); const file = lstatSync(filename);
    if (!parent.isDirectory() || parent.isSymbolicLink() || !file.isFile() || file.isSymbolicLink() || file.size > 1024) return false;
    if (process.platform !== "win32" && (parent.uid !== process.getuid?.() || file.uid !== process.getuid?.()
      || (parent.mode & 0o077) !== 0 || (file.mode & 0o077) !== 0)) return false;
    const policy: unknown = JSON.parse(readFileSync(filename, "utf8"));
    return typeof policy === "object" && policy !== null && !Array.isArray(policy)
      && Object.keys(policy).length === 3 && "version" in policy && policy.version === 1
      && "revision" in policy && Number.isSafeInteger(policy.revision) && (policy.revision as number) >= 0
      && "enabled" in policy && policy.enabled === true;
  } catch { return false; }
}
