const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AccountQuotaReader } = require('../electron/account-quotas.cjs');

function jwt(accountId) {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: accountId },
  })).toString('base64url');
  return `${header}.${payload}.signature`;
}

function response(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function readQuota(additionalRateLimits) {
  const remoteAccountId = 'remote-account-fixture';
  const replies = [
    response({ accessToken: jwt(remoteAccountId) }),
    response({ account_id: remoteAccountId, additional_rate_limits: additionalRateLimits }),
  ];
  const session = { fetch: async () => replies.shift() };
  return new AccountQuotaReader({ now: () => 1_000 }).read(session, 'default', 1, { refresh: true });
}

function bucket(id) {
  return { metered_feature: id, rate_limit: { allowed: true, limit_reached: false } };
}

test('additional quota truncation reports only omitted valid unique buckets', async () => {
  const completeBuckets = Array.from({ length: 32 }, (_, index) => bucket(`bucket-${index}`));
  const repeatedAndMalformed = [
    ...completeBuckets,
    ...Array.from({ length: 33 }, () => bucket('bucket-0')),
    null,
    {},
  ];
  const complete = await readQuota(repeatedAndMalformed);
  assert.equal(complete.availability, 'available');
  assert.deepEqual(complete.additionalBuckets.map(item => item.id),
    completeBuckets.map(item => item.metered_feature));
  assert.equal(complete.additionalBucketsTruncated, false);

  const overLimit = await readQuota(Array.from({ length: 33 }, (_, index) => bucket(`bucket-${index}`)));
  assert.equal(overLimit.availability, 'available');
  assert.equal(overLimit.additionalBuckets.length, 32);
  assert.equal(overLimit.additionalBucketsTruncated, true);
});
