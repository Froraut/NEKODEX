import { expect, test } from "bun:test";
import { bridgeToResponsesSSE, buildResponseJSON } from "../src/bridge";
import type { AdapterEvent } from "../src/types";

const cases: Array<{ name: string; events: AdapterEvent[]; status: string; reason?: string }> = [
  { name: "empty adapter EOF", events: [], status: "incomplete", reason: "adapter_eof" },
  { name: "partial adapter EOF", events: [{ type: "text_delta", text: "partial" }], status: "incomplete", reason: "adapter_eof" },
  {
    name: "filtered completion",
    events: [{ type: "text_delta", text: "partial" }, { type: "done", stopReason: "content_filter", endTurn: true }],
    status: "incomplete", reason: "content_filter",
  },
  {
    name: "token-limited completion",
    events: [{ type: "text_delta", text: "partial" }, { type: "done", stopReason: "max_tokens", endTurn: true }],
    status: "incomplete", reason: "max_output_tokens",
  },
  {
    name: "successful completion",
    events: [{ type: "text_delta", text: "complete" }, { type: "done", endTurn: true }],
    status: "completed",
  },
  { name: "adapter error", events: [{ type: "error", message: "fixture failure" }], status: "failed" },
];

for (const compaction of [false, true]) for (const fixture of cases) {
  test(`${compaction ? "compaction" : "response"} terminal parity: ${fixture.name}`, async () => {
    const json = buildResponseJSON(fixture.events, "chatgpt-web/high", { compaction });
    async function* source(): AsyncGenerator<AdapterEvent> { yield* fixture.events; }
    const wire = await new Response(bridgeToResponsesSSE(
      source(), "chatgpt-web/high", undefined, undefined, undefined, undefined, 2_000, { compaction },
    )).text();
    const terminalFrames = wire.split("\n\n")
      .filter(frame => /^event: response\.(completed|incomplete|failed)\n/.test(frame))
      .map(frame => JSON.parse(frame.split("\n").find(line => line.startsWith("data: "))!.slice(6)));
    expect(terminalFrames).toHaveLength(1);
    const streamed = terminalFrames[0]!.response;
    expect(json.status).toBe(fixture.status);
    expect(streamed.status).toBe(fixture.status);
    expect(json.incomplete_details).toEqual(fixture.reason ? { reason: fixture.reason } : undefined);
    expect(streamed.incomplete_details).toEqual(json.incomplete_details);
    if (compaction) {
      const expectedItems = fixture.status === "completed" ? 1 : 0;
      expect((json.output as Array<{ type: string }>).filter(item => item.type === "compaction")).toHaveLength(expectedItems);
      expect(streamed.output.filter((item: { type: string }) => item.type === "compaction")).toHaveLength(expectedItems);
    }
  });
}
