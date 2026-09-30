import { expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveBrowserAddress } = require("../launcher/electron/browser-navigation-policy.cjs");
const { isAddressFocusShortcut } = require("../launcher/electron/browser-state.cjs");
const { createExternalLinkBroker } = require("../launcher/electron/external-links.cjs");

test("ChatGPT addresses load in the embedded view on the canonical origin", () => {
  const cases: Array<[string, string]> = [
    ["https://chatgpt.com/settings/account", "https://chatgpt.com/settings/account"],
    ["  chatgpt.com/c/abc-123  ", "https://chatgpt.com/c/abc-123"],
    ["chatgpt.com", "https://chatgpt.com/"],
    ["http://chatgpt.com/gpts?x=1#top", "https://chatgpt.com/gpts?x=1#top"],
    ["www.chatgpt.com/codex", "https://chatgpt.com/codex"],
    ["https://chat.openai.com/c/old", "https://chatgpt.com/c/old"],
    ["/library", "https://chatgpt.com/library"],
    ["?temporary-chat=true", "https://chatgpt.com/?temporary-chat=true"],
    ["codex", "https://chatgpt.com/codex"],
    ["c/abc.def", "https://chatgpt.com/c/abc.def"],
  ];
  for (const [input, url] of cases) expect(resolveBrowserAddress(input)).toEqual({ target: "chatgpt", url });
});

test("other web addresses go to the system browser", () => {
  expect(resolveBrowserAddress("example.com/docs")).toEqual({ target: "external", url: "https://example.com/docs" });
  expect(resolveBrowserAddress("https://auth.openai.com/log-in")).toEqual({ target: "external", url: "https://auth.openai.com/log-in" });
  expect(resolveBrowserAddress("chatgpt.com:8443/x")).toEqual({ target: "external", url: "https://chatgpt.com:8443/x" });
});

test("non-web, credentialed and free-text input is refused", () => {
  for (const input of ["", "   ", "javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x", "file:///etc/passwd",
    "about:blank", "mailto:a@example.com", "ftp://example.com", "user:secret@example.com", "https://a:b@chatgpt.com/",
    "what is codex", `https://chatgpt.com/${"x".repeat(5000)}`, 42, null]) {
    expect(() => resolveBrowserAddress(input)).toThrow("Enter a ChatGPT page or a web address");
  }
});

test("⌘L on macOS and Ctrl+L elsewhere focus the address", () => {
  const key = (input: Record<string, unknown>) => ({ type: "keyDown", key: "l", ...input });
  expect(isAddressFocusShortcut(key({ meta: true }), "darwin")).toBe(true);
  expect(isAddressFocusShortcut(key({ meta: true, key: "L" }), "darwin")).toBe(true);
  expect(isAddressFocusShortcut(key({ control: true }), "darwin")).toBe(false);
  expect(isAddressFocusShortcut(key({ meta: true, shift: true }), "darwin")).toBe(false);
  expect(isAddressFocusShortcut(key({ meta: true, alt: true }), "darwin")).toBe(false);
  expect(isAddressFocusShortcut(key({ meta: true, type: "keyUp" }), "darwin")).toBe(false);
  expect(isAddressFocusShortcut(key({ control: true }), "win32")).toBe(true);
  expect(isAddressFocusShortcut(key({ meta: true }), "linux")).toBe(false);
});

test("a typed address opens without a page gesture but keeps the public-host checks", async () => {
  const opened: string[] = [];
  const broker = createExternalLinkBroker({
    shell: { openExternal: async (url: string) => { opened.push(url); } },
    isVisible: () => false,
    lookup: async (hostname: string) => [{ address: hostname === "intranet.example" ? "10.0.0.8" : "93.184.216.34", family: 4 }],
  });
  await broker.openTyped("https://example.com/docs");
  expect(opened).toEqual(["https://example.com/docs"]);
  await expect(broker.openTyped("https://localhost:3000/")).rejects.toThrow("Local external links are blocked");
  await expect(broker.openTyped("https://192.168.1.1/")).rejects.toThrow("Private external links are blocked");
  await expect(broker.openTyped("https://intranet.example/")).rejects.toThrow("resolved to a local or private address");
  // Page-initiated links still need a recent gesture on the visible surface.
  await expect(broker.open({ isDestroyed: () => false }, "https://example.com/")).rejects.toThrow("recent gesture");
  expect(opened).toEqual(["https://example.com/docs"]);
});
