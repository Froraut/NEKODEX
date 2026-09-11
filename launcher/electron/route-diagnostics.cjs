const ISSUE_CODES = new Set([
  "integration-unreadable", "integration-drift", "config-missing", "config-invalid",
  "config-unreadable", "profile-unavailable", "provider-invalid", "custom-provider",
  "catalog-override", "route-mismatch", "integration-recovery-pending",
]);
const path = require("node:path");
const safePath = value => typeof value === "string" && value.length > 0 && value.length <= 4096
  && !/[\u0000-\u001f\u007f]/.test(value) && (path.isAbsolute(value) || path.win32.isAbsolute(value));
const safeName = value => value === null || (typeof value === "string" && value.trim() === value
  && /^[\p{L}\p{M}\p{N}_. -]{1,128}$/u.test(value));

function withCatalogObservation(report, health, config, expectedPid) {
  if (!report || report.schemaVersion !== 1
    || !safePath(report.codexHome) || !safePath(report.configPath)
    || !(report.profilePath === null || safePath(report.profilePath))
    || !["missing", "loaded", "invalid", "unreadable"].includes(report.configStatus)
    || !["default", "root", "profile", "unknown"].includes(report.providerSource)
    || ![report.profile, report.provider].every(safeName)
    || typeof report.customProvider !== "boolean" || typeof report.modelCatalogOverride !== "boolean"
    || ![report.installed, report.active, report.routeMatches].every(value => value === null || typeof value === "boolean")
    || !Array.isArray(report.issueCodes) || report.issueCodes.length > ISSUE_CODES.size
    || !report.issueCodes.every(code => ISSUE_CODES.has(code))) {
    throw new Error("Runtime returned invalid routing diagnostics");
  }
  const current = config && health?.service === "codex-chatgpt-web" && health.status === "ok"
    && health.version === config.releaseVersion && health.mode === config.mode
    && Number.isSafeInteger(expectedPid) && expectedPid > 0
    && health.pid === expectedPid;
  const count = current && Number.isSafeInteger(health.successful_model_catalog_requests)
    && health.successful_model_catalog_requests >= 0 ? health.successful_model_catalog_requests : null;
  const timestamp = health?.last_successful_model_catalog_request_at;
  const lastAt = count > 0 && typeof timestamp === "string" && timestamp.length <= 64
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
    && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : null;
  return {
    schemaVersion: 1,
    codexHome: report.codexHome,
    configPath: report.configPath,
    profilePath: report.profilePath,
    configStatus: report.configStatus,
    profile: report.profile,
    provider: report.provider,
    providerSource: report.providerSource,
    customProvider: report.customProvider,
    modelCatalogOverride: report.modelCatalogOverride,
    installed: report.installed,
    active: report.active,
    routeMatches: report.routeMatches,
    issueCodes: [...report.issueCodes],
    catalog: {
      status: count === null || (count > 0 && !lastAt) ? "unavailable" : count > 0 ? "observed" : "waiting",
      successfulRequests: count,
      lastSuccessfulAt: lastAt,
    },
  };
}

module.exports = { withCatalogObservation };
