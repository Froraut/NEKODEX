import { expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { accountUserAgent, stableChromiumUserAgent } = require("../launcher/electron/browser-user-agent.cjs");
const { observeChatGptSession } = require("../launcher/electron/browser-session-observation.cjs");

const electronDefault = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
  + "NEKODEX/6.1.2-nekodex.1 Chrome/146.0.7680.216 Electron/41.10.7 Safari/537.36";
const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

test("every surface gets one UA that survives NEKODEX and Electron patch updates", () => {
  const stable = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
  expect(stableChromiumUserAgent(electronDefault, "146.0.7680.216")).toBe(stable);
  expect(stableChromiumUserAgent(electronDefault.replace("6.1.2-nekodex.1", "6.2.0-nekodex.1"), "146.0.7690.1")).toBe(stable);
  expect(accountUserAgent(undefined, electronDefault, "146.0.7680.216")).toBe(stable);
  expect(accountUserAgent(chrome, electronDefault, "146.0.7680.216")).toBe(chrome);
  // A damaged binding never leaks Electron's version-bearing UA.
  expect(accountUserAgent(electronDefault, electronDefault, "146.0.7680.216")).toBe(stable);
  expect(() => stableChromiumUserAgent("garbage", "146")).toThrow();
});

function pageWith(response: { status: number; type?: string; body: unknown; url?: string }) {
  const fetch = async () => ({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    url: response.url ?? "https://chatgpt.com/api/auth/session",
    headers: { get: (name: string) => name === "content-type" ? response.type ?? "application/json; charset=utf-8" : null },
    text: async () => typeof response.body === "string" ? response.body : JSON.stringify(response.body),
  });
  return {
    isDestroyed: () => false,
    executeJavaScript: (code: string) => new Function("fetch", "location", `return ${code}`)(fetch, { origin: "https://chatgpt.com" }),
  };
}

test("the in-page session check returns identity fields only, never tokens", async () => {
  const payload = await observeChatGptSession(pageWith({ status: 200, body: {
    user: { id: "user-1", email: "a@example.com", name: "A", image: "x" },
    expires: "2030-01-01T00:00:00.000Z", accessToken: "secret-access", sessionToken: "secret-session",
    error: "RefreshAccessTokenError",
  } }));
  expect(payload).toEqual({ user: { present: true, id: "user-1", email: "a@example.com", name: "A" },
    expires: "2030-01-01T00:00:00.000Z", error: "RefreshAccessTokenError" });
  expect(JSON.stringify(payload)).not.toContain("secret");
  expect(await observeChatGptSession(pageWith({ status: 200, body: { user: {} } })))
    .toEqual({ user: {}, expires: null, error: null });
});

test("a challenged or redirected session check is a failure, not a sign-out", async () => {
  await expect(observeChatGptSession(pageWith({ status: 403, type: "text/html", body: "<title>Just a moment...</title>" })))
    .rejects.toThrow("session HTTP 403");
  await expect(observeChatGptSession(pageWith({ status: 200, body: {}, url: "https://chatgpt.com/auth/login" })))
    .rejects.toThrow("session endpoint redirected");
  await expect(observeChatGptSession({ isDestroyed: () => true })).rejects.toThrow("session page is unavailable");
});
