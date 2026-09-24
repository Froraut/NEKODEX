const test = require("node:test");
const assert = require("node:assert/strict");
const { withCatalogObservation } = require("../electron/route-diagnostics.cjs");
const report = { schemaVersion: 1, codexHome: "/fixture/codex", configPath: "/fixture/codex/config.toml", profilePath: null,
  configStatus: "loaded", provider: "openai", profile: null, providerSource: "default", customProvider: false,
  modelCatalogOverride: false, installed: true, active: true, routeMatches: true, issueCodes: [] };
const config = { releaseVersion: "5.1.0-froraut.1", mode: "browser-only" };
const health = { service: "codex-chatgpt-web", status: "ok", version: config.releaseVersion, mode: config.mode,
  pid: 10, successful_model_catalog_requests: 3, last_successful_model_catalog_request_at: "2026-09-11T12:00:00Z" };

test("installed route alone never claims the catalog was requested", () => {
  assert.equal(withCatalogObservation(report, null, config).catalog.status, "unavailable");
  assert.equal(withCatalogObservation(report, { ...health, successful_model_catalog_requests: 0 }, config, 10).catalog.status, "waiting");
  const observed = withCatalogObservation(report, health, config, 10);
  assert.equal(observed.catalog.status, "observed");
  assert.equal(observed.catalog.successfulRequests, 3);
});

test("a redirect supersedes an older catalog success and a later success recovers", () => {
  const redirected = withCatalogObservation(report, { ...health, last_model_catalog_result: {
    request: 4, at: "2026-09-11T12:01:00Z", status: 302,
  } }, config, 10);
  assert.equal(redirected.catalog.status, "unavailable");
  assert.deepEqual(redirected.catalog.lastResult.failure, { stage: "catalog" });
  assert.equal(redirected.catalog.successfulRequests, 3);

  const recovered = withCatalogObservation(report, { ...health,
    successful_model_catalog_requests: 4,
    last_successful_model_catalog_request_at: "2026-09-11T12:02:00Z",
    last_model_catalog_result: { request: 5, at: "2026-09-11T12:02:00Z", status: 200 },
  }, config, 10);
  assert.equal(recovered.catalog.status, "observed");
  assert.equal(recovered.catalog.successfulRequests, 4);
  assert.equal(recovered.catalog.lastResult.failure, undefined);
});

test("IPC returns only the explicit diagnostic schema and canonical timestamp", () => {
  const result = withCatalogObservation({ ...report, secret: "credential", config: { token: "credential" } }, health, config, 10);
  assert.equal(JSON.stringify(result).includes("credential"), false);
  assert.equal(result.catalog.lastSuccessfulAt, "2026-09-11T12:00:00.000Z");
  assert.notEqual(result.issueCodes, report.issueCodes);
  for (const patch of [{ profile: "private name\ncredential" }, { provider: "https://secret" },
    { configPath: "relative/credential" }, { profilePath: "/path\ncredential" }, { codexHome: "" }]) {
    assert.throws(() => withCatalogObservation({ ...report, ...patch }, health, config), /invalid routing/);
  }
  const badDate = withCatalogObservation(report, { ...health, last_successful_model_catalog_request_at: "September 11 2026 (credential)" }, config, 10);
  assert.equal(badDate.catalog.status, "unavailable");
  assert.equal(badDate.catalog.lastSuccessfulAt, null);
});

test("old or foreign health payloads do not satisfy catalog observation", () => {
  for (const patch of [{ service: "other" }, { version: "old" }, { mode: "full" }, { pid: 11 },
    { successful_model_catalog_requests: -1 }, { last_successful_model_catalog_request_at: "invalid" }]) {
    assert.equal(withCatalogObservation(report, { ...health, ...patch }, config, 10).catalog.status, "unavailable");
  }
  assert.throws(() => withCatalogObservation({ ...report, issueCodes: ["raw secret"] }, health, config), /invalid routing/);
});

test("matching health cannot claim catalog observation without a valid owned daemon pid", () => {
  for (const expectedPid of [undefined, null, 0, -1, 10.5, "10", Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    const result = withCatalogObservation(report, health, config, expectedPid);
    assert.deepEqual(result.catalog, { status: "unavailable", successfulRequests: null, lastSuccessfulAt: null, lastResult: null });
    assert.equal(result.installed, true);
    assert.equal(result.active, true);
  }
});
