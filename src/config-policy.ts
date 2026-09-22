import type { AppConfig, BrowserInteractionMode } from "./config";

/**
 * ChatGPT caches the complete public MCP schema by connector identity. Native command approval
 * request fields change both contracts, so neither may reuse a cached connector identity.
 */
export const CHATGPT_CONNECTOR_NAME = "Codex Native4";
export const DEV_CHATGPT_CONNECTOR_NAME = `${CHATGPT_CONNECTOR_NAME} DEV`;
export const CHATGPT_ASYNC_CONNECTOR_NAME = "Codex Native6";
export const PREVIOUS_ASYNC_CONNECTOR_NAME = "Codex Native5";
export const PREVIOUS_ASYNC_DEV_CONNECTOR_NAME = `${PREVIOUS_ASYNC_CONNECTOR_NAME} DEV`;
export const DEV_CHATGPT_ASYNC_CONNECTOR_NAME = `${CHATGPT_ASYNC_CONNECTOR_NAME} DEV`;
export const ZERO_RISK_CHATGPT_CONNECTOR_NAME = "Codex Zero Risk4";
export const LEGACY_CHATGPT_CONNECTOR_NAMES = [
  "Codex Native", "Codex Native DEV", "Codex Native2", "Codex Native2 DEV", "Codex Zero Risk",
  "Codex Native3", "Codex Native3 DEV", "Codex Zero Risk2", "Codex Zero Risk3",
] as const;

export function isLegacyChatGptConnectorName(value: string): boolean {
  return typeof value === "string"
    && (LEGACY_CHATGPT_CONNECTOR_NAMES as readonly string[]).includes(value.trim());
}

export function canonicalizeChatGptConnectorName(value: string): string {
  return value.trim();
}

export function currentChatGptConnectorName(legacyName: string): string {
  const canonicalName = canonicalizeChatGptConnectorName(legacyName);
  if (canonicalName === "Codex Zero Risk" || canonicalName === "Codex Zero Risk2" || canonicalName === "Codex Zero Risk3") return ZERO_RISK_CHATGPT_CONNECTOR_NAME;
  return canonicalName.endsWith(" DEV") ? DEV_CHATGPT_CONNECTOR_NAME : CHATGPT_CONNECTOR_NAME;
}

export function legacyChatGptConnectorMigrationMessage(legacyName: string): string {
  const currentName = currentChatGptConnectorName(legacyName);
  return `Legacy ChatGPT connector ${JSON.stringify(legacyName)} was found, but this release requires`
    + ` a newly created connector named ${JSON.stringify(currentName)}. Reconnect the harness in setup, then create`
    + ` ${JSON.stringify(currentName)} against that mode's tunnel with Authentication set to None;`
    + ` do not rename or refresh ${JSON.stringify(legacyName)}. Verify the new codex_exec argument schema;`
    + ` command approval remains controlled by the outer Codex runtime.`;
}

export interface InteractionConnectorIdentities {
  appName: string;
  automaticAppName: string;
  manualAppName: typeof ZERO_RISK_CHATGPT_CONNECTOR_NAME;
}

export function resolveInteractionConnectorIdentities(
  interactionMode: BrowserInteractionMode,
  profile: "production" | "development" = "production",
  experimentalAsyncToolOperations = true,
  retainedAutomaticName?: string,
): InteractionConnectorIdentities {
  const allowedRetained = profile === "development"
    ? [DEV_CHATGPT_CONNECTOR_NAME, PREVIOUS_ASYNC_DEV_CONNECTOR_NAME, DEV_CHATGPT_ASYNC_CONNECTOR_NAME]
    : [CHATGPT_CONNECTOR_NAME, PREVIOUS_ASYNC_CONNECTOR_NAME, CHATGPT_ASYNC_CONNECTOR_NAME];
  // Manual transport is synchronous but retains the separate Automatic connector identity.
  const preserveInactive = interactionMode === "manual" && retainedAutomaticName !== undefined
    && allowedRetained.includes(retainedAutomaticName);
  const preserveNative5 = experimentalAsyncToolOperations && retainedAutomaticName === (profile === "development"
    ? PREVIOUS_ASYNC_DEV_CONNECTOR_NAME : PREVIOUS_ASYNC_CONNECTOR_NAME);
  const automaticAppName = preserveInactive || preserveNative5 ? retainedAutomaticName! : experimentalAsyncToolOperations
    ? profile === "development" ? DEV_CHATGPT_ASYNC_CONNECTOR_NAME : CHATGPT_ASYNC_CONNECTOR_NAME
    : profile === "development" ? DEV_CHATGPT_CONNECTOR_NAME : CHATGPT_CONNECTOR_NAME;
  return {
    appName: interactionMode === "manual" ? ZERO_RISK_CHATGPT_CONNECTOR_NAME : automaticAppName,
    automaticAppName,
    manualAppName: ZERO_RISK_CHATGPT_CONNECTOR_NAME,
  };
}

/** Runtime validates persisted compatibility; setup explicitly transitions identities. */
export function validateRuntimeConnectorFeatures(
  parsed: Pick<Partial<AppConfig>, "purpose">,
  browserInteractionMode: BrowserInteractionMode,
  automaticAppName: string,
  experimentalAsyncToolOperations: boolean,
  path: string,
): void {
  const expectedAsyncConnectorName = parsed.purpose === "dev-harness"
    ? DEV_CHATGPT_ASYNC_CONNECTOR_NAME
    : CHATGPT_ASYNC_CONNECTOR_NAME;
  const expectedSynchronousConnectorName = parsed.purpose === "dev-harness"
    ? DEV_CHATGPT_CONNECTOR_NAME
    : CHATGPT_CONNECTOR_NAME;
  const previousAsyncConnectorName = parsed.purpose === "dev-harness"
    ? PREVIOUS_ASYNC_DEV_CONNECTOR_NAME : PREVIOUS_ASYNC_CONNECTOR_NAME;
  if (experimentalAsyncToolOperations && ![expectedAsyncConnectorName, previousAsyncConnectorName].includes(automaticAppName)) {
    throw new Error(
      `experimentalAsyncToolOperations requires automaticAppName ${JSON.stringify(expectedAsyncConnectorName)} in ${path}; rerun setup explicitly`,
    );
  }
  if (!experimentalAsyncToolOperations && automaticAppName !== expectedSynchronousConnectorName
    && !(browserInteractionMode === "manual" && [expectedAsyncConnectorName, previousAsyncConnectorName].includes(automaticAppName))) {
    throw new Error(
      `Synchronous tool operations require automaticAppName ${JSON.stringify(expectedSynchronousConnectorName)} in ${path}; rerun setup explicitly`,
    );
  }
}
