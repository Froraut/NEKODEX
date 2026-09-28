import { createHash } from "node:crypto";
import { join } from "node:path";
import { getConfigDir } from "./config";
import { CHATGPT_WEB_NAMED_MODEL_ROUTES, CHATGPT_WEB_SAVED_TASK_MODEL_ROUTES, isDiscoveredChatGptWebModelSlug } from "./chatgpt-web-models";
import type { ExternalClientContext } from "./external-client-context";

type Obj = Record<string, any>;
const object = (value: unknown): value is Obj => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function argumentReceipt(value: unknown): string {
  if (typeof value !== "string") throw new Error("External client tool arguments must be JSON text.");
  try { return digest(canonical(JSON.parse(value))); }
  catch { throw new Error("External client tool arguments must be valid JSON."); }
}
type Session = { turn: string; active: boolean; touched: number; pending: Map<string, { name: string; arguments: string }>;
  issued: Set<string>; lastRequest?: string; toolContract?: string };
const CLIENT_WEB_MODEL_IDS = new Set([...CHATGPT_WEB_SAVED_TASK_MODEL_ROUTES, ...CHATGPT_WEB_NAMED_MODEL_ROUTES].map(route => route.slug));

/** One owner for authenticated external-client turn identity and issued tool-result receipts. */
export class ClientTurns {
  private sessions = new Map<string, Session>();
  private readonly home = getConfigDir();
  constructor(private readonly producer: ExternalClientContext["producer"]) {}
  prepare(raw: unknown): { body: Obj; context: ExternalClientContext; complete: (value: Obj) => void; release: () => void } {
    if (!object(raw) || typeof raw.prompt_cache_key !== "string" || !raw.prompt_cache_key.trim()
      || raw.prompt_cache_key.length > 256) throw new Error("External client must supply its session-scoped prompt_cache_key. Update External client and start a new session.");
    // Discovered model IDs follow the account's picker; route resolution checks current availability.
    if (typeof raw.model !== "string" || !(CLIENT_WEB_MODEL_IDS.has(raw.model) || isDiscoveredChatGptWebModelSlug(raw.model))) {
      throw new Error("Choose a ChatGPT Web model from the External client provider; native/API models are not forwarded.");
    }
    if (raw.previous_response_id || raw.context_management || raw.client_metadata) {
      throw new Error("External client must send full history without native Codex metadata or native compaction controls.");
    }
    const tools = raw.tools ?? [];
    if (!Array.isArray(tools) || tools.length > 512 || tools.some(tool => !object(tool)
      || tool.type !== "function" || typeof tool.name !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(tool.name)
      || !object(tool.parameters)) || new Set(tools.map(tool => tool.name)).size !== tools.length) {
      throw new Error("External client tools must be distinct structured function declarations.");
    }
    let input: Obj[] = typeof raw.input === "string" ? [{ type: "message", role: "user", content: raw.input }] : raw.input;
    if (!Array.isArray(input) || input.length > 10000 || input.some(item => !object(item))) throw new Error("External client input must be a bounded Responses history.");
    // Drop private item identity from other providers; this endpoint owns its lifecycle.
    input = input.map(item => {
      if (!object(item)) throw new Error("Invalid External client input item");
      if (!['message', 'function_call', 'function_call_output', 'reasoning'].includes(item.type ?? "message")) {
        throw new Error("Unsupported External client history item; start a fresh session on this provider.");
      }
      const { internal_chat_message_metadata_passthrough: _meta, ...copy } = item;
      if (!copy.type) copy.type = "message";
      return copy;
    });
    const lastUser = input.findLastIndex(item => item.type === "message" && item.role === "user");
    if (lastUser < 0) throw new Error("External client request requires a user instruction.");
    const threadId = `${this.producer}_${digest([raw.prompt_cache_key, raw.model])}`;
    const turnId = `${this.producer}_${digest(input.slice(0, lastUser + 1))}`;
    const requestHash = digest([input, tools, raw.instructions]);
    const now = Date.now();
    for (const [key, state] of this.sessions) {
      if (!state.active && now - state.touched > 30 * 60_000) this.sessions.delete(key);
    }
    let state = this.sessions.get(threadId);
    if (state?.active) throw new Error("This External client conversation already has a running request.");
    const suffix = input.slice(lastUser + 1);
    const results = suffix.filter(item => item.type === "function_call_output");
    if (!state || state.turn !== turnId) {
      if (results.length) throw new Error("External client tool continuation expired or belongs to another turn. Start a new user turn.");
      if (!state && this.sessions.size >= 256) throw new Error("External client session limit reached; wait for idle sessions to expire.");
      state = { turn: turnId, active: false, touched: now, pending: new Map(), issued: new Set() };
      this.sessions.set(threadId, state);
    } else if (state.pending.size && state.lastRequest !== requestHash) {
      if (state.toolContract !== digest(canonical(tools))) throw new Error("External client tool declarations changed during a pending tool turn.");
      const pendingResults = results.filter(item => state!.pending.has(item.call_id));
      if (pendingResults.length !== state.pending.size || new Set(pendingResults.map(item => item.call_id)).size !== state.pending.size) {
        throw new Error("External client must return each pending tool result exactly once before continuing.");
      }
      for (const [id, call] of state.pending) {
        if (suffix.filter(item => item.type === "function_call" && item.call_id === id).length !== 1
          || !suffix.some(item => item.type === "function_call" && item.call_id === id
            && item.name === call.name && argumentReceipt(item.arguments) === call.arguments)) {
          throw new Error("External client continuation does not match the issued tool call.");
        }
      }
    }
    if (results.some(item => !state!.issued.has(item.call_id)) || new Set(results.map(item => item.call_id)).size !== results.length) {
      throw new Error("External client returned an unknown or duplicate tool result.");
    }
    state.active = true;
    state.touched = now;
    const current = state;
    const body = { ...raw, store: false, input: input.map((item, index) => item.type === "message" && item.role === "user"
      ? { ...item, id: `${this.producer}_msg_${digest([index, item.content])}` } : item) };
    return {
      body,
      context: { producer: this.producer, threadId, turnId, root: join(this.home, this.producer) },
      complete: value => {
        if (value.status !== "completed") return;
        current.pending = new Map((Array.isArray(value.output) ? value.output : [])
          .filter(item => item.type === "function_call").map(item => [item.call_id, { name: item.name, arguments: argumentReceipt(item.arguments) }]));
        for (const id of current.pending.keys()) current.issued.add(id);
        current.lastRequest = requestHash;
        current.toolContract = digest(canonical(tools));
      },
      release: () => { current.active = false; current.touched = Date.now(); },
    };
  }

}
