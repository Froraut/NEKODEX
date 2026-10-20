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
