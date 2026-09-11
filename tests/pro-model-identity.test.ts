import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatGptBrowserWorker, type BrowserTurn } from "../src/adapters/chatgpt-web/browser-worker";
import { chatGptWebTraceId, createChatGptWebAdapter } from "../src/adapters/chatgpt-web";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { ChatGptTextFeed, ChatGptTraceFeed, ChatGptTurnSessions, chatGptTurnSessions } from "../src/adapters/chatgpt-web/turn-execution";
import { defaultConfig, providerConfig } from "../src/config";
import { parseRequest } from "../src/responses/parser";
import { responseRequest, routeChatGptWebRequest } from "../src/server";

function requestBody(id: string) {
  return {
    model: "chatgpt-web/pro",
    stream: false,
    client_metadata: {
      "x-codex-turn-metadata": JSON.stringify({ thread_id: `thread_${id}`, turn_id: `turn_${id}` }),
    },
    input: [{
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Complete the authorized work once" }],
      internal_chat_message_metadata_passthrough: { turn_id: `turn_${id}` },
    }],
  };
}

function request(body: ReturnType<typeof requestBody>) {
  return new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("changing the Pro preference cannot restart an exact cancelled native turn", async () => {
  const config = { ...defaultConfig("browser-only"), proAvailable: true, proModelVersion: "5.6" as const };
  const body = requestBody("pro_preference_cancelled_replay");
  const parsed = parseRequest(body);
  routeChatGptWebRequest(parsed, config);
  const traceId = chatGptWebTraceId(providerConfig(config), parsed);
  let rejectBrowser!: (reason: Error) => void;
  const browser = new Promise<string>((_resolve, reject) => { rejectBrowser = reject; });
  chatGptTurnSessions.clear();
  chatGptTurnSessions.getOrCreate("pro-preference-cancelled-replay", () => ({
    mode: "read-only",
    browser,
    physicalSettlement: browser.then(() => undefined, () => undefined),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    cancel: reason => rejectBrowser(reason ?? new Error("cancelled")),
  }), traceId);

  let adapterConstructions = 0;
  try {
    expect(await chatGptTurnSessions.cancelTrace(traceId)).toBe(1);
    const factory: Parameters<typeof responseRequest>[2] = () => {
      adapterConstructions += 1;
      return {
        name: "unexpected-cancelled-replay",
        async runTurn(_parsed, _incoming, emit) {
          emit({ type: "done", stopReason: "stop", endTurn: true });
        },
      };
    };
    for (const version of ["5.6", "6", undefined] as const) {
      const result = await responseRequest(request(body), config, factory, {
        readProModelVersion: () => version,
      });
      expect(result.status).toBe(400);
      expect(await result.json()).toMatchObject({ error: { code: "client_cancelled" } });
    }
    expect(adapterConstructions).toBe(0);
  } finally {
    chatGptTurnSessions.clear();
  }
});

test("changing the Pro preference replays a completed native turn without another browser send", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-pro-replay-"));
  const config = {
    ...defaultConfig("browser-only"),
    proAvailable: true,
    proModelVersion: "5.6" as const,
    storageStatePath: join(root, "storage.json"),
    brokerSocketPath: join(root, "broker.sock"),
  };
  const body = requestBody("pro_preference_completed_replay");
  const worker = ChatGptBrowserWorker.forProvider(providerConfig(config));
  const originalRun = worker.run;
  const selectedVersions: Array<string | undefined> = [];
  worker.run = async (turn: BrowserTurn) => {
    selectedVersions.push(turn.capabilities.proModelVersion);
    turn.onTextDelta("The authorized work was completed once");
    return "The authorized work was completed once";
  };
  chatGptTurnSessions.clear();
  try {
    const outputs: unknown[] = [];
    for (const version of ["5.6", "6", undefined] as const) {
      const result = await responseRequest(request(body), config, createChatGptWebAdapter, {
        readProModelVersion: () => version,
      });
      expect(result.status).toBe(200);
      const response = await result.json() as { status: string; output: Array<Record<string, unknown>> };
      expect(response.status).toBe("completed");
      // The Responses envelope allocates new item ids while replaying the same adapter events.
      outputs.push(response.output.map(({ id: _id, ...item }) => item));
    }
    expect(outputs[1]).toEqual(outputs[0]);
    expect(outputs[2]).toEqual(outputs[0]);
    expect(selectedVersions).toEqual(["5.6"]);
  } finally {
    worker.run = originalRun;
    chatGptTurnSessions.clear();
    await TurnBroker.forSocket(config.brokerSocketPath).close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("switching Pro versions A to B to A retires stale browser history while preserving completed replay", async () => {
  const sessions = new ChatGptTurnSessions();
  const owner = "pro-version-switch-native-thread";
  const retained = new Set<string>();
  const releases: string[] = [];
  const reused: boolean[] = [];
  const start = async (key: string, conversationKey: string) => {
    const session = await sessions.getOrCreateAfterOwnerRetirement(
      key, owner,
      () => {
        reused.push(retained.has(conversationKey));
        retained.add(conversationKey);
        return {
          mode: "read-only",
          browser: Promise.resolve(`completed ${key}`),
          physicalSettlement: Promise.resolve(),
          trace: new ChatGptTraceFeed(),
          text: new ChatGptTextFeed(),
          conversationKey,
          releaseRetainedConversation: async () => {
            releases.push(conversationKey);
            retained.delete(conversationKey);
          },
          cancel: () => {},
        };
      },
      `trace-${key}`, undefined, key, owner, undefined, conversationKey,
    );
    await session.browserOutcome;
    await session.physicalSettlement;
    return session;
  };
  try {
    const first = await start("turn-1", "pro-version-5.6");
    await start("turn-2", "pro-version-6");
    const third = await start("turn-3", "pro-version-5.6");

    // The first 5.6 browser never received turn-2. Returning to 5.6 must rebuild
    // from complete history instead of handing that stale browser only turn-3.
    expect(reused).toEqual([false, false, false]);
    expect(releases).toEqual(["pro-version-5.6", "pro-version-6"]);
    expect(retained).toEqual(new Set(["pro-version-5.6"]));
    expect(first.conversationKey()).toBeUndefined();
    expect(sessions.findConversationHead("pro-version-5.6")).toBe(third);
    expect(sessions.find("turn-1")).toBe(first);

    const replay = await sessions.getOrCreateAfterOwnerRetirement("turn-1", owner, () => {
      throw new Error("completed turn must replay after its old browser was released");
    });
    expect(replay).toBe(first);
    expect(replay.settledOutcome()).toMatchObject({ type: "final" });
  } finally {
    sessions.clear();
  }
});

test("concurrent new Pro conversations preserve one physical browser owner", async () => {
  const sessions = new ChatGptTurnSessions();
  const starts: string[] = [];
  let finishFirst!: (answer: string) => void;
  const firstBrowser = new Promise<string>(resolve => { finishFirst = resolve; });
  const start = (key: string, conversationKey: string, browser: Promise<string>) => (
    sessions.getOrCreateAfterOwnerRetirement(
      key, "same-native-thread",
      () => {
        starts.push(key);
        return {
          mode: "read-only",
          browser,
          physicalSettlement: browser.then(() => undefined),
          trace: new ChatGptTraceFeed(),
          text: new ChatGptTextFeed(),
          conversationKey,
          releaseRetainedConversation: async () => {},
          cancel: () => {},
        };
      },
      key, undefined, key, "same-native-thread", undefined, conversationKey,
    )
  );
  const first = start("first", "pro-version-5.6", firstBrowser);
  const second = start("second", "pro-version-6", Promise.resolve("second completed"));
  try {
    await Bun.sleep(0);
    expect(starts).toEqual(["first"]);
    finishFirst("first completed");
    await Promise.all([first, second]);
    expect(starts).toEqual(["first", "second"]);
  } finally {
    finishFirst("first completed");
    await Promise.all([first, second]);
    sessions.clear();
  }
});

test("failed retained-model release blocks replacement and retries before detaching history", async () => {
  const sessions = new ChatGptTurnSessions();
  let releaseAttempts = 0;
  const first = sessions.getOrCreate("release-first", () => ({
    mode: "read-only",
    browser: Promise.resolve("first completed"),
    physicalSettlement: Promise.resolve(),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    conversationKey: "old-5.6-history",
    releaseRetainedConversation: async () => {
      releaseAttempts += 1;
      if (releaseAttempts === 1) throw new Error("browser close failed");
    },
    cancel: () => {},
  }), "first-trace", "release-owner");
  await first.browserOutcome;
  await first.physicalSettlement;
  let replacements = 0;
  const replace = () => sessions.getOrCreateAfterOwnerRetirement(
    "release-second", "release-owner",
    () => {
      replacements += 1;
      return {
        mode: "read-only",
        browser: Promise.resolve("second completed"),
        physicalSettlement: Promise.resolve(),
        trace: new ChatGptTraceFeed(),
        text: new ChatGptTextFeed(),
        conversationKey: "new-6-history",
        cancel: () => {},
      };
    },
    "second-trace", undefined, "second-turn", "release-thread", undefined, "new-6-history",
  );
  try {
    await expect(replace()).rejects.toThrow("browser close failed");
    expect(replacements).toBe(0);
    expect(first.conversationKey()).toBe("old-5.6-history");
    expect(sessions.findConversationHead("old-5.6-history")).toBe(first);

    const second = await replace();
    expect(releaseAttempts).toBe(2);
    expect(replacements).toBe(1);
    expect(first.conversationKey()).toBeUndefined();
    expect(sessions.findConversationHead("old-5.6-history")).toBeUndefined();
    expect(sessions.findConversationHead("new-6-history")).toBe(second);
    expect(sessions.find("release-first")).toBe(first);
  } finally {
    sessions.clear();
  }
});
