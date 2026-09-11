import { expect, test } from "bun:test";
import { proRetryTooltipFixture as fixture } from "./fixtures/pro-retry-tooltip";
import { chatGptProUsageLimitTooltip } from "../src/adapters/chatgpt-web/pro-retry-hint";


test("synthetic explicit Pro tooltip linkage exposes only the reported retry sentence", async () => {
  const value = fixture({ text: "Limit reached. Try again after Sep 15, 2026. Extra text must not enter the error." });
  expect(await chatGptProUsageLimitTooltip(value.menu, { timeoutMs: 0 })).toBe("Try again after Sep 15, 2026.");
  expect(value.hovered()).toBe(true);
  expect(value.reads).toEqual(["pro-tooltip"]);
});

test("a delayed linked tooltip is read after it mounts", async () => {
  const value = fixture({ delayed: true });
  expect(await chatGptProUsageLimitTooltip(value.menu, { timeoutMs: 100 })).toBe("Try again after Sep 15, 2026.");
  expect(value.reads).toEqual(["pro-tooltip"]);
});

test.each([
  { name: "preexisting unrelated tooltip and chat date", options: { mount: false, descriptionId: null } },
  { name: "newly mounted unlinked portal", options: { descriptionId: null } },
  { name: "missing linked tooltip", options: { mount: false } },
  { name: "hidden linked tooltip", options: { visible: false } },
  { name: "plain chat content linked as a description", options: { descriptionId: "chat-date" } },
  { name: "chat descendant falsely marked as a tooltip", options: { descriptionId: "chat-tooltip" } },
  { name: "editable composer linked as a description", options: { descriptionId: "prompt-textarea" } },
])("ignores $name without harvesting its text", async ({ options }) => {
  const value = fixture(options);
  expect(await chatGptProUsageLimitTooltip(value.menu, { timeoutMs: 0 })).toBeUndefined();
  expect(value.reads).toEqual([]);
});

test("the Pro tooltip wins over preexisting unrelated dates even if they occur later in the document", async () => {
  const value = fixture();
  value.document.body.appendChild(value.document.getElementById("unrelated-tooltip")!);
  expect(await chatGptProUsageLimitTooltip(value.menu, { timeoutMs: 0 })).toBe("Try again after Sep 15, 2026.");
  expect(value.reads).toEqual(["pro-tooltip"]);
});

test("a linked tooltip containing a conversation descendant is never read", async () => {
  const value = fixture({ descriptionId: "unrelated-tooltip", mount: false });
  value.document.getElementById("unrelated-tooltip")!.appendChild(value.document.getElementById("chat-tooltip")!);
  value.document.getElementById("chat-tooltip")!.setAttribute("data-message-author-role", "user");
  expect(await chatGptProUsageLimitTooltip(value.menu, { timeoutMs: 0 })).toBeUndefined();
  expect(value.reads).toEqual([]);
});

test("conflicting linked tooltip dates provide no retry detail", async () => {
  const value = fixture({ descriptionId: "pro-tooltip unrelated-tooltip" });
  expect(await chatGptProUsageLimitTooltip(value.menu, { timeoutMs: 0 })).toBeUndefined();
  expect(value.reads).toEqual(["pro-tooltip", "unrelated-tooltip"]);
});

test.each(["Try again after Sep 31, 2026.", "Try again after Feb 29, 2027.", "Try again after Foo 15, 2026.", "Try again later.", ""])(
  "absent or malformed retry dates add no detail: %s", async text => {
    expect(await chatGptProUsageLimitTooltip(fixture({ text }).menu, { timeoutMs: 0 })).toBeUndefined();
  },
);

test.each(["Try again after Feb 29, 2028.", "Try again after Sep 5, 2026."])("retains a valid explicit retry date: %s", async text => {
  expect(await chatGptProUsageLimitTooltip(fixture({ text }).menu, { timeoutMs: 0 })).toBe(text);
});

test.each([{ failHover: true }, { failRead: true }])("optional hint failure returns no replacement error: %j", async options => {
  expect(await chatGptProUsageLimitTooltip(fixture(options).menu, { timeoutMs: 0 })).toBeUndefined();
});

test("missing or hidden exact Pro row never triggers a hover", async () => {
  for (const hidden of [false, true]) {
    const value = fixture();
    const pro = value.document.getElementById("pro")!;
    if (hidden) pro.setAttribute("hidden", "");
    else pro.textContent = "Pro unrelated label";
    expect(await chatGptProUsageLimitTooltip(value.menu, { timeoutMs: 0 })).toBeUndefined();
    expect(value.hovered()).toBe(false);
    expect(value.reads).toEqual([]);
  }
});

test("duplicate visible exact Pro controls cannot select an arbitrary tooltip", async () => {
  const value = fixture();
  const duplicate = value.document.getElementById("pro")!.cloneNode(true) as Element;
  duplicate.id = "duplicate-pro";
  value.document.getElementById("picker")!.appendChild(duplicate);
  expect(await chatGptProUsageLimitTooltip(value.menu, { timeoutMs: 0 })).toBeUndefined();
  expect(value.hovered()).toBe(false);
  expect(value.reads).toEqual([]);
});
