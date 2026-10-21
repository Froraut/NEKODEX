import { readJsonRequestBody } from "../http-body";
import type { BrowserCompanionRuntime } from "./runtime";

/** Mount behind the existing local HTTP authority + admin control-token guard. This endpoint
 * configures a local listener and the explicit ChatGPT tab binding; it grants no page input
 * and never sends a message itself: the existing ChatGPT worker remains the only sender. */
export async function browserCompanionRequest(request: Request, getRuntime: () => BrowserCompanionRuntime): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  if (request.method !== "POST") return Response.json({ ok: false, error: "Companion control requires JSON POST" }, { status: 405, headers });
  try {
    const body = await readJsonRequestBody(request, 4096, 4096) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string" || Object.keys(body).some(key => !["action", "extensionId", "extensionOrigin", "chatgpt", "operationId"].includes(key))) throw new Error("Invalid companion control request");
    const runtime = getRuntime();
    let value: unknown;
    switch (body.action) {
      case "status": value = runtime.status(); break;
      case "enable": value = await runtime.enable(body.extensionId, body.extensionOrigin); break;
      case "disable": value = await runtime.disable(); break;
      case "create-pairing": value = runtime.createPairing(); break;
      case "revoke": value = runtime.revoke(); break;
      // Explicit user binding of the selected chatgpt.com document and its visible model selection.
      case "bind-chatgpt": value = await runtime.bindChatGpt(body.chatgpt); break;
      case "unbind-chatgpt": value = runtime.unbindChatGpt(); break;
      case "release-chatgpt-held": value = runtime.releaseChatGptHeld(body.operationId); break;
      default: throw new Error("Unknown companion control action");
    }
    return Response.json({ ok: true, value }, { headers });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof SyntaxError || (error instanceof Error && ["ZodError", "NativeRequestBodyError"].includes(error.name)) ? "Invalid companion control request" : error instanceof Error ? error.message.slice(0, 240) : "Companion control failed" }, { status: 400, headers });
  }
}
