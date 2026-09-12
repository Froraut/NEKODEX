import { test, expect } from "bun:test";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { createExistingChromeLoginControl } from "../src/existing-chrome-login-control";

test("private importer control only accepts cancellation and aborts on EOF", async () => {
  for (const inputText of ['{"version":1,"type":"existing-chrome-login-cancel"}\n', '{"version":1,"type":"passkey-login-reveal"}\n', 'not json\n', 'x'.repeat(4097)]) {
    const input = new PassThrough();
    const control = createExistingChromeLoginControl(input as unknown as NodeJS.ReadStream);
    input.write(inputText);
    expect(control.signal.aborted).toBe(true);
    control.close();
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("error")).toBe(0);
  }
  const input = new PassThrough();
  const control = createExistingChromeLoginControl(input as unknown as NodeJS.ReadStream);
  input.emit("end");
  expect(control.signal.aborted).toBe(true);
  control.close();
});

test("closing a completed importer removes listeners without aborting successful capture", () => {
  const input = new PassThrough();
  const control = createExistingChromeLoginControl(input as unknown as NodeJS.ReadStream);
  control.close();
  input.emit("end");
  expect(control.signal.aborted).toBe(false);
  expect(input.listenerCount("data")).toBe(0);
});

test("CLI cannot opt into ordinary Chrome access without the owned launcher consent route", async () => {
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  for (const args of [["login", "--existing-chrome"], ["login", "--consent-user-profile"]]) {
    const child = Bun.spawn([process.execPath, cli, ...args], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code).not.toBe(0);
    expect(stdout).not.toContain("@codex-chrome-import:");
    expect(stderr).toContain("Existing Chrome import requires explicit consent in the launcher");
  }
});

test("invalid launcher authorization emits only a fixed diagnostic envelope before any Chrome progress", async () => {
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const child = Bun.spawn([process.execPath, cli, "login", "--existing-chrome", "--launcher-control", "--consent-user-profile"], {
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env, CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR: "SECRET-missing-descriptor", CODEX_WEB_GPT_LAUNCHER_CONTROL_TOKEN: "SECRET-token" },
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code).not.toBe(0);
  expect(stdout.trim()).toBe('@codex-chrome-import-error:{"version":1,"code":"launcher-authorization-failed"}');
  expect(stdout + stderr).not.toContain("SECRET");
  expect(stdout).not.toContain('@codex-chrome-import:');
});
