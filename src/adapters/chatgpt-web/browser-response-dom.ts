import type { Locator } from "playwright-core";
import type { ChatGptMarkdownSegment } from "./markdown";
import { CHATGPT_COMPLETION_ACTION_SELECTOR } from "../../chatgpt-session";
import { CHATGPT_STOPPED_THINKING_LABELS } from "./ui-labels";
import { chatGptBrowserTabClosedError } from "./adapter-error";
import { CHATGPT_DOM_REVISION_ATTRIBUTES } from "./browser-dom-revision";
import { isChatGptTraceControl, stripChatGptTraceControlSuffix, type ChatGptVisibleTraceBlock } from "./browser-visible-trace";

export interface ChatGptResponseDomSnapshot {
  responsePresent: boolean;
  visibleText: string;
  fullHtml: string;
  markdownSegments: ChatGptMarkdownSegment[];
  completionActionVisible: boolean;
  stoppedThinkingVisible: boolean;
  traceBlocks: ChatGptVisibleTraceBlock[];
}

export interface ChatGptResponseDomCache {
  key?: string;
  snapshot?: ChatGptResponseDomSnapshot;
  fullScans?: number;
  cacheHits?: number;
}

export const absentResponseDomSnapshot = (): ChatGptResponseDomSnapshot => ({
  responsePresent: false,
  visibleText: "",
  fullHtml: "",
  markdownSegments: [],
  completionActionVisible: false,
  stoppedThinkingVisible: false,
  traceBlocks: [],
});

export async function responseDomSnapshot(
  responseTurn: Locator,
  cache?: ChatGptResponseDomCache,
  abortSignal?: AbortSignal,
): Promise<ChatGptResponseDomSnapshot> {
  const observed = await responseTurn.evaluate((element, options) => {
    const root = element as HTMLElement;
    type ObserverState = {
      id: number;
      revision: number;
      observer: MutationObserver;
      rendered: Map<HTMLElement, boolean>;
    };
    type ObserverRegistry = { documentId: string; nextId: number; states: WeakMap<Element, ObserverState> };
    const scope = globalThis as typeof globalThis & {
      __CODEX_WEB_GPT_RESPONSE_OBSERVERS__?: ObserverRegistry;
    };
    const registry = scope.__CODEX_WEB_GPT_RESPONSE_OBSERVERS__ ??= {
      documentId: `${performance.timeOrigin}:${Math.random().toString(36).slice(2)}`,
      nextId: 0,
      states: new WeakMap<Element, ObserverState>(),
    };
    let observerState = registry.states.get(root);
    if (!observerState) {
      observerState = {
        id: ++registry.nextId,
        revision: 0,
        observer: undefined as unknown as MutationObserver,
        rendered: new Map<HTMLElement, boolean>(),
      };
      const state = observerState;
      state.observer = new MutationObserver(() => {
        state.revision += 1;
      });
      state.observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: options.attributeFilter,
      });
      registry.states.set(root, state);
    }
    // Browser turn WebContents are intentionally allowed to run while their Electron view is
    // hidden or has no measured width. Layout geometry is therefore not response visibility:
    // completed Markdown can have width=0 while remaining connected, rendered and readable.
    const isRendered = (candidate: HTMLElement): boolean => {
      const style = getComputedStyle(candidate);
      return candidate.isConnected
        && style.display !== "none"
        && style.visibility !== "hidden"
        && style.opacity !== "0";
    };
    // A stylesheet change or CSS animation can reveal an answer or completion control
    // without mutating this response subtree. Recheck the previous scan's dependencies.
    for (const [candidate, rendered] of observerState.rendered) {
      if (isRendered(candidate) !== rendered) {
        observerState.revision += 1;
        break;
      }
    }
    const observerKey = `${registry.documentId}:${observerState.id}:${observerState.revision}`;
    if (options.knownKey === observerKey) return { key: observerKey };
    observerState.rendered.clear();
    const renderedInDom = (candidate: HTMLElement): boolean => {
      const rendered = isRendered(candidate);
      observerState.rendered.set(candidate, rendered);
      return rendered;
    };

    // ChatGPT uses the same Markdown renderer for intermediate commentary and for the final
    // answer. Older responses nested commentary in the streaming-status container. Pro can also
    // render a completed commentary Markdown root immediately before that live status container.
    // Final-answer Markdown follows the live status instead, so DOM order remains the semantic
    // boundary without relying on localized labels such as "Pro thinking".
    // DIL uses an assistant-owned PUIK root without the legacy markdown class (#538).
    const answerRootSelector = '.markdown, [data-message-author-role="assistant"] .puik-root.not-markdown > [class*="_DilResponseRoot"]';
    const allMarkdownRoots = [...root.querySelectorAll<HTMLElement>(answerRootSelector)]
      .filter(candidate => !candidate.parentElement?.closest(answerRootSelector))
      .filter(renderedInDom);
    const streamingStatusContainers = [...root.querySelectorAll<HTMLElement>("[data-streaming-response-status]")]
      .filter(renderedInDom);
    // CHATGPT_COMMENTARY_CLASSIFIER_BEGIN
    // Self-contained so the test suite can execute this exact source against a synthetic DOM;
    // it must not close over anything from the surrounding evaluate scope.
    const selectChatGptAnswerRoots = (
      markdownRoots: HTMLElement[],
      statusContainers: HTMLElement[],
    ): { commentaryRoots: HTMLElement[]; answerRoots: HTMLElement[] } => {
      const firstStatusContainer = statusContainers[0];
      const commentary = markdownRoots.filter(candidate => (
        candidate.closest("[data-streaming-response-status]") !== null
        // Chain-of-thought components carry reasoning, never the final answer, so containment is
        // a position-independent commentary signal. Position alone cannot separate "commentary
        // between two status containers" from "answer between two tool calls".
        || candidate.closest('[data-testid^="cot-v5"]') !== null
        // Only Markdown that precedes the FIRST status container is prior commentary. Keying
        // this on "some status follows me" silently reclassified answer text as commentary as
        // soon as a second tool call opened another status container below it, which both zeroed
        // the visible text and dropped every answer chunk emitted between tool calls.
        || (firstStatusContainer !== undefined && Boolean(
          // 4 is Node.DOCUMENT_POSITION_FOLLOWING, inlined to keep this function standalone.
          candidate.compareDocumentPosition(firstStatusContainer) & 4,
        ))
      ));
      return {
        commentaryRoots: commentary,
        answerRoots: markdownRoots.filter(candidate => !commentary.includes(candidate)),
      };
    };
    // CHATGPT_COMMENTARY_CLASSIFIER_END
    const classified = selectChatGptAnswerRoots(allMarkdownRoots, streamingStatusContainers);
    const commentaryRoots = classified.commentaryRoots;
    const renderedRoots = classified.answerRoots;
    // CHATGPT_MARKDOWN_CONTENT_BEGIN
    const chatGptMarkdownContent = (markdownRoot: HTMLElement): HTMLElement => {
      const content = markdownRoot.cloneNode(true) as HTMLElement;
      const labelSelector = "button.behavior-btn.entity-underline";
      const originalLabels = Array.from(markdownRoot.querySelectorAll<HTMLElement>(labelSelector));
      const hiddenLabelPart = (candidate: HTMLElement): boolean => {
        const style = typeof getComputedStyle === "function" && candidate.isConnected
          ? getComputedStyle(candidate) : candidate.style;
        return candidate.hasAttribute("hidden")
          || candidate.getAttribute("aria-hidden") === "true"
          || candidate.getAttribute("role") === "tooltip"
          || candidate.classList.contains("sr-only")
          || style?.display === "none"
          || ["hidden", "collapse"].includes(style?.visibility)
          || style?.opacity === "0";
      };
      Array.from(content.querySelectorAll<HTMLElement>(labelSelector)).forEach((button, index) => {
        const original = originalLabels[index]!;
        for (let ancestor: HTMLElement | null = original; ancestor; ancestor = ancestor.parentElement) {
          if (hiddenLabelPart(ancestor)) { button.remove(); return; }
        }
        const parts: string[] = [];
        const collect = (node: Node) => {
          if (node.nodeType === Node.TEXT_NODE) { parts.push(node.textContent ?? ""); return; }
          if (!(node instanceof HTMLElement)
            || ["BUTTON", "SCRIPT", "STYLE", "SVG", "IMG", "PICTURE", "SOURCE"].includes(node.nodeName)
            || hiddenLabelPart(node)) return;
          Array.from(node.childNodes).forEach(collect);
        };
        Array.from(original.childNodes).forEach(collect);
        // Issue #434 supplies this entity-button shape without an authoritative URL. Preserve
        // only its visible text on our detached projection; never use href, title or aria-label
        // as a filename, synthesize a download, or mutate/click the live ChatGPT control.
        const label = content.ownerDocument.createElement("span");
        label.setAttribute("data-chatgpt-file-label", "");
        label.textContent = parts.join("").trim();
        button.parentNode?.replaceChild(label, button);
      });
      // These are embedded renderers, not Markdown answer text. Their loading labels, controls
      // and plot axes change independently of generation (including after a later paragraph).
      // Keep their UI out of both the emitted HTML and the text consistency fingerprint.
      // Also remove the controls/media already excluded by chatGptHtmlToMarkdown, so their
      // accessibility labels cannot become consistency fingerprints for untransmitted text.
      // Ordinary code blocks, surrounding prose and the original observed DOM remain intact.
      for (const widget of Array.from(content.querySelectorAll(
        ".chart-widget-container, [data-code-block-preview-pane], button, script, style, svg, img, picture, source",
      ))) widget.remove();
      return content;
    };
    // ChatGPT may merge adjacent `.markdown` roots or virtualize an earlier prefix while a streamed
    // answer is finalized. Root boundaries and visible indices therefore are not identity:
    // flatten semantic blocks and preserve ChatGPT's source ranges across that reparenting.
    const flattenedMarkdownSegments: Array<{
      tag: string;
      html: string;
      text: string;
      pendingLinks: boolean;
      linkTargets: string[];
      group?: string;
      sourceStart?: number;
      sourceEnd?: number;
    }> = [];
    const blockMarkdownTags = new Set([
      "address", "article", "aside", "blockquote", "div", "dl", "fieldset", "figcaption",
      "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
      "li", "main", "nav", "ol", "p", "pre", "section", "table", "ul",
    ]);
    const markdownText = (element: HTMLElement): string => {
      // Detached content has no layout-derived innerText. Preserve textual line boundaries
      // explicitly: plain textContent would conflate "A<br>B" with "AB" in the guard.
      const parts: string[] = [];
      const blockBoundary = () => {
        if (parts.length > 0 && !parts.at(-1)!.endsWith("\n")) parts.push("\n");
      };
      const visit = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent ?? "");
        if (!(node instanceof HTMLElement)) return;
        const tag = node.tagName.toLowerCase();
        const block = blockMarkdownTags.has(tag);
        if (block) blockBoundary();
        if (tag === "br") parts.push("\n");
        node.childNodes.forEach(visit);
        if (block) blockBoundary();
      };
      visit(element);
      return parts.join("").trim();
    };
    // CHATGPT_MARKDOWN_CONTENT_END
    let listGroupIndex = 0;
    const sourceRange = (candidate: Element): { sourceStart: number; sourceEnd: number } | undefined => {
      const startAttribute = candidate.getAttribute("data-start");
      const endAttribute = candidate.getAttribute("data-end");
      if (startAttribute === null || endAttribute === null) return undefined;
      if (!startAttribute.trim() || !endAttribute.trim()) return undefined;
      const sourceStart = Number(startAttribute);
      const sourceEnd = Number(endAttribute);
      return Number.isFinite(sourceStart) && Number.isFinite(sourceEnd) && sourceEnd >= sourceStart
        ? { sourceStart, sourceEnd }
        : undefined;
    };
    const linkState = (element: HTMLElement): { pendingLinks: boolean; linkTargets: string[] } => {
      const anchors = [element, ...element.querySelectorAll<HTMLElement>("a")]
        .filter(candidate => candidate.tagName === "A" && Boolean(candidate.textContent?.trim()));
      return {
        pendingLinks: anchors.some(candidate => !candidate.getAttribute("href")?.trim()),
        linkTargets: anchors.flatMap(candidate => {
          const href = candidate.getAttribute("href");
          return href?.trim() ? [href] : [];
        }),
      };
    };
    const appendBlockSegment = (child: HTMLElement) => {
      const tag = child.tagName.toLowerCase();
      const childRange = sourceRange(child);
      const listItems = tag === "ol" || tag === "ul"
        ? [...child.children].filter(candidate => candidate.tagName === "LI") as HTMLElement[]
        : [];
      if (listItems.length === 0) {
        flattenedMarkdownSegments.push({
          tag,
          html: child.outerHTML,
          text: markdownText(child),
          ...linkState(child),
          ...childRange,
        });
        return;
      }

      const group = childRange
        ? `list:${childRange.sourceStart}:${tag}`
        : `list:${listGroupIndex++}:${tag}`;
      const orderedStart = tag === "ol" ? Number(child.getAttribute("start") ?? "1") : undefined;
      listItems.forEach((item, itemIndex) => {
        const shell = child.cloneNode(false) as HTMLElement;
        shell.removeAttribute("data-is-last-node");
        if (orderedStart !== undefined && Number.isFinite(orderedStart)) {
          shell.setAttribute("start", String(orderedStart + itemIndex));
        }
        shell.append(item.cloneNode(true));
        flattenedMarkdownSegments.push({
          tag: `${tag}:item`,
          html: shell.outerHTML,
          text: markdownText(item),
          ...linkState(item),
          group,
          ...sourceRange(item),
        });
      });
    };
    renderedRoots.map(chatGptMarkdownContent).forEach((markdownRoot) => {
      const children = [...markdownRoot.children] as HTMLElement[];
      const hasBlockChildren = children.some(child => blockMarkdownTags.has(child.tagName.toLowerCase()));
      if (!hasBlockChildren) {
        if (markdownRoot.innerHTML.trim()) flattenedMarkdownSegments.push({
          tag: "root",
          html: markdownRoot.innerHTML,
          text: markdownText(markdownRoot),
          ...linkState(markdownRoot),
          ...sourceRange(markdownRoot),
        });
        return;
      }

      let inlineRun: Node[] = [];
      const flushInlineRun = () => {
        if (inlineRun.length === 0) return;
        const nodes = inlineRun;
        inlineRun = [];
        const shell = document.createElement("span");
        nodes.forEach(node => shell.append(node.cloneNode(true)));
        const text = markdownText(shell);
        if (text) {
          const rangedElements = nodes.flatMap(node => node instanceof Element
            ? [node, ...node.querySelectorAll<HTMLElement>("[data-start][data-end]")]
            : []);
          const ranges = rangedElements
            .map(sourceRange)
            .filter((range): range is { sourceStart: number; sourceEnd: number } => range !== undefined);
          flattenedMarkdownSegments.push({
            tag: "inline",
            html: shell.outerHTML,
            text,
            ...linkState(shell),
            ...(ranges.length > 0 ? {
              sourceStart: Math.min(...ranges.map(range => range.sourceStart)),
              sourceEnd: Math.max(...ranges.map(range => range.sourceEnd)),
            } : {}),
          });
        }
      };

      markdownRoot.childNodes.forEach((node) => {
        if (node instanceof HTMLElement && blockMarkdownTags.has(node.tagName.toLowerCase())) {
          flushInlineRun();
          appendBlockSegment(node);
          return;
        }
        inlineRun.push(node);
      });
      flushInlineRun();
    });
    const markdownSegments = flattenedMarkdownSegments.map((segment, index, segments) => ({
      key: segment.sourceStart !== undefined
        ? `${segment.sourceStart}:${segment.tag}`
        : `${index}:${segment.tag}`,
      tag: segment.tag,
      html: segment.html,
      text: segment.text,
      ...(segment.group ? { group: segment.group } : {}),
      ...(segment.sourceStart !== undefined ? { sourceStart: segment.sourceStart } : {}),
      ...(segment.sourceEnd !== undefined ? { sourceEnd: segment.sourceEnd } : {}),
      streamable: index < segments.length - 1 && !segment.pendingLinks,
      linkTargets: segment.linkTargets,
    }));
    const rendered = renderedRoots.at(-1);
    const completionAction = rendered
      ? [...root.querySelectorAll<HTMLElement>(options.completionActionSelector)]
        .filter(renderedInDom)
        .find(candidate => !rendered.contains(candidate)
          && Boolean(rendered.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING))
      : undefined;
    const completionActionSet = new Set(completionAction ? [completionAction] : []);
    const candidates = new Map<HTMLElement, ChatGptVisibleTraceBlock["kind"]>();
    renderedRoots.forEach(candidate => candidates.set(candidate, "answer"));
    commentaryRoots.forEach(candidate => candidates.set(candidate, "commentary"));
    const overlapsRenderedAnswer = (candidate: HTMLElement): boolean => renderedRoots.some(rendered => (
      candidate.contains(rendered) || rendered.contains(candidate)
    ));
    const overlapsCommentary = (candidate: HTMLElement): boolean => commentaryRoots.some(commentary => (
      candidate.contains(commentary) || commentary.contains(candidate)
    ));
    const statusSemantic = (candidate: HTMLElement): HTMLElement => {
      // Current cot-v5 action rows expose the semantic text on their item anchor while the
      // discoverable data-testid lives on a textless icon below it. Promote that descendant to
      // the owned row; otherwise every non-button action is silently filtered as empty text.
      return candidate.closest<HTMLElement>("button")
        ?? candidate.closest<HTMLElement>("[data-item-anchor]")
        ?? candidate;
    };
    const traceText = (candidate: HTMLElement): string => {
      const ariaLabel = candidate.getAttribute("aria-label")?.trim();
      if (ariaLabel) return ariaLabel;
      // Animated ChatGPT action counters visually split a phrase around the changing number, so
      // `innerText` can become `Searching websites\n3`. The button's screen-reader label already
      // carries the stable semantic phrase (`Searching 3 websites`) without enclosing unrelated
      // commentary from the surrounding streaming-status container.
      const screenReaderText = [...candidate.querySelectorAll<HTMLElement>(".sr-only")]
        .map(element => element.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .find(Boolean);
      return screenReaderText || candidate.innerText.trim();
    };
    const traceKey = (candidate: HTMLElement, kind: ChatGptVisibleTraceBlock["kind"]): string | undefined => {
      const statusContainer = candidate.closest<HTMLElement>("[data-streaming-response-status]");
      const itemAnchor = candidate.closest<HTMLElement>("[data-item-anchor]");
      if (!statusContainer || !itemAnchor) return undefined;
      const anchorIndex = [...statusContainer.querySelectorAll<HTMLElement>("[data-item-anchor]")]
        .indexOf(itemAnchor);
      return anchorIndex >= 0 ? `${kind}:anchor:${anchorIndex}` : undefined;
    };
    const hasFollowingRenderedSibling = (candidate: HTMLElement): boolean => {
      const itemAnchor = candidate.closest<HTMLElement>("[data-item-anchor]");
      for (
        let sibling = itemAnchor?.nextElementSibling;
        sibling;
        sibling = sibling.nextElementSibling
      ) {
        if (sibling instanceof HTMLElement && renderedInDom(sibling) && sibling.innerText.trim()) {
          return true;
        }
      }
      return false;
    };
    root.querySelectorAll<HTMLElement>(
      'button, [role="status"], [aria-busy="true"], [data-testid*="cot"], [data-testid*="reason"], [data-testid*="thought"]',
    ).forEach(candidate => {
      if (completionActionSet.has(candidate)) return;
      if (overlapsRenderedAnswer(candidate) || overlapsCommentary(candidate)) return;
      const semantic = statusSemantic(candidate);
      // A renderer may wrap the final Markdown in a reason/status container. That wrapper and
      // its descendants still belong exclusively to the final-answer stream; assigning either
      // side to the trace stream duplicates or truncates the answer under Codex's `Working` UI.
      if (!overlapsRenderedAnswer(semantic)
        && !overlapsCommentary(semantic)
        && !candidates.has(semantic)) {
        candidates.set(semantic, "status");
      }
    });
    root.querySelectorAll<HTMLElement>("[data-streaming-response-status]").forEach(container => {
      if (!overlapsRenderedAnswer(container)
        && !overlapsCommentary(container)
        && ![...candidates.keys()].some(candidate => container.contains(candidate))) {
        candidates.set(container, "status");
      }
    });
    const traceByKey = new Map<string, ChatGptVisibleTraceBlock>();
    [...candidates]
      .filter(([candidate]) => renderedInDom(candidate))
      .sort(([left], [right]) => left === right
        ? 0
        : left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
      .map(([candidate, kind]) => ({
        kind,
        text: traceText(candidate),
        key: traceKey(candidate, kind),
        ...(kind === "commentary" ? { complete: hasFollowingRenderedSibling(candidate) } : {}),
        // Footer controls such as the model picker and overflow menu are siblings of the final
        // Markdown inside the assistant turn. They are UI, not model trace. Real action buttons
        // are scoped by ChatGPT's streaming-status container.
        uiControl: candidate.matches("button")
          && candidate.closest("[data-streaming-response-status]") === null,
      }))
      .filter(block => block.text.length > 0)
      .forEach((block, index) => {
        const key = block.key ?? `${block.kind}:fallback:${index}`;
        const previous = traceByKey.get(key);
        if (!previous || block.text.length > previous.text.length) traceByKey.set(key, block);
      });
    const traceBlocks = [...traceByKey.values()].map((block, index, blocks) => ({
      ...block,
      ...(block.kind === "commentary" ? {
        complete: block.complete === true || index < blocks.length - 1,
      } : {}),
    }));
    // CHATGPT_STOPPED_THINKING_BEGIN
    const stoppedThinkingVisible = (() => {
      // Only ChatGPT UI in the bound response may terminate the turn. A model quoting this
      // phrase in its answer or reasoning is ordinary content, not a stopped-thinking status.
      const isStatus = (candidate: HTMLElement): boolean => {
        if (overlapsRenderedAnswer(candidate) || overlapsCommentary(candidate)
          || candidate.closest("pre, code, blockquote")) return false;
        for (let element: HTMLElement | null = candidate; element; element = element.parentElement) {
          if (!renderedInDom(element)) return false;
        }
        return true;
      };
      // Exact observed ChatGPT UI labels only; generic phrase matching would mistake
      // quoted response text for a terminal status.
      const stoppedLabels = new Set<string>(options.stoppedThinkingLabels);
      const isStoppedLabel = (value: string | null): boolean => (
        stoppedLabels.has(value?.replace(/\s+/g, " ").trim() ?? "")
      );
      const ariaMatch = [...root.querySelectorAll<HTMLElement>("[aria-label]")]
        .some(candidate => isStoppedLabel(candidate.getAttribute("aria-label")) && isStatus(candidate));
      if (ariaMatch) return true;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!isStoppedLabel(node.textContent)) continue;
        const parent = node.parentElement;
        if (parent && isStatus(parent)) return true;
      }
      return false;
    })();
    // CHATGPT_STOPPED_THINKING_END
    return {
      key: observerKey,
      snapshot: {
        responsePresent: true,
        visibleText: renderedRoots.map(candidate => candidate.innerText.trim()).filter(Boolean).join("\n\n"),
        fullHtml: renderedRoots.map(candidate => candidate.innerHTML).join(""),
        markdownSegments,
        completionActionVisible: completionAction !== undefined,
        stoppedThinkingVisible,
        traceBlocks,
      },
    };
  }, {
    completionActionSelector: CHATGPT_COMPLETION_ACTION_SELECTOR,
    stoppedThinkingLabels: [...CHATGPT_STOPPED_THINKING_LABELS],
    knownKey: cache?.key,
    attributeFilter: [...CHATGPT_DOM_REVISION_ATTRIBUTES],
  }, { timeout: 2_000 }).catch(error => {
    if (abortSignal?.aborted) {
      throw new DOMException("ChatGPT web turn aborted", "AbortError");
    }
    if (responseTurn.page().isClosed()) {
      return undefined;
    }
    // An open page whose response subtree could not be evaluated is an observation fault, not
    // evidence that the assistant response is absent. Preserve the original failure so the
    // main turn loop can spend its bounded internal-observation budget instead of entering
    // missing-response handling with a fabricated empty snapshot.
    throw new TypeError(
      `ChatGPT response DOM observation failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  });
  if (!observed) {
    if (abortSignal?.aborted) {
      throw new DOMException("ChatGPT web turn aborted", "AbortError");
    }
    if (responseTurn.page().isClosed()) {
      throw chatGptBrowserTabClosedError();
    }
    throw new TypeError("ChatGPT response DOM observation returned no result");
  }
  const snapshot = observed.snapshot ?? cache?.snapshot ?? absentResponseDomSnapshot();
  if (observed.snapshot && cache) {
    cache.key = observed.key;
    cache.snapshot = observed.snapshot;
    cache.fullScans = (cache.fullScans ?? 0) + 1;
  } else if (!observed.snapshot && cache?.snapshot) {
    cache.cacheHits = (cache.cacheHits ?? 0) + 1;
  }
  snapshot.traceBlocks = snapshot.traceBlocks
    .map(stripChatGptTraceControlSuffix)
    .filter(block => block.text.length > 0 && !isChatGptTraceControl(block));
  return snapshot;
}
