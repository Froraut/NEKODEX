import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { AccountSafety, DEFAULT_POLICY } = require("../launcher/electron/account-safety.cjs");

function fixture(overrides: Record<string, unknown> = {}) {
  const home = mkdtempSync(join(tmpdir(), "nekodex-pacing-release-"));
  let now = 1_000_000;
  const policy = { ...DEFAULT_POLICY, enabled: true, ...overrides };
  const safety = new AccountSafety(home, () => now);
  safety.setPolicy("default", policy);
  return { home, policy, safety, advance: (ms: number) => { now += ms; },
    reload: () => new AccountSafety(home, () => now),
    cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test("disabling pacing releases a scheduled break after a rejected admission and reload", () => {
  const f = fixture({ breakAfterMinutes: 1 });
  try {
    f.safety.admit("default", 0);
    f.advance(60_000);
    expect(f.safety.availability("default", 0).reason).toBe("scheduled-break");
    expect(() => f.safety.admit("default", 0)).toThrow();
    f.safety.setPolicy("default", { ...f.policy, enabled: false });
    const reloaded = f.reload();
    expect(reloaded.availability("default", 0).eligible).toBe(true);
    expect(() => reloaded.admit("default", 0)).not.toThrow();
  } finally { f.cleanup(); }
});

test("adjusting or disabling pacing releases its session time limit without explicit resume", () => {
  const f = fixture({ maxSessionMinutes: 1, breakAfterMinutes: 30 });
  try {
    f.safety.admit("default", 0);
    f.advance(60_000);
    expect(f.safety.availability("default", 0).reason).toBe("session-limit");
    expect(() => f.safety.admit("default", 0)).toThrow();
    f.safety.setPolicy("default", { ...f.policy, maxSessionMinutes: 2 });
    expect(f.reload().availability("default", 0).eligible).toBe(true);
    f.advance(60_000);
    expect(() => f.safety.admit("default", 0)).toThrow();
    f.safety.setPolicy("default", { ...f.policy, enabled: false });
    expect(() => f.reload().admit("default", 0)).not.toThrow();
  } finally { f.cleanup(); }
});

test("disabling pacing preserves actual provider cooldowns and account stops", () => {
  const f = fixture();
  try {
    f.safety.fail("default", "rate_limit_exceeded");
    f.safety.setPolicy("default", { ...f.policy, enabled: false });
    expect(f.reload().availability("default", 0).reason).toBe("cooldown");
    expect(() => f.reload().admit("default", 0)).toThrow();
    f.advance(f.policy.cooldownMinutes * 60_000);
    expect(f.reload().availability("default", 0).eligible).toBe(true);
    f.safety.fail("default", "account_safety_stop");
    expect(f.reload().availability("default", 0).reason).toBe("paused");
    expect(() => f.reload().admit("default", 0)).toThrow();
  } finally { f.cleanup(); }
});
