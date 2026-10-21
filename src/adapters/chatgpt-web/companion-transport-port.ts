import type { BrowserTurn } from "./browser-worker";

/**
 * The browser worker's only view of the optional browser-companion ChatGPT transport.
 * `ChatGptBrowserWorker.run` stays the single admission, registry and settlement owner;
 * an engaged port replaces the page driver for that one turn and never falls back to the
 * embedded browser (or the reverse) after admission.
 */
export interface ChatGptCompanionTransportPort {
  /** True only while the user has explicitly bound an exact chatgpt.com document. */
  engaged(): boolean;
  /** Submit at most once and settle with the observed answer, or refuse/hold explicitly. */
  run(turn: BrowserTurn): Promise<string>;
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
