import { expect, test } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { registerAgentTools } = require("../launcher/electron/ipc/agent-tools.cjs");
test("Agent tools IPC preserves owned runtime admission and the explicit native root picker", async () => {
  const handlers = new Map<string, (...args: any[]) => any>(); const received: any[] = []; let ready = true;
  registerAgentTools({ handle: (name: string, handler: any) => handlers.set(name, handler), runtimeHost: { supervisor: { readConfig: () => ({ fixture: true }), ownedRuntimeReady: async () => ready,
    control: async (_config: unknown, endpoint: string, packet: any) => { received.push({ endpoint, packet }); return { ok: true, value: { fixture: true } }; } } }, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ["/fixture/selected-root"] }) } });
  expect(await handlers.get("launcher:agent-tools")!({}, { action: "status" })).toEqual({ fixture: true });
  expect((await handlers.get("launcher:agent-tools-pick-skill-root")!({})).cancelled).toBe(false);
  expect(received[1]).toEqual({ endpoint: "agent-tools", packet: { body: { action: "skillRoot", input: { root: "/fixture/selected-root", label: "selected-root" }, explicitUserAction: true } } });
  ready = false;
  await expect(handlers.get("launcher:agent-tools")!({}, { action: "discover", scope: {} })).rejects.toThrow("current NEKODEX runtime");
  expect(received).toHaveLength(2);
});
