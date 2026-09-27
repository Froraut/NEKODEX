import { expect, test } from "bun:test";
import { captureExistingChromeLogin } from "../src/existing-chrome-login";

test("profile capture without a CDP context ID stays on the exact owned claim target", async () => {
  const nonce = "a".repeat(32), targetId = "c".repeat(32);
  const claim = { version: 1 as const, nonce, url: `http://127.0.0.1:15431/nekodex-profile-claim-v1/${nonce}`, openedAt: new Date().toISOString() };
  const methods: string[] = [], attachments: string[] = [];
  const browser = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch(req, server) { if (server.upgrade(req)) return undefined; return new Response("", { status: 404 }); },
    websocket: { message(socket, message) {
      const request = JSON.parse(String(message)); methods.push(request.method);
      let result: unknown;
      if (request.method === "Browser.getVersion") result = { product: "Chrome/152.0.0.0", userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36" };
      else if (request.method === "Target.getTargets") result = { targetInfos: [{ type: "page", targetId, url: claim.url }] };
      else if (request.method === "Target.attachToTarget") { attachments.push(request.params.targetId); result = { sessionId: "session-fixture" }; }
      else if (request.method === "Network.getCookies") result = { cookies: [{ name: "fixture-session", value: "selected-profile-only", domain: "chatgpt.com", path: "/", expires: -1, session: true, httpOnly: true, secure: true, sameSite: "Lax" }] };
      else if (request.method === "Target.closeTarget") { expect(request.params.targetId).toBe(targetId); result = { success: true }; }
      else { socket.send(JSON.stringify({ id: request.id, error: { message: "Unexpected target creation" } })); return; }
      socket.send(JSON.stringify({ id: request.id, result }));
    } },
  });
  try {
    const captured = await captureExistingChromeLogin({ consent: true, timeoutMs: 2_000,
      discoveryData: Promise.resolve(`${browser.port}\n/devtools/browser/bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb\n`), profileClaim: Promise.resolve(claim) });
    expect(captured.storageState.cookies[0]?.value).toBe("selected-profile-only");
    expect(attachments).toEqual([targetId]);
    expect(methods).not.toContain("Target.createTarget");
    expect(methods.at(-1)).toBe("Target.closeTarget");
  } finally { await browser.stop(true); }
});
