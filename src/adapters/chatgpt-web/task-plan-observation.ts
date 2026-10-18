import { getCodexHome } from "../../codex-integration-shared";
import type { CodexParsedRequest } from "../../types";
import { readCurrentCodexPlanSource } from "./codex-rollout-environment";
import { extractChatGptRootThreadMetadata, extractChatGptThreadSpawnLineage, extractChatGptTurnIdentity } from "./environment";

export interface TaskPlanRevision {
  revision: number;
  sourceCallId: string;
  sourceMessageId?: string;
  supersedes?: number;
  explanation?: string;
  steps: Array<{ text: string; claimedStatus: "pending" | "in_progress" | "completed";
    evidence: "observed"; verification: "unverified" }>;
}
/** Content-bearing opt-in observation, deliberately separate from N06 metadata. */
export interface TaskPlanObservation {
  version: 1;
  observedAt: number;
  source: "native-codex-current-turn";
  state: "disabled" | "unavailable" | "observed";
  reason?: "native-source-unavailable" | "no-native-plan" | "invalid-native-plan" | "plan-budget-exceeded";
  native?: { threadId: string; turnId: string };
  revisions: TaskPlanRevision[];
  truncated: boolean;
}

const identifier = /^[A-Za-z0-9_.:-]{1,128}$/;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, bytes: number): value is string => typeof value === "string" && value.trim().length > 0
  && Buffer.byteLength(value, "utf8") <= bytes && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const statuses = new Set(["pending", "in_progress", "completed"]);

function revisionForRecord(record: Record<string, unknown>, revision: number): TaskPlanRevision | undefined {
  // Built-in native update_plan is unnamespaced. A lookalike MCP function has no authority here.
  if (record.namespace != null || typeof record.call_id !== "string" || !identifier.test(record.call_id)
    || (record.id !== undefined && (typeof record.id !== "string" || !identifier.test(record.id)))
    || typeof record.arguments !== "string" || Buffer.byteLength(record.arguments, "utf8") > 16_000) return undefined;
  let args: unknown;
  try { args = JSON.parse(record.arguments); } catch { return undefined; }
  if (!object(args) || Object.keys(args).some(key => key !== "plan" && key !== "explanation")
    || !Array.isArray(args.plan) || args.plan.length > 32
    || (args.explanation !== undefined && !text(args.explanation, 1500))) return undefined;
  const steps: TaskPlanRevision["steps"] = [];
  for (const step of args.plan) {
    if (!object(step) || Object.keys(step).length !== 2 || !text(step.step, 1000)
      || typeof step.status !== "string" || !statuses.has(step.status)) return undefined;
    steps.push({ text: step.step, claimedStatus: step.status as TaskPlanRevision["steps"][number]["claimedStatus"],
      evidence: "observed", verification: "unverified" });
  }
  if (steps.filter(step => step.claimedStatus === "in_progress").length > 1) return undefined;
  return { revision, sourceCallId: record.call_id,
    ...(typeof record.id === "string" ? { sourceMessageId: record.id } : {}),
    ...(revision > 1 ? { supersedes: revision - 1 } : {}),
    ...(typeof args.explanation === "string" ? { explanation: args.explanation } : {}), steps };
}

/** The request supplies identity only; all plan content comes from its verified native journal.
 * A new revision replaces earlier claims, including completed claims. Nothing here verifies work. */
export function taskPlanObservationForRequest(parsed: CodexParsedRequest,
  options: { captureEnabled?: boolean; codexHome?: string; now?: number } = {}): TaskPlanObservation {
  const base: TaskPlanObservation = { version: 1, observedAt: options.now ?? Date.now(),
    source: "native-codex-current-turn", state: "disabled", revisions: [], truncated: false };
  if (options.captureEnabled !== true) return base;
  const unavailable = (reason: TaskPlanObservation["reason"]): TaskPlanObservation => ({ ...base, state: "unavailable", reason });
  const identity = extractChatGptTurnIdentity(parsed);
  const owner = extractChatGptThreadSpawnLineage(parsed) ?? extractChatGptRootThreadMetadata(parsed);
  if (!owner || identity.threadId !== owner.threadId || !identity.turnId) return unavailable("native-source-unavailable");
  const source = readCurrentCodexPlanSource(options.codexHome ?? getCodexHome(), owner, identity.turnId);
  if (source.kind !== "verified") return unavailable("native-source-unavailable");
  const native = { threadId: owner.threadId, turnId: identity.turnId };
  if (!source.records.length) return { ...unavailable("no-native-plan"), native };
  const revisions: TaskPlanRevision[] = [];
  const callIds = new Set<string>(); const messageIds = new Set<string>();
  for (const record of source.records) {
    const revision = revisionForRecord(record, revisions.length + 1);
    if (!revision || callIds.has(revision.sourceCallId)
      || (revision.sourceMessageId !== undefined && messageIds.has(revision.sourceMessageId))) return unavailable("invalid-native-plan");
    callIds.add(revision.sourceCallId);
    if (revision.sourceMessageId) messageIds.add(revision.sourceMessageId);
    revisions.push(revision);
  }
  const result: TaskPlanObservation = { ...base, state: "observed", native, revisions, truncated: false };
  while (result.revisions.length > 8 || Buffer.byteLength(JSON.stringify(result), "utf8") > 8_000) {
    if (result.revisions.length === 1) return unavailable("plan-budget-exceeded");
    result.revisions.shift(); result.truncated = true;
  }
  return result;
}
