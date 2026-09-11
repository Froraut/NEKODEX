import { expect } from "bun:test";
import { readFileSync } from "node:fs";

const fixtureHtml = readFileSync(new URL("./pro-retry-tooltip.html", import.meta.url), "utf8");
const { createDocument } = require("@mixmark-io/domino") as { createDocument(html: string): Document };

export function proRetryTooltipFixture(options: {
  descriptionId?: string | null;
  text?: string;
  mount?: boolean;
  visible?: boolean;
  failHover?: boolean;
  failRead?: boolean;
  delayed?: boolean;
} = {}) {
  const document = createDocument(fixtureHtml);
  const pro = document.getElementById("pro")!;
  const reads: string[] = [];
  let hovered = false;
  let evaluations = 0;
  const mount = () => {
    const tooltip = document.createElement("div");
    tooltip.id = "pro-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.textContent = options.text ?? "Limit reached. Try again after Sep 15, 2026.";
    if (options.visible === false) tooltip.hidden = true;
    document.body.appendChild(tooltip);
  };
  // Domino supplies the DOM parser/selector engine; these two layout surfaces
  // model browser visibility and record exactly which node's text was read.
  const prepareLayout = () => {
    for (const element of Array.from(document.querySelectorAll("*"))) {
      Object.defineProperty(element, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ width: element.closest("[hidden]") ? 0 : 100, height: 20 }),
      });
      Object.defineProperty(element, "innerText", {
        configurable: true,
        get: () => { reads.push(element.id); return element.textContent; },
      });
    }
  };
  const wrap = (elements: Element[]): any => ({
    locator: (selector: string) => wrap(elements.flatMap(element => Array.from(element.querySelectorAll(selector)))),
    filter: ({ hasText, visible }: { hasText?: RegExp; visible?: boolean }) => wrap(elements.filter(element =>
      (!hasText || hasText.test(element.textContent ?? "")) && (visible === undefined || !element.closest("[hidden]") === visible))),
    count: async () => elements.length,
    last: () => wrap(elements.slice(-1)),
    isVisible: async () => elements.length === 1 && !elements[0]!.closest("[hidden]"),
    hover: async () => {
      if (options.failHover) throw new Error("hover timed out");
      expect(elements).toEqual([pro]);
      hovered = true;
      if (options.descriptionId !== null) pro.setAttribute("aria-describedby", options.descriptionId ?? "pro-tooltip");
      if (options.mount !== false && !options.delayed) mount();
    },
    evaluate: async (fn: (element: Element) => unknown) => {
      if (options.failRead) throw new Error("detached Pro control");
      evaluations++;
      if (options.delayed && evaluations === 2) mount();
      prepareLayout();
      return fn(elements[0]!);
    },
  });
  return {
    document,
    menu: wrap([document.getElementById("picker")!]),
    reads,
    hovered: () => hovered,
  };
}

