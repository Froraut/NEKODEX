import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentToolsComposition } from "../src/agent-tools/composition";
import { sha256 } from "../src/agent-tools/config";
import { invocationFingerprint } from "../src/agent-tools/journal";
import type { SkillPdfExtractionResult, SkillPdfExtractorPort } from "../src/agent-tools/skill-pdf-extractor";
import { selectedPdfBytes } from "../src/agent-tools/skill-pdf-resources";
import { snapshotSkillPackageSource } from "../src/agent-tools/skill-resources";
import { ReadOnlySkillLibrary } from "../src/agent-tools/skills";
import { createTextPdf } from "./fixtures/skill-pdf-fixture";

test("PDF v5 keeps immutable bytes private and separates human preview, approved model read and revocation during extraction", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "neko-pdf-resource-"))), home = join(root, "private"), source = join(root, "source");
  mkdirSync(home, { mode: 0o700 }); mkdirSync(join(source, "references"), { recursive: true });
  const text = "PDF_SELECTED_SOURCE_ONLY_2A71\nalpha quantity 3 unit 12.50\nbeta quantity 2 unit 7.25\n";
  const bytes = createTextPdf([text.trimEnd().split("\n")]);
  writeFileSync(join(source, "SKILL.md"), "---\nname: selected-pdf-fixture\ndescription: Interpret only the explicitly approved selected PDF source.\n---\nRead the selected PDF only after the exact tool call is approved.\n");
  writeFileSync(join(source, "references/invoice.pdf"), bytes);
  let extractions = 0, closes = 0, held = false, heldRecovery = false, release: (() => void) | undefined, entered!: () => void;
  let enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const cancelled: string[] = [], receipts = new Map<string, SkillPdfExtractionResult>();
  const extractor: SkillPdfExtractorPort = {
    capabilities: () => ({ supported: !heldRecovery, provider: "macos-pdfkit", recoveryRequired: heldRecovery, activeCount: heldRecovery ? 1 : 0, extractor: { provider: "macos-pdfkit", version: 1, executableSha256: "a".repeat(64), sourceSha256: "b".repeat(64) } }),
    async extract(input) {
      extractions++; expect(input.sha256).toBe(sha256(bytes)); expect(Buffer.from(input.bytes)).toEqual(bytes);
      if (held) await new Promise<void>(resolve => { release = resolve; entered(); });
      const receipt: SkillPdfExtractionResult = { state: "completed", sourceSha256: input.sha256, sourceBytes: input.bytes.length,
        coverage: "text-layer-only", text, pageCount: 1, pagesWithText: 1, pagesWithoutText: 0,
        extractor: { provider: "macos-pdfkit", version: 1, executableSha256: "a".repeat(64), sourceSha256: "b".repeat(64) } };
      receipts.set(input.operationId, receipt); return receipt;
    },
    cancel(id) { cancelled.push(id); release?.(); }, reconcile: id => receipts.get(id), async close() { closes++; },
  };
  const scope = { taskId: crypto.randomUUID(), generation: 1, toolCallId: "pdf-read-1" };
  let pending: { tool: string; arguments: Record<string, unknown>; idempotencyKey: string } | undefined;
  const composition = createAgentToolsComposition({ home, pdfExtractor: extractor,
    scriptExecutor: { capabilities: () => ({ supported: false }), execute: async () => { throw new Error("No script execution in this fixture"); }, cancel() {} },
    authorize: request => request.headers.get("authorization") === "synthetic-pdf-review", isScopeActive: () => true, resolveToolCall: () => pending });
  const post = async (body: unknown) => {
    const response = (await composition.handle(new Request("http://127.0.0.1/admin/agent-tools", { method: "POST",
      headers: { authorization: "synthetic-pdf-review", "content-type": "application/json" }, body: JSON.stringify(body) })))!;
    const packet = await response.json() as any; expect(response.status).toBe(200); expect(packet.ok).toBe(true); return packet.value;
  };
  try {
    const grant = composition.addSkillRoot({ root: source, label: "Selected synthetic PDF" }, true);
    const identity = composition.discoverSkills(grant.id).skills[0]!;
    const review = await post({ action: "reviewSkillPackageImport", actionId: "pdf-review", selection: { identity, resources: ["references/invoice.pdf"] }, label: "PDF fixture", explicitUserAction: true });
    expect(review.action.manifest.package).toMatchObject({ version: 5, kind: "selected-local-document-package" });
    expect(review.resources[0]).toMatchObject({ kind: "document", mediaType: "application/pdf", format: "pdf", digest: sha256(bytes), bytes: bytes.length,
      preview: { state: "completed", text, sourceSha256: sha256(bytes), coverage: "text-layer-only" } });
    expect(review.resources[0]).not.toHaveProperty("data"); expect(JSON.stringify(review)).not.toContain(bytes.toString("base64"));
    expect(extractions).toBe(1); expect(composition.selectedSkillContent(scope)).toEqual([]);
    const imported = await post({ action: "commitSkillImport", actionId: "pdf-review", reviewDigest: review.action.reviewDigest, explicitUserAction: true });
    await post({ action: "attachManagedSkill", scope, versionId: imported.versionId, explicitUserAction: true });
    const selected = composition.selectedSkillContent(scope);
    expect(selected[0]!.resources![0]).toMatchObject({ kind: "document", format: "pdf", mediaType: "application/pdf", digest: sha256(bytes) });
    expect(JSON.stringify(selected)).not.toContain("PDF_SELECTED_SOURCE_ONLY_2A71"); expect(JSON.stringify(selected)).not.toContain(bytes.toString("base64"));
    expect(JSON.stringify(selected)).not.toContain(source); expect(selected[0]!.promptBytes!).toBeLessThan(2048);
    expect(readFileSync(join(imported.target, "resources/references/invoice.pdf"))).toEqual(bytes);
    pending = { tool: "skill-resource/read", arguments: { versionId: imported.versionId, packageDigest: selected[0]!.packageDigest!, relativePath: "references/invoice.pdf", resourceDigest: sha256(bytes) }, idempotencyKey: "pdf-model-read-1" };
    await composition.toolsPort.discover(scope); expect(extractions).toBe(1);
    await expect(composition.toolsPort.invoke({ ...pending, scope, grantId: "unapproved" })).rejects.toThrow("approval required");
    expect(extractions).toBe(1);
    const outcome = await composition.approveInvoke(scope, true); expect(outcome.state).toBe("completed"); expect(extractions).toBe(2);
    expect(outcome.result).toMatchObject({ content: [{ type: "text" }, { type: "text", text }], structuredContent: { trust: "untrusted-source-material", instructionAuthority: false, taskResultVerification: false, extraction: { sourceSha256: sha256(bytes), coverage: "text-layer-only" } } });
    expect(JSON.stringify(outcome.result)).not.toContain(bytes.toString("base64"));
    expect(await composition.approveInvoke(scope, true)).toEqual(outcome); expect(extractions).toBe(2);
    held = true; enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const nextScope = { ...scope, toolCallId: "pdf-read-2" }; pending = { ...pending, idempotencyKey: "pdf-model-read-2" };
    const expectedOperation = invocationFingerprint({ ...pending, scope: nextScope });
    const work = composition.approveInvoke(nextScope, true); await enteredPromise;
    composition.invalidateTaskTools(scope.taskId);
    const invalidated = await work;
    expect(cancelled).toContain(expectedOperation); expect(invalidated.state).not.toBe("completed"); expect(JSON.stringify(invalidated)).not.toContain(text);
    expect(composition.activeCount).toBe(0);
    release = undefined; enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const revokedScope = { ...scope, toolCallId: "pdf-read-3" }; pending = { ...pending, idempotencyKey: "pdf-model-read-3" };
    const revokedOperation = invocationFingerprint({ ...pending, scope: revokedScope });
    const revokedWork = composition.approveInvoke(revokedScope, true); await enteredPromise;
    const revoke = composition.revokeManagedSkill(imported.versionId, false, true);
    await revoke; const revokedResult = await revokedWork;
    expect(cancelled).toContain(revokedOperation); expect(revokedResult.state).not.toBe("completed"); expect(JSON.stringify(revokedResult)).not.toContain(text);
    expect(composition.activeCount).toBe(0); expect(() => composition.selectedSkillContent(scope)).toThrow("revoked");
    expect(readFileSync(join(imported.target, "resources/references/invoice.pdf"))).toEqual(bytes);
    heldRecovery = true; expect(composition.activeCount).toBeGreaterThanOrEqual(1);
    heldRecovery = false; expect(composition.activeCount).toBe(0);
  } finally { release?.(); await composition.close(); rmSync(root, { recursive: true, force: true }); }
  expect(closes).toBe(1);
}, 10_000);

test("selected PDF byte/package bounds preserve existing non-PDF limits and immutable review identity", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "neko-pdf-bounds-"))); mkdirSync(join(root, "references")); mkdirSync(join(root, "scripts"));
  const bytes = createTextPdf([["Bounded PDF fixture"]]);
  writeFileSync(join(root, "SKILL.md"), "---\nname: pdf-bounds\ndescription: Explicit local PDF resource fixture.\n---\nSelected source only.\n");
  const grant = { id: "pdf-bounds", root, source: "workspace" as const, label: "PDF bounds" }, identity = new ReadOnlySkillLibrary([grant]).discover(grant.id).skills[0]!;
  try {
    const base = { relativePath: "references/source.pdf", kind: "document" as const, format: "pdf" as const, mediaType: "application/pdf" as const, bytes: bytes.length, digest: sha256(bytes), data: bytes.toString("base64"), role: "selected-skill-source-material" as const };
    expect(selectedPdfBytes(base)).toEqual(bytes);
    expect(() => selectedPdfBytes({ ...base, data: base.data + "\n" })).toThrow();
    expect(() => selectedPdfBytes({ ...base, digest: "f".repeat(64) })).toThrow();
    for (let index = 0; index < 5; index++) writeFileSync(join(root, `references/${index}.pdf`), bytes);
    expect(() => snapshotSkillPackageSource(grant, { identity, resources: Array.from({ length: 5 }, (_, index) => `references/${index}.pdf`) })).toThrow("aggregate");
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1, 32); bytes.copy(oversized);
    writeFileSync(join(root, "references/large.pdf"), oversized);
    expect(() => snapshotSkillPackageSource(grant, { identity, resources: ["references/large.pdf"] })).toThrow("bounds");
    writeFileSync(join(root, "references/not-pdf.pdf"), "This is not a PDF document.");
    expect(() => snapshotSkillPackageSource(grant, { identity, resources: ["references/not-pdf.pdf"] })).toThrow("signature");
    // A document package cannot use its larger raw-PDF budget to expand code/image authority.
    for (let index = 0; index < 15; index++) writeFileSync(join(root, `scripts/${index}.mjs`), " ".repeat(32 * 1024));
    writeFileSync(join(root, "SKILL.md"), "---\nname: pdf-bounds\ndescription: Explicit PDF fixture.\n---\n" + "a".repeat(40 * 1024));
    const changed = new ReadOnlySkillLibrary([grant]).discover(grant.id).skills[0]!;
    expect(() => snapshotSkillPackageSource(grant, { identity: changed, resources: ["references/0.pdf", ...Array.from({ length: 15 }, (_, index) => `scripts/${index}.mjs`)] })).toThrow("aggregate");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
