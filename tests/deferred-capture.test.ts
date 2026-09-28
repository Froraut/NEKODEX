import { expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { deferredCaptureTransfer, isCloudflareChallengedVerification, isDeferredCaptureTransfer,
  isVerifiedCaptureTransfer, verifyCapturedAccount } = require("../launcher/electron/chrome-session-identity.cjs");

const capture = () => ({
  storageState: { cookies: [{ name: "__Secure-next-auth.session-token", value: "fixture", domain: ".chatgpt.com",
    path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] },
  cleanup: async () => {},
});

function sessionApiAnswering(status: number, headers: Record<string, string>) {
  const isolated = {
    setUserAgent() {}, cookies: { set: async () => {} },
    fetch: async () => new Response("<title>Just a moment...</title>", { status, headers }),
    clearStorageData: async () => {}, closeAllConnections: async () => {},
  };
  return { fromPartition: () => isolated };
}

test("an out-of-page check that Cloudflare challenges is recognised, other refusals are not", async () => {
  const challenged = await verifyCapturedAccount(sessionApiAnswering(403, { "content-type": "text/html", "cf-mitigated": "challenge" }), capture())
    .catch((error: unknown) => error);
  expect(isCloudflareChallengedVerification(challenged)).toBe(true);
  const refused = await verifyCapturedAccount(sessionApiAnswering(403, { "content-type": "text/html" }), capture())
    .catch((error: unknown) => error);
  expect((refused as { code?: string }).code).toBe("session-verification-failed");
  expect(isCloudflareChallengedVerification(refused)).toBe(false);
});

test("rejected captures report a bounded reason without retaining session secrets and still clean up", async () => {
  for (const [payload, reason] of [
    [{ accessToken: 'private-fixture-value' }, 'missing-user'],
    [{ user: { id: 'fixture-user' }, expires: '2000-01-01T00:00:00Z', accessToken: 'private-fixture-value' }, 'expired-session'],
  ] as const) {
    const cleanup: string[] = [];
    const api = { fromPartition: () => ({ cookies: { set: async () => {} },
      fetch: async () => Response.json(payload),
      clearStorageData: async () => { cleanup.push('storage'); },
      closeAllConnections: async () => { cleanup.push('connections'); },
    }) };
    const error = await verifyCapturedAccount(api, capture()).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'chrome-account-unverified', verificationReason: reason, httpStatus: 200, authCookieCount: 1 });
    expect(JSON.stringify(error)).not.toContain('private-fixture-value');
    expect(cleanup).toEqual(['storage', 'connections']);
  }
});

test("a deferred capture commits only the identity the installed page reported and confirmed", async () => {
  const committed: unknown[] = [];
  const confirmed: string[] = [];
  const fingerprint = "a".repeat(64);
  const transfer = deferredCaptureTransfer(capture(), {
    resolveIdentityIntent: async (identity: { label: string }) => {
      confirmed.push(identity.label);
      return { knownPrincipalFingerprint: null, actualIdentityConfirmed: true };
    },
    commit: (_receipt: unknown, identity: unknown) => { committed.push(identity); },
  });
  expect(isDeferredCaptureTransfer(transfer)).toBe(true);
  expect(isVerifiedCaptureTransfer(transfer)).toBe(false);
  expect(transfer.verifiedIdentity).toBeNull();
  // Nothing may be committed before the installed page proved an identity.
  expect(() => transfer.commit({ authenticated: true, principalFingerprint: fingerprint })).toThrow();
  await expect(transfer.adoptIdentity({ principalFingerprint: "not-a-fingerprint", label: "x" })).rejects.toThrow();
  expect(await transfer.adoptIdentity({ principalFingerprint: fingerprint, label: "user@example.com" }))
    .toEqual({ knownPrincipalFingerprint: null, actualIdentityConfirmed: true });
  expect(confirmed).toEqual(["user@example.com"]);
  await expect(transfer.adoptIdentity({ principalFingerprint: fingerprint, label: "again" })).rejects.toThrow("already adopted");
  expect(() => transfer.commit({ authenticated: true, principalFingerprint: "b".repeat(64) })).toThrow("does not match");
  expect(() => transfer.commit({ authenticated: false, principalFingerprint: fingerprint })).toThrow("does not match");
  transfer.commit({ authenticated: true, principalFingerprint: fingerprint });
  expect(committed).toEqual([{ principalFingerprint: fingerprint, label: "user@example.com" }]);
});

test("a cancelled confirmation of a deferred identity adopts nothing", async () => {
  const transfer = deferredCaptureTransfer(capture(), {
    resolveIdentityIntent: async () => { throw Object.assign(new Error("Sign-in cancelled"), { code: "profile-login-cancelled" }); },
  });
  await expect(transfer.adoptIdentity({ principalFingerprint: "c".repeat(64), label: "user@example.com" })).rejects.toThrow("cancelled");
  expect(() => transfer.commit({ authenticated: true, principalFingerprint: "c".repeat(64) })).toThrow();
});
