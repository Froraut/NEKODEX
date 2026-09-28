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
  chatGptModelRowForVersion,
  chatGptWebModelSlugVersion,
  parseChatGptWebModelCapabilities,
  requireChatGptWebModelRoute,
} from "../src/chatgpt-web-models";
import { parseLauncherCapabilityEvidence } from "../src/pro-model-config";

const require = createRequire(import.meta.url);
const { BrowserTaskLedger, isTaskModel, taskModelFamily } = require("../launcher/electron/browser-task-ledger.cjs");

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
  expect(chatGptModelRowForVersion(["Latest", "Auto", "GPT-5.6 Sol"], "6")).toBeUndefined();
  expect(chatGptModelRowForVersion(["GPT-5.6 Sol", "GPT-5.6 Luna"], "5.6")).toBeUndefined();
});

test("the observed picker lists every current model under the identities Codex already uses", () => {
  expect(observed).toEqual({ observedAt: 1_790_000_000_000, names: { "5.6": "Sol" }, families: {
    "6": ["max"], "5.6": ["low", "medium", "high", "xhigh", "max"], "5.5": ["low", "medium", "high", "xhigh"],
  } });
  expect(parseChatGptWebModelCapabilities(JSON.parse(JSON.stringify(observed)))).toEqual(observed);
  const routes = availableChatGptWebModelRoutes(config);
  expect(routes.map(route => [route.slug, route.displayName])).toEqual([
    ["chatgpt-web/gpt-6-pro", "GPT-6 Pro (Web)"],
    ["chatgpt-web/gpt-5.6-pro", "GPT-5.6 Sol Pro (Web)"],
    ["chatgpt-web/gpt-5.6-sol", "GPT-5.6 Sol (Web)"],
    ["chatgpt-web/gpt-5.6-sol-instant", "GPT-5.6 Sol Instant (Web)"],
    ["chatgpt-web/gpt-5.5", "GPT-5.5 (Web)"],
    ["chatgpt-web/gpt-5.5-instant", "GPT-5.5 Instant (Web)"],
  ]);
  const native = { slug: "gpt-6-astra", visibility: "list", priority: 1, tool_mode: "code_mode_only",
    supported_reasoning_levels: [{ effort: "high" }] };
  const catalog = augmentNativeModelCatalog({ models: [native] }, { ...config, subagentProtocol: "native" });
  const web = (catalog.models as Array<{ slug: string; supported_reasoning_levels: Array<{ effort: string }> }>)
    .filter(model => model.slug.startsWith("chatgpt-web/"));
  expect(web.map(model => model.slug)).toEqual(routes.map(route => route.slug));
  expect(web.find(model => model.slug === "chatgpt-web/gpt-5.5")!.supported_reasoning_levels.map(level => level.effort))
    .toEqual(["medium", "high", "xhigh"]);
  const pinned = requireChatGptWebModelRoute("chatgpt-web/gpt-5.5", config, "xhigh");
  expect(pinned.interactionMode === "automatic" && [pinned.modelFamily, pinned.adapterEffort]).toEqual(["5.5", "xhigh"]);
  expect(() => requireChatGptWebModelRoute("chatgpt-web/gpt-5.5-pro", config)).toThrow("not currently offered");
  // Saved fixed-mode and retired identities keep resolving.
  expect(requireChatGptWebModelRoute("chatgpt-web/high", config).adapterEffort).toBe("high");
  const astra = requireChatGptWebModelRoute("chatgpt-web/gpt-6-astra", config);
  expect(astra.interactionMode === "automatic" && astra.modelFamily).toBe("5.6");
});

test("a new ChatGPT model and a retired one change the Codex list without a release", () => {
  const later = aggregateChatGptModelObservation([
    { label: "Latest", positions: Object.fromEntries(levels.map(effort => [effort, described("6.5", "Nova")])) },
    { label: "GPT-6 Astra", positions: { max: described("6", "Astra") } },
    { label: "GPT-5.6 Sol", positions: Object.fromEntries(levels.map(effort => [effort, described("5.6", "Sol")])) },
  ]);
  const routes = availableChatGptWebModelRoutes({ ...config, modelCapabilities: later });
  expect(routes.map(route => route.displayName)).toEqual([
    "GPT-6.5 Nova Pro (Web)", "GPT-6.5 Nova (Web)", "GPT-6.5 Nova Instant (Web)",
    "GPT-6 Astra Pro (Web)",
    "GPT-5.6 Sol Pro (Web)", "GPT-5.6 Sol (Web)", "GPT-5.6 Sol Instant (Web)",
  ]);
  expect(routes.map(route => route.slug)).toContain("chatgpt-web/gpt-6.5-nova");
  expect(() => requireChatGptWebModelRoute("chatgpt-web/gpt-5.5", { ...config, modelCapabilities: later })).toThrow("not currently offered");
});

test("pickers that describe only the effort keep GPT-6 Pro on Latest and the named rows' versions", () => {
  const unversioned = aggregateChatGptModelObservation([
    { label: "Le plus récent", positions: Object.fromEntries(levels.map(effort => [effort, null])) },
    { label: "GPT-5.6 Sol", positions: Object.fromEntries(levels.map(effort => [effort, null])) },
  ]);
  expect(unversioned.families).toEqual({ "6": ["max"], "5.6": ["low", "medium", "high", "xhigh", "max"] });
  expect(unversioned.names).toEqual({ "5.6": "Sol" });
});

test("observations saved before model names keep their fixed identities", () => {
  const legacy = parseChatGptWebModelCapabilities({ observedAt: 1, families: { "6": ["low", "medium", "max"], "5.6": ["low", "max"] } })!;
  expect(legacy.families["6"]).toEqual(["max"]);
  expect(availableChatGptWebModelRoutes({ ...config, modelCapabilities: legacy }).map(route => route.slug).toSorted())
    .toEqual(["chatgpt-web/gpt-5.6-pro", "chatgpt-web/gpt-5.6-sol-instant", "chatgpt-web/gpt-6-pro"]);
  expect(() => parseChatGptWebModelCapabilities({ observedAt: 1, families: { "gpt-6": ["max"] } })).toThrow();
  expect(() => parseChatGptWebModelCapabilities({ observedAt: 1, families: { "6": ["max"] }, names: { "6": "pro" } })).toThrow();
});

test("the launcher admits, records and routes discovered models by their version", () => {
  for (const slug of ["chatgpt-web/gpt-5.5", "chatgpt-web/gpt-6.5-nova-instant", "chatgpt-web/gpt-7-pro", "chatgpt-web/gpt-5.6-sol"]) {
    expect(isTaskModel(slug)).toBe(true);
    expect(taskModelFamily(slug)).toBe(chatGptWebModelSlugVersion(slug));
  }
  expect(taskModelFamily("chatgpt-web/gpt-6-astra")).toBe("5.6");
  expect(taskModelFamily("chatgpt-web/gpt-5.6-luna")).toBeUndefined();
  for (const slug of ["chatgpt-web/gpt-5.5 ", "chatgpt-web/gpt-x", "chatgpt-web/gpt-5.5-instant-pro", "chatgpt-web/../pro"]) {
    expect(isTaskModel(slug)).toBe(false);
  }
  const dir = mkdtempSync(join(tmpdir(), "nekodex-model-discovery-"));
  try {
    const ledger = new BrowserTaskLedger(join(dir, "tasks.json"));
    ledger.end(ledger.start("trace-discovered", "tab-discovered", 1, "chatgpt-web/gpt-5.5"), "completed");
    const restored = new BrowserTaskLedger(join(dir, "tasks.json"));
    expect(restored.snapshot().map((row: { model: string }) => row.model)).toEqual(["chatgpt-web/gpt-5.5"]);
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
