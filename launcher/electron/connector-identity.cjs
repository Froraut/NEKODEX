const CURRENT_CONNECTOR_NAME = "Codex Native4";
const MANUAL_CONNECTOR_NAME = "Codex Zero Risk4";
const DEV_CONNECTOR_NAME = `${CURRENT_CONNECTOR_NAME} DEV`;
const LEGACY_CONNECTOR_NAMES = Object.freeze([
  "Codex Native", "Codex Native DEV", "Codex Native2", "Codex Native2 DEV", "Codex Zero Risk",
  "Codex Native3", "Codex Native3 DEV", "Codex Zero Risk2", "Codex Zero Risk3",
]);

function currentConnectorName(legacyName) {
  if (legacyName === "Codex Zero Risk" || legacyName === "Codex Zero Risk2" || legacyName === "Codex Zero Risk3") return MANUAL_CONNECTOR_NAME;
  return legacyName.endsWith(" DEV") ? DEV_CONNECTOR_NAME : CURRENT_CONNECTOR_NAME;
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

function connectorNameForSetup(value) {
  const configured = validateConnectorName(value);
  return isLegacyConnectorName(configured) ? currentConnectorName(configured) : configured;
}

function connectorNameForDevSetup(value) {
  if (value === undefined || value === null) return DEV_CONNECTOR_NAME;
  const configured = validateConnectorName(value);
  if (configured === MANUAL_CONNECTOR_NAME || configured === "Codex Zero Risk" || configured === "Codex Zero Risk2" || configured === "Codex Zero Risk3") return MANUAL_CONNECTOR_NAME;
  if (configured === CURRENT_CONNECTOR_NAME || isLegacyConnectorName(configured)) {
    return DEV_CONNECTOR_NAME;
  }
  return configured;
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
  connectorNameForSetup,
  connectorNameForDevSetup,
  CURRENT_CONNECTOR_NAME,
  DEV_CONNECTOR_NAME,
  isLegacyConnectorName,
  LEGACY_CONNECTOR_NAMES,
  MANUAL_CONNECTOR_NAME,
  requireCurrentRuntimeConnectorName,
  validateConnectorName,
};
