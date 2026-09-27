// Cloudflare ties its ChatGPT clearance to the public IP address that passed the check. A VPN that
// rotates exit servers per connection, or routes Cloudflare's challenge host through another exit,
// therefore makes ChatGPT ask for verification again after every restart. This check compares the
// addresses Cloudflare reports on fresh connections. Only the verdict leaves this module; the
// addresses themselves are never stored, published or logged.

const CHATGPT_TRACE_URL = "https://chatgpt.com/cdn-cgi/trace";
const CHALLENGE_TRACE_URL = "https://challenges.cloudflare.com/cdn-cgi/trace";
const CHATGPT_SAMPLES = 3;
const TRACE_TIMEOUT_MS = 8_000;
const TRACE_LIMIT = 4_096;

async function traceAddress(session, url, signal) {
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(TRACE_TIMEOUT_MS)])
    : AbortSignal.timeout(TRACE_TIMEOUT_MS);
  try {
    // A trace response is Cloudflare's own diagnostic, not ChatGPT content; it needs no cookies.
    const response = await session.fetch(url, { credentials: "omit", cache: "no-store", redirect: "error",
      signal: requestSignal });
    if (!response.ok) throw new Error(`network trace HTTP ${response.status}`);
    const text = (await response.text()).slice(0, TRACE_LIMIT);
    const address = /^ip=([0-9a-f.:]{2,45})$/im.exec(text)?.[1]?.toLowerCase();
    if (!address) throw new Error("network trace had no address");
    return address;
  } finally {
    // The next sample must open a new connection; an HTTP/2 connection keeps its exit address.
    await session.closeAllConnections();
  }
}

/**
 * Returns `egress-unstable` when fresh ChatGPT connections leave from different addresses,
 * `challenge-route` when the challenge host is reached from an address ChatGPT never sees, or null.
 */
async function checkNetworkEgress(session, { samples = CHATGPT_SAMPLES, signal } = {}) {
  const chatgpt = [];
  for (let index = 0; index < samples; index += 1) {
    signal?.throwIfAborted();
    chatgpt.push(await traceAddress(session, CHATGPT_TRACE_URL, signal));
  }
  const challenge = await traceAddress(session, CHALLENGE_TRACE_URL, signal);
  const chatgptAddresses = new Set(chatgpt).size;
  const challengeMatches = chatgpt.includes(challenge);
  return {
    issue: chatgptAddresses > 1 ? "egress-unstable" : challengeMatches ? null : "challenge-route",
    chatgptAddresses,
    challengeMatches,
  };
}

module.exports = { checkNetworkEgress };
