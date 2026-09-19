const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveNativeRequestProxy } = require("../electron/native-proxy.cjs");
const { withCatalogObservation } = require("../electron/route-diagnostics.cjs");

test("upstream519: native system proxy refresh respects endpoint and protocol boundaries", async () => {
  let route = "PROXY 127.0.0.1:8080";
  const destinations = [];
  const session = { resolveProxy: async url => { destinations.push(url); return route; } };
  const url = "https://chatgpt.com/backend-api/codex/models?client_version=1.2.3";
  assert.equal(await resolveNativeRequestProxy(session, url), "http://127.0.0.1:8080");
  route = "DIRECT";
  assert.equal(await resolveNativeRequestProxy(session, url), "");
  assert.deepEqual(destinations, [url, url]);
  await assert.rejects(resolveNativeRequestProxy(session, "https://evil.example/backend-api/codex/models"));
  assert.equal(destinations.length, 2);
  route = "SOCKS5 localhost:1080; DIRECT";
  await assert.rejects(resolveNativeRequestProxy(session, url), /HTTP\/HTTPS/);
});

test("upstream519: current catalog failure supersedes a success without trusting a foreign owner", () => {
  const report = { schemaVersion: 1, codexHome: "/tmp/codex", configPath: "/tmp/codex/config.toml",
    profilePath: null, configStatus: "loaded", providerSource: "root", profile: null, provider: null,
    customProvider: false, modelCatalogOverride: false, installed: true, active: true,
    routeMatches: true, issueCodes: [] };
  const config = { releaseVersion: "5.3.0-nekodex.1", mode: "full" };
  const health = { service: "codex-chatgpt-web", status: "ok", version: config.releaseVersion,
    mode: config.mode, pid: 42, successful_model_catalog_requests: 1,
    last_successful_model_catalog_request_at: "2026-09-19T00:00:00.000Z",
    last_model_catalog_result: { request: 2, at: "2026-09-19T00:00:01.000Z", status: 502,
      failure: { stage: "transport", code: "ECONNREFUSED", message: "secret" } } };
  const result = withCatalogObservation(report, health, config, 42);
  assert.equal(result.catalog.status, "unavailable");
  assert.deepEqual(result.catalog.lastResult.failure, { stage: "transport", code: "ECONNREFUSED" });
  const foreign = withCatalogObservation(report, health, config, 43);
  assert.equal(foreign.catalog.lastResult, null);
  assert.equal(foreign.catalog.successfulRequests, null);
});
