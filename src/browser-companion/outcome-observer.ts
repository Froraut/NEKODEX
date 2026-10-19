import { createHash } from "node:crypto";
import { z } from "zod";
import type { AgentEvidenceReference } from "../agent-mode/http";
import type { AgentTask, OutcomeEvidence } from "../agent-mode/types";
import type { ToolOutcome } from "../agent-tools/types";
import { browserBindingOf, browserBindingSchema, browserObservationSchema, sameBrowserBinding } from "./protocol";

export const BROWSER_TEXT_TRANSITION_OBSERVER = "selected-browser-text-transition-v1";
export const BROWSER_TEXT_TRANSITION_PROPERTY = "browser.recorded-visible-text-transition";
const key = z.string().min(1).max(240);
const pageUrl = z.string().url().max(4096).refine(value => ["http:", "https:"].includes(new URL(value).protocol));
export const browserTextTransitionSchema = z.object({
  beforeReceipt: key, actionReceipt: key, afterReceipt: key,
  expectedUrl: pageUrl, priorUrl: pageUrl.optional(),
  appearedText: z.string().min(1).max(1000),
}).strict();
export type BrowserTextTransition = z.infer<typeof browserTextTransitionSchema>;
type EvidenceTask = Pick<AgentTask, "id" | "generation" | "revision" | "requirements">;
type Lookup = (idempotencyKey: string) => ToolOutcome | undefined;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sourceOrder = z.object({ chainId: z.string().uuid(), sequence: z.number().int().positive() }).strict();
const recordedSource = z.object({
  source: z.literal("user-selected-browser-companion"), taskId: z.string(), generation: z.number().int().positive(),
  sourceOrder,
  proof: z.enum(["selected-document-observation", "browser-input-execution-only"]),
  execution: z.object({ operationId: z.string().min(1), outcome: z.literal("completed"), executed: z.boolean(),
    cancelRequested: z.literal(false), binding: browserBindingSchema }).passthrough(),
  binding: browserBindingSchema.optional(), observation: browserObservationSchema.optional(),
}).passthrough();

/** Exact, deliberately narrow requirement; a text transition cannot satisfy an arbitrary
 * purchase, message delivery, account identity or other business requirement. */
export function browserTextTransitionRequirement(expectedUrl: string, appearedText: string, priorUrl?: string): string {
  browserTextTransitionSchema.pick({ expectedUrl: true, appearedText: true, priorUrl: true }).parse({ expectedUrl, appearedText, priorUrl });
  return `Observe a newly visible exact text ${JSON.stringify(appearedText)} at ${JSON.stringify(expectedUrl)} after the approved browser input${priorUrl ? ` from ${JSON.stringify(priorUrl)}` : ""}; property ${BROWSER_TEXT_TRANSITION_PROPERTY}.`;
}

function inspect(task: EvidenceTask, value: BrowserTextTransition, lookup: Lookup) {
  const selected = browserTextTransitionSchema.parse(value);
  const receiptKeys = [selected.beforeReceipt, selected.actionReceipt, selected.afterReceipt];
  if (new Set(receiptKeys).size !== 3) throw new Error("Browser outcome needs three distinct approved receipts");
  const outcomes = receiptKeys.map(receiptKey => {
    const outcome = lookup(receiptKey);
    if (!outcome || outcome.idempotencyKey !== receiptKey || outcome.state !== "completed"
      || outcome.scope.taskId !== task.id || outcome.scope.generation !== task.generation) throw new Error("Browser outcome receipt scope is unavailable");
    const result = outcome.result as { isError?: unknown; structuredContent?: unknown } | undefined;
    if (result?.isError !== false) throw new Error("Browser outcome requires successful canonical tool results");
    const source = recordedSource.parse(result.structuredContent);
    if (source.taskId !== task.id || source.generation !== task.generation) throw new Error("Browser outcome source scope changed");
    const expectedOperation = `agent_browser:${createHash("sha256").update(receiptKey).digest("hex")}`;
    if (source.execution.operationId !== expectedOperation) throw new Error("Browser outcome execution identity changed");
    return { outcome, source };
  });
  const [before, action, after] = outcomes as [typeof outcomes[number], typeof outcomes[number], typeof outcomes[number]];
  if (before.outcome.tool !== "browser/observe" || after.outcome.tool !== "browser/observe"
    || !["browser/click", "browser/type"].includes(action.outcome.tool)
    || before.source.proof !== "selected-document-observation" || after.source.proof !== "selected-document-observation"
    || action.source.proof !== "browser-input-execution-only" || !action.source.execution.executed
    || before.source.execution.executed || after.source.execution.executed) throw new Error("Browser outcome requires observe/input/independent-observe receipts");
  const a = before.source.sourceOrder, b = action.source.sourceOrder, c = after.source.sourceOrder;
  if (a.chainId !== b.chainId || b.chainId !== c.chainId || !(a.sequence < b.sequence && b.sequence < c.sequence)) throw new Error("Browser outcome observations do not bracket the approved input");
  const prior = browserObservationSchema.parse(before.source.observation);
  const next = browserObservationSchema.parse(after.source.observation);
  const priorBinding = browserBindingOf(prior), nextBinding = browserBindingOf(next);
  if (!before.source.binding || !after.source.binding || !sameBrowserBinding(before.source.binding, priorBinding)
    || !sameBrowserBinding(after.source.binding, nextBinding)
    || !sameBrowserBinding(action.source.execution.binding, priorBinding)
    || next.observationId === prior.observationId
    || !sameBrowserBinding(priorBinding, { ...nextBinding, observationId: prior.observationId })
    || !sameBrowserBinding(after.source.execution.binding, priorBinding)) throw new Error("Browser outcome changed selected document or observation owner");
  if (prior.url !== (selected.priorUrl ?? selected.expectedUrl) || next.url !== selected.expectedUrl) throw new Error("Browser outcome changed the expected exact URL");
  return { selected, outcomes, prior, next, passed: !prior.text.includes(selected.appearedText) && next.text.includes(selected.appearedText) };
}

/** Resolves only immutable receipts supplied by the trusted journal/runtime owner. Does not
 * read a page, send input, grant permission or accept page/model supplied evidence objects. */
export function browserTextTransitionReference(task: EvidenceTask, requirementId: string, value: BrowserTextTransition, lookup: Lookup): AgentEvidenceReference {
  const { selected, outcomes, next } = inspect(task, value, lookup);
  if (task.requirements.find(row => row.id === requirementId)?.text !== browserTextTransitionRequirement(selected.expectedUrl, selected.appearedText, selected.priorUrl)) throw new Error("Requirement does not explicitly request this recorded browser text transition");
  const subject = `browser-transition:${JSON.stringify(selected)}`;
  return { sourceEventId: `browser-transition:${hash(subject)}`, requirementId, subject,
    subjectRevision: `sha256:${hash(outcomes.map(row => row.outcome))}:${next.observationId}`, property: BROWSER_TEXT_TRANSITION_PROPERTY };
}

export function resolveBrowserTextTransitionEvidence(task: EvidenceTask, reference: AgentEvidenceReference, lookup: Lookup): OutcomeEvidence {
  if (reference.property !== BROWSER_TEXT_TRANSITION_PROPERTY || !reference.subject.startsWith("browser-transition:")) throw new Error("Unsupported browser outcome evidence property");
  const value = browserTextTransitionSchema.parse(JSON.parse(reference.subject.slice("browser-transition:".length)));
  const expected = browserTextTransitionReference(task, reference.requirementId, value, lookup);
  for (const field of ["sourceEventId", "subject", "subjectRevision", "property"] as const) if (reference[field] !== expected[field]) throw new Error("Browser outcome reference does not match the canonical receipts");
  const { passed } = inspect(task, value, lookup);
  return { ...expected, id: `browser-evidence:${hash([task.id, task.generation, task.revision, expected])}`,
    taskRevision: task.revision, outcome: passed ? "passed" : "failed", observer: BROWSER_TEXT_TRANSITION_OBSERVER };
}
