import { defaultConfig } from "../src/config";
import { startServer } from "../src/server";

// Spawned only by the opt-in acceptance runner with temporary app/Codex homes.
const server = startServer({ ...defaultConfig("browser-only"), port: 0 }, {
  adapterFactory: () => ({
    name: "offline-acceptance",
    async runTurn(_parsed, _incoming, emit) {
      emit({ type: "text_delta", text: "ACCEPTANCE LOCAL READY", phase: "final_answer" });
      emit({ type: "done", stopReason: "stop", endTurn: true });
    },
  }),
});
try {
  const root = `http://127.0.0.1:${server.port}`;
  const health = await fetch(`${root}/healthz`);
  if (!health.ok || (await health.json() as { service?: string }).service !== "codex-chatgpt-web") throw new Error("Local health failed");
  const response = await fetch(`${root}/v1/responses`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "chatgpt-web/high", stream: false, input: "Synthetic offline acceptance" }),
  });
  const body = await response.json() as { status?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const text = body.output?.flatMap(item => item.content?.map(part => part.text ?? "") ?? []).join("");
  if (!response.ok || body.status !== "completed" || text !== "ACCEPTANCE LOCAL READY") throw new Error("Local protocol failed");
  process.stdout.write("ACCEPTANCE_LOCAL_STARTUP_OK\n");
} finally { await server.stop(true); }
