const test = require("node:test");
const assert = require("node:assert/strict");
const { signingConfiguration, assertMacPublisher, signEmbeddedRuntime } = require("../scripts/release-signing.cjs");
const mac = { CODEX_WEB_GPT_RELEASE: "1", CSC_NAME: "Developer ID Application: Example Publisher (ABCDEFGHIJ)",
  CODEX_WEB_GPT_SIGNING_KEYCHAIN: "/tmp/test.keychain", APPLE_TEAM_ID: "ABCDEFGHIJ", APPLE_API_KEY: "/tmp/test.p8",
  APPLE_API_KEY_ID: "TESTKEY", APPLE_API_ISSUER: "issuer" };
test("local packaging does not require publisher credentials or sign arbitrary paths", () => {
  assert.deepEqual(signingConfiguration("darwin", {}), { release: false });
  assert.doesNotThrow(() => signEmbeddedRuntime("/does/not/exist", "darwin", {}));
});
test("publisher releases fail before packaging when any required Apple input is absent", () => {
  for (const name of Object.keys(mac).filter(name => name !== "CODEX_WEB_GPT_RELEASE")) {
    const env = { ...mac }; delete env[name]; assert.throws(() => signingConfiguration("darwin", env), new RegExp(name));
  }
  assert.deepEqual(signingConfiguration("darwin", mac), { release: true });
});
test("Apple Development, ad-hoc and another team's signatures cannot pass distribution validation", () => {
  assert.throws(() => signingConfiguration("darwin", { ...mac, CSC_NAME: "Apple Development: Example Publisher" }), /Developer ID/);
  assert.throws(() => signingConfiguration("darwin", { ...mac, CSC_NAME: "-" }), /Developer ID/);
  const details = "Authority=Developer ID Application: Example Publisher (ABCDEFGHIJ)\nTeamIdentifier=ABCDEFGHIJ\nTimestamp=Sep 11, 2026\n";
  assert.doesNotThrow(() => assertMacPublisher(details, "ABCDEFGHIJ"));
  assert.throws(() => assertMacPublisher(details, "XXXXXXXXXX"), /configured team/);
  assert.throws(() => assertMacPublisher(details.replace("Authority=Developer ID Application:", "Authority=Apple Development:"), "ABCDEFGHIJ"), /Developer ID/);
  assert.throws(() => assertMacPublisher(details.replace(/Timestamp=.*\n/, ""), "ABCDEFGHIJ"), /timestamped/);
});
test("Windows signing requires an explicit thumbprint and signing tool", () => {
  const env = { CODEX_WEB_GPT_RELEASE: "1", CODEX_WEB_GPT_WINDOWS_CERT_SHA1: "a".repeat(40), CODEX_WEB_GPT_SIGNTOOL: "C:\\SDK\\signtool.exe" };
  assert.deepEqual(signingConfiguration("win32", env), { release: true });
  assert.throws(() => signingConfiguration("win32", { ...env, CODEX_WEB_GPT_WINDOWS_CERT_SHA1: "publisher" }), /thumbprint/);
  assert.throws(() => signingConfiguration("win32", { ...env, CODEX_WEB_GPT_SIGNTOOL: "" }), /SIGNTOOL/);
  assert.deepEqual(signingConfiguration("linux", { CODEX_WEB_GPT_RELEASE: "1" }), { release: true });
});

test("macOS supports an existing notarytool keychain profile without exported API keys", () => {
  const env = { ...mac, APPLE_KEYCHAIN_PROFILE: "release-notary", APPLE_KEYCHAIN: "/tmp/notary.keychain" };
  delete env.APPLE_API_KEY; delete env.APPLE_API_KEY_ID; delete env.APPLE_API_ISSUER;
  assert.deepEqual(signingConfiguration("darwin", env), { release: true });
  delete env.APPLE_KEYCHAIN_PROFILE;
  assert.throws(() => signingConfiguration("darwin", env), /APPLE_API_KEY/);
});

test("explicit macOS-only prerelease excludes Windows and keeps exactly one notices producer", () => {
  const { releasePlan } = require("../../scripts/release-plan.cjs");
  const input = { event: "workflow_dispatch", refType: "tag", tag: "v5.1.0-froraut.1", version: "5.1.0-froraut.1", scope: "macos" };
  const plan = releasePlan(input);
  assert.deepEqual(plan.include.map(item => item.runner), ["macos-15", "macos-15-intel"]);
  assert.equal(plan.include.filter(item => item.notices).length, 1);
  assert.equal(releasePlan({ ...input, event: "push" }).include.length, 4);
  assert.throws(() => releasePlan({ ...input, refType: "branch" }), /existing tag/);
  assert.throws(() => releasePlan({ ...input, tag: "v5.1.0", version: "5.1.0" }), /stable release/);
  assert.throws(() => releasePlan({ ...input, scope: "unsigned" }), /scope/);
});
