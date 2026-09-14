import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir, type AppConfig } from "./config";
import { availableChatGptWebModelRoutes, CHATGPT_WEB_BACKEND_MODEL, resolveChatGptWebContextLimits, resolveChatGptWebMessageTokenBudget } from "./chatgpt-web-models";
import { readRequestBodyBytes } from "./http-body";
import { formatErrorResponse } from "./bridge";
import type { CodexParsedRequest } from "./types";

type Obj = Record<string, any>;
const object = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export type HermesContext = NonNullable<CodexParsedRequest["_hermesContext"]>;
type Session = { turn: string; active: boolean; touched: number; pending: Map<string, string>; issued: Set<string>; lastRequest?: string };

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
  private sessions = new Map<string, Session>();
  constructor(private readonly home = getConfigDir()) {}

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

  prepare(raw: unknown): { body: Obj; context: HermesContext; complete: (value: Obj) => void; release: () => void } {
    if (!object(raw) || typeof raw.prompt_cache_key !== "string" || !raw.prompt_cache_key.trim()
      || raw.prompt_cache_key.length > 256) throw new Error("Hermes must supply its session-scoped prompt_cache_key. Update Hermes and start a new session.");
    if (typeof raw.model !== "string" || !/^chatgpt-web\/(light|medium|high|extra-high|pro|luna|think)$/.test(raw.model)) {
      throw new Error("Choose a ChatGPT Web model from the Hermes provider; native/API models are not forwarded.");
    }
    if (raw.previous_response_id || raw.context_management || raw.client_metadata) {
      throw new Error("Hermes must send full history without native Codex metadata or native compaction controls.");
    }
    const tools = raw.tools ?? [];
    if (!Array.isArray(tools) || tools.length > 512 || tools.some(tool => !object(tool)
      || tool.type !== "function" || typeof tool.name !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(tool.name)
      || !object(tool.parameters)) || new Set(tools.map(tool => tool.name)).size !== tools.length) {
      throw new Error("Hermes tools must be distinct structured function declarations.");
    }
    let input: Obj[] = typeof raw.input === "string" ? [{ type: "message", role: "user", content: raw.input }] : raw.input;
    if (!Array.isArray(input) || input.length > 10000 || input.some(item => !object(item))) throw new Error("Hermes input must be a bounded Responses history.");
    // Drop private item identity from other providers; this endpoint owns its lifecycle.
    input = input.map(item => {
      if (!object(item)) throw new Error("Invalid Hermes input item");
      if (!['message', 'function_call', 'function_call_output', 'reasoning'].includes(item.type ?? "message")) {
        throw new Error("Unsupported Hermes history item; start a fresh session on this provider.");
      }
      const { internal_chat_message_metadata_passthrough: _meta, ...copy } = item;
      if (!copy.type) copy.type = "message";
      return copy;
    });
    const lastUser = input.findLastIndex(item => item.type === "message" && item.role === "user");
    if (lastUser < 0) throw new Error("Hermes request requires a user instruction.");
    const threadId = `hermes_${digest([raw.prompt_cache_key, raw.model])}`;
    const turnId = `hermes_${digest(input.slice(0, lastUser + 1))}`;
    const requestHash = digest([input, tools, raw.instructions]);
    const now = Date.now();
    for (const [key, state] of this.sessions) {
      if (!state.active && now - state.touched > 30 * 60_000) this.sessions.delete(key);
    }
    let state = this.sessions.get(threadId);
    if (state?.active) throw new Error("This Hermes conversation already has a running request.");
    const suffix = input.slice(lastUser + 1);
    const results = suffix.filter(item => item.type === "function_call_output");
    if (!state || state.turn !== turnId) {
      if (results.length) throw new Error("Hermes tool continuation expired or belongs to another turn. Start a new user turn.");
      if (!state && this.sessions.size >= 256) throw new Error("Hermes session limit reached; wait for idle sessions to expire.");
      state = { turn: turnId, active: false, touched: now, pending: new Map(), issued: new Set() };
      this.sessions.set(threadId, state);
    } else if (state.pending.size && state.lastRequest !== requestHash) {
      const pendingResults = results.filter(item => state!.pending.has(item.call_id));
      if (pendingResults.length !== state.pending.size || new Set(pendingResults.map(item => item.call_id)).size !== state.pending.size) {
        throw new Error("Hermes must return each pending tool result exactly once before continuing.");
      }
      for (const [id, name] of state.pending) {
        if (!suffix.some(item => item.type === "function_call" && item.call_id === id && item.name === name)) {
          throw new Error("Hermes continuation does not match the issued tool call.");
        }
      }
    }
    if (results.some(item => !state!.issued.has(item.call_id)) || new Set(results.map(item => item.call_id)).size !== results.length) {
      throw new Error("Hermes returned an unknown or duplicate tool result.");
    }
    state.active = true;
    state.touched = now;
    const current = state;
    const body = { ...raw, store: false, input: input.map((item, index) => item.type === "message" && item.role === "user"
      ? { ...item, id: `hermes_msg_${digest([index, item.content])}` } : item) };
    return {
      body,
      context: { threadId, turnId, root: join(this.home, "hermes") },
      complete: value => {
        if (value.status !== "completed") return;
        current.pending = new Map((Array.isArray(value.output) ? value.output : [])
          .filter(item => item.type === "function_call").map(item => [item.call_id, item.name]));
        for (const id of current.pending.keys()) current.issued.add(id);
        current.lastRequest = requestHash;
      },
      release: () => { current.active = false; current.touched = Date.now(); },
    };
  }

  async respond(req: Request, config: AppConfig, run: (req: Request, context: HermesContext, complete: (value: Obj) => void) => Promise<Response>): Promise<Response> {
    let prepared: ReturnType<HermesIntegration["prepare"]> | undefined;
    try {
      if (req.headers.get("content-encoding") && req.headers.get("content-encoding") !== "identity") throw new Error("Hermes requests must use uncompressed JSON.");
      const raw = JSON.parse(new TextDecoder().decode(await readRequestBodyBytes(req, 4 * 1024 * 1024)));
      if (!hermesModels(config).some(model => model.id === raw?.model)) throw new Error("This Web model does not provide the minimum 64k context required by Hermes. Choose a model from this provider's current catalog.");
      prepared = this.prepare(raw);
      if (prepared.body.tools?.length && config.mode !== "full") throw new Error("Finish ChatGPT MCP setup in Codex Web GPT before using Hermes tools.");
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
