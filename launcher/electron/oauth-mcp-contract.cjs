'use strict';
// Public contracts only. Credentials, HTTP session identifiers and arbitrary headers are never DTOs.
const net = require('node:net');
const { createHash } = require('node:crypto');
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const HASH = /^[a-f0-9]{64}$/;
const PIN_KEYS = ['providerId', 'resource', 'endpoint', 'issuer', 'clientId', 'metadataDigest', 'accountId', 'epoch', 'serverId'];
function fail() { throw new Error('Reviewed OAuth MCP authority or exact invocation unavailable'); }
function exact(value, keys) { return plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function canonical(value, depth = 0) {
  if (depth > 32) fail();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(item => canonical(item, depth + 1)).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1)).join(',') + '}';
  fail();
}
function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function publicUrl(raw, requireCanonical = true) {
  if (typeof raw !== 'string' || raw.length > 2048) fail();
  let url; try { url = new URL(raw); } catch { fail(); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || requireCanonical && raw !== url.href
    || !host.includes('.') || net.isIP(host) || /(?:^|\.)(?:localhost|local|internal|home|invalid|test)$/.test(host)) fail();
  return url;
}
function publicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split('.').map(Number);
    return a > 0 && a < 224 && a !== 10 && a !== 127
      && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254)
      && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0 || b === 88 && c === 99))
      && !(a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) && !(a === 203 && b === 0 && c === 113);
  }
  return net.isIPv6(address) && /^[23][0-9a-f]{3}:/i.test(address)
    && !/^2001:(?:0{0,3}[0-9a-f]{1,2}:|0{0,2}1[0-9a-f]{2}:|db8:)/i.test(address)
    && !/^(?:2002:|3fff:)/i.test(address);
}
function validateOAuthMcpPin(input) {
  if (!exact(input, PIN_KEYS) || !ID.test(input.providerId) || !ID.test(input.accountId)
    || !/^[a-z][a-z0-9_-]{0,39}$/.test(input.serverId) || !input.serverId.startsWith('oauth_mcp_')
    || !HASH.test(input.epoch) || !HASH.test(input.metadataDigest)
    || typeof input.clientId !== 'string' || !input.clientId || input.clientId.length > 2000 || /[\r\n\0]/.test(input.clientId)) fail();
  publicUrl(input.endpoint); publicUrl(input.resource); publicUrl(input.issuer, false);
  // The OAuth resource is the exact reviewed MCP endpoint, not a broad origin or renderer URL.
  if (input.resource !== input.endpoint) fail();
  return Object.freeze(structuredClone(input));
}
function validateScope(scope) {
  if (!exact(scope, ['taskId', 'generation', 'toolCallId']) || !ID.test(scope.taskId) || !ID.test(scope.toolCallId)
    || !Number.isSafeInteger(scope.generation) || scope.generation < 1) fail();
  return structuredClone(scope);
}
function validateInvocation(pin, request) {
  if (!exact(request, ['scope', 'tool', 'arguments', 'idempotencyKey', 'invocationHash'])) fail();
  validateScope(request.scope);
  if (typeof request.idempotencyKey !== 'string' || !request.idempotencyKey || request.idempotencyKey.length > 240
    || typeof request.tool !== 'string' || !request.tool.startsWith(pin.serverId + '/')
    || !/^[a-zA-Z0-9_.-]{1,120}$/.test(request.tool.slice(pin.serverId.length + 1))
    || !exact(request.arguments, ['binding', 'input']) || request.arguments.binding !== digest(pin) || !plain(request.arguments.input)
    || Buffer.byteLength(canonical(request.arguments)) > 96 * 1024 || !HASH.test(request.invocationHash)
    || request.invocationHash !== oauthMcpInvocationHash(pin, request)) fail();
  return structuredClone(request);
}
function oauthMcpInvocationHash(pin, request) {
  return digest({ pin: validateOAuthMcpPin(pin), scope: validateScope(request.scope), tool: request.tool,
    arguments: request.arguments, idempotencyKey: request.idempotencyKey });
}
function scrub(value, token) {
  // Decode JSON before redaction too: an upstream JSON \u escape must not bypass token suppression.
  const visit = (item, depth = 0) => {
    if (depth > 40) fail();
    if (typeof item === 'string') return item.split(token).join('[protected]');
    if (Array.isArray(item)) return item.map(value => visit(value, depth + 1));
    if (plain(item)) return Object.fromEntries(Object.entries(item).map(([key, value]) => [key.split(token).join('[protected]'), visit(value, depth + 1)]));
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return item;
    fail();
  };
  const result = visit(value);
  if (Buffer.byteLength(canonical(result)) > 192 * 1024) fail();
  return result;
}
module.exports = { validateOAuthMcpPin, oauthMcpPinDigest: digest, oauthMcpInvocationHash,
  validateInvocation, validateScope, canonical, digest, plain, exact, publicUrl, publicAddress, scrub };
