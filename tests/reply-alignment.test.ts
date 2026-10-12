import { afterEach, expect, setSystemTime, test } from "bun:test";
import { chromium } from "playwright-core";
import { responseDomSnapshot } from "../src/adapters/chatgpt-web/browser-response-dom";
import {
  ChatGptMarkdownBuffer,
  ChatGptMarkdownConsistencyError,
  chatGptHtmlToMarkdown,
  type ChatGptMarkdownSegment,
} from "../src/adapters/chatgpt-web/markdown";

// Reply-alignment fixes adapted from upstream 6.1.4–6.1.8 (miuuyy/codex-chatgpt-web).
afterEach(() => { setSystemTime(); });

let clock = 0;
/** Each observation is well past the 750 ms stability window of the previous one. */
const observe = (buffer: ChatGptMarkdownBuffer, segments: ChatGptMarkdownSegment[]): string => {
  clock += 1_000;
  setSystemTime(new Date(clock));
  return buffer.observe(segments);
};
const block = (key: string, tag: string, text: string, extra: Partial<ChatGptMarkdownSegment> = {}): ChatGptMarkdownSegment => ({
  key, tag, text, html: tag === "hr" ? "<hr>" : `<${tag}>${text}</${tag}>`, streamable: true, ...extra,
});
const streamed = (segments: ChatGptMarkdownSegment[]) => segments.map((segment, index) => ({
  ...segment, streamable: index < segments.length - 1,
}));

function katex(source: string, display = false, visual = "VISUAL_COPY"): string {
  const escaped = source.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const math = '<span class="katex"><span class="katex-mathml"><math><semantics>'
    + "<mrow><mi>ACCESSIBLE_COPY</mi></mrow>"
    + `<annotation encoding="application/x-tex">${escaped}</annotation>`
    + `</semantics></math></span><span class="katex-html" aria-hidden="true">${visual}</span></span>`;
  return display ? `<span class="katex-display">${math}</span>` : math;
}

test("KaTeX formulas return exactly one original LaTeX expression", () => {
  const inline = String.raw`E = mc^2`;
  const display = String.raw`r_{\mathrm{eff}} = \exp\left(-\sum_i q_i \log q_i\right)`;
  expect(chatGptHtmlToMarkdown(`<p>Inline: ${katex(inline)}.</p>${katex(display, true)}`))
    .toBe(`Inline: \\(${inline}\\).\n\n\\[\n${display}\n\\]`);
  // TeX comments need their newline; generic HTML whitespace collapsing would change the formula.
  expect(chatGptHtmlToMarkdown(katex("a % comment\n+ b", true))).toBe("\\[\na % comment\n+ b\n\\]");
});

test("wiki-shaped LaTeX stays a formula while prose wiki links still resolve", () => {
  const source = String.raw`\operatorname{rank}\left(\frac{α_{i}}{1+β}\right) < 2 \quad [[x]]`;
  expect(chatGptHtmlToMarkdown(
    `<ul><li>Value ${katex(source)}; <a href="https://example.com">reference</a>.</li></ul>`
      + "<p>Open [[Notes/math|notes]].</p>" + katex(`${source}\n+ γ`, true),
  )).toBe(`- Value \\(${source}\\); [reference](https://example.com).\n\n`
    + `Open [notes](<Notes/math.md>).\n\n\\[\n${source}\n+ γ\n\\]`);
});

test("a formula without one unambiguous TeX source fails instead of inventing one", () => {
  const formula = katex("x");
  expect(() => chatGptHtmlToMarkdown(formula.replace(/<annotation[^>]*>.*?<\/annotation>/, "")))
    .toThrow("one unambiguous LaTeX source");
  expect(() => chatGptHtmlToMarkdown(formula.replace("</semantics>",
    '<annotation encoding="application/x-tex">y</annotation></semantics>'))).toThrow("one unambiguous LaTeX source");
});

test("repeated report headings can first appear after an earlier copy was committed", () => {
  for (const { count, repeated, tag, text } of [
    { count: 93, repeated: [15, 20, 25, 29], tag: "p", text: "変更済み:" },
    { count: 120, repeated: [40, 83], tag: "h2", text: "Functions" },
  ]) {
    const buffer = new ChatGptMarkdownBuffer();
    const report = Array.from({ length: count }, (_, index) => {
      const blockTag = repeated.includes(index) ? tag : "p";
      return block(`${index}:${blockTag}`, blockTag, repeated.includes(index) ? text : `Unique block ${index}`);
    });
    let delivered = "";
    for (let length = 2; length <= report.length; length += 1) {
      delivered += observe(buffer, streamed(report.slice(0, length)));
    }
    const expected = report.map(segment => chatGptHtmlToMarkdown(segment.html)).join("\n\n");
    const finished = buffer.finish();
    expect(finished.markdown).toBe(expected);
    expect(delivered + finished.delta).toBe(expected);
  }
});

test("recreated horizontal rules keep their position among delivered paragraphs", () => {
  const buffer = new ChatGptMarkdownBuffer();
  const first = [block("a", "p", "Intro"), block("r1", "hr", ""), block("b", "p", "Body"), block("c", "p", "Next")];
  observe(buffer, streamed(first));
  observe(buffer, streamed(first));
  // A redraw remounts every node; the rule has no text, so only its order can anchor it.
  const remounted = [block("a2", "p", "Intro"), block("r2", "hr", ""), block("b2", "p", "Body"),
    block("c2", "p", "Next"), block("d2", "p", "Tail")];
  observe(buffer, streamed(remounted));
  expect(buffer.finish().markdown).toBe("Intro\n\n* * *\n\nBody\n\nNext\n\nTail");
});

test("late source ranges carry delivered blocks across later remounts", () => {
  const buffer = new ChatGptMarkdownBuffer();
  const initial = [block("n1", "p", "One"), block("n2", "p", "Two"), block("n3", "p", "Three")];
  observe(buffer, streamed(initial));
  observe(buffer, streamed(initial));
  // The same nodes receive source offsets after delivery, then ChatGPT remounts them.
  observe(buffer, streamed([
    block("n1", "p", "One", { sourceStart: 0, sourceEnd: 3 }),
    block("n2", "p", "Two", { sourceStart: 5, sourceEnd: 8 }),
    block("n3", "p", "Three", { sourceStart: 10, sourceEnd: 15 }),
  ]));
  observe(buffer, streamed([
    block("m2", "p", "Two", { sourceStart: 5, sourceEnd: 8 }),
    block("m3", "p", "Three", { sourceStart: 10, sourceEnd: 15 }),
    block("m4", "p", "Four", { sourceStart: 17, sourceEnd: 21 }),
  ]));
  expect(buffer.finish().markdown).toBe("One\n\nTwo\n\nThree\n\nFour");
});

test("a delivered node cannot move its source range or reappear as new text", () => {
  const buffer = new ChatGptMarkdownBuffer();
  const ranged = [
    block("n1", "p", "One", { sourceStart: 0, sourceEnd: 3 }),
    block("n2", "p", "Two", { sourceStart: 5, sourceEnd: 8 }),
  ];
  observe(buffer, streamed(ranged));
  observe(buffer, streamed(ranged));
  observe(buffer, streamed([
    block("n1", "p", "One", { sourceStart: 1, sourceEnd: 4 }),
    block("n2", "p", "Two", { sourceStart: 5, sourceEnd: 8 }),
  ]));
  let failure: unknown;
  try { buffer.finish(); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ChatGptMarkdownConsistencyError);
  expect((failure as ChatGptMarkdownConsistencyError).diagnostic).toMatchObject({
    reason: "source_range_changed", observedIndex: 0, committedIndex: 0, observedTag: "p",
  });
});

test("an unmatched final block reports structure without answer text", () => {
  const buffer = new ChatGptMarkdownBuffer();
  const initial = [block("a", "p", "Alpha"), block("b", "p", "Beta"), block("c", "p", "Gamma")];
  observe(buffer, streamed(initial));
  observe(buffer, streamed(initial));
  // The committed tail is not visible and nothing pending anchors the new block.
  observe(buffer, streamed([block("a", "p", "Alpha"), block("x", "p", "Unknown")]));
  let failure: unknown;
  try { buffer.finish(); } catch (error) { failure = error; }
  const diagnostic = (failure as ChatGptMarkdownConsistencyError).diagnostic!;
  expect(diagnostic).toMatchObject({ reason: "unanchored_block", observedIndex: 1, observedKeyMode: "dom-node" });
  expect(JSON.stringify(diagnostic)).not.toContain("Unknown");
});

test("text after a mutable file preview waits for completion while the prefix streams", () => {
  const buffer = new ChatGptMarkdownBuffer();
  const preview = block("ref", "div", "", { html: "<div></div>", mutableReference: true });
  const segments = [block("a", "p", "Before"), preview, block("b", "p", "After"), block("c", "p", "Tail")];
  let delivered = observe(buffer, streamed(segments));
  delivered += observe(buffer, streamed(segments));
  // The preview disappears; the following paragraph must still not be released early.
  delivered += observe(buffer, streamed([block("a", "p", "Before"), block("b", "p", "After"), block("c", "p", "Tail")]));
  expect(delivered).toBe("Before");
  expect(buffer.finish()).toEqual({ markdown: "Before\n\nAfter\n\nTail", delta: "\n\nAfter\n\nTail" });
});

// DOM checks run the production page callback in Chromium (CI installs chromium-headless-shell).
const launch = () => chromium.launch({
  headless: true,
  ...(process.env.CHATGPT_DOM_TEST_BROWSER ? { executablePath: process.env.CHATGPT_DOM_TEST_BROWSER } : {}),
});

test("a file preview leaving the answer does not rebind delivered blocks", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<div id="turn"><div class="markdown">
      <p>Intro</p>
      <div data-chatgpt-copy-reference="" data-markdown-copy="contents"><div class="group/resource-row">report.pdf · PDF</div></div>
      <p>After</p><p>Tail</p>
    </div></div>`);
    const turn = page.locator("#turn");
    const buffer = new ChatGptMarkdownBuffer();
    const first = await responseDomSnapshot(turn, {});
    expect(first.markdownSegments.map(segment => [segment.tag, segment.text, Boolean(segment.mutableReference)]))
      .toEqual([["p", "Intro", false], ["div", "", true], ["p", "After", false], ["p", "Tail", false]]);
    let delivered = observe(buffer, first.markdownSegments);
    delivered += observe(buffer, first.markdownSegments);
    await page.evaluate(() => document.querySelector("[data-chatgpt-copy-reference]")!.remove());
    delivered += observe(buffer, (await responseDomSnapshot(turn, {})).markdownSegments);
    const finished = buffer.finish();
    expect(delivered + finished.delta).toBe("Intro\n\nAfter\n\nTail");
  } finally { await browser.close(); }
});

test("KaTeX visual hydration keeps formula identity while a TeX edit still fails", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<div id="turn"><div class="markdown">
      <p>Energy ${katex("E = mc^2", false, "E")}</p><p>Done</p><p>Tail</p>
    </div></div>`);
    const turn = page.locator("#turn");
    const buffer = new ChatGptMarkdownBuffer();
    const first = (await responseDomSnapshot(turn, {})).markdownSegments;
    observe(buffer, first);
    expect(observe(buffer, first)).toBe("Energy \\(E = mc^2\\)\n\nDone");
    await page.evaluate(() => { document.querySelector(".katex-html")!.textContent = "E=mc²"; });
    observe(buffer, (await responseDomSnapshot(turn, {})).markdownSegments);
    expect(buffer.finish().markdown).toBe("Energy \\(E = mc^2\\)\n\nDone\n\nTail");

    const edited = new ChatGptMarkdownBuffer();
    observe(edited, first);
    observe(edited, first);
    await page.evaluate(() => { document.querySelector("annotation")!.textContent = "E = mc^3"; });
    observe(edited, (await responseDomSnapshot(turn, {})).markdownSegments);
    expect(() => edited.finish()).toThrow("changed a completed text block");
  } finally { await browser.close(); }
});
