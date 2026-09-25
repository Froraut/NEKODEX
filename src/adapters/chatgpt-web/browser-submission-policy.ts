export type ChatGptSubmissionEvidence = "user_turn" | "assistant_turn" | "generation_running" | "mcp_tool_call";

export function chatGptSubmissionEvidence(state: {
  initialTurnIdentities: readonly string[];
  userIdentities: readonly string[];
  responseIdentities: readonly string[];
  generationRunning: boolean;
}): ChatGptSubmissionEvidence | undefined {
  if (chatGptNewTurnIdentity(state.initialTurnIdentities, state.userIdentities)) return "user_turn";
  if (chatGptNewTurnIdentity(state.initialTurnIdentities, state.responseIdentities)) return "assistant_turn";
  if (state.generationRunning) return "generation_running";
  return undefined;
}

export type ChatGptConnectorAttachmentMode = "none" | "mention" | "retained";

/** A launcher lease may reuse a connector only after proving that exact retained surface is bound. */
export function chatGptConnectorAttachmentMode(
  localTools: boolean,
  reuseConversation: boolean,
): ChatGptConnectorAttachmentMode {
  if (!localTools) return "none";
  return reuseConversation ? "retained" : "mention";
}

export function chatGptStagedBaselineIdentities(
  initial: readonly string[],
  acknowledgedStages: readonly string[] = [],
  observed: readonly { identity: string; text: string }[] = [],
): readonly string[] {
  if (!acknowledgedStages.length) return initial;
  const identities = new Set(initial);
  for (const acknowledgement of acknowledgedStages) {
    const matching = observed.filter(turn => turn.text === acknowledgement);
    if (matching.length > 1) throw new Error("ChatGPT exposed duplicate acknowledged context stages");
    if (matching[0]) identities.add(matching[0].identity);
  }
  return [...identities];
}

export function chatGptNewTurnIdentity(
  initial: readonly string[],
  current: readonly string[],
): string | undefined {
  const previous = new Set(initial);
  const added = current.filter(identity => !previous.has(identity));
  if (added.length > 1) {
    throw new Error(`ChatGPT exposed ${added.length} new conversation turns for one submitted message`);
  }
  return added[0];
}

export function chatGptReboundTurnIdentity(
  initial: readonly string[],
  boundIdentity: string,
  current: readonly string[],
): string | undefined {
  if (current.includes(boundIdentity)) return boundIdentity;
  return chatGptNewTurnIdentity(initial, current);
}

/**
 * Lexical/contenteditable may preserve runs of ASCII spaces by exposing some of them as NBSP
 * through DOM textContent. Treat that DOM-only representation as equivalent only when the
 * expected U+0020 belongs to a multi-space run. Single spaces, tabs, newlines, intentional
 * expected NBSP characters, and every other mutation remain exact and fail closed.
 */
function promptCodeUnitEquivalent(
  expected: string,
  observed: string,
  index: number,
): boolean {
  const expectedUnit = expected[index];
  const observedUnit = observed[index];

  if (expectedUnit === observedUnit) return true;
  if (expectedUnit !== " " || observedUnit !== "\u00A0") return false;

  return expected[index - 1] === " " || expected[index + 1] === " ";
}

export function promptTextEquivalent(
  expected: string,
  observed: string,
): boolean {
  if (expected.length !== observed.length) return false;

  for (let index = 0; index < expected.length; index += 1) {
    if (!promptCodeUnitEquivalent(expected, observed, index)) {
      return false;
    }
  }

  return true;
}

export function promptEquivalentPrefixLength(
  expected: string,
  observed: string,
): number {
  const length = Math.min(expected.length, observed.length);

  let index = 0;
  while (
    index < length
    && promptCodeUnitEquivalent(expected, observed, index)
  ) {
    index += 1;
  }

  return index;
}
