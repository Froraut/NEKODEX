import { test, expect } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { reloadApplicationPage } = require("../launcher/electron/application-reload.cjs");
const { applicationMenu } = require("../launcher/electron/application-menu.cjs");

function fixture() {
  const calls: string[] = [];
  const page = { reload: () => calls.push("page"), reloadIgnoringCache: () => calls.push("page-no-cache") };
  const shell = {};
  const host = { accountId: "a", view: { webContents: page }, turnTabs: new Map(),
    activeView: () => ({ webContents: page }), assertUserNavigationAllowed: () => calls.push("guard") };
  const pool = { hosts: new Map([["a", host]]), surfaceActive: true, snapshot: () => ({ visible: true }),
    selectedHost: () => host, accountOperationError: () => null };
  const args = { focusedContents: shell, mainWindow: { webContents: shell }, browserPool: pool,
    reloadShell: () => calls.push("shell") };
  return { calls, page, shell, host, pool, args };
}

test("native reload follows the displayed embedded page even when toolbar has focus", async () => {
  const f = fixture();
  await reloadApplicationPage({ ...f.args, ignoreCache: true });
  expect(f.calls).toEqual(["guard", "page-no-cache"]);
  f.pool.surfaceActive = false;
  await reloadApplicationPage(f.args);
  expect(f.calls.at(-1)).toBe("shell");
});

test("busy account and unowned window cannot be reloaded through native menu", async () => {
  const f = fixture();
  f.pool.accountOperationError = () => new Error("Account sign-in is active");
  await expect(reloadApplicationPage(f.args)).rejects.toThrow("Account sign-in");
  await expect(reloadApplicationPage({ ...f.args, focusedContents: {} })).rejects.toThrow("no reloadable");
  expect(f.calls).toEqual([]);
});

test("explicit reload cancels and joins only its background inspection", async () => {
  const f = fixture();
  Object.assign(f.host, { readOnlyInspection: {}, cancelReadOnlyInspection: async () => {
    f.calls.push("check-cancelled");
    (f.host as any).readOnlyInspection = null;
  } });
  await reloadApplicationPage(f.args);
  expect(f.calls).toEqual(["check-cancelled", "guard", "page"]);
});

test("API and workspace pages retain their navigation owner", async () => {
  const f = fixture();
  const api = {}, workspace = {};
  Object.assign(f.host, { ownsApiPanelContents: (c: unknown) => c === api,
    reloadApiPanelContents: () => f.calls.push("api"),
    workspaceBrowser: { ownsContents: (c: unknown) => c === workspace,
      reloadContents: (_c: unknown, options: { ignoreCache: boolean }) => f.calls.push(`workspace-${options.ignoreCache}`) } });
  await reloadApplicationPage({ ...f.args, focusedContents: api });
  await reloadApplicationPage({ ...f.args, focusedContents: workspace, ignoreCache: true });
  expect(f.calls).toEqual(["guard", "api", "guard", "workspace-true"]);
});

test("both native menu languages route reload shortcuts through the owner callback", () => {
  for (const language of ["en", "ru"]) {
    const calls: boolean[] = [];
    const menus = applicationMenu({ name: "NEKODEX", language, onReload: (force: boolean) => calls.push(force) });
    const items = menus.flatMap((menu: { submenu?: any[] }) => menu.submenu ?? []);
    expect(items.some((item: { role?: string }) => ["reload", "forceReload", "viewMenu"].includes(item.role ?? ""))).toBe(false);
    for (const accelerator of ["CmdOrCtrl+R", "CmdOrCtrl+Shift+R"]) items.find((item: any) => item.accelerator === accelerator).click();
    expect(calls).toEqual([false, true]);
  }
});
