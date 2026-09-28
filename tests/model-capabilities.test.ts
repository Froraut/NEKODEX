import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { defaultConfig } from "../src/config";
import { augmentNativeModelCatalog } from "../src/model-catalog";
import { launcherCapabilityProbeRequired } from "../src/setup";
import { detectChatGptAccountCapabilities, chatGptUnversionedEffortMatches, chatGptModelStateMatches } from "../src/chatgpt-session";
import { availableChatGptWebModelRoutes, requireChatGptWebModelRoute, parseChatGptWebModelCapabilities } from "../src/chatgpt-web-models";

const require = createRequire(import.meta.url);
const { BrowserTaskLedger } = require("../launcher/electron/browser-task-ledger.cjs");
const { BrowserAdmissionQueue } = require("../launcher/electron/browser-admission-queue.cjs");
const { AccountBrowserPool } = require("../launcher/electron/account-pool.cjs");
const evidence = { observedAt: Date.now(), families: {
  "5.6": ["low", "medium", "high", "xhigh", "max"] as const,
  "6": [] as const,
} };
const config = { ...defaultConfig(), solAvailable: true, extraHighAvailable: true,
  proAvailable: true, modelCapabilities: evidence, browserHost: "launcher" as const };

test("one family's Pro limit does not hide another family's Pro or alter native rows", () => {
  const native = { slug: "gpt-6-sol", visibility: "list", supported_reasoning_levels: [{ effort: "high" }] };
  const catalog = augmentNativeModelCatalog({ models: [native] }, { ...config, subagentProtocol: "native" });
  const models = catalog.models as typeof native[];
  expect(models.find(model => model.slug === native.slug)).toEqual(native);
  expect(models.some(model => model.slug === "chatgpt-web/gpt-5.6-pro")).toBe(true);
  expect(models.some(model => model.slug === "chatgpt-web/gpt-6-pro")).toBe(false);
  // Below Pro ChatGPT runs GPT-5.6 Sol; the retired Astra rows are never advertised, and
  // saved tasks that name them keep resolving to GPT-5.6 Sol.
  expect(models.some(model => model.slug.startsWith("chatgpt-web/gpt-6-astra"))).toBe(false);
  const astra = requireChatGptWebModelRoute("chatgpt-web/gpt-6-astra", config, "xhigh");
  expect(astra.interactionMode === "automatic" && astra.modelFamily).toBe("5.6");
  expect(astra.adapterEffort).toBe("xhigh");
  expect(requireChatGptWebModelRoute("chatgpt-web/gpt-6-astra-instant", config).adapterEffort).toBe("low");
  expect(requireChatGptWebModelRoute("chatgpt-web/gpt-5.6-pro", config).adapterEffort).toBe("max");
  expect(() => requireChatGptWebModelRoute("chatgpt-web/gpt-6-pro", config)).toThrow("unavailable");
  const refreshed = { ...config, modelCapabilities: { ...evidence, families: { ...evidence.families, "6": ["max"] as const } } };
  expect(requireChatGptWebModelRoute("chatgpt-web/gpt-6-pro", refreshed).adapterEffort).toBe("max");
  const listed = (augmentNativeModelCatalog({ models: [native] }, { ...refreshed, subagentProtocol: "native" }).models as Array<{ slug: string; display_name: string }>)
    .filter(model => model.slug.startsWith("chatgpt-web/")).map(model => model.display_name);
  expect(listed).toEqual(["GPT-6 Pro (Web)", "GPT-5.6 Sol Pro (Web)", "GPT-5.6 Sol (Web)", "GPT-5.6 Sol Instant (Web)"]);
  expect(requireChatGptWebModelRoute("chatgpt-web/high", config).adapterEffort).toBe("high");
});

test("setup refreshes old observations while Manual mode remains independent of the browser", () => {
  expect(launcherCapabilityProbeRequired(config)).toBe(false);
  expect(launcherCapabilityProbeRequired({ ...config, modelCapabilities: undefined })).toBe(true);
  expect(launcherCapabilityProbeRequired({ ...config, modelCapabilities: { ...evidence, observedAt: Date.now() - 31 * 60_000 } })).toBe(true);
  expect(launcherCapabilityProbeRequired(config, true, "manual")).toBe(false);
  expect(() => parseChatGptWebModelCapabilities({ ...evidence, families: { "6": ["invented"] } })).toThrow();
});

test("every advertised named model survives admission and durable task history", () => {
  const dir = mkdtempSync(join(tmpdir(), "nekodex-model-admission-"));
  const queue = new BrowserAdmissionQueue({ file: join(dir, "queue.json"), autoPump: false,
    inspect: () => ({ reason: "account-operation" }), dispatch: () => { throw new Error("Unexpected dispatch"); } });
  try {
    const ledger = new BrowserTaskLedger(join(dir, "tasks.json"));
    const routes = [...availableChatGptWebModelRoutes(config), ...availableChatGptWebModelRoutes({ ...config, modelCapabilities: undefined }),
      ...availableChatGptWebModelRoutes({ ...config, solAvailable: false })];
    for (const [index, route] of routes.entries()) {
      const traceId = `named-model-${index}`;
      expect(queue.request({ traceId, helperPid: process.pid, reveal: false, retained: false,
        key: null, routingKey: null, connector: null, requestedAccountId: null, taskProgressVersion: 1,
        requestedModel: route.slug, effort: route.adapterEffort }).notSent).toBe(true);
      const id = ledger.start(traceId, `named-tab-${index}`, 1, route.slug);
      ledger.end(id, "completed");
    }
    const restored = new BrowserTaskLedger(join(dir, "tasks.json"));
    expect(restored.snapshot().map((row: { model: string }) => row.model)).toEqual(routes.map(route => route.slug));
    expect(restored.storageIssue).toBeNull();
  } finally { queue.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("account admission uses the requested family's efforts independently of the legacy aggregate", () => {
  const pool = { registry: { snapshot: () => ({ mode: 'selected', selectedId: 'default', accounts: [{ id: 'default', enabled: true }] }) },
    hosts: new Map([['default', { state: { authenticated: true }, turnTabs: new Map() }]]),
    capabilities: new Map([['default', { solAvailable: true, proAvailable: false, extraHighAvailable: false, modelCapabilities: evidence }]]),
    traceOwners: new Map(), affinity: new Map(), pendingAffinity: new Map(), reservations: new Map(), lastAssigned: new Map(),
    connectors: new Map(), accountOperationLabel: () => null };
  const select = (requestedModel: string, effort: string) => AccountBrowserPool.prototype.chooseAccount.call(pool, 'test-trace', null, false, { requestedModel, effort });
  expect(select('chatgpt-web/gpt-5.6-pro', 'max')).toBe('default');
  expect(select('chatgpt-web/gpt-6-astra', 'xhigh')).toBe('default');
  expect(select('chatgpt-web/gpt-5.6-sol', 'xhigh')).toBe('default');
  expect(() => select('chatgpt-web/gpt-6-pro', 'max')).toThrow('No enabled ChatGPT account');
});

test("French effort evidence stays exact and rejects contradictory versions", () => {
  expect(chatGptModelStateMatches(["GPT-5.6 Sol Élevée, 3 sur 5."], "5.6", false, "high")).toBe(true);
  expect(chatGptUnversionedEffortMatches(["Très élevé, 4 sur 4.", "Utilisez les touches fléchées"], "xhigh")).toBe(true);
  expect(chatGptUnversionedEffortMatches(["Pro, 5 sur 5."], "max")).toBe(true);
  for (const descriptions of [["Pro"], ["Pro, 4 sur 5."], ["Pro, 5 sur 4."], ["Pro, 5 sur 5.", "GPT-7 Pro"]]) {
    expect(chatGptUnversionedEffortMatches(descriptions, "max")).toBe(false);
  }
});

// This optional fixture launches an isolated headless browser; it never uses an account.
test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("family discovery restores the selected model, effort, menu and unsent draft", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(readFileSync(join(import.meta.dir, "fixtures/french-model-picker.html"), "utf8"));
    const capabilities = await detectChatGptAccountCapabilities(page, { selectorTimeoutMs: 3_000 });
    // Latest has no Pro level here, so the picker offers no GPT-6 level at all.
    expect(capabilities.modelCapabilities?.families).toEqual({ "5.6": evidence.families["5.6"] });
    expect(capabilities.modelCapabilities?.names).toEqual({ "5.6": "Sol" });
    expect(await page.locator('#picker').isVisible()).toBe(false);
    expect(await page.locator("#status").innerText()).toBe("Pro, 5 sur 5.");
    expect(await page.locator('[role="slider"]').getAttribute("aria-valuenow")).toBe("4");
    expect(await page.locator('#prompt-textarea').innerText()).toBe("Brouillon à conserver");
  } finally { await browser.close(); }
}, 15_000);
