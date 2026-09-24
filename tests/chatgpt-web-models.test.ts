import { describe, expect, test } from "bun:test";
import { chatGptConversationKey } from "../src/adapters/chatgpt-web/conversation-key";
import {
  availableChatGptWebModelRoutes,
  CHATGPT_WEB_BACKEND_MODEL,
  CHATGPT_WEB_LUNA_BACKEND_MODEL,
  CHATGPT_WEB_LUNA_MODEL_ROUTE,
  CHATGPT_WEB_LUNA_MODEL_ROUTES,
  CHATGPT_WEB_LUNA_THINK_MODEL_ROUTE,
  CHATGPT_WEB_ZERO_RISK_BACKEND_MODEL,
  CHATGPT_WEB_ZERO_RISK_CONTEXT_WINDOW,
  CHATGPT_WEB_ZERO_RISK_MODEL_ROUTE,
  CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL,
  CHATGPT_WEB_ZERO_RISK_PRO_MODEL_ROUTE,
  CHATGPT_WEB_MODEL_ROUTES,
  CHATGPT_WEB_NAMED_MODEL_ROUTES,
  CHATGPT_WEB_PRO_REASONING_COMPOSER_CHAR_LIMIT,
  chatGptWebRouteEfforts,
  requireChatGptWebModelRoute,
  resolveChatGptWebContextLimits,
  resolveChatGptWebTransportLimits,
} from "../src/chatgpt-web-models";
import { defaultConfig } from "../src/config";
import { routeChatGptWebRequest } from "../src/server";
import type { CodexParsedRequest } from "../src/types";

function parsed(modelId: string, reasoning = "medium"): CodexParsedRequest {
  return {
    modelId,
    context: { messages: [] },
    stream: false,
    options: { reasoning },
    _rawBody: { model: modelId, reasoning: { effort: reasoning } },
  };
}

describe("fixed ChatGPT Web model routes", () => {
  const plus = { solAvailable: true, proAvailable: false };
  const pro = { solAvailable: true, proAvailable: true };

  test("independent Extra High capability exposes its route and limits without admitting Pro", () => {
    const fourPositions = { solAvailable: true, extraHighAvailable: true, proAvailable: false };
    expect(availableChatGptWebModelRoutes(fourPositions).map(route => route.slug)).toEqual([
      "chatgpt-web/light", "chatgpt-web/medium", "chatgpt-web/high", "chatgpt-web/extra-high",
      "chatgpt-web/gpt-5.6-sol-instant", "chatgpt-web/gpt-5.6-sol",
    ]);
    expect(requireChatGptWebModelRoute("chatgpt-web/extra-high", fourPositions).adapterEffort).toBe("xhigh");
    expect(() => requireChatGptWebModelRoute("chatgpt-web/pro", fourPositions)).toThrow("Pro is not available");
    expect(resolveChatGptWebContextLimits(CHATGPT_WEB_BACKEND_MODEL, "xhigh", fourPositions)).toEqual({
      contextWindow: 90_000,
      effectiveContextWindowPercent: 89,
      autoCompactTokenLimit: 80_000,
    });
    expect(resolveChatGptWebTransportLimits(CHATGPT_WEB_BACKEND_MODEL, "xhigh", fourPositions)).toEqual({
      browserComposerCharLimit: 1_048_572,
    });
    expect(() => requireChatGptWebModelRoute("chatgpt-web/extra-high", { ...fourPositions, extraHighAvailable: false }))
      .toThrow("Extra High is not available");
  });

  test("uses unique stable slugs and one explicit adapter effort per model", () => {
    expect(new Set(CHATGPT_WEB_MODEL_ROUTES.map(route => route.slug)).size).toBe(CHATGPT_WEB_MODEL_ROUTES.length);
    expect(CHATGPT_WEB_MODEL_ROUTES.map(route => [route.slug, route.codexEffort, route.adapterEffort])).toEqual([
      ["chatgpt-web/light", "low", "low"],
      ["chatgpt-web/medium", "medium", "medium"],
      ["chatgpt-web/high", "high", "high"],
      ["chatgpt-web/extra-high", "xhigh", "xhigh"],
      ["chatgpt-web/pro", "ultra", "max"],
    ]);
    expect(CHATGPT_WEB_MODEL_ROUTES[0]?.displayName).toBe("ChatGPT Web — Instant");
  });

  test("exposes only Plus-eligible routes without the Pro account capability", () => {
    expect(availableChatGptWebModelRoutes(plus).map(route => route.slug)).toEqual([
      "chatgpt-web/light",
      "chatgpt-web/medium",
      "chatgpt-web/high",
      "chatgpt-web/gpt-5.6-sol-instant",
      "chatgpt-web/gpt-5.6-sol",
    ]);
    expect(availableChatGptWebModelRoutes({ solAvailable: true, proAvailable: true }))
      .toEqual([...CHATGPT_WEB_MODEL_ROUTES, ...CHATGPT_WEB_NAMED_MODEL_ROUTES.slice(0, 4)]);
    expect(() => requireChatGptWebModelRoute("chatgpt-web/extra-high", plus))
      .toThrow("Extra High is not available for this account");
    expect(() => requireChatGptWebModelRoute("chatgpt-web/pro", plus))
      .toThrow("Pro is not available for this account");
  });

  test("exposes Luna and Think when the authenticated account has no Sol selector", () => {
    const free = { solAvailable: false, proAvailable: false };
    expect(availableChatGptWebModelRoutes(free)).toEqual([
      ...CHATGPT_WEB_LUNA_MODEL_ROUTES, CHATGPT_WEB_NAMED_MODEL_ROUTES[4],
    ]);
    expect(requireChatGptWebModelRoute("chatgpt-web/luna", free).backendModel)
      .toBe(CHATGPT_WEB_LUNA_BACKEND_MODEL);
    expect(requireChatGptWebModelRoute("chatgpt-web/think", free))
      .toBe(CHATGPT_WEB_LUNA_THINK_MODEL_ROUTE);
    expect(() => requireChatGptWebModelRoute("chatgpt-web/light", free))
      .toThrow("Luna-only account");
    expect(() => requireChatGptWebModelRoute("chatgpt-web/luna", {
      solAvailable: true,
      proAvailable: false,
    })).toThrow("only available for Luna-only accounts");
  });

  test("Manual mode exposes one generic route independent of account capabilities", () => {
    const manual = {
      solAvailable: false,
      proAvailable: false,
      browserInteractionMode: "manual" as const,
    };
    expect(availableChatGptWebModelRoutes(manual)).toEqual([CHATGPT_WEB_ZERO_RISK_MODEL_ROUTE]);
    expect(requireChatGptWebModelRoute("chatgpt-web/zero-risk", manual))
      .toBe(CHATGPT_WEB_ZERO_RISK_MODEL_ROUTE);
    expect(() => requireChatGptWebModelRoute("chatgpt-web/zero-risk-pro", manual))
      .toThrow("not enabled in Manual model settings");
    const manualPro = { ...manual, zeroRiskProEnabled: true };
    expect(availableChatGptWebModelRoutes(manualPro)).toEqual([
      CHATGPT_WEB_ZERO_RISK_MODEL_ROUTE,
      CHATGPT_WEB_ZERO_RISK_PRO_MODEL_ROUTE,
    ]);
    expect(requireChatGptWebModelRoute("chatgpt-web/zero-risk-pro", manualPro))
      .toBe(CHATGPT_WEB_ZERO_RISK_PRO_MODEL_ROUTE);
    expect(() => requireChatGptWebModelRoute("chatgpt-web/luna", manual))
      .toThrow("not available while Manual mode is enabled");
    expect(() => requireChatGptWebModelRoute("chatgpt-web/zero-risk", plus))
      .toThrow("only available while Manual mode is enabled");
  });

  test("named Web identities resolve selectable efforts while old task identities stay fixed", () => {
    const sol = "chatgpt-web/gpt-5.6-sol";
    const luna = "chatgpt-web/gpt-5.6-luna";
    const fourPositions = { ...plus, extraHighAvailable: true };
    expect(CHATGPT_WEB_NAMED_MODEL_ROUTES.map(route => route.slug)).toEqual([
      "chatgpt-web/gpt-5.6-sol-instant", sol,
      "chatgpt-web/gpt-5.6-pro", "chatgpt-web/gpt-6-pro", luna,
    ]);
    expect(chatGptWebRouteEfforts(requireChatGptWebModelRoute(sol, plus), plus))
      .toEqual(["medium", "high"]);
    expect(chatGptWebRouteEfforts(requireChatGptWebModelRoute(sol, fourPositions), fourPositions))
      .toEqual(["medium", "high", "xhigh"]);
    expect(requireChatGptWebModelRoute(sol, fourPositions, "medium")).toMatchObject({
      slug: sol, modelFamily: "5.6", codexEffort: "medium", adapterEffort: "medium",
    });
    expect(requireChatGptWebModelRoute(sol, fourPositions, "xhigh")).toMatchObject({
      codexEffort: "xhigh", adapterEffort: "xhigh",
    });
    expect(() => requireChatGptWebModelRoute(sol, plus, "xhigh")).toThrow("does not support effort");
    expect(() => requireChatGptWebModelRoute(sol, fourPositions, "low")).toThrow("does not support effort");
    expect(() => requireChatGptWebModelRoute("chatgpt-web/gpt-5.6-sol-instant", plus, "high"))
      .toThrow("does not support effort");
    expect(requireChatGptWebModelRoute("chatgpt-web/gpt-6-pro", pro, "max")).toMatchObject({
      modelFamily: "6", adapterEffort: "max",
    });
    expect(() => requireChatGptWebModelRoute("chatgpt-web/gpt-5.6-pro", plus, "max"))
      .toThrow("not available for this account");
    expect(() => requireChatGptWebModelRoute("chatgpt-web/gpt-6-pro", pro, "ultra"))
      .toThrow("does not support effort");

    const free = { solAvailable: false, proAvailable: false };
    expect(requireChatGptWebModelRoute(luna, free, "medium")).toMatchObject({
      backendModel: CHATGPT_WEB_LUNA_BACKEND_MODEL, codexEffort: "medium", adapterEffort: "medium",
    });
    expect(() => requireChatGptWebModelRoute(luna, free, "high")).toThrow("does not support effort");
    expect(() => requireChatGptWebModelRoute(luna, plus, "low"))
      .toThrow("only available for Luna-only accounts");

    expect(requireChatGptWebModelRoute("chatgpt-web/high", plus, "low"))
      .toBe(CHATGPT_WEB_MODEL_ROUTES.find(route => route.slug === "chatgpt-web/high")!);
    expect(requireChatGptWebModelRoute("chatgpt-web/think", free, "high"))
      .toBe(CHATGPT_WEB_LUNA_THINK_MODEL_ROUTE);
  });

  test("Manual mode always publishes its fixed three-turn compaction interval and rejects multipart Bigger Context", () => {
    const manual = {
      solAvailable: true,
      proAvailable: true,
      browserInteractionMode: "manual" as const,
    };
    expect(resolveChatGptWebContextLimits(CHATGPT_WEB_ZERO_RISK_BACKEND_MODEL, "low", manual)).toEqual({
      contextWindow: 123_000,
      effectiveContextWindowPercent: 78,
      autoCompactTokenLimit: 96_000,
    });
    expect(resolveChatGptWebTransportLimits(CHATGPT_WEB_ZERO_RISK_BACKEND_MODEL, "low", manual)).toEqual({});
    expect(resolveChatGptWebContextLimits(CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL, "low", manual)).toEqual({
      contextWindow: 336_579,
      effectiveContextWindowPercent: 85,
      autoCompactTokenLimit: 285_000,
    });
    expect(resolveChatGptWebTransportLimits(CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL, "low", manual)).toEqual({});
    expect(() => availableChatGptWebModelRoutes({
      ...manual,
      experimentalBiggerContext: true,
    })).toThrow("does not support Bigger Context");
  });

  test("publishes measured Plus browser windows and compacts before the transport ceiling", () => {
    expect(resolveChatGptWebContextLimits(CHATGPT_WEB_BACKEND_MODEL, "low", plus)).toEqual({
      contextWindow: 41_000,
      effectiveContextWindowPercent: 78,
      autoCompactTokenLimit: 32_000,
    });
    expect(resolveChatGptWebContextLimits(CHATGPT_WEB_BACKEND_MODEL, "medium", plus)).toEqual({
      contextWindow: 90_000,
      effectiveContextWindowPercent: 89,
      autoCompactTokenLimit: 80_000,
    });
    expect(resolveChatGptWebContextLimits(CHATGPT_WEB_BACKEND_MODEL, "high", plus)).toEqual({
      contextWindow: 90_000,
      effectiveContextWindowPercent: 89,
      autoCompactTokenLimit: 80_000,
    });
    expect(resolveChatGptWebTransportLimits(CHATGPT_WEB_BACKEND_MODEL, "low", plus)).toEqual({
      browserComposerCharLimit: 211_256,
    });
    expect(resolveChatGptWebTransportLimits(CHATGPT_WEB_BACKEND_MODEL, "medium", plus)).toEqual({
      browserComposerCharLimit: 1_048_572,
    });
    expect(() => resolveChatGptWebContextLimits(CHATGPT_WEB_BACKEND_MODEL, "xhigh", plus))
      .toThrow("unavailable effort");
  });

  test("publishes the usable Pro browser window instead of the unreachable underlying model window", () => {
    expect(resolveChatGptWebContextLimits(CHATGPT_WEB_BACKEND_MODEL, "low", pro)).toEqual({
      contextWindow: 111_193,
      effectiveContextWindowPercent: 85,
      autoCompactTokenLimit: 95_000,
    });
    for (const effort of ["medium", "high", "xhigh"] as const) {
      expect(resolveChatGptWebContextLimits(CHATGPT_WEB_BACKEND_MODEL, effort, pro)).toEqual({
        contextWindow: 111_193,
        effectiveContextWindowPercent: 85,
        autoCompactTokenLimit: 95_000,
      });
    }
    expect(resolveChatGptWebContextLimits(CHATGPT_WEB_BACKEND_MODEL, "max", pro)).toEqual({
      contextWindow: 112_193,
      effectiveContextWindowPercent: 85,
      autoCompactTokenLimit: 95_000,
    });
    expect(resolveChatGptWebTransportLimits(CHATGPT_WEB_BACKEND_MODEL, "low", pro)).toEqual({
      browserMessageTokenLimit: 103_000,
      browserComposerCharLimit: 545_000,
    });
    for (const effort of ["medium", "high", "xhigh"] as const) {
      expect(resolveChatGptWebTransportLimits(CHATGPT_WEB_BACKEND_MODEL, effort, pro)).toEqual({
        browserMessageTokenLimit: 103_000,
        browserComposerCharLimit: CHATGPT_WEB_PRO_REASONING_COMPOSER_CHAR_LIMIT,
      });
    }
    expect(resolveChatGptWebTransportLimits(CHATGPT_WEB_BACKEND_MODEL, "max", pro)).toEqual({
      browserMessageTokenLimit: 104_000,
      browserComposerCharLimit: 1_635_000,
    });
  });

  test("publishes Luna's real model window without early native compaction", () => {
    expect(resolveChatGptWebContextLimits(CHATGPT_WEB_LUNA_BACKEND_MODEL, "low", {
      solAvailable: false,
      proAvailable: false,
    })).toEqual({
      contextWindow: 1_050_000,
      effectiveContextWindowPercent: 100,
      autoCompactTokenLimit: 1_050_000,
    });
  });

  test("triples Sol context and compaction limits only when Bigger Context is enabled", () => {
    expect(resolveChatGptWebContextLimits(CHATGPT_WEB_BACKEND_MODEL, "max", {
      ...pro,
      experimentalBiggerContext: true,
    })).toEqual({
      contextWindow: 336_579,
      effectiveContextWindowPercent: 85,
      autoCompactTokenLimit: 285_000,
    });
    expect(resolveChatGptWebContextLimits(CHATGPT_WEB_LUNA_BACKEND_MODEL, "low", {
      solAvailable: false,
      proAvailable: false,
      experimentalBiggerContext: true,
    })).toEqual({
      contextWindow: 1_050_000,
      effectiveContextWindowPercent: 100,
      autoCompactTokenLimit: 1_050_000,
    });
  });

  test("binds the selected model authoritatively and ignores a conflicting request effort", () => {
    const request = parsed("chatgpt-web/high", "low");
    const rawSnapshot = structuredClone(request._rawBody);
    const route = routeChatGptWebRequest(request, defaultConfig("browser-only"));

    expect(route.slug).toBe("chatgpt-web/high");
    expect(request.modelId).toBe(CHATGPT_WEB_BACKEND_MODEL);
    expect(request.options.reasoning).toBe("high");
    expect(request._rawBody).toEqual(rawSnapshot);
  });

  test("routes named efforts and family without mutating the client payload", () => {
    const config = defaultConfig("full");
    config.extraHighAvailable = true;
    config.proAvailable = true;
    const solRequest = parsed("chatgpt-web/gpt-5.6-sol", "medium");
    const rawSnapshot = structuredClone(solRequest._rawBody);
    expect(routeChatGptWebRequest(solRequest, config)).toMatchObject({
      modelFamily: "5.6", codexEffort: "medium", adapterEffort: "medium",
    });
    expect(solRequest.modelId).toBe(CHATGPT_WEB_BACKEND_MODEL);
    expect(solRequest.options.reasoning).toBe("medium");
    expect(solRequest._chatgptModelFamily).toBe("5.6");
    expect(solRequest._rawBody).toEqual(rawSnapshot);

    const proRequest = parsed("chatgpt-web/gpt-6-pro", "max");
    expect(routeChatGptWebRequest(proRequest, config)).toMatchObject({
      modelFamily: "6", adapterEffort: "max",
    });
    expect(proRequest.options.reasoning).toBe("max");
    expect(proRequest._chatgptModelFamily).toBe("6");
    expect(() => routeChatGptWebRequest(parsed("chatgpt-web/gpt-5.6-sol", "low"), config))
      .toThrow("does not support effort");
  });

  test("binds the Pro model to the browser Pro effort and fails closed for unknown routes", () => {
    const config = defaultConfig("full");
    config.proAvailable = true;
    config.extraHighAvailable = true;
    const request = parsed("chatgpt-web/pro", "low");
    expect(routeChatGptWebRequest(request, config).adapterEffort).toBe("max");
    expect(request.options.reasoning).toBe("max");
    expect(() => routeChatGptWebRequest(parsed("chatgpt-web/not-enabled"), config))
      .toThrow("model is not enabled");
  });

  test("keeps Pro compaction on the same retained Pro conversation", () => {
    const config = defaultConfig("full");
    config.proAvailable = true;
    config.extraHighAvailable = true;
    const normal = parsed("chatgpt-web/pro", "low");
    const compact = parsed("chatgpt-web/pro", "low");
    const metadata = {
      "x-codex-turn-metadata": JSON.stringify({ thread_id: "thread_pro_compaction" }),
    };
    normal._rawBody = {
      model: "chatgpt-web/pro",
      reasoning: { effort: "low" },
      client_metadata: metadata,
    };
    compact._rawBody = structuredClone(normal._rawBody);
    compact._compactionRequest = true;

    expect(routeChatGptWebRequest(normal, config).slug).toBe("chatgpt-web/pro");
    expect(normal.options.reasoning).toBe("max");
    expect(routeChatGptWebRequest(compact, config).slug).toBe("chatgpt-web/pro");
    expect(compact.options.reasoning).toBe("max");
    expect(chatGptConversationKey(compact, "provider"))
      .toBe(chatGptConversationKey(normal, "provider"));
  });

  test("binds the Luna route to Luna without a selectable effort", () => {
    const config = defaultConfig("browser-only");
    config.solAvailable = false;
    const request = parsed("chatgpt-web/luna", "high");
    const route = routeChatGptWebRequest(request, config);
    expect(route).toBe(CHATGPT_WEB_LUNA_MODEL_ROUTE);
    expect(request.modelId).toBe(CHATGPT_WEB_LUNA_BACKEND_MODEL);
    expect(request.options.reasoning).toBe("low");
  });

  test("binds the Think route to the Luna backend with explicit Think mode", () => {
    const config = defaultConfig("browser-only");
    config.solAvailable = false;
    const request = parsed("chatgpt-web/think", "high");
    const route = routeChatGptWebRequest(request, config);
    expect(route).toBe(CHATGPT_WEB_LUNA_THINK_MODEL_ROUTE);
    expect(request.modelId).toBe(CHATGPT_WEB_LUNA_BACKEND_MODEL);
    expect(request.options.reasoning).toBe("medium");
  });

  test("Manual mode routing preserves its internal backend identity and only a technical Codex effort", () => {
    const config = defaultConfig("full");
    config.browserInteractionMode = "manual";
    const request = parsed("chatgpt-web/zero-risk", "ultra");
    const route = routeChatGptWebRequest(request, config);

    expect(route).toBe(CHATGPT_WEB_ZERO_RISK_MODEL_ROUTE);
    expect(request.modelId).toBe(CHATGPT_WEB_ZERO_RISK_BACKEND_MODEL);
    expect(request.options.reasoning).toBe("low");

    config.zeroRiskProEnabled = true;
    const proRequest = parsed("chatgpt-web/zero-risk-pro", "ultra");
    const proRoute = routeChatGptWebRequest(proRequest, config);
    expect(proRoute).toBe(CHATGPT_WEB_ZERO_RISK_PRO_MODEL_ROUTE);
    expect(proRequest.modelId).toBe(CHATGPT_WEB_ZERO_RISK_PRO_BACKEND_MODEL);
    expect(proRequest.options.reasoning).toBe("low");
  });
});
