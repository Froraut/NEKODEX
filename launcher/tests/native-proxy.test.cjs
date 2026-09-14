const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveNativeProxyEnvironment, resolveTunnelProxyEnvironment } = require("../electron/native-proxy.cjs");

test("system proxy routing remains endpoint-specific and keeps local IPC direct", async () => {
  const destinations = [];
  const session = { resolveProxy: async url => { destinations.push(url); return url.includes("chatgpt.com") ? "PROXY localhost:8080" : "HTTPS proxy.example:8443"; } };
  assert.deepEqual(await resolveNativeProxyEnvironment(session, {}), { CODEX_CHATGPT_WEB_NATIVE_PROXY: "http://localhost:8080" });
  const tunnel = await resolveTunnelProxyEnvironment(session, { NO_PROXY: "internal.example" });
  assert.equal(tunnel.HTTPS_PROXY, "https://proxy.example:8443");
  assert.equal(tunnel.NO_PROXY, "internal.example,localhost,127.0.0.1,::1");
  assert.equal(destinations.length, 2);
  await resolveTunnelProxyEnvironment(session, { HTTPS_PROXY: "http://explicit.example:3128" });
  assert.equal(destinations.length, 2, "An explicit proxy must not be replaced by a PAC lookup");
});
