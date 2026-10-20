import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentModeStore } from "../src/agent-mode";
import { defaultConfig } from "../src/config";
import { startServer } from "../src/server";

test.serial("actual server coalesces concurrent and repeated stop cleanup with an initialized Agent store", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-stop-owner-")));
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const previousDescriptor = process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
  const previousExitCode = process.exitCode;
  process.env.CODEX_CHATGPT_WEB_HOME = home; delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
  let server: ReturnType<typeof startServer> | undefined; let reopened: AgentModeStore | undefined;
  try {
    const config = { ...defaultConfig(), port: 0 };
    server = startServer(config, { fetchUpstream: async () => { throw new Error("Stop fixture must not contact a provider"); } });
    const endpoint = `http://127.0.0.1:${server.port}/admin/agent-mode`;
    const call = async (body: unknown) => {
      const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${config.controlToken}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(response.ok).toBe(true); return (await response.json() as any).value;
    };
    const status = await call({ action: "status" });
    await call({ action: "create", actionId: "create-stop-fixture", input: { ownerMode: "agent", id: "retained-task", mode: "manual", originalRequest: "Retain this synthetic task during repeated shutdown.", requirements: [{ id: "retained", text: "Preserve the task and creation receipt." }], stages: [{ id: "pending", instruction: "Wait for an explicit future action.", requirementIds: ["retained"] }], bounds: { maxConcurrent: 1, maxTurns: 2, maxSpend: null }, execution: { provider: "local-responses", model: status.models[0].id } } });
    await Promise.all([server.stop(true), server.stop(true)]);
    await server.stop(true);
    expect(process.exitCode).toBe(previousExitCode);
    reopened = new AgentModeStore(join(home, "agent-mode", "state.sqlite"));
    expect(reopened.getTask("retained-task")).toMatchObject({ status: "ready", turns: 0 });
    expect(reopened.listReceipts("retained-task").some(receipt => receipt.kind === "create")).toBe(true);
    expect(reopened.listDispatches("retained-task")).toHaveLength(0);
  } finally {
    await server?.stop(true); reopened?.close();
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    if (previousDescriptor === undefined) delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR; else process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR = previousDescriptor;
    rmSync(home, { recursive: true, force: true });
  }
}, 5_000);
