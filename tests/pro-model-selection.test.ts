import { expect, test } from "bun:test";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import observedPicker from "./fixtures/pro-model-picker.json";
import {
  CHATGPT_EFFORT_MENU_SELECTOR,
  CHATGPT_EFFORT_SLIDER_CONTAINER_SELECTOR,
} from "../src/chatgpt-session";

// The live hidden slider has no aria-valuetext. The owned keyboard menuitem's
// aria-describedby references expose its actual version and effort (sanitized DOM fixture).
function picker(options: {
  unavailable?: boolean;
  actualVersion?: string;
  max?: number;
  descriptionTexts?: readonly string[];
  modelOptions?: Array<{ role: string; name: string; version: string }>;
} = {}) {
  let version = "6", value = 0, submenu = false, expanded = false;
  let actualVersion = options.actualVersion;
  let pinnedVersion: string | undefined;
  let keyboardFailure: string | undefined;
  const actions: string[] = [];
  const hidden = {
    filter() { return this; }, last() { return this; }, getByText() { return this; }, count: async () => 0,
    isVisible: async () => false,
    waitFor: ({ signal }: { signal: AbortSignal }) => new Promise<void>((_, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  };
  const sliderControl = {
    getAttribute: async (name: string) => name === "aria-describedby" ? observedPicker.keyboardControl["aria-describedby"] : null,
    press: async (key: string) => {
    actions.push(`${version}:${key}`);
    value += key === "ArrowRight" ? 1 : -1;
  } };
  const slider = {
    waitFor: async () => {},
    getAttribute: async (name: string) => ({
      "aria-valuemin": "0", "aria-valuemax": String(options.max ?? 4), "aria-valuenow": String(value),
    })[name] ?? null,
    locator: () => sliderControl,
  };
  const container = {
    filter() { return this; }, last() { return this; }, locator: () => slider,
    isVisible: async () => !submenu, waitFor: async () => {}, evaluate: async () => [],
  };
  const control = {
    filter() { return this; }, first() { return this; }, count: async () => 1, innerText: async () => "Selected effort",
    last() { return this; }, waitFor: async () => {}, isVisible: async () => true,
    getAttribute: async (name: string) => name === "aria-controls" ? "picker"
      : name === "aria-expanded" ? String(expanded) : null,
    click: async () => { submenu = false; expanded = true; },
  };
  const versionTrigger = {
    count: async () => 1, waitFor: async () => {},
    getAttribute: async (name: string) => name === "aria-expanded" ? String(submenu) : null,
    click: async () => { submenu = true; actions.push("open-versions"); },
  };
  const modelOptions = options.modelOptions ?? observedPicker.options;
  const radio = (name: string | RegExp) => {
    const option = modelOptions.find(option => typeof name === "string" ? option.name === name : name.test(option.name));
    return {
    count: async () => options.unavailable || !option ? 0 : 1,
    isVisible: async () => submenu && !options.unavailable && Boolean(option),
    waitFor: async () => { if (options.unavailable || !option) throw new Error("missing version"); },
    getAttribute: async (attribute: string) => attribute === "aria-checked" ? String(pinnedVersion === option?.version) : null,
    click: async () => {
      if (options.unavailable || !submenu || !option) throw new Error("unavailable version");
      version = option.version;
      pinnedVersion = version;
      value = 0; submenu = false; actions.push(`selected:${version}`);
    },
    };
  };
  const menu = {
    filter() { return this; }, last() { return this; }, isVisible: async () => true,
    getByLabel: (name: RegExp) => {
      if (!name.test(observedPicker.triggerLabel)) throw new Error("model trigger does not match observed label");
      return versionTrigger;
    },
    getByRole: (role: string, args: { name: string | RegExp; exact: boolean }) => {
      if (role !== "menuitemradio" || !args.exact) throw new Error("expected exact model radio");
      return radio(args.name);
    },
  };
  const composer = { isEditable: async () => true, locator: () => ({ locator: () => control, getByTestId: () => ({
    waitFor: async () => {}, isEnabled: async () => true, press: async () => { actions.push("SEND"); },
  }) }) };
  const page = {
    evaluate: async (fn: unknown, ids: string[]) => {
      expect(ids).toEqual(["picker-value", "picker-instructions"]);
      const descriptions = options.descriptionTexts ?? [
        `${actualVersion ?? (version === "6" && value < 4 ? "5.6" : version)} ${["Instant", "Medium", "High", "Extra High", "Pro"][value]}，第 ${value + 1} 项，共 5 项。`,
        observedPicker.descriptions["picker-instructions"],
      ];
      const previousDocument = Reflect.get(globalThis, "document");
      Reflect.set(globalThis, "document", {
        getElementById: (id: string) => {
          const index = ids.indexOf(id);
          return index < 0 ? null : { textContent: descriptions[index] };
        },
      });
      try {
        return (fn as (descriptionIds: string[]) => unknown)(ids);
      } finally {
        if (previousDocument === undefined) Reflect.deleteProperty(globalThis, "document");
        else Reflect.set(globalThis, "document", previousDocument);
      }
    },
    locator: (selector: string) => selector === '[id="picker"]' || selector === CHATGPT_EFFORT_MENU_SELECTOR ? menu
      : selector === CHATGPT_EFFORT_SLIDER_CONTAINER_SELECTOR ? container : hidden,
    url: () => "https://chatgpt.com/",
    keyboard: { press: async () => {
      expanded = false;
      if (keyboardFailure) throw new Error(keyboardFailure);
    } },
    isClosed: () => false,
  };
  interface WorkerFixture {
    activeComposer: () => Promise<unknown>;
    waitForSubmissionAcceptedWithRecovery: () => Promise<string>;
    selectModelAndEffort(...args: unknown[]): Promise<unknown>;
    sendAttachedPrompt(...args: unknown[]): Promise<unknown>;
  }
  const worker: WorkerFixture = Object.create(ChatGptBrowserWorker.prototype);
  worker.activeComposer = async () => composer;
  worker.waitForSubmissionAcceptedWithRecovery = async () => "user_turn";
  return {
    actions,
    state: () => ({ version, value }),
    setEffort: (next: number) => { value = next; },
    drift: (next: string) => { actualVersion = next; },
    failKeyboardCleanup: () => { keyboardFailure = "keyboard cleanup failed"; },
    select: (requested: string | undefined, effort = "max", stageVersion?: string) => worker.selectModelAndEffort(
      page, "gpt-5.6-sol", effort,
      { localToolsEnabled: false, solAvailable: true, proAvailable: true, proModelVersion: requested },
      undefined, stageVersion),
    send: (requested: string, effort: "low" | "max" = "max") => worker.sendAttachedPrompt(page, {}, async () => { actions.push("READY"); }, undefined, undefined,
      { onSendActivated: async () => { actions.push("ACTIVATED"); } }, undefined, undefined, undefined,
      { modelVersion: requested, effort, uiEffortIndex: effort === "max" ? 4 : 0 }),
  };
}

test.each(["5.6", "5.5", "6"])("explicit Pro version %s is selected before effort", async version => {
  const fixture = picker();
  await fixture.select(version);
  expect(fixture.state()).toEqual({ version, value: 4 });
  expect(fixture.actions[0]).toBe("open-versions");
  expect(fixture.actions[1]).toBe(`selected:${version}`);
  expect(fixture.actions.slice(2)).toEqual(Array(4).fill(`${version}:ArrowRight`));
});

test("an explicit GPT-6 Astra option is accepted without weakening version proof", async () => {
  const fixture = picker({
    modelOptions: [
      { role: "menuitemradio", name: "GPT-6 Astra", version: "6" },
      ...observedPicker.options.filter(option => option.version !== "6"),
    ],
  });
  await fixture.select("6");
  expect(fixture.state()).toEqual({ version: "6", value: 4 });
});

test.each(["Le plus récent", "최신"])("observed Latest label %s still needs version and effort proof", async name => {
  const fixture = picker({ modelOptions: [
    { role: "menuitemradio", name, version: "6" },
    ...observedPicker.options.filter(option => option.version !== "6"),
  ] });
  await fixture.select("6");
  expect(fixture.state()).toEqual({ version: "6", value: 4 });
});

test("nearby GPT-6 labels are not accepted as the pinned model", async () => {
  const fixture = picker({
    modelOptions: [
      { role: "menuitemradio", name: "GPT-6 Mini", version: "6" },
      ...observedPicker.options.filter(option => option.version !== "6"),
    ],
  });
  await expect(fixture.select("6")).rejects.toThrow("6");
});

test("model-state verification is independent of aria-describedby order", async () => {
  const fixture = picker({
    descriptionTexts: [
      observedPicker.descriptions["picker-instructions"],
      "5.6 Pro，第 5 项，共 5 项。",
    ],
  });
  await fixture.select("5.6");
  expect(fixture.state()).toEqual({ version: "5.6", value: 4 });
});

test("an unrelated instruction mentioning Pro cannot validate an Instant state", async () => {
  const fixture = picker({
    descriptionTexts: [
      "5.6 Instant，第 1 项，共 5 项。",
      "Choose Pro for the most difficult tasks.",
    ],
  });
  await expect(fixture.select("5.6")).rejects.toThrow("5.6");
});

test("a missing version stops before any effort or submission can proceed", async () => {
  const fixture = picker({ unavailable: true });
  await expect(fixture.select("5.5")).rejects.toThrow("5.5");
  expect(fixture.actions).toEqual(["open-versions"]);
});

test.each(["6", "7", "5.60", ""])("a mismatched or unverified live label (%s) cannot satisfy pinned 5.6", async actualVersion => {
  const fixture = picker({ actualVersion });
  await expect(fixture.select("5.6")).rejects.toThrow("5.6");
});

test("Latest must still prove version 6, not silently follow a future model", async () => {
  await expect(picker({ actualVersion: "7" }).select("6")).rejects.toThrow("6");
});

test("a version reset during connector or file attachment prevents the send activation", async () => {
  const fixture = picker();
  await fixture.select("5.6");
  fixture.drift("6");
  await expect(fixture.send("5.6")).rejects.toThrow("5.6");
  expect(fixture.actions).toContain("READY");
  expect(fixture.actions).not.toContain("ACTIVATED");
  expect(fixture.actions).not.toContain("SEND");
});

test("menu cleanup failure cannot mask a pre-send model mismatch", async () => {
  const fixture = picker();
  await fixture.select("5.6");
  fixture.drift("6");
  fixture.failKeyboardCleanup();
  await expect(fixture.send("5.6")).rejects.toThrow("5.6");
  expect(fixture.actions).toContain("READY");
  expect(fixture.actions).not.toContain("ACTIVATED");
  expect(fixture.actions).not.toContain("SEND");
});

test("menu cleanup failure still blocks a send after successful verification", async () => {
  const fixture = picker();
  await fixture.select("5.6");
  fixture.failKeyboardCleanup();
  await expect(fixture.send("5.6")).rejects.toThrow("keyboard cleanup failed");
  expect(fixture.actions).toContain("READY");
  expect(fixture.actions).not.toContain("ACTIVATED");
  expect(fixture.actions).not.toContain("SEND");
});

test("a verified 5.6 Pro selection permits one send", async () => {
  const fixture = picker();
  await fixture.select("5.6");
  await fixture.select("5.6");
  expect(fixture.actions.filter(action => action === "open-versions")).toHaveLength(1);
  await fixture.send("5.6");
  expect(fixture.actions.slice(-3)).toEqual(["READY", "ACTIVATED", "SEND"]);
  expect(fixture.actions.filter(action => action === "SEND")).toHaveLength(1);
});

test("an effort reset to non-Pro prevents the send even when the version still matches", async () => {
  const fixture = picker();
  await fixture.select("5.6");
  fixture.setEffort(2);
  await expect(fixture.send("5.6")).rejects.toThrow("5.6");
  expect(fixture.actions).toContain("READY");
  expect(fixture.actions).not.toContain("ACTIVATED");
  expect(fixture.actions).not.toContain("SEND");
});

test("preparatory low-effort stages of pinned Pro stay on that version", async () => {
  const fixture = picker();
  await fixture.select("5.6", "low", "5.6");
  expect(fixture.state()).toEqual({ version: "5.6", value: 0 });
});

test("explicit Latest lower effort proves its checked family and 5.6 state before Send", async () => {
  const fixture = picker();
  await fixture.select("6", "low", "6");
  expect(fixture.state()).toEqual({ version: "6", value: 0 });
  await fixture.send("6", "low");
  expect(fixture.actions).toContain("SEND");
});

test("an ordinary non-Pro route and a legacy unpinned route do not select a version", async () => {
  const ordinary = picker();
  await ordinary.select("5.6", "high");
  expect(ordinary.state()).toEqual({ version: "6", value: 2 });
  expect(ordinary.actions).not.toContain("open-versions");
  const legacy = picker();
  await legacy.select(undefined);
  expect(legacy.state()).toEqual({ version: "6", value: 4 });
  expect(legacy.actions).not.toContain("open-versions");
});
