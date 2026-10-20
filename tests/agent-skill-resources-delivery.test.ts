import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentToolsComposition } from "../src/agent-tools/composition";
import { AgentModeRuntime, AgentModeStore, createLocalResponsesExecutionPort } from "../src/agent-mode";

test("explicit resource review reaches the counted model offer through the owned HTTP and skill composition", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-skill-delivery-")));
  const source = join(home, "local-source"); mkdirSync(join(source, "references"), { recursive: true });
  const instructions = "---\nname: resource-fixture\ndescription: Interpret the explicitly selected inert delivery fixture.\n---\nRead references/format.md when interpreting this fixture. Do not execute anything.\n";
  const reference = "Fixture format: report the literal receipt marker RESOURCE_PACKET_OK.\n";
  writeFileSync(join(source, "SKILL.md"), instructions);
  writeFileSync(join(source, "references", "format.md"), reference);
  const taskId = crypto.randomUUID(); const scope = { taskId, generation: 1, toolCallId: "explicit-selection" };
  const composition = createAgentToolsComposition({ home, authorize: request => request.headers.get("authorization") === "fixture-only",
    isScopeActive: candidate => candidate.taskId === taskId && candidate.generation === 1 });
  const store = new AgentModeStore(join(home, "agent.sqlite"));
  const post = async (body: unknown) => {
    const response = (await composition.handle(new Request("http://127.0.0.1/admin/agent-tools", { method: "POST",
      headers: { authorization: "fixture-only", "content-type": "application/json" }, body: JSON.stringify(body) })))!;
    return { response, body: await response.json() as any };
  };
  let requests = 0; let offeredPacket: unknown;
  const model = "chatgpt-web/fixture";
  const port = createLocalResponsesExecutionPort({ models: () => [{ id: model }], endpoint: () => "http://127.0.0.1:1/v1/responses",
    selectedSkills: request => composition.selectedSkillContent({ taskId: request.task.id, generation: request.task.generation, toolCallId: request.dispatch.id }),
    fetch: (async (_url, init) => {
      requests++;
      const body = JSON.parse(String(init?.body));
      const prompt = JSON.parse(body.input[0].content[0].text);
      offeredPacket = structuredClone(prompt.selectedSkills);
      expect(prompt.selectedSkills).toHaveLength(1);
      expect(prompt.selectedSkills[0]).toMatchObject({ content: instructions, role: "selected-skill-instructions", precedence: "below-system-developer-user",
        resources: [{ relativePath: "references/format.md", content: reference, bytes: Buffer.byteLength(reference) }] });
      expect(prompt.selectedSkills[0].packageDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(prompt.selectedSkills)).not.toContain(source);
      expect(body.tools).toEqual([]);
      return Response.json({ id: "fixture-resource-response", status: "completed", output: [{ type: "message", role: "assistant",
        content: [{ type: "output_text", text: "RESOURCE_PACKET_OK: synthetic transport receipt only." }] }] });
    }) as typeof fetch });
  const runtime = new AgentModeRuntime({ store, ownerId: "fixture-resource-owner", models: () => [{ id: model }], executionPort: port });
  try {
    const root = composition.addSkillRoot({ root: source, label: "Explicit inert local package" }, true);
    const identity = composition.discoverSkills(root.id).skills[0]!;
    const invalid = await post({ action: "reviewSkillPackageImport", actionId: "invalid-extra", selection: { identity, resources: ["references/format.md"], root: source }, label: "Fixture", explicitUserAction: true });
    expect(invalid.response.status).toBe(400);
    const reviewed = await post({ action: "reviewSkillPackageImport", actionId: "review-resources", selection: { identity, resources: ["references/format.md"] }, label: "Fixture", explicitUserAction: true });
    expect(reviewed.response.status).toBe(200); expect(reviewed.body.value.action.state).toBe("reviewed");
    expect(composition.selectedSkillContent(scope)).toEqual([]);
    const imported = await post({ action: "commitSkillImport", actionId: "review-resources", reviewDigest: reviewed.body.value.action.reviewDigest, explicitUserAction: true });
    expect(imported.response.status).toBe(200);
    const attached = await post({ action: "attachManagedSkill", scope, versionId: imported.body.value.versionId, explicitUserAction: true });
    expect(attached.response.status).toBe(200);
    const selected = structuredClone(composition.selectedSkillContent(scope));
    writeFileSync(join(source, "references", "format.md"), "Source changed after immutable import.\n");
    expect(composition.selectedSkillContent(scope)).toEqual(selected);
    runtime.create("create-resource-task", { id: taskId, ownerMode: "agent", mode: "manual", originalRequest: "Interpret the selected inert skill resource.",
      requirements: [{ id: "report", text: "Report the resource marker." }], stages: [{ id: "interpret", instruction: "Use the selected source material.", requirementIds: ["report"] }],
      bounds: { maxConcurrent: 1, maxTurns: 1, maxSpend: null }, execution: { provider: "local-responses", model } });
    runtime.step(taskId, "offer-resource-task", { explicitUserAction: true }); await runtime.waitForIdle();
    expect(requests).toBe(1); expect(offeredPacket).toEqual(selected);
    expect(store.getTask(taskId)).toMatchObject({ status: "review_required", turns: 1, unpricedTurns: 1 });
    const revoked = await post({ action: "revokeManagedSkill", versionId: imported.body.value.versionId, forget: false, explicitUserAction: true });
    expect(revoked.response.status).toBe(200);
    expect(() => composition.selectedSkillContent(scope)).toThrow("revoked");
    expect(requests).toBe(1); expect(offeredPacket).toEqual(selected);
  } finally {
    runtime.beginShutdown(); await runtime.waitForIdle(); runtime.finishShutdown();
    store.close(); await composition.close(); rmSync(home, { recursive: true, force: true });
  }
});
