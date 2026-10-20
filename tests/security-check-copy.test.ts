import { expect, test } from "bun:test";
import { sessionIssueCopy } from "../launcher/src/session-issue-copy";
import { workspaceHeadline } from "../launcher/src/connections-copy";
import { copyFor } from "../launcher/src/i18n";

test("every language explains the Cloudflare check and tells the user to tick it", () => {
  for (const language of ["en", "ru", "zh-CN", "zh-TW", "ja", "ko"] as const) {
    expect(sessionIssueCopy(language, "challenge")).toContain("Cloudflare");
  }
  expect(sessionIssueCopy("ru", "challenge")).toContain("галочку");
});

test("the headline for a pending check opens the browser instead of retrying verification", () => {
  const headline = workspaceHeadline({ reason: "session-unavailable" } as any,
    { app: copyFor("en"), language: "en", development: false, manual: false, authenticationIssue: "challenge" } as any);
  expect(headline).toMatchObject({ title: "Security check needed", step: "open-workspace", action: "Open Browser", tone: "warning" });
});

test("the session row and its words lead to the browser for a pending check, never to a retry", () => {
  const { deriveWorkspaceReadiness } = require("../launcher/src/workspace-readiness");
  const { connectionActionWord, connectionStatusWord } = require("../launcher/src/connections-copy");
  const input = { manual: false, development: false, authenticationStatus: "unavailable", smokePassed: true, installed: true,
    catalogUnavailable: false, catalogVerified: true, pickerConfirmed: true, toolsInstalled: false, toolsVerified: false, runtime: {} };
  const pending = deriveWorkspaceReadiness({ ...input, authenticationIssue: "challenge" }).connections.session;
  expect(pending).toMatchObject({ key: "security-check", action: "open-browser" });
  expect(connectionStatusWord(pending, copyFor("en"), "en")).toBe("Security check needed");
  expect(connectionActionWord(pending.action, copyFor("en"), "en")).toBe("Open Browser");
  // Any other unavailable check is still retried in place.
  expect(deriveWorkspaceReadiness({ ...input, authenticationIssue: "access" }).connections.session)
    .toMatchObject({ key: "verification-unavailable", action: "retry" });
});

test("a session check in progress keeps the security check up everywhere", () => {
  const { deriveWorkspaceReadiness } = require("../launcher/src/workspace-readiness");
  const input = { manual: false, development: false, authenticationStatus: "unknown", authenticationIssue: "challenge",
    smokePassed: true, installed: true, catalogUnavailable: false, catalogVerified: true, pickerConfirmed: true,
    toolsInstalled: false, toolsVerified: false, runtime: {} };
  const readiness = deriveWorkspaceReadiness(input);
  expect(readiness.connections.session).toMatchObject({ key: "security-check", action: "open-browser" });
  expect(readiness.reason).toBe("session-unavailable");
  const headline = workspaceHeadline(readiness,
    { app: copyFor("en"), language: "en", development: false, manual: false, authenticationIssue: "challenge" } as any);
  expect(headline).toMatchObject({ title: "Security check needed", step: "open-workspace" });
  // Without a pending check, a session check still reads as checking.
  expect(deriveWorkspaceReadiness({ ...input, authenticationIssue: null }).connections.session).toMatchObject({ key: "checking" });
});
