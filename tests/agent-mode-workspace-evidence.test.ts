import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentModeStore, activeTaskEvidence, SEMANTIC_REVIEW_PROTOCOL } from "../src/agent-mode";
import { defaultConfig } from "../src/config";
import { startServer } from "../src/server";
import { createAgentWorkspaceEvidenceAuthority } from "../launcher/electron/agent-workspace-evidence.cjs";
import type { AgentTask } from "../src/agent-mode";

test.serial("signed real-file observations reject drift at final verify and recover through exact-condition supersession", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-file-evidence-flow-")));
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const previousDescriptor = process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
  process.env.CODEX_CHATGPT_WEB_HOME = home; delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
  const root = join(home, "selected-workspace"); mkdirSync(root, { mode: 0o700 });
  const file = join(root, "artifact.txt"); const otherFile = join(root, "other.txt");
  const expectedBytes = "Expected synthetic business artifact bytes.\n";
  const expectedSha256 = createHash("sha256").update(expectedBytes).digest("hex");
  writeFileSync(file, "Wrong initial bytes.\n");
  const workspaceId = randomUUID(); const taskId = randomUUID(); const familyId = randomUUID();
  const authority = createAgentWorkspaceEvidenceAuthority({ keyPath: join(home, "agent-workspace", "grant-key"), resolveWorkspace: id => {
    if (id !== workspaceId) throw new Error("Fixture workspace was not selected"); return { id, path: root };
  } });
  let server: ReturnType<typeof startServer> | undefined; let reader: AgentModeStore | undefined;
  let modelCalls = 0; const reviewContexts: string[] = []; let workerContext = "";
  try {
    const config = { ...defaultConfig(), port: 0 };
    server = startServer(config, { fetchUpstream: async () => { throw new Error("No provider network in artifact fixture"); }, adapterFactory: () => ({ name: "synthetic-artifact-report", async runTurn(parsed, _incoming, emit) {
      const context = (parsed as { _clientContext?: { threadId: string } })._clientContext;
      if (context?.threadId.startsWith("agent_review_thread_")) {
        // Independent reviewer turn: separate thread identity, cites only the current observed facts.
        reviewContexts.push(context.threadId);
        const current = reader!.getTask(taskId), active = activeTaskEvidence(current);
        emit({ type: "text_delta", text: JSON.stringify({ protocol: SEMANTIC_REVIEW_PROTOCOL, requirements: current.requirements.map(row => ({ requirementId: row.id, verdict: "pass", sufficiency: "complete",
          evidenceIds: active.filter(fact => fact.requirementId === row.id).map(fact => fact.id), toolReceiptIds: [], rationale: "The cited current observation establishes this requirement.", missing: [] })),
          deliverable: { verdict: "pass", rationale: "Both selected artifacts satisfy their requirements." } }) });
        emit({ type: "done", endTurn: true }); return;
      }
      workerContext = context?.threadId ?? "";
      modelCalls++; emit({ type: "text_delta", text: "The synthetic stage is reported complete; inspect the selected actual artifacts before verification." }); emit({ type: "done", endTurn: true });
    } }) });
    const url = `http://127.0.0.1:${server.port}/admin/agent-mode`;
    const call = async (body: unknown) => {
      const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${config.controlToken}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() as any };
    };
    const status = await call({ action: "status" });
    expect((await call({ action: "create", actionId: randomUUID(), input: { ownerMode: "agent", id: taskId, familyId, mode: "goal", originalRequest: "Produce the exact selected artifact and the required companion file.", requirements: [{ id: "artifact", text: "The selected artifact has the explicitly expected SHA-256." }, { id: "other", text: "The selected companion file exists." }], stages: [{ id: "report", instruction: "Report the synthetic artifact work; keep claims separate from actual verification.", requirementIds: ["artifact", "other"] }], bounds: { maxConcurrent: 1, maxTurns: 2, maxSpend: null }, execution: { provider: "local-responses", model: status.body.value.models[0].id } } })).status).toBe(201);
    reader = new AgentModeStore(join(home, "agent-mode", "state.sqlite"));
    const terminal = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { watcher.close(); reject(new Error("Synthetic report terminal did not persist")); }, 2_000);
      const watcher = watch(join(home, "agent-mode"), () => { if (reader!.getTask(taskId).status === "review_required") { clearTimeout(timeout); watcher.close(); resolve(); } });
    });
    await call({ action: "run", taskId, actionId: randomUUID(), explicitUserAction: true }); await terminal;
    const task = () => reader!.getTask(taskId);
    const scope = () => ({ familyId, generation: task().generation, revision: task().revision });
    const observe = async (requirementId: string, relativePath: string, property: "file-exists" | "file-sha256") => {
      const actionId = randomUUID();
      const proof = authority.observe({ task: task(), observationId: actionId, workspaceId, relativePath, requirementId, property, ...(property === "file-sha256" ? { expectedSha256 } : {}) });
      const result = await call({ action: "workspace-evidence", taskId, actionId, scope: scope(), proof });
      expect(result.status).toBe(200); return result.body.value as { task: AgentTask; evidence: AgentTask["evidence"][number]; reference: { actualSha256: string | null; observedAt: string } };
    };
    expect((await call({ action: "workspace-evidence", taskId, actionId: randomUUID(), scope: scope(), proof: { outcome: "passed", property: "file-sha256" } })).status).toBe(409);
    const initialFailure = await observe("artifact", "artifact.txt", "file-sha256");
    expect(initialFailure.evidence.outcome).toBe("failed");
    const otherFailure = await observe("other", "other.txt", "file-exists"); expect(otherFailure.evidence.outcome).toBe("failed");
    writeFileSync(file, expectedBytes);
    const firstPass = await observe("artifact", "artifact.txt", "file-sha256");
    expect(firstPass.evidence).toMatchObject({ outcome: "passed", supersedes: [initialFailure.evidence.id] });
    expect(firstPass.evidence.supersedes).not.toContain(otherFailure.evidence.id);
    expect(firstPass.reference.actualSha256).toBe(expectedSha256); expect(Number.isFinite(Date.parse(firstPass.reference.observedAt))).toBe(true);
    const reviewWithOtherFailure = await call({ action: "review", taskId, actionId: randomUUID(), scope: scope() });
    expect(reviewWithOtherFailure.body.value.task.review.findings).toHaveLength(1);
    expect((await call({ action: "verify", taskId, actionId: randomUUID(), scope: scope(), reviewId: reviewWithOtherFailure.body.value.task.review.id })).status).toBe(409);
    writeFileSync(otherFile, "Present companion artifact.\n");
    await observe("other", "other.txt", "file-exists");
    const reviewed = await call({ action: "review", taskId, actionId: randomUUID(), scope: scope() });
    expect(reviewed.body.value.task.review.findings).toHaveLength(0);
    // Two passing file properties are still not verification of the whole deliverable.
    const unreviewed = await call({ action: "verify", taskId, actionId: randomUUID(), scope: scope(), reviewId: reviewed.body.value.task.review.id });
    expect(unreviewed.status).toBe(409); expect(unreviewed.body.message).toContain("Current independent semantic review required");
    const reviewer = { provider: "local-responses", model: status.body.value.models[0].id };
    // A drifted file fact is never sent to the reviewer.
    writeFileSync(file, "External edit before review.\n");
    const driftedReview = await call({ action: "semantic-review", taskId, actionId: randomUUID(), scope: scope(), reviewer, explicitUserAction: true });
    expect(driftedReview.status).toBe(409); expect(driftedReview.body.message).toContain("changed after observation"); expect(reviewContexts).toHaveLength(0);
    writeFileSync(file, expectedBytes);
    const restored = await observe("artifact", "artifact.txt", "file-sha256"); // restore needs a new observation, not a replay
    expect(restored.evidence.supersedes).toEqual([firstPass.evidence.id]);
    const semantic = await call({ action: "semantic-review", taskId, actionId: randomUUID(), scope: scope(), reviewer, explicitUserAction: true });
    expect(semantic.status).toBe(200); expect(semantic.body.value.task.semanticReview.deliverable.verdict).toBe("pass");
    expect(semantic.body.value.task.semanticReview.reviewer).toMatchObject({ context: "fresh-tool-less", independence: "separate-context" });
    expect(reviewContexts).toHaveLength(1); expect(workerContext.startsWith("agent_thread_")).toBe(true);
    // An unchanged ledger is not reviewed again.
    expect((await call({ action: "semantic-review", taskId, actionId: randomUUID(), scope: scope(), reviewer, explicitUserAction: true })).status).toBe(200);
    expect(reviewContexts).toHaveLength(1);
    writeFileSync(file, "External edit after a passing observation.\n");
    const stale = await call({ action: "verify", taskId, actionId: randomUUID(), scope: scope(), reviewId: reviewed.body.value.task.review.id });
    expect(stale.status).toBe(409); expect(stale.body.message).toContain("changed after observation");
    expect(task().status).toBe("review_required");
    writeFileSync(file, expectedBytes);
    const fresh = await observe("artifact", "artifact.txt", "file-sha256");
    expect(fresh.evidence.supersedes).toEqual([restored.evidence.id]);
    const finalReview = await call({ action: "review", taskId, actionId: randomUUID(), scope: scope() });
    expect(finalReview.body.value.task.semanticReview).toBeUndefined();
    expect((await call({ action: "verify", taskId, actionId: randomUUID(), scope: scope(), reviewId: finalReview.body.value.task.review.id })).status).toBe(409);
    expect((await call({ action: "semantic-review", taskId, actionId: randomUUID(), scope: scope(), reviewer, explicitUserAction: true })).status).toBe(200);
    expect(reviewContexts).toHaveLength(2); expect(reviewContexts[0]).not.toBe(reviewContexts[1]);
    const verified = await call({ action: "verify", taskId, actionId: randomUUID(), scope: scope(), reviewId: finalReview.body.value.task.review.id });
    expect(verified.status).toBe(200); expect(verified.body.value.task.status).toBe("verified_complete");
    const details = await call({ action: "get", taskId });
    expect(details.body.value.task.evidence).toHaveLength(6); expect(details.body.value.activeEvidence).toHaveLength(2);
    expect(details.body.value.workspaceEvidence).toHaveLength(6); expect(JSON.stringify(details.body.value.workspaceEvidence)).not.toContain(expectedBytes);
    expect(modelCalls).toBe(1);
  } finally {
    await server?.stop(true); reader?.close();
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    if (previousDescriptor === undefined) delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR; else process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR = previousDescriptor;
    rmSync(home, { recursive: true, force: true });
  }
}, 5_000);
