import { z } from "zod";
import datasetV1 from "../tests/fixtures/chatgpt-ui/v1.json";
import observedProPicker from "../tests/fixtures/pro-model-picker.json";
import {
  CHATGPT_COMPLETION_ACTION_SELECTOR,
  CHATGPT_COMPOSER_SELECTOR,
  CHATGPT_EFFORT_ITEM_SELECTOR,
  CHATGPT_EFFORT_SLIDER_SELECTOR,
  CHATGPT_STOP_BUTTON_SELECTOR,
  chatGptModelStateMatches,
  parseChatGptEffortSliderState,
} from "./chatgpt-session";
import { parseChatGptWebProModelVersion } from "./chatgpt-web-models";
import { resolveChatGptWebModelMode } from "./adapters/chatgpt-web/model";

export interface UiFixtureCheck {
  id: string;
  passed: boolean;
  /** Fixed diagnostic categories only; never page text, prompts, credentials, or profile paths. */
  detail: string;
}

const selectorContracts = {
  composer: CHATGPT_COMPOSER_SELECTOR,
  "effort-item": CHATGPT_EFFORT_ITEM_SELECTOR,
  "effort-slider": CHATGPT_EFFORT_SLIDER_SELECTOR,
  "completion-action": CHATGPT_COMPLETION_ACTION_SELECTOR,
  "stop-button": CHATGPT_STOP_BUTTON_SELECTOR,
} as const;

const id = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/);
const version = z.enum(["5.6", "5.5", "6"]);
const sliderState = z.object({ min: z.number().int(), max: z.number().int(), value: z.number().int() }).strict();
const nullableAttribute = z.string().max(32).nullable();
const modelMode = z.object({
  displayLabel: z.enum(["Luna", "Think", "Instant", "Medium", "High", "Extra High", "Pro"]),
  uiEffortIndex: z.number().int().min(0).max(4).nullable(),
  modelVersion: version.nullable(),
}).strict();
const fixtureCase = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("slider"), id,
    attributes: z.tuple([nullableAttribute, nullableAttribute, nullableAttribute]),
    expected: sliderState.nullable(),
  }).strict(),
  z.object({
    kind: z.literal("model-mode"), id,
    modelId: z.enum(["gpt-5.6-sol", "gpt-5.6-luna"]),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
    capabilities: z.object({
      localToolsEnabled: z.boolean(), solAvailable: z.boolean(), extraHighAvailable: z.boolean(),
      proAvailable: z.boolean(), proModelVersion: version.optional(),
    }).strict(),
    expected: modelMode.nullable(),
  }).strict(),
  z.object({
    kind: z.literal("pro-version"), id,
    value: z.string().max(32), expected: version.nullable(),
  }).strict(),
  z.object({
    kind: z.literal("selection-state"), id,
    descriptions: z.array(z.string().max(256)).min(1).max(8),
    version, requirePro: z.boolean(), expected: z.boolean(),
  }).strict(),
  z.object({
    kind: z.literal("selector-contract"), id,
    selector: z.enum(["composer", "effort-item", "effort-slider", "completion-action", "stop-button"]),
    expected: z.string().min(1).max(1024),
  }).strict(),
]);
const datasetSchema = z.object({
  version: z.literal(1),
  provenance: z.object({
    kind: z.literal("synthetic-contract"),
    recordedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    liveAccountEvidence: z.literal(false),
    sourceFixtures: z.tuple([
      z.literal("tests/fixtures/pro-model-picker.json"),
      z.literal("tests/fixtures/pro-retry-tooltip.html"),
    ]),
  }).strict(),
  cases: z.array(fixtureCase).min(1).max(128),
}).strict();

export type UiFixtureDataset = z.infer<typeof datasetSchema>;

/** Validate an in-memory fixture, with bounded fields and no file/path loading surface. */
export function parseUiFixtureDataset(value: unknown): UiFixtureDataset {
  if (value && typeof value === "object" && "version" in value && value.version !== 1) {
    throw new Error("Unsupported UI fixture dataset version");
  }
  const parsed = datasetSchema.safeParse(value);
  if (!parsed.success) throw new Error("Malformed UI fixture dataset");
  const ids = parsed.data.cases.map(fixture => fixture.id);
  if (new Set(ids).size !== ids.length) throw new Error("UI fixture dataset contains duplicate case IDs");
  return parsed.data;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Only pure production parsers/classifiers and exported selector contracts execute here. */
export function evaluateUiFixtureDataset(value: unknown): UiFixtureCheck[] {
  return parseUiFixtureDataset(value).cases.map(fixture => {
    switch (fixture.kind) {
      case "slider": {
        const actual = parseChatGptEffortSliderState(...fixture.attributes) ?? null;
        return { id: fixture.id, passed: sameValue(actual, fixture.expected),
          detail: "Offline ARIA slider parser contract; no live element or account capability was observed." };
      }
      case "model-mode": {
        let actual: z.infer<typeof modelMode> | null = null;
        try {
          const mode = resolveChatGptWebModelMode(fixture.modelId, fixture.effort, fixture.capabilities);
          actual = { displayLabel: mode.displayLabel, uiEffortIndex: mode.uiEffortIndex, modelVersion: mode.modelVersion ?? null };
        } catch { /* The fixture explicitly expects a rejected capability/effort combination. */ }
        return { id: fixture.id, passed: sameValue(actual, fixture.expected),
          detail: "Offline model/effort classification contract; this does not prove model availability or selection in an account." };
      }
      case "pro-version": {
        let actual: string | null = null;
        try { actual = parseChatGptWebProModelVersion(fixture.value) ?? null; }
        catch { /* Unsupported versions must fail closed. */ }
        return { id: fixture.id, passed: actual === fixture.expected,
          detail: "Offline pinned Pro version validation contract." };
      }
      case "selection-state":
        return { id: fixture.id,
          passed: chatGptModelStateMatches(fixture.descriptions, fixture.version, fixture.requirePro) === fixture.expected,
          detail: "Offline owned-description version/effort proof; no live accessibility descriptions were read." };
      case "selector-contract":
        return { id: fixture.id, passed: selectorContracts[fixture.selector] === fixture.expected,
          detail: "Exported selector matches the versioned contract; no browser DOM matching or visibility check was performed." };
    }
  });
}

/** Fixed checked-in input only: no network, browser, account profile, filesystem walk, or custom path. */
export function runUiFixtureChecks(): UiFixtureCheck[] {
  const slider = observedProPicker.slider;
  const parsedSlider = parseChatGptEffortSliderState(slider["aria-valuemin"], slider["aria-valuemax"], slider["aria-valuenow"]);
  const descriptions = observedProPicker.keyboardControl["aria-describedby"].split(/\s+/)
    .map(key => (observedProPicker.descriptions as Record<string, string>)[key] ?? "");
  return [
    ...evaluateUiFixtureDataset(datasetV1),
    {
      id: "recorded-pro-picker-slider",
      passed: sameValue(parsedSlider, { min: 0, max: 4, value: 4 }),
      detail: "Existing sanitized picker fixture parses as a five-position slider; historical fixture evidence only.",
    },
    {
      id: "recorded-pro-picker-state",
      passed: chatGptModelStateMatches(descriptions, "5.6", true),
      detail: "Existing sanitized picker fixture proves version and Pro in one described state; historical fixture evidence only.",
    },
    ...(["5.6", "5.5", "6"] as const).map(expectedVersion => ({
      id: `recorded-pro-option-${expectedVersion.replace(".", "-")}`,
      passed: observedProPicker.options.some(option => option.role === "menuitemradio" && option.version === expectedVersion),
      detail: "Expected version is present in the existing sanitized option inventory; no live menu was opened.",
    })),
  ];
}
