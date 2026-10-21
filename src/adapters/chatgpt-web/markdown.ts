import { CHATGPT_MARKDOWN_BUFFER_BYTES, assertByteLimit, retainedRecordBytes } from "./resource-budgets";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { createDocument } from "@mixmark-io/domino";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  fence: "```",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
});

turndown.use(gfm);
turndown.remove(["button", "script", "style"]);
turndown.addRule("literalCodexPlanMarkers", {
  filter: node => {
    if (!["P", "DIV"].includes(node.nodeName)
      || !/<\/?proposed_plan>/.test(node.textContent ?? "")
      || node.querySelector("pre, code, blockquote, q")) return false;
    for (let ancestor = node.parentNode; ancestor; ancestor = ancestor.parentNode) {
      if (["PRE", "CODE", "BLOCKQUOTE", "Q"].includes(ancestor.nodeName)) return false;
    }
    return true;
  },
  replacement: content => {
    // Restore only literal standalone markers escaped by Turndown. Do this while the HTML
    // ancestry is available, so quoted examples and fenced/inline code cannot become plans.
    const restored = content.replace(/^([ \t]*)<(\/?)proposed\\_plan>([ \t]*)$/gm, "$1<$2proposed_plan>$3");
    return `\n\n${restored}\n\n`;
  },
});
const fileLabelSelector = "button.behavior-btn.entity-underline, span[data-chatgpt-file-label]";
turndown.addRule("inertFileLabelLinks", {
  filter: node => node.nodeName === "A" && Boolean(node.querySelector(fileLabelSelector)),
  replacement: content => content,
});
turndown.addRule("inertFileLabels", {
  filter: node => node.nodeName === "BUTTON"
    && node.classList.contains("behavior-btn") && node.classList.contains("entity-underline")
    || node.nodeName === "SPAN" && node.hasAttribute("data-chatgpt-file-label"),
  replacement: (_content, node) => {
    let label = visibleFileLabelText(node as HTMLElement);
    if (!label) return "";
    for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.nodeName === "TD" || ancestor.nodeName === "TH") {
        label = label.replaceAll("|", "\\|");
        break;
      }
    }
    for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.nodeName === "CODE" || ancestor.nodeName === "PRE") return label;
    }
    // This control provides a label, not an authoritative download target. Inline code keeps
    // file paths, URL-looking names and wiki syntax inert through later Markdown transforms.
    let delimiterLength = 1;
    for (const match of label.matchAll(/`+/g)) delimiterLength = Math.max(delimiterLength, match[0].length + 1);
    const delimiter = "`".repeat(delimiterLength);
    const padding = label.startsWith("`") || label.endsWith("`") ? " " : "";
    return `${delimiter}${padding}${label}${padding}${delimiter}`;
  },
});
turndown.addRule("removeImages", {
  filter: node => ["IMG", "PICTURE", "SOURCE"].includes(node.nodeName),
  replacement: () => "",
});
turndown.addRule("removeSvg", {
  filter: node => node.nodeName === "SVG",
  replacement: () => "",
});
turndown.addRule("linkInlineFilePaths", {
  filter: node => inlineFilePath(node) !== undefined,
  replacement: (_content, node) => {
    const path = node.textContent!;
    const target = path.replaceAll("\\", "/");
    return `[${turndown.escape(path)}](<${target}>)`;
  },
});
turndown.addRule("compactListItem", {
  filter: "li",
  replacement: (content, node, options) => {
    const parent = node.parentNode as HTMLElement | null;
    let prefix = `${options.bulletListMarker} `;
    if (parent?.nodeName === "OL") {
      const start = Number(parent.getAttribute("start") ?? "1");
      const index = Array.prototype.indexOf.call(parent.children, node) as number;
      prefix = `${start + index}. `;
    }
    const normalized = content
      .replace(/^\n+|\n+$/g, "")
      .replace(/\n/g, `\n${" ".repeat(prefix.length)}`);
    return `${prefix}${normalized}${node.nextSibling ? "\n" : ""}`;
  },
});

turndown.addRule("preserveKatexSource", {
  filter: node => node.classList.contains("katex") && node.hasAttribute("data-codex-latex"),
  replacement: (_content, node) => {
    const source = (node as HTMLElement).getAttribute("data-codex-latex")!;
    return node.parentElement?.classList.contains("katex-display")
      ? `\n\n\\[\n${source}\n\\]\n\n`
      : `\\(${source}\\)`;
  },
});

function preserveKatexSource(html: string): string | HTMLElement {
  if (!html.includes("katex")) return html;
  const root = createDocument().createElement("div");
  root.innerHTML = html;
  for (const math of Array.from(root.querySelectorAll(".katex"))) {
    if (math.closest("pre, code")) continue;
    const sources = math.querySelectorAll('annotation[encoding="application/x-tex"]');
    if (sources.length !== 1) throw new Error("ChatGPT formula does not contain one unambiguous LaTeX source");
    const source = sources[0]!.textContent ?? "";
    // Capture before Turndown collapses whitespace: newlines matter in TeX comments. Carry the
    // source as data while removing the duplicated MathML and visual layers from this
    // conversion-only DOM, so a formula is returned once (upstream 6.1.4).
    math.setAttribute("data-codex-latex", source);
    math.textContent = source;
  }
  return root;
}

function visibleFileLabelText(element: HTMLElement): string {
  const hidden = (candidate: HTMLElement) => candidate.hasAttribute("hidden")
    || candidate.getAttribute("aria-hidden") === "true"
    || candidate.getAttribute("role") === "tooltip"
    || candidate.classList.contains("sr-only")
    || candidate.style?.display === "none"
    || ["hidden", "collapse"].includes(candidate.style?.visibility)
    || candidate.style?.opacity === "0";
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (hidden(ancestor)) return "";
  }
  const label = element.cloneNode(true) as HTMLElement;
  for (const child of Array.from(label.querySelectorAll<HTMLElement>("*"))) {
    if (["BUTTON", "SCRIPT", "STYLE", "SVG", "IMG", "PICTURE", "SOURCE"].includes(child.nodeName.toUpperCase())
      || hidden(child)) child.remove();
  }
  return (label.textContent ?? "").trim();
}

function inlineFilePath(node: Node): string | undefined {
  if (node.nodeName !== "CODE") return undefined;
  if ((node as HTMLElement).querySelector(fileLabelSelector)) return undefined;
  for (let ancestor = node.parentNode; ancestor; ancestor = ancestor.parentNode) {
    if (["A", "PRE"].includes(ancestor.nodeName)) return undefined;
  }

  const path = node.textContent ?? "";
  if (path !== path.trim() || /[\s`<>()[\]]/.test(path)) return undefined;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) return undefined;

  const withoutLocation = path.replace(/:\d+(?::\d+)?$/, "");
  const separator = Math.max(withoutLocation.lastIndexOf("/"), withoutLocation.lastIndexOf("\\"));
  if (separator < 0) return undefined;

  const basename = withoutLocation.slice(separator + 1);
  if (!/\.[a-z\d][a-z\d._-]*$/i.test(basename)) return undefined;
  return path;
}

function obsidianWikiLink(value: string): string | undefined {
  const separator = value.indexOf("|");
  const target = (separator >= 0 ? value.slice(0, separator) : value).trim();
  const label = (separator >= 0 ? value.slice(separator + 1) : value).trim();
  if (!target || !label || /[<>]/.test(target)) return undefined;

  const fragmentAt = target.indexOf("#");
  const note = fragmentAt >= 0 ? target.slice(0, fragmentAt) : target;
  const fragment = fragmentAt >= 0 ? target.slice(fragmentAt) : "";
  const extension = note.slice(note.lastIndexOf("/") + 1).includes(".");
  const path = note && !extension ? `${note}.md` : note;
  return `[${label}](<${path}${fragment}>)`;
}

function linkObsidianWikiLinks(markdown: string): string {
  let fence: { marker: "`" | "~"; length: number } | undefined;
  let mathEnd: "\\)" | "\\]" | undefined;
  return markdown.split("\n").map(line => {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    // Backtick fence info cannot contain another backtick. A filename code span may need
    // three or more ticks, but closing on the same line does not open a fenced block.
    const fenceRun = fenceMatch?.[1]?.startsWith("`") && fenceMatch[2]?.includes("`")
      ? undefined : fenceMatch?.[1];
    if (fence) {
      const closingRun = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)?.[1];
      if (closingRun?.[0] === fence.marker && closingRun.length >= fence.length) fence = undefined;
      return line;
    }
    if (!mathEnd && fenceRun) {
      fence = { marker: fenceRun[0] as "`" | "~", length: fenceRun.length };
      return line;
    }

    let result = "";
    let inlineCodeTicks = 0;
    for (let index = 0; index < line.length;) {
      if (mathEnd) {
        const end = line.indexOf(mathEnd, index);
        if (end < 0) return result + line.slice(index);
        result += line.slice(index, end + mathEnd.length);
        index = end + mathEnd.length;
        mathEnd = undefined;
        continue;
      }
      if (line[index] === "`") {
        let end = index + 1;
        while (line[end] === "`") end += 1;
        const ticks = end - index;
        inlineCodeTicks = inlineCodeTicks === 0 ? ticks : ticks === inlineCodeTicks ? 0 : inlineCodeTicks;
        result += line.slice(index, end);
        index = end;
        continue;
      }
      const escapedWiki = line.startsWith("\\[\\[", index);
      if (inlineCodeTicks === 0 && (escapedWiki || line.startsWith("[[", index))) {
        const openingLength = escapedWiki ? 4 : 2;
        const closing = escapedWiki ? "\\]\\]" : "]]";
        const end = line.indexOf(closing, index + openingLength);
        if (end >= 0) {
          const value = line.slice(index + openingLength, end);
          const linked = line[index - 1] === "!" ? undefined : obsidianWikiLink(value);
          if (linked || escapedWiki) {
            // Restore Turndown's bracket escaping only outside code. Filename labels and
            // code examples must retain literal backslashes rather than changing identity.
            result += linked ?? `[[${value}]]`;
            index = end + closing.length;
            continue;
          }
        }
      }
      // Double brackets can be valid LaTeX: never rewrite wiki syntax inside a formula.
      if (inlineCodeTicks === 0 && (line.startsWith("\\(", index) || line.startsWith("\\[", index))) {
        mathEnd = line[index + 1] === "(" ? "\\)" : "\\]";
        result += line.slice(index, index + 2);
        index += 2;
        continue;
      }
      result += line[index];
      index += 1;
    }
    return result;
  }).join("\n");
}

export function chatGptHtmlToMarkdown(html: string): string {
  if (!html.trim()) return "";
  return linkObsidianWikiLinks(turndown.turndown(preserveKatexSource(html))).trim();
}

export interface ChatGptMarkdownSegment {
  key: string;
  tag?: string;
  html: string;
  text: string;
  linkTargets?: string[];
  group?: string;
  sourceStart?: number;
  sourceEnd?: number;
  streamable: boolean;
  /** File-reference controls can replace their label, spinner and download link until completion. */
  mutableReference?: boolean;
}

interface ChatGptMarkdownCandidate extends ChatGptMarkdownSegment {
  changedAt: number;
  streamableAt?: number;
  /** Streamable only through the browser's completed-turn proof, not a following block. */
  tailBoundary?: boolean;
}

interface CommittedChatGptMarkdownSegment {
  key: string;
  tag?: string;
  text: string;
  linkTargets?: string[];
  sourceStart?: number;
  sourceEnd?: number;
}

export class ChatGptMarkdownConsistencyError extends Error {
  constructor(message: string, readonly diagnostic?: {
    reason: "text_changed" | "link_target_changed" | "block_order_changed" | "source_range_overlap"
      | "source_range_changed" | "unanchored_block";
    observedStart?: number;
    observedEnd?: number;
    committedStart?: number;
    committedEnd?: number;
    observedTextChars: number;
    committedTextChars: number;
    observedTag?: string;
    committedTag?: string;
    observedIndex: number;
    committedIndex: number;
    observedKeyMode?: "source-range" | "dom-node";
    committedKeyMode?: "source-range" | "dom-node";
  }) {
    super(message);
    this.name = "ChatGptMarkdownConsistencyError";
  }
}

/** How long a streamable block must stay unchanged before it is committed to the stream. */
const CHATGPT_MARKDOWN_STABILITY_MS = 750;
/**
 * How long the completed-turn proof alone must persist before it releases the final block. That
 * block's content must still have stayed unchanged for the full stability window.
 */
const CHATGPT_MARKDOWN_TAIL_BOUNDARY_MS = 250;

/**
 * A following block is a structural boundary the renderer may still be settling, so the whole
 * window runs after it appears. The completed-turn proof is checked from outside the renderer: it
 * has to survive another observation, while the block it releases has usually been unchanged since
 * the answer stopped streaming, often for longer than the window by the time the stream closes.
 */
function chatGptMarkdownReleaseAt(candidate: ChatGptMarkdownCandidate, streamableAt: number): number {
  return candidate.tailBoundary
    ? Math.max(candidate.changedAt + CHATGPT_MARKDOWN_STABILITY_MS, streamableAt + CHATGPT_MARKDOWN_TAIL_BOUNDARY_MS)
    : Math.max(candidate.changedAt, streamableAt) + CHATGPT_MARKDOWN_STABILITY_MS;
}

/**
 * Converts structurally completed ChatGPT DOM blocks into an append-only Markdown stream.
 *
 * ChatGPT can rewrite old HTML while hydrating citations and controls, so a character prefix is
 * not a safe commit boundary. It can also virtualize an already-rendered prefix, so later DOM
 * snapshots are partial observations rather than the response ledger. The browser supplies source
 * ranges for semantic blocks and marks a block streamable only after a following block exists.
 * Once committed, a missing prefix is harmless; changing text at a committed source range remains
 * an explicit protocol error because Responses deltas cannot be retracted.
 */
export class ChatGptMarkdownBuffer {
  private readonly candidates = new Map<string, ChatGptMarkdownCandidate>();
  private readonly committed: CommittedChatGptMarkdownSegment[] = [];
  private latest: ChatGptMarkdownSegment[] = [];
  private markdown = "";
  private retainedBytes = 0;
  private snapshotBytes = 0;
  private lastGroup: string | undefined;
  private consistencyError: ChatGptMarkdownConsistencyError | undefined;
  private referencePrefix: Set<string> | undefined;

  constructor(private readonly delivery: "stream" | "complete" = "stream") {}

  observe(segments: ChatGptMarkdownSegment[], options: { tailReady?: boolean } = {}): string {
    const now = Date.now();
    // Candidates and the latest snapshot both retain DOM records before Markdown is emitted.
    const snapshotBytes = 2 * segments.reduce((bytes, segment) => bytes + retainedRecordBytes(segment), 0);
    assertByteLimit(this.retainedBytes + snapshotBytes, CHATGPT_MARKDOWN_BUFFER_BYTES, "ChatGPT Markdown progress buffer");
    const reconciled = this.reconcile(segments);
    if (reconciled instanceof ChatGptMarkdownConsistencyError) {
      this.consistencyError = reconciled;
      return "";
    }
    this.consistencyError = undefined;
    this.snapshotBytes = snapshotBytes;
    this.latest = reconciled.map(segment => ({ ...segment }));
    // A compaction summary is delivered atomically. Until finish(), edits and reordering revise an
    // undelivered draft instead of contradicting text already sent to Codex.
    if (this.delivery === "complete") return "";

    const referenceIndex = reconciled.findIndex(segment => segment.mutableReference);
    if (referenceIndex >= 0) {
      const prefix = new Set(reconciled.slice(0, referenceIndex).map(segment => this.candidateId(segment)));
      this.referencePrefix = this.referencePrefix
        ? new Set([...this.referencePrefix].filter(id => prefix.has(id))) : prefix;
    }

    const visibleCandidates = new Set<string>();
    for (const segment of reconciled) {
      const candidateId = this.candidateId(segment);
      visibleCandidates.add(candidateId);
      const previous = this.candidates.get(candidateId);
      const unchanged = previous
        && previous.key === segment.key
        && previous.tag === segment.tag
        && previous.html === segment.html
        && previous.text === segment.text
        && JSON.stringify(previous.linkTargets ?? []) === JSON.stringify(segment.linkTargets ?? [])
        && previous.group === segment.group
        && previous.sourceStart === segment.sourceStart
        && previous.sourceEnd === segment.sourceEnd;
      // A following block normally establishes the boundary. The owning browser may also
      // prove that the stream stopped and completed-turn actions rendered. The tail keeps the
      // same content stability window; this does not declare the whole turn complete.
      const streamable = segment.streamable || options.tailReady === true;
      this.candidates.set(candidateId, {
        ...segment,
        streamable,
        ...(streamable && !segment.streamable ? { tailBoundary: true } : {}),
        changedAt: unchanged ? previous.changedAt : now,
        ...(streamable ? {
          streamableAt: unchanged && previous.streamableAt !== undefined
            ? previous.streamableAt
            : now,
        } : {}),
      });
    }
    for (const candidateId of this.candidates.keys()) {
      if (!visibleCandidates.has(candidateId)) this.candidates.delete(candidateId);
    }

    let delta = "";
    let committedCount = 0;
    while (committedCount < reconciled.length) {
      const segment = reconciled[committedCount]!;
      const candidateId = this.candidateId(segment);
      const candidate = this.candidates.get(candidateId);
      // A disappearing or remounted file preview must not release text after it. Only blocks
      // already known to precede it may stream; finish() delivers the rest (upstream #769).
      if (this.referencePrefix && !this.referencePrefix.has(candidateId)) break;
      if (!candidate?.streamable || candidate.streamableAt === undefined) break;
      if (now < chatGptMarkdownReleaseAt(candidate, candidate.streamableAt)) break;
      delta += this.commit(candidate);
      this.committed.push(this.committedSegment(candidate));
      this.candidates.delete(candidateId);
      committedCount += 1;
    }
    this.latest = this.latest.slice(committedCount);
    this.snapshotBytes = 2 * this.latest.reduce((bytes, segment) => bytes + retainedRecordBytes(segment), 0);
    return delta;
  }

  /**
   * When the next pending block becomes committable without any further DOM change, or undefined
   * while it still waits for a boundary. The observer polls then instead of up to an interval late.
   */
  nextReleaseAt(): number | undefined {
    const next = this.delivery === "stream" ? this.latest[0] : undefined;
    if (!next) return undefined;
    const candidateId = this.candidateId(next);
    if (this.referencePrefix && !this.referencePrefix.has(candidateId)) return undefined;
    const candidate = this.candidates.get(candidateId);
    if (!candidate?.streamable || candidate.streamableAt === undefined) return undefined;
    return chatGptMarkdownReleaseAt(candidate, candidate.streamableAt);
  }

  finish(): { markdown: string; delta: string } {
    if (this.consistencyError) throw this.consistencyError;
    let delta = "";
    for (const segment of this.latest) {
      delta += this.commit(segment);
      this.committed.push(this.committedSegment(segment));
    }
    this.candidates.clear();
    this.latest = [];
    this.snapshotBytes = 0;
    return { markdown: this.markdown, delta };
  }

  private reconcile(
    segments: ChatGptMarkdownSegment[],
  ): ChatGptMarkdownSegment[] | ChatGptMarkdownConsistencyError {
    if (this.committed.length === 0 || segments.length === 0) return segments;

    const pending: ChatGptMarkdownSegment[] = [];
    let lastRangedIndex = this.committed.findLastIndex(segment => segment.sourceEnd !== undefined);
    let lastRangedCommitted = this.committed[lastRangedIndex];
    let lastCommittedEnd = lastRangedCommitted?.sourceEnd;
    const hydratedRanges: Array<{ index: number; segment: CommittedChatGptMarkdownSegment }> = [];
    let highestCommittedIndex = -1;
    const matchedCommitted = new Set<number>();
    let sawPending = false;
    let previousSourceStart: number | undefined;

    for (const [observedIndex, segment] of segments.entries()) {
      if (segment.sourceStart !== undefined) {
        if (previousSourceStart !== undefined && segment.sourceStart <= previousSourceStart) {
          return new ChatGptMarkdownConsistencyError(
            "ChatGPT final DOM exposed non-monotonic source ranges",
          );
        }
        previousSourceStart = segment.sourceStart;
      }
      const committedIndex = this.committedIndex(segment, highestCommittedIndex, matchedCommitted);
      if (committedIndex instanceof ChatGptMarkdownConsistencyError) return committedIndex;
      if (committedIndex !== undefined) {
        const committed = this.committed[committedIndex]!;
        const reordered = sawPending || committedIndex <= highestCommittedIndex;
        if (reordered || committed.text !== segment.text) {
          return this.changedCommittedBlockError(
            reordered ? "block_order_changed" : "text_changed",
            segment,
            committed,
            observedIndex,
            committedIndex,
          );
        }
        highestCommittedIndex = committedIndex;
        matchedCommitted.add(committedIndex);
        // Link destinations are answer content even when textContent remains identical.
        if (JSON.stringify(committed.linkTargets ?? []) !== JSON.stringify(segment.linkTargets ?? [])) {
          return this.changedCommittedBlockError("link_target_changed", segment, committed, observedIndex, committedIndex);
        }
        if (committed.sourceStart !== undefined && segment.sourceStart !== undefined
          && committed.sourceStart !== segment.sourceStart) {
          return this.changedCommittedBlockError("source_range_changed", segment, committed, observedIndex, committedIndex);
        }
        // A matching DOM node can acquire its first source range after delivery. Preserve that
        // proven association for later remounts, but only after this whole snapshot passes.
        if (committed.sourceStart === undefined && segment.sourceStart !== undefined) {
          const hydrated = { ...committed, sourceStart: segment.sourceStart, sourceEnd: segment.sourceEnd };
          hydratedRanges.push({ index: committedIndex, segment: hydrated });
          if (committedIndex > lastRangedIndex) {
            lastRangedIndex = committedIndex;
            lastRangedCommitted = hydrated;
            lastCommittedEnd = hydrated.sourceEnd;
          }
        }
        continue;
      }

      if (segment.sourceStart !== undefined && lastCommittedEnd !== undefined) {
        if (segment.sourceStart <= lastCommittedEnd) {
          return this.changedCommittedBlockError(
            "source_range_overlap", segment, lastRangedCommitted!, observedIndex, lastRangedIndex,
          );
        }
        sawPending = true;
        pending.push(segment);
        continue;
      }

      const followsVisibleCommittedTail = highestCommittedIndex === this.committed.length - 1;
      // A known, undelivered paragraph also anchors new content after a virtualized committed
      // tail. Earlier committed blocks are still checked above for edits and reordering.
      if (!followsVisibleCommittedTail && !sawPending && !this.matchesLatestPending(segment)) {
        const tail = this.committed.at(-1)!;
        return new ChatGptMarkdownConsistencyError(
          "ChatGPT final DOM could not be aligned with text already streamed to Codex",
          {
            reason: "unanchored_block",
            observedStart: segment.sourceStart,
            observedEnd: segment.sourceEnd,
            committedStart: tail.sourceStart,
            committedEnd: tail.sourceEnd,
            observedTextChars: segment.text.length,
            committedTextChars: tail.text.length,
            observedTag: segment.tag,
            committedTag: tail.tag,
            observedIndex,
            committedIndex: this.committed.length - 1,
            observedKeyMode: segment.sourceStart === undefined ? "dom-node" : "source-range",
            committedKeyMode: tail.sourceStart === undefined ? "dom-node" : "source-range",
          },
        );
      }
      sawPending = true;
      pending.push(segment);
    }

    for (const hydrated of hydratedRanges) this.committed[hydrated.index] = hydrated.segment;
    return pending;
  }

  private committedIndex(
    segment: ChatGptMarkdownSegment,
    afterIndex: number,
    matched: ReadonlySet<number>,
  ): number | ChatGptMarkdownConsistencyError | undefined {
    // The browser keys blocks by live DOM node identity, so the same node is the strongest proof.
    const sameNode = this.committed.findIndex(committed => segment.key === committed.key);
    if (sameNode >= 0) return sameNode;
    const exact = this.committed.findIndex(committed => (
      segment.sourceStart !== undefined && committed.sourceStart !== undefined
        && segment.sourceStart === committed.sourceStart && segment.tag === committed.tag
    ));
    if (exact >= 0) return exact;

    if (segment.sourceStart !== undefined) return undefined;
    if (!segment.tag) return undefined;
    // A horizontal rule has no textContent but does produce Markdown, so its occurrences are
    // matched in order like repeated paragraphs. Other empty blocks (images, previews) still
    // require an exact DOM key or source range.
    if (!segment.text.trim() && segment.tag !== "hr") return undefined;
    const semanticMatches = this.committed
      .map((committed, index) => ({ committed, index }))
      .filter(({ committed }) => committed.tag === segment.tag && committed.text === segment.text);
    // Match each committed occurrence at most once, in response order. A repeated paragraph must
    // not be rebound to an occurrence this snapshot already consumed; counting from zero breaks
    // when earlier blocks are virtualized away.
    const remaining = semanticMatches.filter(match => match.index > afterIndex);
    if (remaining.length === 1) return remaining[0]!.index;
    if (remaining.length > 1) {
      if (afterIndex >= 0 && remaining[0]!.index === afterIndex + 1) return remaining[0]!.index;
      return new ChatGptMarkdownConsistencyError("ChatGPT final DOM has ambiguous repeated text already streamed to Codex");
    }
    // A known pending tail can survive removal of its committed prefix. Without that evidence,
    // an unseen earlier occurrence is a reorder, not new text.
    const earlier = semanticMatches.find(match => !matched.has(match.index));
    if (earlier && !this.matchesLatestPending(segment)) return earlier.index;
    return undefined;
  }

  private matchesLatestPending(segment: ChatGptMarkdownSegment): boolean {
    const exact = this.latest.filter(candidate => (
      segment.sourceStart !== undefined && candidate.sourceStart !== undefined
        ? segment.sourceStart === candidate.sourceStart && segment.tag === candidate.tag
        : segment.key === candidate.key
    ));
    if (exact.length === 1) return true;
    if (segment.sourceStart !== undefined) return false;
    if (!segment.tag) return false;
    if (!segment.text.trim() && segment.tag !== "hr") return false;
    return this.latest.filter(candidate => (
      candidate.tag === segment.tag && candidate.text === segment.text
    )).length === 1;
  }

  private candidateId(segment: ChatGptMarkdownSegment): string {
    return segment.sourceStart !== undefined
      ? `source:${segment.sourceStart}:${segment.tag ?? ""}`
      : `key:${segment.key}`;
  }

  private committedSegment(segment: ChatGptMarkdownSegment): CommittedChatGptMarkdownSegment {
    return {
      key: segment.key,
      ...(segment.tag ? { tag: segment.tag } : {}),
      text: segment.text,
      ...(segment.linkTargets ? { linkTargets: [...segment.linkTargets] } : {}),
      ...(segment.sourceStart !== undefined ? { sourceStart: segment.sourceStart } : {}),
      ...(segment.sourceEnd !== undefined ? { sourceEnd: segment.sourceEnd } : {}),
    };
  }

  private changedCommittedBlockError(
    reason: NonNullable<ChatGptMarkdownConsistencyError["diagnostic"]>["reason"],
    observed: ChatGptMarkdownSegment,
    committed: CommittedChatGptMarkdownSegment,
    observedIndex: number,
    committedIndex: number,
  ): ChatGptMarkdownConsistencyError {
    return new ChatGptMarkdownConsistencyError(
      "ChatGPT changed a completed text block that was already streamed to Codex",
      {
        reason,
        observedStart: observed.sourceStart,
        observedEnd: observed.sourceEnd,
        committedStart: committed.sourceStart,
        committedEnd: committed.sourceEnd,
        observedTextChars: observed.text.length,
        committedTextChars: committed.text.length,
        observedTag: observed.tag,
        committedTag: committed.tag,
        observedIndex,
        committedIndex,
      },
    );
  }

  private commit(segment: ChatGptMarkdownSegment): string {
    const block = chatGptHtmlToMarkdown(segment.html);
    const recordBytes = retainedRecordBytes(this.committedSegment(segment));
    if (!block) {
      assertByteLimit(this.retainedBytes + this.snapshotBytes + recordBytes, CHATGPT_MARKDOWN_BUFFER_BYTES, "ChatGPT Markdown progress buffer");
      this.retainedBytes += recordBytes;
      return "";
    }
    const separator = this.markdown
      ? segment.group !== undefined && segment.group === this.lastGroup ? "\n" : "\n\n"
      : "";
    const delta = `${separator}${block}`;
    const bytes = Buffer.byteLength(delta, "utf8") + recordBytes;
    assertByteLimit(this.retainedBytes + this.snapshotBytes + bytes, CHATGPT_MARKDOWN_BUFFER_BYTES, "ChatGPT Markdown progress buffer");
    this.retainedBytes += bytes;
    this.markdown += delta;
    this.lastGroup = segment.group;
    return delta;
  }
}
