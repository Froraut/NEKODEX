/** Only authenticated in-process producers can assign this context. Never parse it from a body. */
export interface ExternalClientContext {
  producer: "hermes" | "claude" | "api";
  threadId: string;
  turnId: string;
  root: string;
}

export function externalClientContext(parsed: {
  _clientContext?: ExternalClientContext;
  _hermesContext?: Omit<ExternalClientContext, "producer">;
}): ExternalClientContext | undefined {
  return parsed._clientContext ?? (parsed._hermesContext ? { ...parsed._hermesContext, producer: "hermes" } : undefined);
}

export function externalClientLabel(context: ExternalClientContext): string {
  return context.producer === "hermes" ? "Hermes" : context.producer === "claude" ? "Claude Code" : "the API client";
}
