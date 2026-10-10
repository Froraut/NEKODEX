import { expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { googleRefusedEmbeddedSignIn, openAiApiPanelUrl } = require("../launcher/electron/openai-api-panel.cjs");

test("Google's embedded-browser refusal is recognised and nothing else is", () => {
  expect(googleRefusedEmbeddedSignIn("https://accounts.google.com/v3/signin/rejected?continue=x")).toBe(true);
  expect(googleRefusedEmbeddedSignIn("https://accounts.google.com/signin/rejected")).toBe(true);
  expect(googleRefusedEmbeddedSignIn("https://accounts.google.com/o/oauth2/auth?error=disallowed_useragent")).toBe(true);
  for (const url of ["https://accounts.google.com/v3/signin/identifier?flowName=GlifWebSignIn",
    "https://evil.example/signin/rejected", "http://accounts.google.com/signin/rejected",
    "https://accounts.google.com.evil.example/signin/rejected", "https://platform.openai.com/login", "not a url"]) {
    expect(googleRefusedEmbeddedSignIn(url)).toBe(false);
  }
  // The handoff only ever opens the panel's fixed pages.
  expect(openAiApiPanelUrl("keys")).toBe("https://platform.openai.com/settings/organization/api-keys");
  expect(() => openAiApiPanelUrl("https://accounts.google.com")).toThrow();
});
