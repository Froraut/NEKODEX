import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { architectureMapText, checkArchitectureLinks } from "../scripts/architecture-map";

test("architecture map detects moved modules and runtime dependency changes without content churn", () => {
  const root = mkdtempSync(join(tmpdir(), "nekodex-architecture-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/a.ts"), 'import "./b";\n');
    writeFileSync(join(root, "src/b.ts"), "export const value = 1;\n");
    const original = architectureMapText(root);
    writeFileSync(join(root, "src/.DS_Store"), "local Finder metadata");
    writeFileSync(join(root, "src/b.ts"), "export const value = 2;\n");
    expect(architectureMapText(root)).toBe(original);
    renameSync(join(root, "src/b.ts"), join(root, "src/c.ts"));
    expect(architectureMapText(root)).toContain("unresolved:./b");
    writeFileSync(join(root, "src/a.ts"), 'import "./c";\n');
    expect(architectureMapText(root)).toContain('"dependencies":["src/c.ts"]');
    expect(architectureMapText(root)).not.toBe(original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("architecture maintenance rejects a dead local documentation link", () => {
  const root = mkdtempSync(join(tmpdir(), "nekodex-architecture-links-"));
  try {
    mkdirSync(join(root, "docs/development"), { recursive: true });
    writeFileSync(join(root, "ARCHITECTURE.md"), "[owner](src/missing.ts)");
    writeFileSync(join(root, "docs/development/extending-nekodex.md"), "");
    expect(() => checkArchitectureLinks(root)).toThrow("missing path");
    mkdirSync(join(root, "src")); writeFileSync(join(root, "src/missing.ts"), "");
    expect(() => checkArchitectureLinks(root)).not.toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
