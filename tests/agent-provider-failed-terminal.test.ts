import { expect, test } from "bun:test";
import { createLocalResponsesExecutionPort } from "../src/agent-mode/provider";
import type { ExecutionRequest } from "../src/agent-mode/types";

test("failed Responses retain one ACK/outcome while exposing only allowlisted connector diagnostics", async () => {
  const model = "fixture-web-model";
  const stage = { id: "report", instruction: "Inspect the synthetic receipt.", requirementIds: ["result"], status: "running" as const };
  const request: ExecutionRequest = {
    task: { schemaVersion: 1, id: "task", familyId: "family", ownerMode: "agent", mode: "goal", status: "running", generation: 1, revision: 1,
      originalRequest: "Inspect one synthetic failed Responses terminal.", corrections: [], requirements: [{ id: "result", text: "Preserve failed receipt identity." }], stages: [stage],
      bounds: { maxConcurrent: 1, maxTurns: 1, maxSpend: null }, turns: 1, spent: 0, reserved: 0, unpricedTurns: 0, evidenceRevision: 0, evidence: [], cycle: 0, createdAt: 1, updatedAt: 1,
      execution: { provider: "local-responses", model } },
    dispatch: { id: "dispatch", taskId: "task", familyId: "family", generation: 1, taskRevision: 1, ownerId: "owner", workerId: "worker", stageId: stage.id, messageId: "message", messages: [], state: "offered", reservedSpend: 0, createdAt: 1 },
    worker: { id: "worker", taskId: "task", familyId: "family", name: "primary", state: "busy" },
    stage, messages: [], history: { reports: [], total: 0, truncated: false }, signal: new AbortController().signal,
  };
  const privateMessage = '<html>Bearer PRIVATE_TOKEN https://private.invalid/?secret=PRIVATE_TOKEN</html>';
  const cases = [
    { error: { type: "connector_error", code: "connector_not_found", message: "ChatGPT personalization preflight exceeded its readiness deadline", privateDetail: privateMessage }, expected: "deadline" },
    { error: { type: "connector_error", code: "connector_not_found", message: privateMessage }, expected: "connector" },
    { error: { type: "server_error", code: "unrecognized_private_code", message: privateMessage }, expected: "generic" },
  ];
  for (const [index, fixture] of cases.entries()) {
    let offers = 0; const acknowledgements: string[] = [], responseId = `synthetic-failed-${index}`;
    const port = createLocalResponsesExecutionPort({ models: () => [{ id: model }], endpoint: () => "http://127.0.0.1:1/v1/responses",
      fetch: (async () => { offers++; return Response.json({ id: responseId, status: "failed", output: [], error: fixture.error }); }) as typeof fetch });
    const result = await port.execute(request, receipt => acknowledgements.push(receipt));
    expect(offers).toBe(1); expect(acknowledgements).toEqual([responseId]);
    expect(result).toMatchObject({ receiptId: `response:${responseId}`, outcome: "failed", actualSpend: null });
    expect(result.continuation).toBeUndefined(); expect(JSON.stringify(result)).not.toContain("PRIVATE_TOKEN");
    expect(result.summary).not.toContain("<html>"); expect(result.summary).not.toContain("private.invalid");
    if (fixture.expected === "deadline") {
      expect(result.summary).toContain("readiness timed out before the website prompt was sent");
      expect(result.summary).toContain("connector_not_found"); expect(result.summary).toContain("Open NEKODEX Browser");
    } else if (fixture.expected === "connector") {
      expect(result.summary).toContain("connector is unavailable (connector_not_found)");
      expect(result.summary).not.toContain("before the website prompt was sent");
    } else expect(result.summary).toBe("Responses turn failed; no assistant text was returned.");
  }
}, 3000);
