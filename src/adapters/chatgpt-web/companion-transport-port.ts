import type { BrowserTurn } from "./browser-worker";

/**
 * The browser worker's only view of the optional browser-companion ChatGPT transport.
 * `ChatGptBrowserWorker.run` stays the single admission, registry and settlement owner.
 * Only a turn that explicitly opts in (it names the bound companion account) is a companion
 * turn; every other turn keeps the embedded path, whatever the companion state. The choice is
 * made once at admission and never falls back in either direction.
 */
export interface ChatGptCompanionTransportPort {
  /** Submit at most once and settle with the observed answer, or refuse/hold explicitly. */
  run(turn: BrowserTurn): Promise<string>;
}

/** The routing rule: an explicit per-turn opt-in, never the companion's bound/held state. */
export function isChatGptCompanionTurn(turn: Pick<BrowserTurn, "companionAccount">): boolean {
  return turn.companionAccount !== undefined;
}

let installed: ChatGptCompanionTransportPort | undefined;

/** Composition-root only. One process-local owner; returns its exact uninstaller. */
export function installChatGptCompanionTransport(port: ChatGptCompanionTransportPort): () => void {
  if (installed && installed !== port) throw new Error("Another ChatGPT companion transport is already installed");
  installed = port;
  return () => { if (installed === port) installed = undefined; };
}

export function chatGptCompanionTransport(): ChatGptCompanionTransportPort | undefined {
  return installed;
}
