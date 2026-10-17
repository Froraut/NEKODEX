import { test, expect } from "bun:test";
import { browserControls } from "../launcher/src/browser-controls";

test("a background verification leaves explicit navigation available", () => {
  const browser = { status: "testing", navigationLocked: false, authenticated: false } as any;
  const operation = { status: "running", name: "mcp-verification" } as any;
  expect(browserControls(browser, operation, "darwin", "automatic").navigationLocked).toBe(false);
  expect(browserControls({ ...browser, status: "running" }, operation, "darwin", "automatic").navigationLocked).toBe(true);
  expect(browserControls({ ...browser, navigationLocked: true }, operation, "darwin", "automatic").navigationLocked).toBe(true);
});

test("macOS secondary accounts expose the supported profile import and embedded-login handoff", () => {
  const browser = { accountId: "secondary", authenticated: false, status: "signed-out", loginInProgress: true } as any;
  expect(browserControls(browser, null, "darwin", "automatic")).toMatchObject({ existingChromeAvailable: true, existingChromeBlocked: false });
  expect(browserControls(browser, null, "win32", "automatic").existingChromeAvailable).toBe(false);
});
