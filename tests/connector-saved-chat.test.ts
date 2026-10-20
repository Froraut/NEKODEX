import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatGptBrowserWorker, chatGptTurnUsesSavedChat } from "../src/adapters/chatgpt-web/browser-worker";

const TEMPORARY_CHAT = "https://chatgpt.com/?temporary-chat=true";

function verificationFixture(selectConnector: () => Promise<void>) {
  const diagnosticsRoot = mkdtempSync(join(tmpdir(), "nekodex-connector-verify-"));
  let url = TEMPORARY_CHAT;
  const surfaces: boolean[] = [];
  const navigations: string[] = [];
  const page: any = {
    url: () => url,
    isClosed: () => false,
    goto: async (target: string) => { navigations.push(target); url = target; },
  };
  const worker: any = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    config: { appName: "Codex Native6", browserDiagnosticsPath: diagnosticsRoot },
    ensurePage: async () => page,
    prepareTemporaryChatSurface: async (_page: unknown, _capture: unknown, _signal: unknown, useSavedChats = false) => {
      surfaces.push(useSavedChats);
      url = useSavedChats ? "https://chatgpt.com/" : TEMPORARY_CHAT;
    },
    selectConnector,
    clearChatGptComposerState: async () => {},
  });
  return {
    verify: () => worker.verifyConnectorExclusive("verify_connector_saved_chat"),
    surfaces, navigations, url: () => url,
    cleanup: () => rmSync(diagnosticsRoot, { recursive: true, force: true }),
  };
}

test("connector verification proves the plugin on a saved chat and returns to Temporary Chat", async () => {
  const fixture = verificationFixture(async () => {});
  try {
    await expect(fixture.verify()).resolves.toBe("Codex Native6");
    expect(fixture.surfaces).toEqual([true]);
    expect(fixture.navigations).toEqual([TEMPORARY_CHAT]);
    expect(fixture.url()).toBe(TEMPORARY_CHAT);
  } finally {
    fixture.cleanup();
  }
});

test("a failed connector verification still returns the home page to Temporary Chat", async () => {
  const fixture = verificationFixture(async () => { throw new Error("Synthetic connector row missing"); });
  try {
    await expect(fixture.verify()).rejects.toThrow("Synthetic connector row missing");
    expect(fixture.surfaces).toEqual([true]);
    expect(fixture.url()).toBe(TEMPORARY_CHAT);
  } finally {
    fixture.cleanup();
  }
});

test("only tool turns or an explicit preference use saved chats", () => {
  expect(chatGptTurnUsesSavedChat(false, { localToolsEnabled: false })).toBe(false);
  expect(chatGptTurnUsesSavedChat(undefined, { localToolsEnabled: false })).toBe(false);
  expect(chatGptTurnUsesSavedChat(false, { localToolsEnabled: true })).toBe(true);
  expect(chatGptTurnUsesSavedChat(true, { localToolsEnabled: false })).toBe(true);
});
