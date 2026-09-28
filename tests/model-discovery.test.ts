import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { defaultConfig } from "../src/config";
import { augmentNativeModelCatalog } from "../src/model-catalog";
import {
  activateChatGptEffortMenu,
  aggregateChatGptModelObservation,
  CHATGPT_EFFORT_CONTROL_SELECTOR,
  detectChatGptAccountCapabilities,
  parseChatGptDescribedModelState,
  selectChatGptModelFamily,
  type ChatGptModelRowObservation,
} from "../src/chatgpt-session";
import {
  availableChatGptWebModelRoutes,
  CHATGPT_WEB_SAVED_TASK_MODEL_ROUTES,
  chatGptModelRowForVersion,
  newestChatGptWebProFamily,
  parseChatGptWebModelCapabilities,
  requireChatGptWebModelRoute,
} from "../src/chatgpt-web-models";
import { parseLauncherCapabilityEvidence } from "../src/pro-model-config";
import { ClientTurns } from "../src/client-turns";

const require = createRequire(import.meta.url);
const { BrowserTaskLedger, isTaskModel, taskModelFamily } = require("../launcher/electron/browser-task-ledger.cjs");
const { AccountBrowserPool } = require("../launcher/electron/account-pool.cjs");
const { RuntimeHost } = require("../launcher/electron/runtime.cjs");

const levels = ["low", "medium", "high", "xhigh", "max"] as const;
const described = (version: string, name?: string) => ({ version, ...(name ? { name } : {}) });

// What ChatGPT's English picker describes today: Latest runs GPT-5.6 Sol below Pro and GPT-6 at Pro.
const englishPicker: ChatGptModelRowObservation[] = [
  { label: "Latest", positions: { low: described("5.6", "Sol"), medium: described("5.6", "Sol"),
    high: described("5.6", "Sol"), xhigh: described("5.6", "Sol"), max: described("6") } },
  { label: "GPT-5.6 Sol", positions: Object.fromEntries(levels.map(effort => [effort, described("5.6", "Sol")])) },
  { label: "GPT-5.5Leaving on October 14", positions: { low: described("5.5"), medium: described("5.5"),
    high: described("5.5"), xhigh: described("5.5") } },
];

const observed = aggregateChatGptModelObservation(englishPicker, 1_790_000_000_000);
const config = { ...defaultConfig(), solAvailable: true, extraHighAvailable: true, proAvailable: true,
  browserHost: "launcher" as const, modelCapabilities: observed };

test("slider descriptions yield the version, model name and effort in every supported format", () => {
  expect(parseChatGptDescribedModelState("5.6 Sol Extra High, 4 of 5.")).toEqual({ version: "5.6", name: "Sol", effort: "xhigh" });
  expect(parseChatGptDescribedModelState("GPT-5.6 Sol Élevée, 3 sur 5.")).toEqual({ version: "5.6", name: "Sol", effort: "high" });
  expect(parseChatGptDescribedModelState("6 Pro，第 5 项，共 5 项。")).toEqual({ version: "6", effort: "max" });
  expect(parseChatGptDescribedModelState("6.5 Nova Medium, 2 of 5.")).toEqual({ version: "6.5", name: "Nova", effort: "medium" });
  expect(parseChatGptDescribedModelState("5.5 Extra High, 4 of 5.")).toEqual({ version: "5.5", effort: "xhigh" });
  expect(parseChatGptDescribedModelState("Pro, 5 of 5.")).toBeUndefined();
});

test("each version is served by the row naming it, or by Latest only when it is newest", () => {
  const labels = ["Latest", "GPT-5.6 Sol", "GPT-5.5Leaving on October 14"];
  expect(chatGptModelRowForVersion(labels, "5.6")).toEqual({ index: 1, latest: false });
  expect(chatGptModelRowForVersion(labels, "5.5")).toEqual({ index: 2, latest: false });
  expect(chatGptModelRowForVersion(labels, "6")).toEqual({ index: 0, latest: true });
  expect(chatGptModelRowForVersion(labels, "7")).toEqual({ index: 0, latest: true });
  // An older version without its own row is not silently run as Latest.
  expect(chatGptModelRowForVersion(labels, "5.4")).toBeUndefined();
  expect(chatGptModelRowForVersion(["Auto", "Fast", "GPT-5.6 Sol"], "6")).toBeUndefined();
  expect(chatGptModelRowForVersion(["GPT-5.6 Sol", "GPT-5.6 Luna"], "5.6")).toBeUndefined();
});

test("the Codex picker lists exactly ChatGPT's five levels, each with one effort", () => {
  expect(observed).toEqual({ observedAt: 1_790_000_000_000, names: { "5.6": "Sol" }, families: {
    "6": ["max"], "5.6": ["low", "medium", "high", "xhigh", "max"], "5.5": ["low", "medium", "high", "xhigh"],
  } });
  expect(parseChatGptWebModelCapabilities(JSON.parse(JSON.stringify(observed)))).toEqual(observed);
  const five = [
    ["chatgpt-web/gpt-5.6-sol-instant", "GPT-5.6 Sol Instant (Web)", "low"],
    ["chatgpt-web/gpt-5.6-sol-medium", "GPT-5.6 Sol Medium (Web)", "medium"],
    ["chatgpt-web/gpt-5.6-sol-high", "GPT-5.6 Sol High (Web)", "high"],
    ["chatgpt-web/gpt-5.6-sol-extra-high", "GPT-5.6 Sol Extra High (Web)", "xhigh"],
    ["chatgpt-web/gpt-6-pro", "GPT-6 Astra Pro (Web)", "max"],
  ];
  const native = { slug: "gpt-6-astra", visibility: "list", priority: 1, tool_mode: "code_mode_only",
    supported_reasoning_levels: [{ effort: "high" }] };
  const catalog = augmentNativeModelCatalog({ models: [native] }, { ...config, subagentProtocol: "native" });
  const web = (catalog.models as Array<{ slug: string; display_name: string; supported_reasoning_levels: Array<{ effort: string }>;
    context_window: number }>).filter(model => model.slug.startsWith("chatgpt-web/"));
  expect(web.map(model => [model.slug, model.display_name, model.supported_reasoning_levels.map(level => level.effort).join(",")]))
    .toEqual(five);
  // Each level keeps its own context budget; Pro keeps the larger Pro-model window.
  expect(web.find(model => model.slug === "chatgpt-web/gpt-6-pro")!.context_window)
    .toBeGreaterThan(web.find(model => model.slug === "chatgpt-web/gpt-5.6-sol-high")!.context_window);
  const astra = requireChatGptWebModelRoute("chatgpt-web/gpt-6-pro", config);
  expect(astra.interactionMode === "automatic" && [astra.modelFamily, astra.adapterEffort]).toEqual(["6", "max"]);
  const medium = requireChatGptWebModelRoute("chatgpt-web/gpt-5.6-sol-medium", config);
  expect(medium.interactionMode === "automatic" && [medium.modelFamily, medium.adapterEffort]).toEqual(["5.6", "medium"]);
  expect(() => requireChatGptWebModelRoute("chatgpt-web/gpt-5.6-sol-medium", config, "high")).toThrow("does not support effort");
  expect(() => requireChatGptWebModelRoute("chatgpt-web/gpt-5.5", config)).toThrow("not enabled");
  // Saved tasks keep resolving the fixed-mode, generic Sol, Sol Pro and retired Astra identities.
  expect(requireChatGptWebModelRoute("chatgpt-web/high", config).adapterEffort).toBe("high");
  expect(requireChatGptWebModelRoute("chatgpt-web/gpt-5.6-sol", config, "xhigh").adapterEffort).toBe("xhigh");
  const solPro = requireChatGptWebModelRoute("chatgpt-web/gpt-5.6-pro", config);
  expect(solPro.interactionMode === "automatic" && [solPro.modelFamily, solPro.adapterEffort]).toEqual(["5.6", "max"]);
  const alias = requireChatGptWebModelRoute("chatgpt-web/gpt-6-astra", config);
  expect(alias.interactionMode === "automatic" && alias.modelFamily).toBe("5.6");
});

test("the account's picker decides which of the five levels are listed", () => {
  const plus = aggregateChatGptModelObservation([
    { label: "Latest", positions: { low: described("5.6", "Sol"), medium: described("5.6", "Sol"), high: described("5.6", "Sol") } },
    { label: "GPT-5.6 Sol", positions: { low: described("5.6", "Sol"), medium: described("5.6", "Sol"), high: described("5.6", "Sol") } },
  ]);
  expect(availableChatGptWebModelRoutes({ ...config, extraHighAvailable: false, proAvailable: false, modelCapabilities: plus })
    .map(route => route.slug)).toEqual(["chatgpt-web/gpt-5.6-sol-instant", "chatgpt-web/gpt-5.6-sol-medium", "chatgpt-web/gpt-5.6-sol-high"]);
  // A newer model at Pro does not become GPT-6 Astra Pro; that row needs GPT-6 at Pro.
  const newer = aggregateChatGptModelObservation([
    { label: "Latest", positions: { high: described("5.6", "Sol"), max: described("6.5", "Nova") } },
    { label: "GPT-5.6 Sol", positions: { high: described("5.6", "Sol"), max: described("5.6", "Sol") } },
  ]);
  expect(availableChatGptWebModelRoutes({ ...config, modelCapabilities: newer }).map(route => route.slug))
    .toEqual(["chatgpt-web/gpt-5.6-sol-high"]);
  expect(() => requireChatGptWebModelRoute("chatgpt-web/gpt-6-pro", { ...config, modelCapabilities: newer })).toThrow("unavailable");
});

test("pickers that describe only the effort keep GPT-6 Pro on Latest and the named rows' versions", () => {
  const unversioned = aggregateChatGptModelObservation([
    { label: "Le plus récent", positions: Object.fromEntries(levels.map(effort => [effort, null])) },
    { label: "GPT-5.6 Sol", positions: Object.fromEntries(levels.map(effort => [effort, null])) },
  ]);
  expect(unversioned.families).toEqual({ "6": ["max"], "5.6": ["low", "medium", "high", "xhigh", "max"] });
  expect(unversioned.names).toEqual({ "5.6": "Sol" });
});

test("observations saved before model names keep GPT-6 only at Pro", () => {
  const legacy = parseChatGptWebModelCapabilities({ observedAt: 1, families: { "6": ["low", "medium", "max"], "5.6": ["low", "max"] } })!;
  expect(legacy.families["6"]).toEqual(["max"]);
  expect(availableChatGptWebModelRoutes({ ...config, modelCapabilities: legacy }).map(route => route.slug))
    .toEqual(["chatgpt-web/gpt-5.6-sol-instant", "chatgpt-web/gpt-6-pro"]);
  expect(() => parseChatGptWebModelCapabilities({ observedAt: 1, families: { "gpt-6": ["max"] } })).toThrow();
  expect(() => parseChatGptWebModelCapabilities({ observedAt: 1, families: { "6": ["max"] }, names: { "6": "pro" } })).toThrow();
});

test("the launcher admits, records and routes the five models by family", () => {
  const families: Record<string, string> = { "chatgpt-web/gpt-5.6-sol-instant": "5.6", "chatgpt-web/gpt-5.6-sol-medium": "5.6",
    "chatgpt-web/gpt-5.6-sol-high": "5.6", "chatgpt-web/gpt-5.6-sol-extra-high": "5.6", "chatgpt-web/gpt-6-pro": "6",
    "chatgpt-web/gpt-5.6-pro": "5.6", "chatgpt-web/gpt-6-astra": "5.6" };
  for (const [slug, family] of Object.entries(families)) {
    expect(isTaskModel(slug)).toBe(true);
    expect(taskModelFamily(slug)).toBe(family);
  }
  expect(taskModelFamily("chatgpt-web/gpt-5.6-luna")).toBeUndefined();
  for (const slug of ["chatgpt-web/gpt-5.5", "chatgpt-web/gpt-5.6-sol-high ", "chatgpt-web/../pro"]) expect(isTaskModel(slug)).toBe(false);
  const dir = mkdtempSync(join(tmpdir(), "nekodex-model-discovery-"));
  try {
    const ledger = new BrowserTaskLedger(join(dir, "tasks.json"));
    ledger.end(ledger.start("trace-five", "tab-five", 1, "chatgpt-web/gpt-5.6-sol-extra-high"), "completed");
    const restored = new BrowserTaskLedger(join(dir, "tasks.json"));
    expect(restored.snapshot().map((row: { model: string }) => row.model)).toEqual(["chatgpt-web/gpt-5.6-sol-extra-high"]);
    expect(restored.storageIssue).toBeNull();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("launcher evidence is validated before the runtime saves it", () => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  expect(parseLauncherCapabilityEvidence(encode({ solAvailable: true, extraHighAvailable: true, proAvailable: true,
    modelCapabilities: observed }))).toEqual({ solAvailable: true, extraHighAvailable: true, proAvailable: true, modelCapabilities: observed });
  expect(() => parseLauncherCapabilityEvidence(encode({ solAvailable: false, proAvailable: true }))).toThrow("Contradictory");
  expect(() => parseLauncherCapabilityEvidence(encode({ solAvailable: true, proAvailable: false, url: "x" }))).toThrow();
  expect(() => parseLauncherCapabilityEvidence("not base64!")).toThrow();
});

// This optional fixture launches an isolated headless browser; it never uses an account.
test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("discovery reads every picker row and restores the model, effort, menu and draft", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(readFileSync(join(import.meta.dir, "fixtures/english-model-picker.html"), "utf8"));
    const capabilities = await detectChatGptAccountCapabilities(page, { selectorTimeoutMs: 3_000 });
    expect(capabilities.proAvailable).toBe(true);
    expect({ ...capabilities.modelCapabilities, observedAt: 0 }).toEqual({ ...observed, observedAt: 0 });
    expect(await page.evaluate(() => (window as unknown as { pickerState(): unknown }).pickerState())).toEqual({ family: "latest", value: 2 });
    expect(await page.locator("#picker").isVisible()).toBe(false);
    expect(await page.locator("#prompt-textarea").innerText()).toBe("Draft to keep");

    // Turn selection reaches each discovered version through the same row discovery used.
    const control = page.locator(CHATGPT_EFFORT_CONTROL_SELECTOR);
    let activation = await activateChatGptEffortMenu(page, control);
    activation = await selectChatGptModelFamily(page, control, activation, "5.5");
    expect(activation.latestModelRow).toBe(false);
    expect(await page.evaluate(() => (window as unknown as { pickerState(): { family: string } }).pickerState().family)).toBe("5.5");
    activation = await selectChatGptModelFamily(page, control, activation, "6");
    expect(activation.latestModelRow).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { pickerState(): { family: string } }).pickerState().family)).toBe("latest");
    await expect(selectChatGptModelFamily(page, control, activation, "5.4")).rejects.toThrow("unavailable or ambiguous");
  } finally { await browser.close(); }
}, 60_000);

test("Latest stays reachable beside other unversioned rows, and its unversioned Pro is GPT-6", () => {
  expect(chatGptModelRowForVersion(["Auto", "Latest", "GPT-5.6 Sol"], "6")).toEqual({ index: 1, latest: true });
  const mixed = aggregateChatGptModelObservation([
    { label: "Latest", positions: { high: described("5.6", "Sol"), max: null } },
    { label: "Auto", positions: { max: null } },
    { label: "GPT-5.6 Sol", positions: { high: described("5.6", "Sol"), max: described("5.6", "Sol") } },
  ]);
  expect(mixed.families).toEqual({ "6": ["max"], "5.6": ["high", "max"] });
});

test("retired identities stay available to saved tasks as hidden catalog rows", () => {
  const saved = CHATGPT_WEB_SAVED_TASK_MODEL_ROUTES.map(route => route.slug);
  for (const slug of ["chatgpt-web/gpt-5.6-sol", "chatgpt-web/gpt-5.6-pro", "chatgpt-web/gpt-6-astra", "chatgpt-web/high"]) {
    expect(saved).toContain(slug);
  }
});

test("fixed levels and unpinned Pro no longer depend on the row an earlier turn left selected", () => {
  const high = requireChatGptWebModelRoute("chatgpt-web/high", config);
  expect(high.interactionMode === "automatic" && high.modelFamily).toBe("5.6");
  expect(newestChatGptWebProFamily(config)).toBe("6");
  expect(newestChatGptWebProFamily({ modelCapabilities: { observedAt: 1, families: { "6": ["max"] } } })).toBeUndefined();
});

test("external clients may request the five models", () => {
  const turns = new ClientTurns("hermes");
  const prepared = turns.prepare({ prompt_cache_key: "session-1", model: "chatgpt-web/gpt-5.6-sol-medium", input: "Hello" });
  expect(prepared.body.model).toBe("chatgpt-web/gpt-5.6-sol-medium");
  prepared.release();
  expect(() => turns.prepare({ prompt_cache_key: "session-2", model: "gpt-6-astra", input: "Hello" })).toThrow("Choose a ChatGPT Web model");
});

test("the launcher defers evidence it cannot save yet and never replaces a discovered list with none", async () => {
  const logger = { info() {}, warn() {} };
  const host = Object.assign(Object.create(RuntimeHost.prototype), {
    logger, launcherProfile: "production", active: null, lifecycleOperation: null, activeChild: null,
    runtimeConfigSnapshot: () => ({ configured: true, config: { browserHost: "launcher", browserInteractionMode: "automatic",
      solAvailable: true, proAvailable: true, extraHighAvailable: true, modelCapabilities: observed } }),
  });
  expect(await host.saveModelCapabilities({ solAvailable: true, proAvailable: true, extraHighAvailable: true, modelCapabilities: { ...observed, observedAt: 5 } }))
    .toEqual({ saved: false, reason: "unchanged" });
  expect(await host.saveModelCapabilities({ solAvailable: true, proAvailable: true, extraHighAvailable: true }))
    .toEqual({ saved: false, reason: "incomplete" });
  host.active = "setup";
  expect(await host.saveModelCapabilities({ solAvailable: true, proAvailable: false, extraHighAvailable: true, modelCapabilities: observed }))
    .toEqual({ saved: false, reason: "busy" });

  const results = [{ saved: false, reason: "busy" }, { saved: true }];
  const calls: string[] = [];
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
    logger, destroyed: false, capabilitySave: null, capabilitySaveAgain: false, capabilitySavePending: false, capabilitySaveRetry: null,
    capabilities: new Map([["default", { solAvailable: true, proAvailable: true }]]),
    registry: { snapshot: () => ({ selectedId: "default" }) },
    options: { onCapabilityEvidence: async (id: string) => { calls.push(id); return results.shift(); } },
  });
  expect(await pool.saveSelectedCapabilities()).toBe(false);
  expect(pool.capabilitySavePending).toBe(true);
  expect(pool.capabilitySaveRetry).not.toBeNull();
  clearTimeout(pool.capabilitySaveRetry);
  expect(await pool.saveSelectedCapabilities()).toBe(true);
  expect(pool.capabilitySavePending).toBe(false);
  expect(calls).toEqual(["default", "default"]);
});
