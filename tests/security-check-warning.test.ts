import { expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BrowserHost } = require("../launcher/electron/browser-host.cjs");

const success = { webContentsId: 7, statusCode: 200, url: "https://chatgpt.com/backend-api/me" };

function host() {
  const logs: string[] = [];
  const contents = { id: 7, getURL: () => "https://chatgpt.com/?temporary-chat=true", isDestroyed: () => false };
  const value: any = Object.assign(Object.create(BrowserHost.prototype), {
    view: { webContents: contents }, turnTabs: new Map(), authGeneration: 1, destroyed: true,
    state: { authenticated: true, authenticationStatus: "verified", status: "ready" },
    cloudflareChallengeRecovery: null, cloudflareChallengeRecoveryArmed: true, networkEgressCheckedAt: Date.now(),
    getBrowserInteractionMode: () => "automatic", publishState() {}, snapshot() { return { ...this.state }; },
    logger: { info: (event: string) => logs.push(event), warn: (event: string) => logs.push(event), error: (event: string) => logs.push(event) },
  });
  return { host: value, logs };
}

async function failRecovery(target: any) {
  target.reloadHomeAfterCloudflareChallenge = async () => {
    throw new Error("ChatGPT security check is still blocking backend requests. Reload ChatGPT and retry.");
  };
  target.startCloudflareChallengeRecovery("https://chatgpt.com");
  await target.cloudflareChallengeRecovery?.catch?.(() => {});
  await new Promise(resolve => setImmediate(resolve));
}

test("a check a reload cannot clear asks the user to complete it, and later 403 reads keep asking", async () => {
  const { host: target, logs } = host();
  await failRecovery(target);
  expect(logs).toContain("browser.security_check_required");
  expect(target.state).toMatchObject({ securityCheckRequired: true, authenticationStatus: "unavailable",
    authenticationIssue: "challenge", authenticated: false });
  target.setState({ status: "error", authenticated: false, authenticationStatus: "unavailable",
    message: "ChatGPT session verification unavailable: session HTTP 403" });
  expect(target.state.authenticationIssue).toBe("challenge");
});

test("a successful ChatGPT response after the user passes the check clears the warning", async () => {
  const { host: target, logs } = host();
  await failRecovery(target);
  target.handleChatGptBackendResponse(success);
  expect(target.state.securityCheckRequired).toBe(false);
  expect(target.state.authenticationIssue).not.toBe("challenge");
  expect(logs).toContain("browser.security_check_cleared");
});

test("a verified session check also clears the warning", async () => {
  const { host: target } = host();
  await failRecovery(target);
  target.setState({ status: "ready", authenticated: true, authenticationStatus: "verified" });
  expect(target.state.securityCheckRequired).toBe(false);
  expect(target.state.authenticationIssue).toBeNull();
});
