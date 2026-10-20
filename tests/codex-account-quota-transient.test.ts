import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { QUOTA_AUTO_RETRY_DELAYS_MS, createQuotaAutoRetryBudget, quotaAutoRetryDelay } from "../launcher/src/quota-auto-retry";
import type { AccountQuotaSnapshot } from "../launcher/src/types";

const require = createRequire(import.meta.url);

const { AccountQuotaReader } = require("../launcher/electron/account-quotas.cjs");
const { createCodexAccountTools } = require("../launcher/electron/codex-account-tools.cjs");

const ID = "875bc05d-0382-46a7-ba08-d473d569ac23";
const REMOTE = "remote-account";
const START = Date.parse("2026-10-20T18:36:00.000Z");

type Step = (init: { signal?: AbortSignal }) => Response | Promise<Response>;

function jwt(accountId: string) {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + 3600,
    "https://api.openai.com/auth": { chatgpt_account_id: accountId },
  })).toString("base64url");
  return `e30.${payload}.sig`;
}
function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
const signedIn: Step = () => json({ accessToken: jwt(REMOTE) });
const usage: Step = () => json({ account_id: REMOTE, plan_type: "plus", rate_limit: { allowed: true, limit_reached: false,
  primary_window: { used_percent: 40, limit_window_seconds: 604_800, reset_at: 2_000_000_000 } } });
const networkDown: Step = () => { throw new TypeError("fetch failed"); };
const hang: Step = ({ signal }) => new Promise((_resolve, reject) => {
  const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort);
});

function browserSession(steps: { session?: Step; usage?: Step } = {}) {
  const current = { session: steps.session ?? signedIn, usage: steps.usage ?? usage };
  return {
    current,
    session: { fetch: async (url: string, init: { signal?: AbortSignal }) =>
      (url.endsWith("/api/auth/session") ? current.session : current.usage)(init) },
  };
}

async function readOnce(steps: { session?: Step; usage?: Step }, options: Record<string, unknown> = {}) {
  const reader = new AccountQuotaReader({ now: () => START, ...options });
  return reader.read(browserSession(steps).session, ID, 1, { refresh: true });
}

function toolsFixture(steps: { session?: Step; usage?: Step }) {
  let clock = START;
  const browser = browserSession(steps);
  const host = { view: { webContents: { session: browser.session, isDestroyed: () => false } }, ready: async () => {} };
  const pool = {
    hosts: new Map([[ID, host]]),
    getHost: () => host,
    accountSnapshot: () => ({ accounts: [{ id: ID, authenticated: true }] }),
    evidenceEpoch: () => 3,
    accountIdentityLease: () => ({ accountId: ID, identityEpoch: 1, principalFingerprint: "a".repeat(64) }),
    acquireAccountReadOperation: () => () => {},
  };
  const tools = createCodexAccountTools({
    getPool: () => pool, BrowserWindow: class {}, clipboard: {}, codexHome: "/nonexistent",
    quotaReader: new AccountQuotaReader({ now: () => clock }),
    createController: () => ({ selectionLock: () => null, status: () => ({}), destroy: async () => {} }),
  });
  return { tools, browser, advance: (ms: number) => { clock += ms; } };
}

test("a startup network failure is cached as transient and a later refresh replaces it", async () => {
  const { tools, browser, advance } = toolsFixture({ session: networkDown });
  const failed = await tools.refreshQuota(ID);
  expect(failed).toMatchObject({ availability: "unavailable", reason: "request_failed", transient: true, retryAfterMs: 30_000 });
  // The renderer's hydration sees the same cached result and knows it may heal.
  expect(tools.quotaSnapshot(ID)).toMatchObject({ availability: "unavailable", transient: true, retryAfterMs: 30_000 });

  browser.current.session = signedIn;
  advance(30_000);
  const healed = await tools.refreshQuota(ID);
  expect(healed).toMatchObject({ availability: "available", freshness: "fresh", refreshError: null });
  expect(healed.transient).toBeUndefined();
  expect(tools.quotaSnapshot(ID)).toMatchObject({ availability: "available", planType: "plus" });
});

test("timeouts, 5xx answers, a session page that is not ready and a cancelled read are transient", async () => {
  const html = () => new Response("<html>Just a moment…</html>", { status: 200, headers: { "content-type": "text/html" } });
  const cases: Array<[string, { session?: Step; usage?: Step }, Record<string, unknown>?]> = [
    ["timeout", { usage: hang }, { timeoutMs: 20 }],
    ["session_unavailable", { session: () => json({}, 502) }],
    ["session_unavailable", { session: html }],
    ["usage_unavailable", { usage: () => json({}, 503) }],
    ["usage_unavailable", { usage: () => json({}, 408) }],
  ];
  for (const [reason, steps, options] of cases) {
    expect(await readOnce(steps, options)).toMatchObject({ availability: "unavailable", reason, transient: true, retryAfterMs: 30_000 });
  }

  const reader = new AccountQuotaReader({ now: () => START });
  const pending = reader.read(browserSession({ usage: hang }).session, ID, 1, { refresh: true });
  await Promise.resolve();
  reader.clear(ID); // an account operation preempted the read
  expect(await pending).toMatchObject({ availability: "unavailable", reason: "stale_read", transient: true });
});

test("a definitive answer is not marked transient and Refresh allowance still reads again", async () => {
  const cases: Array<[string, { session?: Step; usage?: Step }]> = [
    ["usage_unavailable", { usage: () => json({ detail: "Not found" }, 404) }], // no Codex usage for this plan or account
    ["codex_auth_unsupported", { usage: () => json({}, 403) }],
    ["signed_out", { session: () => json({}, 401) }],
    ["unsupported_session", { session: () => json({}) }], // the session answered without a token
    ["session_unavailable", { session: () => json({}, 403) }],
  ];
  for (const [reason, steps] of cases) {
    expect(await readOnce(steps)).toMatchObject({ availability: "unavailable", reason, transient: false, retryAfterMs: null });
  }
  const limited = await readOnce({ usage: () => json({}, 429, { "retry-after": "120" }) });
  expect(limited).toMatchObject({ reason: "rate_limited", transient: false, retryAfterMs: null,
    retryAt: new Date(START + 120_000).toISOString() });

  const { tools, browser, advance } = toolsFixture({ usage: () => json({ detail: "Not found" }, 404) });
  expect(await tools.refreshQuota(ID)).toMatchObject({ reason: "usage_unavailable", transient: false });
  browser.current.usage = usage;
  advance(10_000);
  expect(await tools.refreshQuota(ID)).toMatchObject({ availability: "available" });
});

test("the renderer re-reads a transient result at most three times, 30 s, 60 s and 120 s apart", () => {
  const now = START;
  const transient = { availability: "unavailable", coverage: "none", accountId: ID, reason: "timeout",
    checkedAt: new Date(now).toISOString(), transient: true, retryAfterMs: 30_000 } as AccountQuotaSnapshot;
  expect(QUOTA_AUTO_RETRY_DELAYS_MS).toEqual([30_000, 60_000, 120_000]);
  expect([0, 1, 2, 3].map(spent => quotaAutoRetryDelay(transient, spent, now))).toEqual([30_000, 60_000, 120_000, null]);
  // Measured from the failed read: a card opened later re-reads an old failure sooner.
  expect(quotaAutoRetryDelay(transient, 0, now + 20_000)).toBe(10_000);
  expect(quotaAutoRetryDelay(transient, 1, now + 10 * 60_000)).toBe(0);
  expect(quotaAutoRetryDelay({ ...transient, retryAfterMs: 45_000 }, 0, now)).toBe(45_000);
  // Definitive and successful results, and no result yet, are never re-read automatically.
  expect(quotaAutoRetryDelay({ ...transient, transient: false, retryAfterMs: null }, 0, now)).toBeNull();
  expect(quotaAutoRetryDelay({ ...transient, availability: "available", coverage: "reported_buckets" }, 0, now)).toBeNull();
  expect(quotaAutoRetryDelay(null, 0, now)).toBeNull();

  const budget = createQuotaAutoRetryBudget();
  budget.spend(ID);
  budget.spend(ID);
  expect([budget.spent(ID), budget.spent("other-account")]).toEqual([2, 0]);
});
