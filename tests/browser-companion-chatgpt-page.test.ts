import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as session from "../src/chatgpt-session";

test("bundled ChatGPT page function uses exactly the adapter's reviewed selectors", () => {
  const source = readFileSync(new URL("../browser-companion/chatgpt.js", import.meta.url), "utf8");
  const selectors = Object.fromEntries([...source.matchAll(/^ {4}(\w+): ("(?:[^"\\]|\\.)*"),$/gm)].map(match => [match[1]!, JSON.parse(match[2]!) as string]));
  expect(selectors).toMatchObject({
    composer: session.CHATGPT_COMPOSER_SELECTOR, effort: session.CHATGPT_EFFORT_CONTROL_SELECTOR, send: session.CHATGPT_SEND_BUTTON_SELECTOR,
    stop: session.CHATGPT_STOP_BUTTON_SELECTOR, completion: session.CHATGPT_COMPLETION_ACTION_SELECTOR,
    assistantTurn: session.CHATGPT_ASSISTANT_TURN_SELECTOR, userTurn: session.CHATGPT_USER_TURN_SELECTOR,
  });
  // No host-supplied selectors, script or URL navigation exist in the bundled function.
  expect(source).not.toMatch(/\beval\(|new Function|location\.(assign|replace)|location\.href\s*=|request\.selector/);
});
