import { getCodexHome } from "../../codex-integration-shared";
import type { CodexParsedRequest } from "../../types";
import { verifyCurrentCodexObservationIdentity } from "./codex-rollout-environment";
import { extractChatGptRootThreadMetadata, extractChatGptThreadSpawnLineage, extractChatGptTurnIdentity } from "./environment";
import { taskObservationForRequest } from "./task-observation";

/** Native storage stays in the Bun daemon; the Node browser helper receives only the projection. */
export function verifiedTaskObservationForRequest(parsed: CodexParsedRequest) {
  const identity = extractChatGptTurnIdentity(parsed);
  const owner = extractChatGptThreadSpawnLineage(parsed) ?? extractChatGptRootThreadMetadata(parsed);
  const verified = Boolean(owner && identity.turnId
    && verifyCurrentCodexObservationIdentity(getCodexHome(), owner, identity.turnId));
  return taskObservationForRequest(parsed, Date.now(), verified);
}
