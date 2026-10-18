import { createHash } from "node:crypto";
import { namespacedToolName, type CodexParsedRequest } from "../../types";
import { externalClientContext } from "../../external-client-context";
import { extractChatGptThreadSpawnLineage, extractChatGptTurnIdentity } from "./environment";
import type { ChatGptExternalTurnProgressSnapshot } from "./turn-progress";

export interface TaskObservation {
  version: 1;
  observedAt: number;
  source: "validated-request";
  native?: { threadId: string; turnId: string; parentThreadId?: string; agentName?: string;
    source: "codex-client" | "external-client"; state: "request-observed" };
  lineage: Array<{ kind: "compaction" | "checkpoint" | "browser-rebind" | "assistant-replacement";
    observedAt: number; sourceTraceId?: string; fromId?: string; toId?: string }>;
  tools: Array<{ name: string; namespace?: string; advertised: boolean; selected: boolean;
    observed: "unobserved" | "succeeded"; observedAt?: number }>;
  skills: Array<{ name: string; source: "codex-selected-skill"; sourceDigest?: string; contentDigest: string }>;
  toolCounters?: { total: number; succeeded: number; errors: number; samples: number; totalLatencyMs: number; minLatencyMs?: number; maxLatencyMs?: number };
  toolsTruncated: boolean;
  skillsTruncated: boolean;
}
const identifier = /^[A-Za-z0-9_.:-]{1,128}$/;
const skillName = /^[\p{L}\p{N}_.:/ -]{1,128}$/u;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** An allowlisted projection of an already parsed request, never its instructions or tool schemas. */
export function taskObservationForRequest(parsed: CodexParsedRequest, now = Date.now(), verifiedNative = false): TaskObservation {
  const identity = extractChatGptTurnIdentity(parsed);
  const lineage = extractChatGptThreadSpawnLineage(parsed);
  const native = (verifiedNative || externalClientContext(parsed)) && identity.threadId && identifier.test(identity.threadId)
    && identity.turnId && identifier.test(identity.turnId)
    ? { threadId: identity.threadId, turnId: identity.turnId,
      ...(verifiedNative && lineage?.threadId === identity.threadId && identifier.test(lineage.parentThreadId)
        ? { parentThreadId: lineage.parentThreadId,
          ...(/^\/root(?:\/[A-Za-z0-9_-]+)*$/.test(lineage.agentName) && lineage.agentName.length <= 128
            ? { agentName: lineage.agentName } : {}) } : {}),
      source: externalClientContext(parsed) ? "external-client" as const : "codex-client" as const,
      state: "request-observed" as const } : undefined;
  const choice = parsed.options.toolChoice;
  const selected = choice && typeof choice === "object"
    ? new Set("name" in choice ? [choice.name] : choice.allowedTools) : new Set<string>();
  const tools = [...new Map((parsed.context.tools ?? [])
    .filter(tool => identifier.test(tool.name) && (tool.namespace === undefined || identifier.test(tool.namespace)))
    .map(tool => [JSON.stringify([tool.namespace, tool.name]), {
      name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}), advertised: true,
      selected: selected.has(namespacedToolName(tool.namespace, tool.name)), observed: "unobserved" as const,
    }])).values()];
  const skills: TaskObservation["skills"] = [];
  for (const message of parsed.context.messages) {
    if (message.role !== "user" || message.origin !== "codex_skill") continue;
    if (Array.isArray(message.content) && message.content.some(part => part.type !== "text")) continue;
    const text = typeof message.content === "string" ? message.content
      : message.content.map(part => part.type === "text" ? part.text : "").join("\n");
    const name = /^<skill>\s*<name>([^<>\r\n]+)<\/name>/.exec(text)?.[1]?.trim();
    if (!name || !skillName.test(name) || !text.trimEnd().endsWith("</skill>")) continue;
    // The digest identifies selected content; it is not publisher authentication.
    const source = /<(?:path|source|location)>([^<>]+)<\/(?:path|source|location)>/.exec(text)?.[1];
    const contentDigest = digest(text);
    if (!skills.some(skill => skill.contentDigest === contentDigest)) skills.push({ name,
      source: "codex-selected-skill", ...(source ? { sourceDigest: digest(source) } : {}), contentDigest });
  }
  return boundTaskObservation({ version: 1, observedAt: now, source: "validated-request", ...(native ? { native } : {}),
    lineage: parsed._compactionRequest ? [{ kind: "compaction", observedAt: now }] : [],
    tools: tools.slice(0, 128), skills: skills.slice(0, 16), toolsTruncated: tools.length > 128, skillsTruncated: skills.length > 16 });
}

/** Exact wire-name matching is used only when the inventory maps it to one namespace/name pair. */
export function taskObservationWithProgress(observation: TaskObservation | undefined,
  progress: ChatGptExternalTurnProgressSnapshot | undefined): TaskObservation | undefined {
  if (!observation) return undefined;
  const successes = new Map((progress?.successfulTools ?? []).map(tool => [tool.wireName, tool.observedAt]));
  const counts = new Map<string, number>();
  for (const tool of observation.tools) {
    const wire = namespacedToolName(tool.namespace, tool.name);
    counts.set(wire, (counts.get(wire) ?? 0) + 1);
  }
  return { ...observation, ...(progress?.toolCounters ? { toolCounters: { ...progress.toolCounters } } : {}), tools: observation.tools.map(tool => {
    const wire = namespacedToolName(tool.namespace, tool.name);
    const at = successes.get(wire);
    return at !== undefined && counts.get(wire) === 1 ? { ...tool, observed: "succeeded", observedAt: at } : { ...tool };
  }) };
}

/** Stay below the existing 16KiB control request limit, including base owner fields. */
export function boundTaskObservation(value: TaskObservation): TaskObservation {
  const result = structuredClone(value);
  result.lineage = result.lineage.slice(-16);
  while (Buffer.byteLength(JSON.stringify(result), "utf8") > 12_000) {
    if (result.tools.length) { result.tools.pop(); result.toolsTruncated = true; }
    else if (result.skills.length) { result.skills.pop(); result.skillsTruncated = true; }
    else if (result.lineage.length) result.lineage.shift();
    else throw new Error("Task observation exceeds metadata budget");
  }
  return result;
}
