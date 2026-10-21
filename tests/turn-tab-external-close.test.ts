import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BrowserHost } = require("../launcher/electron/browser-host.cjs");

function fixture(interactionMode: "automatic" | "manual") {
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, close() {} });
  const tab: any = { id: "tab-1", traceId: "trace-1", interactionMode, view: { webContents: contents } };
  const removed: unknown[][] = [];
  const terminal: unknown[][] = [];
  const warnings: unknown[][] = [];
  const host: any = Object.assign(Object.create(BrowserHost.prototype), {
    destroyed: false, turnTabs: new Map([[tab.id, tab]]),
    logger: { info() {}, warn: (...args: unknown[]) => warnings.push(args), error() {} },
    removeTurnTab: (...args: unknown[]) => removed.push(args),
    signalManualTerminal: (...args: unknown[]) => terminal.push(args),
  });
  host.bindTurnContentsDestruction(tab, contents);
  return { host, tab, contents, removed, terminal, warnings };
}

test("an automatic tab destroyed outside closeTab() is retired exactly once", () => {
  const { tab, contents, removed, terminal, warnings } = fixture("automatic");
  contents.emit("destroyed");
  contents.emit("destroyed");
  expect(removed).toEqual([[tab, true]]);
  expect(terminal).toEqual([]);
  expect(warnings[0]?.[0]).toBe("browser.tab_closed_externally");
});

test("a manual tab also reports a failed terminal state", () => {
  const { tab, contents, removed, terminal } = fixture("manual");
  contents.emit("destroyed");
  expect(terminal).toEqual([[tab, "failed"]]);
  expect(removed).toEqual([[tab, true]]);
});

test("a replaced tab or a shutting-down host is left alone", () => {
  const replaced = fixture("automatic");
  replaced.host.turnTabs.set(replaced.tab.id, { ...replaced.tab });
  replaced.contents.emit("destroyed");
  expect(replaced.removed).toEqual([]);
  const shutdown = fixture("automatic");
  shutdown.host.destroyed = true;
  shutdown.contents.emit("destroyed");
  expect(shutdown.removed).toEqual([]);
});

test("disposing a view whose page Electron already cleared does not throw", () => {
  const { host, tab } = fixture("automatic");
  host.window = { contentView: { removeChildView() {} } };
  tab.view.webContents = undefined;
  expect(() => host.disposeTurnView(tab)).not.toThrow();
});
