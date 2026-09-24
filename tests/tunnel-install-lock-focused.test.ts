import { afterEach, expect, test } from "bun:test";
import { closeSync, existsSync, fsyncSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireTunnelInstallLock } from "../src/tunnel";
let root: string;
function fixture() { root = mkdtempSync(join(tmpdir(), "tunnel-lock-")); return join(root, "install.lock"); }
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });
for (const stage of ["writeFileSync", "fsyncSync"] as const) {
  test(`${stage} failure removes only the created lock and allows a retry`, () => {
    const path = fixture();
    const primary = new Error(`${stage} injected`);
    expect(() => acquireTunnelInstallLock(path, { writeFileSync, fsyncSync, closeSync, [stage]: () => { throw primary; } })).toThrow(primary);
    expect(existsSync(path)).toBe(false);
    expect(acquireTunnelInstallLock(path)()).toBeUndefined();
  });
}
test("existing lock is preserved", () => {
  const path = fixture(); writeFileSync(path, "another owner");
  expect(() => acquireTunnelInstallLock(path)).toThrow("already in progress");
  expect(readFileSync(path, "utf8")).toBe("another owner");
});
for (const replacement of ["file", "symlink"] as const) {
  test(`initialization failure preserves a replacement ${replacement} and primary error`, () => {
    const path = fixture(); const primary = new Error("sync injected");
    let failure: any;
    try {
      acquireTunnelInstallLock(path, { writeFileSync, closeSync, fsyncSync: () => {
        renameSync(path, `${path}.owned`);
        if (replacement === "symlink") symlinkSync(`${path}.owned`, path);
        else writeFileSync(path, "another owner");
        throw primary;
      } });
    } catch (error) { failure = error; }
    expect(failure.cause).toBe(primary);
    expect(String(failure)).toContain("ownership changed");
    expect(existsSync(path)).toBe(true);
  });
}
test("close cleanup failure retains the primary failure", () => {
  const path = fixture(); const primary = new Error("write injected");
  let failure: any;
  try { acquireTunnelInstallLock(path, {
    writeFileSync: () => { throw primary; }, fsyncSync,
    closeSync: fd => { closeSync(fd); throw new Error("close injected"); },
  }); } catch (error) { failure = error; }
  expect(failure.cause).toBe(primary);
  expect(String(failure)).toContain("close injected");
  expect(existsSync(path)).toBe(false);
});
test("release preserves replacement inode even with the same token", () => {
  const path = fixture(); const release = acquireTunnelInstallLock(path);
  const token = readFileSync(path); renameSync(path, `${path}.owned`); writeFileSync(path, token);
  expect(release()?.message).toContain("ownership changed");
  expect(readFileSync(path)).toEqual(token);
});
