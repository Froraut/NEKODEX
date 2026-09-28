import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const require = createRequire(import.meta.url);
const { createStateStore, resolveAppearance, validateAppearance } = require("../launcher/electron/state.cjs");
const { showChromeProfilePicker } = require("../launcher/electron/chrome-profile-picker.cjs");

test("launcher appearance defaults to dark and sanitises unknown saved values", () => {
  const directory = mkdtempSync(join(tmpdir(), "nekodex-appearance-"));
  try {
    const file = join(directory, "launcher-state.json");
    expect(createStateStore(file).read().appearance).toBe("dark");
    for (const [saved, expected] of [["light", "light"], ["system", "system"], ["dark", "dark"],
      ["sepia", "dark"], ["Light", "dark"], [1, "dark"], [null, "dark"]] as const) {
      writeFileSync(file, JSON.stringify({ version: 1, appearance: saved }));
      expect(createStateStore(file).read().appearance).toBe(expected);
    }
    writeFileSync(file, JSON.stringify({ version: 1, keepRunningOnClose: false }));
    const store = createStateStore(file);
    expect(store.read().appearance).toBe("dark");
    expect(store.update({ appearance: "light" }).appearance).toBe("light");
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ appearance: "light", keepRunningOnClose: false });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the appearance preference accepts only system, dark and light and resolves system from the OS", () => {
  for (const value of ["system", "dark", "light"]) expect(validateAppearance(value)).toBe(value);
  for (const value of ["auto", "Dark", "", true, null, undefined, {}]) {
    expect(() => validateAppearance(value)).toThrow("Appearance must be System, Dark or Light");
  }
  expect(resolveAppearance("light", true)).toBe("light");
  expect(resolveAppearance("dark", false)).toBe("dark");
  expect(resolveAppearance("system", true)).toBe("dark");
  expect(resolveAppearance("system", false)).toBe("light");
  expect(resolveAppearance(undefined, false)).toBe("dark");
});

test("the Chrome profile picker window paints and loads the resolved launcher theme", async () => {
  for (const [theme, expected, background] of [["light", "light", "#f8f7fc"], ["dark", "dark", "#1b1b24"],
    ["system", "dark", "#1b1b24"], [undefined, "dark", "#1b1b24"]] as const) {
    let options: { backgroundColor?: string } = {};
    let loaded: unknown;
    class FakeWindow {
      webContents = { on() {}, setWindowOpenHandler() {} };
      constructor(value: typeof options) { options = value; }
      once() {}
      isDestroyed() { return false; }
      destroy() {}
      show() {}
      loadFile(_file: string, loadOptions: unknown) { loaded = loadOptions; return Promise.resolve(); }
    }
    const controller = new AbortController();
    const choice = showChromeProfilePicker({ BrowserWindow: FakeWindow, profiles: [], theme, signal: controller.signal });
    controller.abort();
    expect(await choice).toEqual({ kind: "cancel" });
    expect(options.backgroundColor).toBe(background);
    expect(loaded).toEqual({ query: { theme: expected } });
  }
});

test("the Chrome profile picker light palette redefines every dark palette colour", () => {
  const css = readFileSync(join(import.meta.dir, "../launcher/electron/chrome-profile-picker.css"), "utf8");
  const variables = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const block = css.slice(start, css.indexOf("}", start));
    return [...block.matchAll(/(--[a-z-]+):/g)].map(match => match[1]).sort();
  };
  expect(variables(':root[data-theme="light"]')).toEqual(variables(":root"));
});
