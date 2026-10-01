import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { responseDomSnapshot } from "../src/adapters/chatgpt-web/browser-response-dom";
import { ChatGptTurnDomHealthTracker } from "../src/adapters/chatgpt-web/browser-response-policy";
import { ChatGptMarkdownBuffer, chatGptHtmlToMarkdown } from "../src/adapters/chatgpt-web/markdown";

// Synthetic DOM only: no ChatGPT account, browser profile, API call or installed app.
const tracker = new ChatGptTurnDomHealthTracker(20, 20, 20);
const missing = { responsePresent: false, currentText: "", completionActionVisible: false };
assert.equal(tracker.update({ ...missing, running: true }, 0), undefined);
assert.equal(tracker.update({ ...missing, running: true }, 10_000), undefined);
assert.equal(tracker.update({ ...missing, running: false }, 10_001), undefined);
assert.match(tracker.update({ ...missing, running: false }, 10_022)!, /did not create a response/);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<article id="turn"><div data-message-author-role="assistant"><div class="markdown">
    <div data-markdown-copy="rich-block"><header>Editable title</header><button>Format controls</button>
      <div data-markdown-copy-content="true"><p>Owned body with <a href="https://example.com/">a link</a>.</p>
        <div data-markdown-copy="code-block"><span>Python toolbar</span><button>Copy</button>
          <code class="language-python">first = 1\nsecond = 2</code></div>
      </div>
    </div><p>Following prose.</p>
  </div></div></article>`);
  const first = await responseDomSnapshot(page.locator("#turn"));
  assert.equal(first.responsePresent, true);
  const projected = first.markdownSegments.map(segment => segment.html).join("\n");
  assert.ok(projected.includes("<pre>"));
  assert.ok(projected.includes("first = 1\nsecond = 2"));
  assert.ok(projected.includes('href="https://example.com/"'));
  assert.ok(!/Editable title|Format controls|Python toolbar/.test(projected));
  await page.locator("header").evaluate(node => { node.textContent = "Changed title"; });
  await page.locator("button").first().evaluate(node => { node.textContent = "Changing format"; });
  const second = await responseDomSnapshot(page.locator("#turn"));
  assert.deepEqual(second.markdownSegments, first.markdownSegments);
  const markdown = chatGptHtmlToMarkdown(projected);
  assert.ok(markdown.includes("first = 1\nsecond = 2"));
  assert.ok(markdown.includes("https://example.com/"));
  // Different empty semantic blocks are not the same committed block.
  const buffer = new ChatGptMarkdownBuffer();
  buffer.observe([{ key: "first-rule", tag: "HR", html: "<hr>", text: "", streamable: false }]);
  buffer.finish();
  buffer.observe([
    { key: "first-rule", tag: "HR", html: "<hr>", text: "", streamable: false },
    { key: "second-rule", tag: "HR", html: "<hr>", text: "", streamable: false },
  ]);
  assert.equal((buffer.finish().markdown.match(/\* \* \*/g) ?? []).length, 2);
} finally { await browser.close(); }

const require = createRequire(import.meta.url);
const { BrowserTurnLifecycle } = require("../launcher/electron/browser-turn-lifecycle.cjs");
const ended: unknown[] = [];
const tab = { id: "tab", traceId: "owned", helperPid: 42, authenticationRequired: true,
  status: "running",
  message: "Sign in required", taskRecordId: "record", loading: true,
  view: { webContents: { isDestroyed: () => false, setBackgroundThrottling() {} } } };
const lifecycle = new BrowserTurnLifecycle({ tabs: new Map([[tab.id, tab]]),
  closedOwners: new Map(), cancelledOwners: new Map(),
  context: { ledger: { end(_id: string, status: string) { ended.push(status); } } },
  views: {}, presentation: { syncPowerSaveBlocker() {}, snapshot: () => ({}), publishState() {}, writeDescriptor() {} },
  manual: {}, artifacts: { release() {} }, events: {}, logger: { info() {} } });
const receipt = await lifecycle.endTurn("owned", 42, "completed", false, undefined, true, true);
assert.deepEqual(receipt, { cancelledByUser: false, authenticationRequired: true });
assert.deepEqual(ended, ["failed"]);
assert.equal(tab.status, "error");
assert.equal(tab.message, "Sign in required");
assert.equal(lifecycle.tabs.get(tab.id), tab);
const { AccountBrowserPool } = require("../launcher/electron/account-pool.cjs");
const usage: unknown[][] = [], safety: unknown[][] = [];
const owner = { accountId: "account", turnTabs: new Map(), endTurn: async () => receipt };
const pool = { ownerForTrace: () => owner, traceOwners: new Map([["owned", "account"]]),
  recordUsage: (record: () => void) => record(), usage: { finish: (...args: unknown[]) => usage.push(args) },
  safety: { fail: (...args: unknown[]) => safety.push(args) }, publish() {}, logger: { warn() {} } };
await AccountBrowserPool.prototype.endTurn.call(pool, "owned", 42, "completed", false);
assert.deepEqual(usage[0], ["owned", 42, "failed", undefined, "chatgpt_sign_in_required"]);
assert.deepEqual(safety[0], ["account", "chatgpt_sign_in_required"]);
owner.endTurn = async () => ({ ...receipt, cancelledByUser: true });
await AccountBrowserPool.prototype.endTurn.call(pool, "owned", 42, "completed", false);
assert.equal(usage[1]?.[2], "aborted");
assert.equal(safety.length, 1);
console.log("UPSTREAM_RESPONSE_OK running-grace writing-card code-lines empty-blocks authentication-receipt usage-outcome");
