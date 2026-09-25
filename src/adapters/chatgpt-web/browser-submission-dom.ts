import type { Page } from "playwright-core";
import { CHATGPT_USER_TURN_SELECTOR, CHATGPT_ASSISTANT_TURN_SELECTOR, CHATGPT_STOP_BUTTON_SELECTOR } from "../../chatgpt-session";
import { throwIfPromptAttachmentAborted, withBrowserTurnAbort, withChatGptBrowserObservationTimeout } from "./browser-operation-support";
import { CHATGPT_DOM_REVISION_ATTRIBUTES, recordDomRevisionObservation } from "./browser-dom-revision";

export interface ChatGptSubmissionDomState {
  userTurnCount: number;
  assistantTurnCount: number;
  visibleStopButtonCount: number;
  turnIdentities: string[];
  userIdentities: string[];
  responseIdentities: string[];
  acknowledgementTurns?: Array<{ identity: string; text: string }>;
}

export interface ChatGptSubmissionDomCache {
  key?: string;
  snapshot?: ChatGptSubmissionDomState;
  fullScans?: number;
  cacheHits?: number;
}

export async function submissionDomState(
  page: Page,
  cache?: ChatGptSubmissionDomCache,
  signal?: AbortSignal,
): Promise<ChatGptSubmissionDomState> {
  throwIfPromptAttachmentAborted(signal);
  const observed = await withChatGptBrowserObservationTimeout(withBrowserTurnAbort(page.evaluate(options => {
    type ObserverState = { id: string; revision: number; observer: MutationObserver };
    const scope = globalThis as typeof globalThis & {
      __CODEX_WEB_GPT_TURN_OBSERVER__?: ObserverState;
    };
    const observerState = scope.__CODEX_WEB_GPT_TURN_OBSERVER__ ??= (() => {
      const state: ObserverState = {
        id: `${performance.timeOrigin}:${Math.random().toString(36).slice(2)}`,
        revision: 0,
        observer: undefined as unknown as MutationObserver,
      };
      state.observer = new MutationObserver(() => {
        state.revision += 1;
      });
      state.observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: options.attributeFilter,
      });
      return state;
    })();
    const observerKey = `${observerState.id}:${observerState.revision}`;
    if (options.knownKey === observerKey) return { key: observerKey };
    const identities = (elements: Element[], attribute: string): string[] => {
      const values = elements.map(element => element.getAttribute(attribute));
      if (values.some(value => typeof value !== "string" || value.trim().length === 0)) {
        throw new Error(`ChatGPT conversation turn has no stable ${attribute} identity`);
      }
      const typed = values as string[];
      if (new Set(typed).size !== typed.length) {
        throw new Error("ChatGPT exposed duplicate conversation turn identities");
      }
      return typed;
    };
    const visible = (element: Element): boolean => {
      const candidate = element as HTMLElement;
      const style = getComputedStyle(candidate);
      const bounds = candidate.getBoundingClientRect();
      return candidate.isConnected
        && style.visibility !== "hidden"
        && (bounds.width > 0 || bounds.height > 0);
    };
    // data-testid contains a display index: ChatGPT can renumber it while the same turn lives.
    // Virtualization removes a turn's section, but retains its outer identity container.
    const containers = [...document.querySelectorAll("[data-turn-id-container]")].filter(element =>
      element.parentElement?.closest("[data-turn-id-container]")?.getAttribute("data-turn-id-container")
        !== element.getAttribute("data-turn-id-container"));
    const turnIdentities = identities(containers, "data-turn-id-container");
    const userIdentities = identities([...document.querySelectorAll(options.userTurnSelector)], "data-turn-id");
    const responseIdentities = identities([...document.querySelectorAll(options.assistantTurnSelector)], "data-turn-id");
    // Retained staging acknowledgements can receive new DOM IDs when ChatGPT switches
    // to Pro. Only the exact transaction-bound, already-validated ACK is historical proof.
    const acknowledgementTurns = [...document.querySelectorAll(options.assistantTurnSelector)].flatMap(element => {
      const text = [...(element.querySelectorAll?.(".markdown") ?? [])].map(node => node.textContent ?? "").join("\n").trim();
      const identity = element.getAttribute("data-turn-id");
      return identity && text.length <= 180 && text.startsWith("CODEX_MULTIPART_ACK ") ? [{ identity, text }] : [];
    });
    const knownTurns = new Set(turnIdentities);
    if ([...userIdentities, ...responseIdentities].some(identity => !knownTurns.has(identity))) {
      throw new Error("ChatGPT conversation turn has no matching identity container");
    }
    return {
      key: observerKey,
      snapshot: {
        userTurnCount: userIdentities.length,
        assistantTurnCount: responseIdentities.length,
        visibleStopButtonCount: [...document.querySelectorAll(options.stopButtonSelector)].filter(visible).length,
        turnIdentities,
        userIdentities,
        responseIdentities,
        acknowledgementTurns,
      },
    };
  }, {
    userTurnSelector: CHATGPT_USER_TURN_SELECTOR,
    assistantTurnSelector: CHATGPT_ASSISTANT_TURN_SELECTOR,
    stopButtonSelector: CHATGPT_STOP_BUTTON_SELECTOR,
    knownKey: cache?.key,
    attributeFilter: [...CHATGPT_DOM_REVISION_ATTRIBUTES],
  }), signal));
  const snapshot = observed.snapshot ?? cache?.snapshot;
  if (!snapshot) throw new Error("ChatGPT turn DOM revision cache has no baseline snapshot");
  recordDomRevisionObservation(cache, observed);
  return snapshot;
}
