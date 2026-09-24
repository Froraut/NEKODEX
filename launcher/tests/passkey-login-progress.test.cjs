const test = require("node:test");
const assert = require("node:assert/strict");
const { initialPasskeyProgress, publicPasskeyProgress, parsePasskeyProgress } = require("../electron/passkey-login-progress.cjs");

test("renderer reload retains authoritative phase and never unlocks duplicate Import", () => {
  const progress = initialPasskeyProgress(1_000_000);
  assert.equal(publicPasskeyProgress(progress).canImport, false);
  for (const phase of ["waiting", "importing", "verifying", "cancelling", "timed-out", "cancelled", "failed", "completed"]) {
    const reloaded = JSON.parse(JSON.stringify(publicPasskeyProgress({ ...progress, phase })));
    assert.equal(reloaded.canImport, phase === "waiting");
    assert.equal(reloaded.canReveal, phase === "waiting");
    assert.equal(reloaded.canCancel, ["waiting", "importing", "verifying"].includes(phase));
  }
});

test("only bounded public child progress is accepted and arbitrary details are discarded", () => {
  assert.equal(parsePasskeyProgress("ordinary stdout"), null);
  assert.equal(parsePasskeyProgress('@codex-passkey:{"version":1,"phase":"waiting","deadlineAt":"bad"}'), null);
  assert.equal(parsePasskeyProgress('@codex-passkey:{"version":1,"phase":"completed"}'), null);
  assert.deepEqual(parsePasskeyProgress('@codex-passkey:{"version":1,"event":"reveal-failed","message":"secret"}'), {
    revealError: "passkey-reveal-failed",
  });
});

test("public progress exposes only stable fields and safe error codes", () => {
  const progress = initialPasskeyProgress(1_000_000);
  assert.deepEqual(publicPasskeyProgress({
    ...progress,
    phase: "failed",
    error: "/Users/private/profile failed",
    revealError: "private window detail",
    secret: "cookie",
  }), {
    phase: "failed",
    startedAt: progress.startedAt,
    deadlineAt: progress.deadlineAt,
    error: "passkey-import-failed",
    revealError: null,
    active: false,
    canImport: false,
    canReveal: false,
    canCancel: false,
  });
  assert.equal(publicPasskeyProgress({ ...progress, error: "passkey-cleanup-failed" }).error, "passkey-cleanup-failed");
});
