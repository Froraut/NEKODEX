import { expect, test } from "bun:test";
import { defaultConfig } from "../src/config";
import { responseRequest } from "../src/server";

const body = (trigger: string) => ({
  model: "chatgpt-web/gpt-6-pro",
  stream: true,
  input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "suggest" }] }],
  client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: "t", turn_id: "u", request_kind: "turn", turn_trigger: trigger }) },
});

test("a Codex next-message prediction on a Web model is declined before any browser work", async () => {
  let adapterCalls = 0;
  const factory = (() => { adapterCalls++; throw new Error("adapter must not run"); }) as never;
  const response = await responseRequest(new Request("http://localhost/v1/responses", {
    method: "POST", body: JSON.stringify(body("composer_predictions")),
  }), defaultConfig("full"), factory, { webAdmission: () => { throw new Error("admission must not run"); } } as never);
  expect(response.status).toBe(400);
  expect(await response.text()).toContain("Next-message predictions are not run on ChatGPT Web models");
  expect(adapterCalls).toBe(0);
});
