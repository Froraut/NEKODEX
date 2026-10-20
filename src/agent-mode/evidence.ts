import type { AgentTask, OutcomeEvidence } from "./types";

/** Immutable history remains in the task; only explicitly superseded exact-boundary facts retire. */
export function activeTaskEvidence(task: Pick<AgentTask, "revision" | "evidence">): OutcomeEvidence[] {
  const current = task.evidence.filter(evidence => evidence.taskRevision === task.revision);
  const superseded = new Set(current.flatMap(evidence => evidence.supersedes ?? []));
  return current.filter(evidence => !superseded.has(evidence.id));
}
