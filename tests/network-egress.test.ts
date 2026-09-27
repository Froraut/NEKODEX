import { expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { checkNetworkEgress } = require("../launcher/electron/network-egress-check.cjs");

function sessionSeeing(addresses: { chatgpt: string[]; challenge: string }, status = 200) {
  const requests: string[] = [];
  let closed = 0;
  let chatgpt = 0;
  return {
    requests, closed: () => closed,
    session: {
      fetch: async (url: string, init: { credentials?: string }) => {
        requests.push(`${new URL(url).host} ${init.credentials}`);
        const ip = url.includes("challenges.cloudflare.com") ? addresses.challenge : addresses.chatgpt[chatgpt++ % addresses.chatgpt.length];
        return new Response(`fl=1\nh=${new URL(url).host}\nip=${ip}\nts=1\ncolo=EWR\n`, { status });
      },
      closeAllConnections: async () => { closed += 1; },
    },
  };
}

test("a stable route reports no issue and opens a fresh connection for every sample", async () => {
  const probe = sessionSeeing({ chatgpt: ["203.0.113.7"], challenge: "203.0.113.7" });
  expect(await checkNetworkEgress(probe.session)).toEqual({ issue: null, chatgptAddresses: 1, challengeMatches: true });
  expect(probe.requests).toEqual(["chatgpt.com omit", "chatgpt.com omit", "chatgpt.com omit", "challenges.cloudflare.com omit"]);
  expect(probe.closed()).toBe(4);
});

test("rotating ChatGPT exits and a separate challenge route are reported without addresses", async () => {
  const rotating = await checkNetworkEgress(sessionSeeing({ chatgpt: ["203.0.113.7", "198.51.100.4"], challenge: "203.0.113.7" }).session);
  expect(rotating).toEqual({ issue: "egress-unstable", chatgptAddresses: 2, challengeMatches: true });
  const split = await checkNetworkEgress(sessionSeeing({ chatgpt: ["203.0.113.7"], challenge: "192.0.2.9" }).session);
  expect(split).toEqual({ issue: "challenge-route", chatgptAddresses: 1, challengeMatches: false });
  expect(JSON.stringify([rotating, split])).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
});

test("an unusable trace is a failed check, not a verdict", async () => {
  await expect(checkNetworkEgress(sessionSeeing({ chatgpt: ["203.0.113.7"], challenge: "203.0.113.7" }, 403).session))
    .rejects.toThrow("network trace HTTP 403");
});
