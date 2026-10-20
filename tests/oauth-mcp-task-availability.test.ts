import { expect, test } from 'bun:test';
import { oauthMcpCallMatches, oauthMcpConnectionMatches, oauthMcpTaskConnection, type OAuthMcpStatus } from '../launcher/src/AgentOAuthMcpPanel';

test('an exact live OAuth binding permits its saved call without stdio config; stale/revoked/held snapshots grant nothing', () => {
  const scope = { taskId: 'selected-task', generation: 2, toolCallId: 'oauth-mcp-control' };
  const accountKey = JSON.stringify(['selected-account', 'current-epoch']), binding = 'a'.repeat(64);
  const pin = { providerId: 'linear-readonly', resource: 'https://mcp.linear.app/mcp', endpoint: 'https://mcp.linear.app/mcp',
    issuer: 'https://linear.app', clientId: 'public-client', metadataDigest: 'b'.repeat(64), accountId: 'selected-account', epoch: 'current-epoch', serverId: 'oauth_mcp_tools' };
  const status: OAuthMcpStatus = { closed: false, unavailable: false, providers: [{ ...pin, label: 'Linear' }],
    bindings: [{ scope, pin, binding }], receipts: [{ binding, providerId: pin.providerId, serverId: pin.serverId,
      stopped: false, activeCount: 0, receiptCount: 0, heldUnknownCount: 0, ownerHeld: false, receipts: [] }] };
  // OAuth readiness is supplied by its own snapshot; there is no stdio/global-enable input.
  const connection = oauthMcpTaskConnection(status, scope, accountKey);
  expect(connection?.bindings).toEqual([{ binding, serverId: 'oauth_mcp_tools' }]);
  const refreshed = oauthMcpTaskConnection(status, scope, accountKey, 2);
  expect(oauthMcpConnectionMatches(connection, scope, accountKey, 0)).toBe(true);
  // Same task/account/generation is insufficient after an explicit refresh:
  // the old callback must fail closed and only a newly checked snapshot wins.
  expect(oauthMcpConnectionMatches(connection, scope, accountKey, 2)).toBe(false);
  expect(oauthMcpConnectionMatches(refreshed, scope, accountKey, 2)).toBe(true);
  const call = { tool: 'oauth_mcp_tools/' + binding.slice(0, 16) + '__list_issues', arguments: { binding, input: { limit: 1 } } };
  expect(oauthMcpCallMatches(connection, call)).toBe(true);
  expect(oauthMcpCallMatches(connection, { ...call, arguments: { binding: 'c'.repeat(64) } })).toBe(false);
  expect(oauthMcpCallMatches(connection, { ...call, tool: 'other-server/' + binding.slice(0, 16) + '__list_issues' })).toBe(false);
  expect(oauthMcpCallMatches(connection, { ...call, tool: 'oauth_mcp_tools/' + 'c'.repeat(16) + '__list_issues' })).toBe(false);
  expect(oauthMcpTaskConnection(status, { ...scope, generation: 3 }, accountKey)).toBeNull();
  expect(oauthMcpTaskConnection(status, { ...scope, taskId: 'other-task' }, accountKey)).toBeNull();
  expect(oauthMcpTaskConnection(status, scope, JSON.stringify(['selected-account', 'new-epoch']))).toBeNull();
  expect(oauthMcpTaskConnection(status, undefined, accountKey)).toBeNull();
  expect(oauthMcpTaskConnection(null, scope, accountKey)).toBeNull();
  for (const change of [{ closed: true }, { unavailable: true }, { bindings: [] }, { providers: [] }, { receipts: [] }]) {
    expect(oauthMcpTaskConnection({ ...status, ...change }, scope, accountKey)).toBeNull();
  }
  for (const change of [{ stopped: true }, { ownerHeld: true }, { heldUnknownCount: 1 }, { activeCount: 1 }]) {
    expect(oauthMcpTaskConnection({ ...status, receipts: [{ ...status.receipts[0]!, ...change }] }, scope, accountKey)).toBeNull();
  }
  // A settled journal keeps its current writer lock until close. That lock is
  // distinct from a held unknown outcome or a foreign retained writer.
  expect(oauthMcpTaskConnection({ ...status, receipts: [{ ...status.receipts[0]!, ownerHeld: true, ownerCurrent: true }] }, scope, accountKey)?.bindings).toHaveLength(1);
  expect(oauthMcpTaskConnection({ ...status, receipts: [{ ...status.receipts[0]!, ownerHeld: true, ownerCurrent: true, heldUnknownCount: 1 }] }, scope, accountKey)).toBeNull();
  expect(oauthMcpCallMatches(null, call)).toBe(false);
});
