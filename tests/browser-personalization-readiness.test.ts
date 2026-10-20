import { expect, test } from "bun:test";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { ensureChatGptPersonalizedConnectorAccess } from "../src/adapters/chatgpt-web/browser-personalization";

function fixture(exactRowAfterProof: boolean) {
  let text = "", triggers = 0, selected = false, selectedChecks = 0, structuralClicks = 0, attachments = 0, sends = 0;
  const checkpoints: string[] = [];
  const timeout = () => Object.assign(new Error("Synthetic menu not visible"), { name: "TimeoutError" });
  const empty: any = { filter() { return this; }, count: async () => 0 };
  const structural: any = { filter() { return this; }, count: async () => 0, click: async () => { structuralClicks++; throw Error("No personalization control may be clicked"); } };
  const row: any = { filter() { return this; }, first() { return this; },
    count: async () => exactRowAfterProof && triggers >= 2 ? 1 : 0,
    waitFor: async () => { if (!exactRowAfterProof || triggers < 2) throw timeout(); },
    getAttribute: async () => "true" };
  const rows: any = { filter: () => row, count: row.count };
  const popup: any = { filter() { return this; }, or() { return this; }, locator: () => rows,
    count: async () => exactRowAfterProof && triggers >= 2 && !selected ? 1 : 0 };
  const composer: any = { fill: async (value: string) => { text = value; }, focus: async () => {},
    pressSequentially: async (value: string) => { text += value; triggers++; },
    evaluate: async () => ({ text, focused: true }),
    press: async (key: string) => { if (key === "Enter") { selected = true; text = ""; } },
  };
  const page: any = { url: () => "https://chatgpt.com/?temporary-chat=true",
    getByRole: () => empty, getByText: () => row,
    locator: (selector: string) => selector.includes('aria-haspopup="menu"') ? structural : popup,
  };
  const worker: any = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    config: { appName: "Codex Native6" },
    activeComposer: async () => composer,
    connectorIsSelected: async () => { selectedChecks++; return selected; },
    selectedConnectorControl: () => ({ waitFor: async () => { if (!selected) throw Error("No exact selected pill"); } }),
    clearChatGptComposerState: async () => { text = ""; selected = false; },
    attachedPromptText: async () => text,
    connectorMentionRowTitles: async () => [],
    connectorMentionFailure: async () => "Synthetic exact configured connector is unavailable",
    insertPromptText: async (_page: unknown, value: string) => { if (!selected) throw Error("Prompt attached before exact connector proof"); attachments++; text += value; },
    assertPromptAttached: async () => {},
    sendAttachedPrompt: async () => { sends++; throw Error("This readiness check must never send"); },
  });
  return { worker, page, checkpoints, capture: async (name: string) => { checkpoints.push(name); },
    counts: () => ({ triggers, selected, selectedChecks, structuralClicks, attachments, sends }) };
}

test("missing controls defer readiness to exact connector selection, never attach/send on missing proof, and preserve visible state", async () => {
  const hydrated = fixture(true);
  await hydrated.worker.attachPrompt(hydrated.page, "Synthetic instruction", true, hydrated.capture);
  expect(hydrated.checkpoints).toContain("personalization-proof-menu-missing");
  expect(hydrated.checkpoints).toContain("personalization-control-unavailable-requires-connector-proof");
  expect(hydrated.checkpoints).not.toContain("personalization-enabled");
  expect(hydrated.checkpoints).toContain("connector-selected");
  expect(hydrated.counts()).toMatchObject({ triggers: 2, selected: true, structuralClicks: 0, attachments: 1, sends: 0 });
  expect(hydrated.counts().selectedChecks).toBeGreaterThan(0);

  const missing = fixture(false);
  await expect(missing.worker.attachPrompt(missing.page, "Must remain unattached", true, missing.capture)).rejects.toThrow("exact configured connector");
  expect(missing.checkpoints).toContain("personalization-control-unavailable-requires-connector-proof");
  expect(missing.checkpoints).not.toContain("connector-selected");
  expect(missing.counts()).toMatchObject({ selected: false, structuralClicks: 0, attachments: 0, sends: 0 });

  let proofCalls = 0, settingChanges = 0;
  const visible: any = { getByRole: (_role: string, options: { name: RegExp }) => ({ filter() { return this; }, count: async () => options.name.test("Personalized") ? 1 : 0,
      click: async () => { settingChanges++; } }), locator: () => { throw Error("A proven visible state does not enter structural fallback"); } };
  expect(await ensureChatGptPersonalizedConnectorAccess(visible, undefined, async () => { proofCalls++; return false; })).toBe("already-personalized");
  expect(proofCalls).toBe(0); expect(settingChanges).toBe(0);
}, 3000);
