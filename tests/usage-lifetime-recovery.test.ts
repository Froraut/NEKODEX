import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { UsageStore } = require("../launcher/electron/usage-store.cjs");

test("usage lifetime: v1 migration preserves receipts and lifetime beyond daily retention", () => {
  const dir = mkdtempSync(join(tmpdir(), "nekodex-usage-migration-"));
  let now = new Date(2026, 8, 19, 12).getTime();
  try {
    const initial = new UsageStore(dir, () => now);
    initial.accept("trace", 1, "receipt", "max", "5.6");
    const file = join(dir, "local-usage.json");
    const legacy = JSON.parse(readFileSync(file, "utf8"));
    legacy.version = 1; legacy.lifetime = 5;
    delete legacy.lifetimeGroups; delete legacy.lifetimeUnclassified;
    const legacyText = JSON.stringify(legacy);
    writeFileSync(file, legacyText);
    const migrated = new UsageStore(dir, () => now);
    migrated.accept("trace", 1, "receipt", "max", "5.6");
    migrated.finish("trace", 1, "completed", "receipt");
    expect(migrated.snapshot()).toMatchObject({ lifetime: 5, lifetimeUnclassified: 4,
      lifetimeGroups: [{ accepted: 1, completed: 1, failed: 0, aborted: 0 }] });
    const original = readdirSync(dir).find(name => name.startsWith("local-usage.json.v1-"))!;
    expect(readFileSync(join(dir, original), "utf8")).toBe(legacyText);
    now += 91 * 86400_000;
    migrated.accept("next", 1, "new", "max", "5.6");
    const restarted = new UsageStore(dir, () => now);
    expect(restarted.snapshot()).toMatchObject({ lifetime: 6, lifetimeUnclassified: 4,
      lifetimeGroups: [{ accepted: 2, completed: 1 }], rows: [{ accepted: 1, completed: 0 }] });
    expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("usage recovery: backup restores receipts and corrupt evidence while future schemas stay untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "nekodex-usage-recovery-"));
  try {
    const store = new UsageStore(dir);
    store.accept("trace", 1, "receipt", "max", "6");
    store.finish("trace", 1, "completed", "receipt");
    const file = join(dir, "local-usage.json");
    writeFileSync(file, "broken");
    const recovered = new UsageStore(dir);
    recovered.accept("trace", 1, "receipt", "max", "6");
    recovered.finish("trace", 1, "failed", "receipt");
    expect(recovered.snapshot()).toMatchObject({ available: true, recovered: true, lifetime: 1,
      lifetimeGroups: [{ accepted: 1, completed: 1, failed: 0 }] });
    const corrupt = readdirSync(dir).find(name => name.startsWith("local-usage.json.corrupt-"))!;
    expect(readFileSync(join(dir, corrupt), "utf8")).toBe("broken");
    const future = JSON.stringify({ version: 99 });
    writeFileSync(file, future);
    const newer = new UsageStore(dir);
    newer.accept("other", 1, "new", "high", "unknown");
    expect(newer.snapshot().available).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(future);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
