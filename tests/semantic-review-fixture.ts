import { activeTaskEvidence, normalizeSemanticReview, SEMANTIC_REVIEW_PROTOCOL } from "../src/agent-mode";
import type { AgentModeStore } from "../src/agent-mode";

/** Records a synthetic independent reviewer pass over the CURRENT ledger, citing each
 * requirement's active passed evidence. Host normalization still applies unchanged. */
export function recordSemanticPass(store: AgentModeStore, taskId: string, model = "synthetic-reviewer") {
  const task = store.getTask(taskId), input = store.semanticReviewInput(taskId);
  const attemptId = `synthetic-attempt-${task.generation}-${task.revision}-${task.evidenceRevision}`;
  store.recordSemanticReviewAttempt(taskId, { attemptId, actionId: attemptId, generation: task.generation, taskRevision: task.revision, evidenceRevision: task.evidenceRevision, inputDigest: input.digest, reviewer: { provider: "local-responses", model } });
  const verdicts = normalizeSemanticReview(input.packet, JSON.stringify({ protocol: SEMANTIC_REVIEW_PROTOCOL,
    requirements: task.requirements.map(row => ({ requirementId: row.id, verdict: "pass", sufficiency: "complete", evidenceIds: activeTaskEvidence(task).filter(fact => fact.requirementId === row.id && fact.outcome === "passed").map(fact => fact.id), toolReceiptIds: [], rationale: "Synthetic independent judgment over the cited facts.", missing: [] })),
    deliverable: { verdict: "pass", rationale: "Synthetic whole-deliverable judgment." } }));
  return store.recordSemanticReviewResult(taskId, { attemptId, state: "recorded", receiptId: `response:${attemptId}`, review: { id: `semantic-${attemptId}`, attemptId, generation: task.generation, taskRevision: task.revision, evidenceRevision: task.evidenceRevision, inputDigest: input.digest,
    reviewer: { provider: "local-responses", model, context: "fresh-tool-less", independence: "separate-provider", receiptId: `response:${attemptId}` }, requirements: verdicts.requirements, deliverable: verdicts.deliverable, completeInput: input.packet.completeInput, hostAdjustments: verdicts.hostAdjustments, createdAt: 0 } });
}
