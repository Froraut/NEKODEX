import { expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { passkeyRequiredInEmbeddedSignIn, googleRefusedEmbeddedSignIn } = require("../launcher/electron/openai-api-panel.cjs");

test("OpenAI's passkey step is handed off from embedded sign-in windows", () => {
  expect(passkeyRequiredInEmbeddedSignIn("https://auth.openai.com/auth_challenge/passkey")).toBe(true);
  expect(passkeyRequiredInEmbeddedSignIn("https://auth.openai.com/auth_challenge/passkey?state=abc")).toBe(true);
  expect(passkeyRequiredInEmbeddedSignIn("https://auth.openai.com/auth_challenge/webauthn")).toBe(true);
  // Other sign-in steps, other hosts and look-alikes stay embedded.
  expect(passkeyRequiredInEmbeddedSignIn("https://auth.openai.com/log-in")).toBe(false);
  expect(passkeyRequiredInEmbeddedSignIn("https://auth.openai.com/auth_challenge/email")).toBe(false);
  expect(passkeyRequiredInEmbeddedSignIn("https://evil.example/auth_challenge/passkey")).toBe(false);
  expect(passkeyRequiredInEmbeddedSignIn("http://auth.openai.com/auth_challenge/passkey")).toBe(false);
  expect(passkeyRequiredInEmbeddedSignIn("not a url")).toBe(false);
  expect(googleRefusedEmbeddedSignIn("https://auth.openai.com/auth_challenge/passkey")).toBe(false);
});
