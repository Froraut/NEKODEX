export type ChatGptSubmissionEvidence = "user_turn" | "assistant_turn" | "generation_running" | "mcp_tool_call";

export function chatGptSubmissionEvidence(state: {
  initialTurnIdentities: readonly string[];
  historicalTurnIdentities?: readonly string[];
  userIdentities: readonly string[];
  responseIdentities: readonly string[];
  generationRunning: boolean;
}): ChatGptSubmissionEvidence | undefined {
  const historical = state.historicalTurnIdentities ?? [];
  if (chatGptNewTurnIdentity(state.initialTurnIdentities, state.userIdentities, historical)) return "user_turn";
  if (chatGptNewTurnIdentity(state.initialTurnIdentities, state.responseIdentities, historical)) return "assistant_turn";
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

/** A grouped assistant identity and the user message of the same exchange. */
export function chatGptExchangeIdentities(identity: string): string[] {
  const prefix = "group:assistant:";
  return identity.startsWith(prefix) ? [identity, `group:user:${identity.slice(prefix.length)}`] : [identity];
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
    // The stage's own user message is history too; otherwise it can look like the next Send.
    if (matching[0]) for (const identity of chatGptExchangeIdentities(matching[0].identity)) identities.add(identity);
  }
  return [...identities];
}



/**
 * `historical` identities are known earlier exchanges that were not mounted, in order, when the
 * baseline was captured: acknowledged context stages a saved-chat virtualizer can unmount and later
 * remount above retained history (upstream #866). They are never new, but carry no order anchor.
 */
export function chatGptNewTurnIdentity(
  initial: readonly string[],
  current: readonly string[],
  historical: readonly string[] = [],
): string | undefined {
  const previous = new Set(initial);
  const known = new Set([...initial, ...historical]);
  const observed = new Set(current);
  const retainedInitial = initial.filter(identity => observed.has(identity));
  const retainedCurrent = current.filter(identity => previous.has(identity));
  if (retainedInitial.length !== retainedCurrent.length
    || retainedInitial.some((identity, index) => identity !== retainedCurrent[index])) {
    throw new Error("ChatGPT conversation history order changed after Send");
  }
  // A retained identity separates restored older history from post-Send turns.
  // Without that anchor, every unknown identity remains a possible new turn.
  const anchor = retainedInitial.at(-1);
  const boundary = anchor === undefined ? -1 : current.lastIndexOf(anchor);
  const added = current.slice(boundary + 1).filter(identity => !known.has(identity));
  if (added.length > 1) {
    throw new Error(`ChatGPT exposed ${added.length} new conversation turns for one submitted message`);
  }
  return added[0];
}

export function chatGptReboundTurnIdentity(
  initial: readonly string[],
  boundIdentity: string,
  current: readonly string[],
  historical: readonly string[] = [],
): string | undefined {
  if (current.includes(boundIdentity)) return boundIdentity;
  return chatGptNewTurnIdentity(initial, current, historical);
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
