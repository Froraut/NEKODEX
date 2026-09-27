import { ClientTurns } from "./client-turns";
import { timingSafeEqual } from "node:crypto";
import { readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir, type AppConfig } from "./config";
import { availableChatGptWebModelRoutes, CHATGPT_WEB_BACKEND_MODEL, resolveChatGptWebContextLimits, resolveChatGptWebMessageTokenBudget } from "./chatgpt-web-models";
import { readRequestBodyBytes } from "./http-body";
import { formatErrorResponse } from "./bridge";
import type { CodexParsedRequest } from "./types";

type Obj = Record<string, any>;
const object = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
export type HermesContext = NonNullable<CodexParsedRequest["_hermesContext"]>;


export function hermesModels(config: AppConfig) {
  // Hermes refuses windows below 64k. Use the real ordinary-message budget, not Bigger Context
  // or Luna's underlying model window (whose browser envelope is much smaller).
  const capabilities = { ...config, experimentalBiggerContext: false };
  return availableChatGptWebModelRoutes(config).flatMap(route => {
    if (route.interactionMode !== "automatic" || route.backendModel !== CHATGPT_WEB_BACKEND_MODEL) return [];
    const context = Math.min(
      resolveChatGptWebContextLimits(route.backendModel, route.adapterEffort, capabilities).autoCompactTokenLimit,
      resolveChatGptWebMessageTokenBudget(route.backendModel, route.adapterEffort, capabilities),
    );
    return context < 64_000 ? [] : [{ id: route.slug, object: "model", created: 0, owned_by: "chatgpt-web", context_length: context }];
  });
}

/** Separate authenticated producer. Never accept Codex lifecycle/filesystem claims from Hermes. */
export class HermesIntegration {
  private readonly turns = new ClientTurns("hermes");
  private readonly home = getConfigDir();

  authorized(req: Request): boolean {
    try {
      const path = join(this.home, "hermes", "provider-token");
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256
        || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) return false;
      const token = readFileSync(path, "utf8").trim();
      if (!/^[a-f0-9]{64}$/.test(token)) return false;
      const expected = Buffer.from(`Bearer ${token}`);
      const actual = Buffer.from(req.headers.get("authorization") ?? "");
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    } catch { return false; }
  }

  models(config: AppConfig): Response {
    return Response.json({ object: "list", data: hermesModels(config) });
  }

  prepare(raw: unknown): ReturnType<ClientTurns["prepare"]> { return this.turns.prepare(raw); }

  async respond(req: Request, config: AppConfig, run: (req: Request, context: HermesContext, complete: (value: Obj) => void) => Promise<Response>): Promise<Response> {
    let prepared: ReturnType<HermesIntegration["prepare"]> | undefined;
    try {
      if (req.headers.get("content-encoding") && req.headers.get("content-encoding") !== "identity") throw new Error("Hermes requests must use uncompressed JSON.");
      const raw = JSON.parse(new TextDecoder().decode(await readRequestBodyBytes(req, 4 * 1024 * 1024)));
      if (!hermesModels(config).some(model => model.id === raw?.model)) throw new Error("This Web model does not provide the minimum 64k context required by Hermes. Choose a model from this provider's current catalog.");
      prepared = this.prepare(raw);
      if (prepared.body.tools?.length && config.mode !== "full") throw new Error("Finish ChatGPT MCP setup in NEKODEX before using Hermes tools.");
      const internal = new Request("http://127.0.0.1/v1/responses", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(prepared.body), signal: req.signal,
      });
      const response = await run(internal, prepared.context, prepared.complete);
      if (!response.body) { prepared.release(); return response; }
      const reader = response.body.getReader();
      const release = prepared.release;
      return new Response(new ReadableStream({
        async pull(controller) {
          try {
            const result = await reader.read();
            if (result.done) { release(); controller.close(); } else controller.enqueue(result.value);
          } catch (error) { release(); controller.error(error); }
        },
        async cancel(reason) { try { await reader.cancel(reason); } finally { release(); } },
      }), { status: response.status, headers: response.headers });
    } catch (error) {
      prepared?.release();
      return formatErrorResponse(400, "invalid_request_error", error instanceof Error ? error.message : "Hermes request failed");
    }
  }
}
