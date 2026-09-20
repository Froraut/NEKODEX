/** Narrow request identity needed before Responses parsing or continuation expansion. */
export interface ChatGptTurnIdentity {
  threadId?: string;
  turnId?: string;
  parentThreadId?: string;
  agentName?: string;
  subagentKind?: string;
  promptCacheKey?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function clientTurnMetadataFromBody(value: unknown): Record<string, unknown> | undefined {
  const body = record(value);
  const metadata = record(body?.client_metadata);
  const raw = metadata?.["x-codex-turn-metadata"];
  if (typeof raw === "string") {
    try { return record(JSON.parse(raw)); }
    catch { return undefined; }
  }
  return record(raw);
}

/** Read only Codex-owned lifecycle identity without interpreting or rewriting provider input. */
export function extractCodexTurnIdentityFromBody(value: unknown): ChatGptTurnIdentity {
  const metadata = clientTurnMetadataFromBody(value);
  return {
    ...(typeof metadata?.thread_id === "string" ? { threadId: metadata.thread_id } : {}),
    ...(typeof metadata?.turn_id === "string" ? { turnId: metadata.turn_id } : {}),
    ...(typeof metadata?.parent_thread_id === "string" ? { parentThreadId: metadata.parent_thread_id } : {}),
    ...(typeof metadata?.agent_name === "string" ? { agentName: metadata.agent_name } : {}),
    ...(typeof metadata?.subagent_kind === "string" ? { subagentKind: metadata.subagent_kind } : {}),
  };
}
