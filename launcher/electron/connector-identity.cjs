const CURRENT_CONNECTOR_NAME = "Codex Native4";
const ASYNC_CONNECTOR_NAME = "Codex Native6";
const MANUAL_CONNECTOR_NAME = "Codex Zero Risk4";
const ASYNC_DEV_CONNECTOR_NAME = `${ASYNC_CONNECTOR_NAME} DEV`;
const LEGACY_CONNECTOR_NAMES = Object.freeze([
  "Codex Native", "Codex Native DEV", "Codex Native2", "Codex Native2 DEV", "Codex Zero Risk",
  "Codex Native3", "Codex Native3 DEV", "Codex Zero Risk2", "Codex Zero Risk3",
]);

function automaticConnectorName({ development = false, asyncToolOperations = true } = {}) {
  const name = asyncToolOperations ? ASYNC_CONNECTOR_NAME : CURRENT_CONNECTOR_NAME;
  return development ? `${name} DEV` : name;
}

function currentConnectorName(legacyName, options) {
  if (legacyName === "Codex Zero Risk" || legacyName === "Codex Zero Risk2" || legacyName === "Codex Zero Risk3") return MANUAL_CONNECTOR_NAME;
  return automaticConnectorName({ ...options, development: legacyName.endsWith(" DEV") });
}

function validateConnectorName(value) {
  const configured = typeof value === "string" ? value.trim() : "";
  if (!configured || configured.length > 80) {
    throw new Error("Connector name is invalid");
  }
  return configured;
}

function isLegacyConnectorName(value) {
  return typeof value === "string" && LEGACY_CONNECTOR_NAMES.includes(value.trim());
}

function requireCurrentRuntimeConnectorName(value) {
  const configured = validateConnectorName(value);
  if (isLegacyConnectorName(configured)) {
    throw new Error(
      `The local runtime still targets legacy ChatGPT connector ${JSON.stringify(configured)}. Reconnect the harness`
      + ` so it targets ${JSON.stringify(currentConnectorName(configured))}, then create that connector as a new ChatGPT plugin;`
      + ` do not rename or refresh the legacy connector.`,
    );
  }
  return configured;
}

module.exports = {
  ASYNC_CONNECTOR_NAME,
  ASYNC_DEV_CONNECTOR_NAME,
  automaticConnectorName,
  CURRENT_CONNECTOR_NAME,
  isLegacyConnectorName,
  LEGACY_CONNECTOR_NAMES,
  MANUAL_CONNECTOR_NAME,
  requireCurrentRuntimeConnectorName,
  validateConnectorName,
};
