import { expect, test } from "bun:test";
import { execCommandGatewayProgram } from "../src/adapters/chatgpt-web/mcp-server";

test("nested command gateway preserves errors and rejects unsupported shell options before dispatch", async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = (program: string, name: string, tool: () => Promise<unknown>) =>
    new AsyncFunction("ALL_TOOLS", "tools", "text", program)([{ name }], { [name]: tool }, () => {});
  await expect(run(execCommandGatewayProgram({ cmd: "synthetic" }, { command: "synthetic" }),
    "exec_command", async () => ({ isError: true, content: [{ type: "text", text: "synthetic native failure" }] })))
    .rejects.toThrow("synthetic native failure");
  let dispatched = false;
  await expect(run(execCommandGatewayProgram({ cmd: "synthetic", tty: true }, { command: "synthetic" }),
    "shell_command", async () => { dispatched = true; return {}; }))
    .rejects.toThrow("does not support codex_exec tty");
  expect(dispatched).toBe(false);
});
