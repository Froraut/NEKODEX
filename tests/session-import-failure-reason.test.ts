import { expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { sessionImportFailureReason } = require("../launcher/electron/browser-host.cjs");

test("logs the launcher's own sign-in failure sentence", () => {
  expect(sessionImportFailureReason(new Error("Passkey login state has an invalid cookie SameSite value")))
    .toBe("Passkey login state has an invalid cookie SameSite value");
  expect(sessionImportFailureReason(new Error("Installed ChatGPT identity does not match the verified capture\nstack")))
    .toBe("Installed ChatGPT identity does not match the verified capture");
});

test("drops messages that could carry addresses, URLs, values or numbers", () => {
  for (const message of ["Signed in as someone@example.com", "Redirected to https://auth.openai.com/x",
    "cookie __Secure-next-auth.session-token=abc", "session HTTP 403", "{\"error\":\"x\"}", "x".repeat(200)]) {
    expect(sessionImportFailureReason(new Error(message))).toBeNull();
  }
  expect(sessionImportFailureReason("not an error")).toBeNull();
});
