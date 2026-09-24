const STAGES = new Set(["config", "request", "transport", "upstream", "catalog"]);

// Receipts are diagnostics, never arbitrary upstream messages or credential-bearing payloads.
function catalogReceipt(value) {
  if (!value || !Number.isSafeInteger(value.request) || value.request < 1
    || !Number.isInteger(value.status) || value.status < 200 || value.status > 599
    || typeof value.at !== "string" || value.at.length > 64
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.at)
    || !Number.isFinite(Date.parse(value.at))) return null;
  const stage = STAGES.has(value.failure?.stage) ? value.failure.stage : "catalog";
  const code = typeof value.failure?.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value.failure.code)
    ? value.failure.code : undefined;
  return { request: value.request, at: new Date(value.at).toISOString(), status: value.status,
    ...(value.status >= 300 ? { failure: { stage, ...(code ? { code } : {}) } } : {}) };
}

module.exports = { catalogReceipt };
