import { expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { createCodexAccountTools } = require("../launcher/electron/codex-account-tools.cjs");

const ID = "875bc05d-0382-46a7-ba08-d473d569ac23";
const REMOTE = "remote-account";

function jwt(accountId: string) {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + 3600,
    "https://api.openai.com/auth": { chatgpt_account_id: accountId },
  })).toString("base64url");
  return `e30.${payload}.sig`;
}
function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function fixture() {
  let fetches = 0;
  const session = {
    fetch: async (url: string) => {
      fetches += 1;
      return url.endsWith("/api/auth/session")
        ? json({ accessToken: jwt(REMOTE) })
        : json({ account_id: REMOTE, plan_type: "plus", rate_limit: { allowed: true, limit_reached: false,
          primary_window: { used_percent: 40, limit_window_seconds: 18_000, reset_at: 2_000_000_000 } } });
    },
  };
  const host = { view: { webContents: { session, isDestroyed: () => false } }, ready: async () => {} };
  const ids = { evidence: 3, identity: 1 };
  let onRead: () => void = () => {};
  const pool = {
    hosts: new Map([[ID, host]]),
    getHost: () => host,
    accountSnapshot: () => ({ accounts: [{ id: ID, authenticated: true }] }),
    evidenceEpoch: () => ids.evidence,
    accountIdentityLease: () => ({ accountId: ID, identityEpoch: ids.identity, principalFingerprint: "a".repeat(64) }),
    acquireAccountReadOperation: () => { onRead(); return () => {}; },
  };
  const tools = createCodexAccountTools({
    getPool: () => pool, BrowserWindow: class {}, clipboard: {}, codexHome: "/nonexistent",
    createController: () => ({ selectionLock: () => null, status: () => ({}), destroy: async () => {} }),
  });
  return { tools, ids, fetches: () => fetches, setOnRead: (fn: () => void) => { onRead = fn; } };
}

test("an evidence re-check (Check / connector / sign-in restore) keeps the allowance; an identity change drops it", async () => {
  const { tools, ids } = fixture();
  await tools.refreshQuota(ID);
  expect(tools.quotaSnapshot(ID)?.availability).toBe("available");
  ids.evidence += 1; // account-pool invalidateEvidence(): capability/connector check, auth flip, proxy change
  expect(tools.quotaSnapshot(ID)?.availability).toBe("available"); // today: null -> "Allowance has not been checked yet."
  ids.identity += 1; // sign-out / different principal / new session id
  expect(tools.quotaSnapshot(ID)).toBeNull();
});

test("a refresh that races an evidence re-check still lands", async () => {
  const { tools, ids, setOnRead } = fixture();
  setOnRead(() => { ids.evidence += 1; }); // e.g. startup connector verification finishing mid-read
  await expect(tools.refreshQuota(ID)).resolves.toMatchObject({ availability: "available" }); // today: rejects
});
