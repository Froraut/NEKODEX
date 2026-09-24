const { test } = require("node:test");
const assert = require("node:assert/strict");
const { AccountQuotaReader } = require("../electron/account-quotas.cjs");

function jwt(accountId) {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: accountId },
  })).toString("base64url");
  return `${header}.${payload}.signature`;
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function session(remoteAccountId, usageReplies) {
  let usageIndex = 0;
  return { fetch: async url => url.endsWith("/api/auth/session")
    ? json({ accessToken: jwt(remoteAccountId) })
    : usageReplies[Math.min(usageIndex++, usageReplies.length - 1)]() };
}

const usage = (remoteAccountId, usedPercent) => () => json({
  account_id: remoteAccountId,
  rate_limit: { allowed: true, limit_reached: false, primary_window: { used_percent: usedPercent } },
});
const failure = (status = 503, headers = {}) => () => json({ error: "unavailable" }, status, headers);

test("quota freshness expires and failed refresh retains only the same owner's observed values", async () => {
  let now = 1_000;
  const reader = new AccountQuotaReader({ now: () => now, successTtlMs: 100, failureTtlMs: 20, minRefreshMs: 10 });
  const owner = session("remote-a", [usage("remote-a", 25), failure()]);

  const fresh = await reader.read(owner, "default", 7, { refresh: true });
  assert.equal(fresh.freshness, "fresh");
  assert.equal(fresh.fetchedAt, new Date(1_000).toISOString());
  assert.equal(fresh.freshUntil, new Date(1_100).toISOString());
  assert.equal(fresh.refreshError, null);

  now = 1_101;
  const expired = reader.snapshot(owner, "default", 7);
  assert.equal(expired.freshness, "stale");
  assert.equal(expired.refreshError, null);
  assert.equal(expired.accountBucket.primary.usedPercent, 25);

  const retained = await reader.read(owner, "default", 7, { refresh: true });
  assert.equal(retained.availability, "available");
  assert.equal(retained.freshness, "stale");
  assert.equal(retained.fetchedAt, fresh.fetchedAt);
  assert.equal(retained.freshUntil, fresh.freshUntil);
  assert.equal(retained.refreshError, "usage_unavailable");
  assert.equal(retained.checkedAt, new Date(1_101).toISOString());
  assert.equal(retained.accountBucket.primary.usedPercent, 25);

  const replacement = session("remote-b", [failure()]);
  now = 1_200;
  const unavailable = await reader.read(replacement, "default", 8, { refresh: true });
  assert.equal(unavailable.availability, "unavailable");
  assert.equal(unavailable.freshness, "stale");
  assert.equal(unavailable.freshUntil, null);
  assert.equal(unavailable.refreshError, "usage_unavailable");
  assert.equal(unavailable.fetchedAt, undefined);
  assert.equal(unavailable.accountBucket.primary.usedPercent, null);
});

test("an explicit failed refresh marks retained values stale before their original TTL", async () => {
  let now = 2_000;
  const reader = new AccountQuotaReader({ now: () => now, successTtlMs: 1_000, failureTtlMs: 20, minRefreshMs: 10 });
  const owner = session("remote-a", [usage("remote-a", 30), failure()]);
  const fresh = await reader.read(owner, "default", 9, { refresh: true });
  now = 2_011;
  const retained = await reader.read(owner, "default", 9, { refresh: true });
  assert.equal(retained.freshUntil, fresh.freshUntil);
  assert.equal(retained.freshness, "stale");
  assert.equal(reader.snapshot(owner, "default", 9).freshness, "stale");
  assert.equal(retained.refreshError, "usage_unavailable");
});

test("429 retention preserves values, retryAt throttling, and shared in-flight ownership", async () => {
  let now = 10_000;
  let release;
  let usageCalls = 0;
  const remote = "remote-rate-limited";
  const owner = { fetch: async url => {
    if (url.endsWith("/api/auth/session")) return json({ accessToken: jwt(remote) });
    usageCalls += 1;
    if (usageCalls === 1) return usage(remote, 40)();
    await new Promise(resolve => { release = resolve; });
    return failure(429, { "retry-after": "60" })();
  } };
  const reader = new AccountQuotaReader({ now: () => now, successTtlMs: 100, failureTtlMs: 20, minRefreshMs: 10 });
  await reader.read(owner, "default", 3, { refresh: true });
  now = 10_101;
  const first = reader.read(owner, "default", 3, { refresh: true });
  const joined = reader.read(owner, "default", 3, { refresh: true });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  release();
  const [retained, coalesced] = await Promise.all([first, joined]);
  assert.deepEqual(coalesced, retained);
  assert.equal(usageCalls, 2);
  assert.equal(retained.availability, "available");
  assert.equal(retained.freshness, "stale");
  assert.equal(retained.refreshError, "rate_limited");
  assert.equal(retained.retryAt, new Date(70_101).toISOString());

  now = 20_000;
  const throttled = await reader.read(owner, "default", 3, { refresh: true });
  assert.deepEqual(throttled, retained);
  assert.equal(usageCalls, 2);
});
