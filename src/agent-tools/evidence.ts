import type { AgentEvidenceReference } from "../agent-mode/http";
import type { AgentTask, OutcomeEvidence } from "../agent-mode/types";
import { sha256 } from "./config";
import type { ToolOutcome } from "./types";

export const MCP_TERMINAL_PROPERTY = "mcp.tool-terminal-result";
/** Deliberately narrow explicit requirement, not a generic business-outcome mapping. */
export function mcpTerminalRequirement(subject: string): string { return `Observe the terminal MCP tool result for ${subject}; property ${MCP_TERMINAL_PROPERTY}.`; }
export function mcpTerminalReference(outcome: ToolOutcome, requirementId: string): AgentEvidenceReference {
  if (outcome.state === "outcome_unknown") throw new Error("MCP terminal result is unknown");
  return { sourceEventId: `mcp:${sha256(outcome.idempotencyKey)}`, requirementId,
    subject: `mcp:${JSON.stringify([outcome.scope.taskId, outcome.scope.generation, outcome.scope.toolCallId, outcome.tool])}`,
    subjectRevision: `sha256:${sha256(JSON.stringify(outcome))}`, property: MCP_TERMINAL_PROPERTY };
}
/** The private receipt owner supplies lookup; caller assertions cannot supply a result. */
export function resolveMcpTerminalEvidence(task: AgentTask, reference: AgentEvidenceReference, lookup: (sourceEventId: string) => ToolOutcome | undefined): OutcomeEvidence {
  if (reference.property !== MCP_TERMINAL_PROPERTY) throw new Error("Unsupported MCP evidence property");
  const outcome = lookup(reference.sourceEventId);
  // A current explicit requirement may observe an immutable historical receipt.
  // This is a new read observation, never revival of the old execution grant.
  if (!outcome || outcome.scope.taskId !== task.id || outcome.scope.generation > task.generation) throw new Error("MCP evidence task scope mismatch");
  const expected = mcpTerminalReference(outcome, reference.requirementId);
  if (expected.sourceEventId !== reference.sourceEventId || expected.subject !== reference.subject || expected.subjectRevision !== reference.subjectRevision) throw new Error("MCP evidence receipt identity mismatch");
  const requirement = task.requirements.find(row => row.id === reference.requirementId);
  if (requirement?.text !== mcpTerminalRequirement(expected.subject)) throw new Error("Requirement does not explicitly request this terminal MCP result");
  return { ...expected, id: `mcp-evidence:${sha256(JSON.stringify([task.id, task.revision, reference.requirementId, expected.sourceEventId]))}`, taskRevision: task.revision,
    outcome: outcome.state === "completed" ? "passed" : "failed", observer: "nekodex-standalone-mcp-receipt" };
}
