export const ORIGIN = "http://127.0.0.1:17843";
export const extensionApi = globalThis.browser ?? globalThis.chrome;
export async function companionRequest(credentials, route, payload = {}, signal) {
  const response = await fetch(`${ORIGIN}/v1/companion/${route}`, { method: "POST", redirect: "error", cache: "no-store",
    headers: { "content-type": "application/json", ...(credentials?.token ? { authorization: `Bearer ${credentials.token}` } : {}) },
    body: JSON.stringify({ version: 1, hostId: credentials.hostId, sessionId: credentials.sessionId, ...payload }), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Local companion request failed");
  return result;
}
export async function runCompanionSession({ credentials, dispatcher, signal, say, request = companionRequest }) {
  const consumed = new Set();
  while (!signal.aborted) {
    const { commands } = await request(credentials, "poll", {}, signal);
    if (!Array.isArray(commands) || commands.length > 1) throw new Error("Invalid companion command envelope");
    for (const command of commands) {
      if (signal.aborted) return;
      if (typeof command.operationId !== "string" || consumed.has(command.operationId)) throw new Error("Operation identity already consumed; input is never replayed");
      consumed.add(command.operationId);
      const result = await dispatcher.execute(command);
      // Never let Stop cancel the receipt upload for an input that has already started.
      await request(credentials, "result", { result: { operationId: command.operationId, ...result } });
      say(result.outcome === "completed" ? `${command.kind === "observe" ? "Fresh page observed" : "Input executed"}. Waiting for the next scoped operation.` : result.reason);
      if (result.outcome !== "completed") return;
    }
  }
}
