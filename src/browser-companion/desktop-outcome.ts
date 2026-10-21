import { createHash } from "node:crypto";
import { z } from "zod";
import type { AgentEvidenceReference } from "../agent-mode/http";
import type { AgentTask, OutcomeEvidence } from "../agent-mode/types";
import type { ToolOutcome } from "../agent-tools/types";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const selectionSchema = z.object({ windowId: z.string().regex(/^\d+$/), processId: z.string().regex(/^\d+:\d+$/), windowEpoch: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const scalar = z.union([z.string().max(4096), z.number().finite(), z.boolean()]);
const extent = z.number().finite().nonnegative().max(1_000_000);
/** Window-relative points with a top-left origin, the space screenshot-pixel input maps into. */
export const desktopWindowRectSchema = z.object({ x: z.number().finite().min(-1_000_000).max(1_000_000), y: z.number().finite().min(-1_000_000).max(1_000_000), width: extent, height: extent }).strict();
export const desktopWindowSizeSchema = z.object({ width: extent, height: extent }).strict();
export const desktopApplicationPropertiesSchema = z.object({
  selection: selectionSchema,
  observedAt: z.string().datetime({ offset: true }),
  properties: z.array(z.object({
    elementId: z.string().min(1).max(160), role: z.string().min(1).max(160),
    identifier: z.string().max(512).optional(), title: z.string().max(512).optional(),
    value: scalar.optional(), enabled: z.boolean().optional(), focused: z.boolean().optional(),
    frame: desktopWindowRectSchema.optional(),
  }).strict()).max(128),
  /** Selected window size in points at the read. Older snapshots carry no geometry. */
  window: desktopWindowSizeSchema.optional(),
}).strict().superRefine((snapshot, context) => {
  if (new Set(snapshot.properties.map(row => row.elementId)).size !== snapshot.properties.length) context.addIssue({ code: "custom", message: "Native application element identities must be unique" });
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 64 * 1024) context.addIssue({ code: "custom", message: "Native application property snapshot exceeds its bound" });
});
export type DesktopApplicationProperties = z.infer<typeof desktopApplicationPropertiesSchema>;
export const desktopPropertyExpectationSchema = z.object({
  elementId: z.string().min(1).max(160),
  property: z.enum(["value", "title", "enabled", "focused"]),
  equals: scalar,
}).strict().superRefine((condition, context) => {
  if ((condition.property === "enabled" || condition.property === "focused") && typeof condition.equals !== "boolean"
    || condition.property === "title" && typeof condition.equals !== "string") context.addIssue({ code: "custom", message: "Expected value does not match its application property type" });
});
export type DesktopPropertyExpectation = z.infer<typeof desktopPropertyExpectationSchema>;
export function evaluateDesktopProperty(snapshotValue: unknown, expectationValue: unknown) {
  const snapshot = desktopApplicationPropertiesSchema.parse(snapshotValue);
  const expectation = desktopPropertyExpectationSchema.parse(expectationValue);
  const element = snapshot.properties.find(row => row.elementId === expectation.elementId);
  const actual = element?.[expectation.property];
  return { snapshot, expectation, actual: actual ?? null,
    outcome: actual === undefined ? "unknown" as const : actual === expectation.equals ? "passed" as const : "failed" as const };
}
export function desktopPropertyRequirement(selection: DesktopApplicationProperties["selection"], expectation: DesktopPropertyExpectation): string {
  // Explicit narrow mapping: this property fact cannot certify a broader business claim.
  return `Observe selected desktop application property ${JSON.stringify({ selection: selectionSchema.parse(selection), expectation: desktopPropertyExpectationSchema.parse(expectation) })}.`;
}
const verifiedResultSchema = z.object({ source: z.literal("owned-macos-desktop"), taskId: z.string(), generation: z.number().int(),
  proof: z.literal("selected-window-application-property"), verification: z.object({ snapshot: desktopApplicationPropertiesSchema,
    expectation: desktopPropertyExpectationSchema, actual: scalar.nullable(), outcome: z.enum(["passed", "failed", "unknown"]) }).strict(),
  limitation: z.string(),
}).strict();
function retainedVerification(outcome: ToolOutcome) {
  if (outcome.tool !== "desktop/verifyProperty" || outcome.state !== "completed") throw new Error("Select a completed application-property observation, not an input receipt");
  const metadata = verifiedResultSchema.parse((outcome.result as { structuredContent?: unknown } | undefined)?.structuredContent);
  if (metadata.taskId !== outcome.scope.taskId || metadata.generation !== outcome.scope.generation) throw new Error("Desktop property observation changed task authority");
  const verified = evaluateDesktopProperty(metadata.verification.snapshot, metadata.verification.expectation);
  if (verified.actual !== metadata.verification.actual || verified.outcome !== metadata.verification.outcome) throw new Error("Desktop property result differs from its observed application value");
  return verified;
}
export function desktopPropertyReference(outcome: ToolOutcome, requirementId: string): AgentEvidenceReference {
  const verified = retainedVerification(outcome);
  return { sourceEventId: `desktop-property:${hash(outcome.idempotencyKey)}`, requirementId,
    subject: `desktop-window:${JSON.stringify(verified.snapshot.selection)}`,
    subjectRevision: `sha256:${hash(JSON.stringify(verified.snapshot))}`,
    property: `ax-property:${hash(JSON.stringify(verified.expectation))}` };
}
/** lookup must be supplied by the canonical private tool journal. Model text,
 * renderer snapshots and input receipts never become application evidence. */
export function resolveDesktopPropertyEvidence(task: AgentTask, reference: AgentEvidenceReference, lookup: (sourceEventId: string) => ToolOutcome | undefined): OutcomeEvidence {
  const outcome = lookup(reference.sourceEventId);
  if (!outcome || outcome.scope.taskId !== task.id || outcome.scope.generation !== task.generation) throw new Error("Application property evidence belongs to a different task generation");
  const verified = retainedVerification(outcome), expected = desktopPropertyReference(outcome, reference.requirementId);
  for (const field of ["sourceEventId", "subject", "subjectRevision", "property"] as const) if (reference[field] !== expected[field]) throw new Error("Application property evidence reference mismatch");
  if (task.requirements.find(row => row.id === reference.requirementId)?.text !== desktopPropertyRequirement(verified.snapshot.selection, verified.expectation)) throw new Error("Requirement does not explicitly request this selected application property");
  return { ...expected, id: `desktop-evidence:${hash(JSON.stringify([task.id, task.revision, reference.requirementId, expected.sourceEventId]))}`,
    taskRevision: task.revision, outcome: verified.outcome, observer: "selected-macos-application-property-v1" };
}
/** A current semantic review may cite exact desktop/verifyProperty receipts for prose
 * requirements. At Verify each cited receipt must still be the latest approved observation
 * of the same attached window, exactly like recorded property evidence. Stale reviews are
 * refused by digest elsewhere, so only the current review's citations are re-checked. */
export function assertSemanticDesktopCitationsCurrent(task: AgentTask, input: { currentDigest: string; lookup: (receiptKey: string) => ToolOutcome | undefined; assertCurrent: (evidence: OutcomeEvidence) => void }): void {
  const review = task.semanticReview;
  if (!review || review.inputDigest !== input.currentDigest || review.generation !== task.generation || review.taskRevision !== task.revision) return;
  // Only a passing verdict can carry Verify, and only a completed receipt can be its basis.
  for (const verdict of review.requirements) if (verdict.verdict === "pass") for (const key of verdict.toolReceiptIds) {
    const outcome = input.lookup(key);
    if (!outcome || outcome.tool !== "desktop/verifyProperty" || outcome.state !== "completed") continue;
    const reference = desktopPropertyReference(outcome, verdict.requirementId);
    input.assertCurrent({ ...reference, id: `semantic-desktop-citation:${hash(key)}`, taskRevision: task.revision, outcome: "passed", observer: "selected-macos-application-property-v1" });
  }
}
