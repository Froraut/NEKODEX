import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ChatGptMarkdownBuffer, ChatGptMarkdownConsistencyError, chatGptHtmlToMarkdown } from "../src/adapters/chatgpt-web/markdown";

const { createDocument, createWindow } = require("@mixmark-io/domino") as {
  createDocument(html: string): { body: HTMLElement; querySelector(selector: string): HTMLElement | null };
  createWindow(): { HTMLElement: unknown; Node: unknown };
};
const worker = readFileSync("src/adapters/chatgpt-web/browser-worker.ts", "utf8");
const source = worker.split("// CHATGPT_MARKDOWN_CONTENT_BEGIN")[1]?.split("// CHATGPT_MARKDOWN_CONTENT_END")[0];
if (!source) throw new Error("Markdown content projection is missing from browser-worker.ts");
const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
const window = createWindow();
const { contentFor, textFor } = new Function("HTMLElement", "Node", "getComputedStyle",
  `${javascript}; return { contentFor: chatGptMarkdownContent, textFor: markdownText };`,
)(window.HTMLElement, window.Node, (element: HTMLElement) => element.classList.contains("fixture-hidden")
  ? { display: "none" } : element.style) as {
  contentFor(root: HTMLElement): HTMLElement;
  textFor(root: HTMLElement): string;
};

// Exact reporter-supplied synthetic shape from upstream issue #434; no href or
// download receipt was supplied. All other cases below are adversarial fixtures.
const reportedHtml = 'Report: <button class="behavior-btn entity-underline">report.pdf</button>';

test("observed entity-button filename survives Markdown extraction as inert text", () => {
  expect(chatGptHtmlToMarkdown(reportedHtml)).toBe("Report: `report.pdf`");
  const original = createDocument(`<div class="markdown">${reportedHtml}</div>`).body;
  const before = original.innerHTML;
  const projected = contentFor(original);
  expect(textFor(projected)).toBe("Report: report.pdf");
  expect(chatGptHtmlToMarkdown(projected.innerHTML)).toBe("Report: `report.pdf`");
  expect(projected.querySelector("button")).toBeFalsy();
  expect(projected.querySelector("[href]")).toBeFalsy();
  expect(original.innerHTML).toBe(before);
});

test("file labels ignore misleading metadata, nested links, code paths and tooltip labels", () => {
  const html = '<p>Report: <span data-state="closed"><button class="entity-underline behavior-btn"'
    + ' href="sandbox:/invented.pdf" aria-label="wrong.pdf" title="wrong.pdf">'
    + '<a href="https://example.com/invented.pdf"><code>docs/report.pdf</code></a>'
    + '<span role="tooltip">docs/report.pdf</span><span class="sr-only">Download file</span>'
    + '<svg><text>file icon</text></svg></button></span>.</p>';
  const projected = contentFor(createDocument(html).body);
  expect(textFor(projected)).toBe("Report: docs/report.pdf.");
  for (const candidate of [html, projected.innerHTML]) {
    expect(chatGptHtmlToMarkdown(candidate)).toBe("Report: `docs/report.pdf`.");
    expect(chatGptHtmlToMarkdown(candidate)).not.toContain("](");
    expect(chatGptHtmlToMarkdown(candidate)).not.toContain("invented");
  }
});

test("preserved filename syntax cannot become a wiki link, URL autolink or injected code span", () => {
  for (const [label, expected] of [
    ["[[reports/final.pdf]]", "`[[reports/final.pdf]]`"],
    ["[report.pdf](sandbox:/made-up.pdf)", "`[report.pdf](sandbox:/made-up.pdf)`"],
    ["https://example.com/report.pdf", "`https://example.com/report.pdf`"],
    ["`report`.pdf", "`` `report`.pdf ``"],
    ["report``.pdf", "```report``.pdf```"],
  ]) {
    const html = `<button class="behavior-btn entity-underline">${label}</button>`;
    expect(chatGptHtmlToMarkdown(html)).toBe(expected!);
    expect(chatGptHtmlToMarkdown(contentFor(createDocument(html).body).innerHTML)).toBe(expected!);
  }
});

test("an enclosing code node cannot promote an inert file label to a local file link", () => {
  const html = '<code><button class="behavior-btn entity-underline">docs/report.pdf</button></code>';
  const projected = contentFor(createDocument(html).body);
  expect(chatGptHtmlToMarkdown(html)).toBe("`docs/report.pdf`");
  expect(chatGptHtmlToMarkdown(projected.innerHTML)).toBe("`docs/report.pdf`");
  expect(chatGptHtmlToMarkdown(`<pre>${projected.innerHTML}</pre>`)).toBe("```\ndocs/report.pdf\n```");
});

test("a surrounding link cannot promote a filename control to a download target", () => {
  const html = `<a href="https://example.com/not-a-download">${reportedHtml}</a>`;
  expect(chatGptHtmlToMarkdown(html)).toBe("Report: `report.pdf`");
  expect(chatGptHtmlToMarkdown(contentFor(createDocument(html).body).innerHTML)).toBe("Report: `report.pdf`");
});

test("table cell filenames escape pipes without leaking Markdown link syntax into another cell", () => {
  for (const wrap of [(value: string) => value, (value: string) => `<code>${value}</code>`]) {
    const html = '<table><tr><th>File</th><th>Other</th></tr><tr><td>'
      + wrap('<button class="behavior-btn entity-underline">report|[evil](https://example.com)</button>')
      + '</td><td>x</td></tr></table>';
    const expected = '| File | Other |\n| --- | --- |\n| `report\\|[evil](https://example.com)` | x |';
    expect(chatGptHtmlToMarkdown(html)).toBe(expected);
    expect(chatGptHtmlToMarkdown(contentFor(createDocument(html).body).innerHTML)).toBe(expected);
  }
});

test("literal escaped wiki filenames are unchanged and multi-backtick names do not hide later links", () => {
  const literal = String.raw`\[\[report.pdf\]\]`;
  const html = `<p><button class="behavior-btn entity-underline">${literal}</button></p>`;
  expect(chatGptHtmlToMarkdown(html)).toBe(`\`${literal}\``);
  expect(textFor(contentFor(createDocument(html).body))).toBe(literal);
  const multi = '<p><button class="behavior-btn entity-underline">report``.pdf</button></p><p>See [[Notes]]</p>';
  expect(chatGptHtmlToMarkdown(multi)).toBe('```report``.pdf```\n\nSee [Notes](<Notes.md>)');
});

test("ordinary controls and hidden file labels remain excluded", () => {
  for (const html of [
    '<button>report.pdf</button>',
    '<button class="behavior-btn">report.pdf</button>',
    '<button class="entity-underline">report.pdf</button>',
    '<button class="behavior-btn entity-underline" hidden>report.pdf</button>',
    '<span aria-hidden="true"><button class="behavior-btn entity-underline">report.pdf</button></span>',
    '<span style="display:none"><button class="behavior-btn entity-underline">report.pdf</button></span>',
    '<button class="behavior-btn entity-underline" style="visibility:hidden">report.pdf</button>',
    '<button class="behavior-btn entity-underline" style="opacity:0">report.pdf</button>',
  ]) {
    expect(chatGptHtmlToMarkdown(html)).toBe("");
    expect(textFor(contentFor(createDocument(html).body))).toBe("");
  }
  const cssHidden = createDocument('<div class="fixture-hidden">' + reportedHtml + "</div>").body;
  expect(contentFor(cssHidden).querySelector("[data-chatgpt-file-label]")).toBeFalsy();
});

test("same-name references are preserved independently and never discovered in another turn", () => {
  const document = createDocument(`<article id="old">${reportedHtml}</article>`
    + `<article id="current"><p>${reportedHtml}</p><p>${reportedHtml}</p></article>`);
  const oldHtml = document.querySelector("#old")!.innerHTML;
  const projected = contentFor(document.querySelector("#current")!);
  expect(chatGptHtmlToMarkdown(projected.innerHTML)).toBe("Report: `report.pdf`\n\nReport: `report.pdf`");
  expect(projected.querySelectorAll("[data-chatgpt-file-label]").length).toBe(2);
  expect(document.querySelector("#old")!.innerHTML).toBe(oldHtml);
});

test("filename projection preserves raw JSON text and does not read hidden descendants", () => {
  const html = '<p>{"file":"<button class="behavior-btn entity-underline">'
    + 'report.pdf<span hidden>wrong.pdf</span><span class="fixture-hidden">hidden.pdf</span>'
    + '<script>alert(1)</script></button>","ready":true}</p>';
  const projected = contentFor(createDocument(html).body);
  expect(textFor(projected)).toBe('{"file":"report.pdf","ready":true}');
  expect(JSON.parse(textFor(projected))).toEqual({ file: "report.pdf", ready: true });
  expect(projected.querySelector("script")).toBeFalsy();
});

test("changing an already committed filename triggers the existing consistency guard", () => {
  const segmentFor = (filename: string) => {
    const content = contentFor(createDocument(`<p>${reportedHtml.replace("report.pdf", filename)}</p>`).body);
    return { key: "file", tag: "p", html: content.innerHTML, text: textFor(content), sourceStart: 0, sourceEnd: 40, streamable: true };
  };
  const buffer = new ChatGptMarkdownBuffer(undefined, 0);
  expect(buffer.observe([segmentFor("report.pdf")], 1)).toBe("Report: `report.pdf`");
  expect(buffer.observe([segmentFor("changed.pdf")], 2)).toBe("");
  expect(buffer.finish.bind(buffer)).toThrow(ChatGptMarkdownConsistencyError);
});
