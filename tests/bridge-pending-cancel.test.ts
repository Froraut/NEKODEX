import { expect, test } from "bun:test";
import { bridgeToResponsesSSE } from "../src/bridge";
import { AsyncEventQueue } from "../src/event-queue";
import type { AdapterEvent } from "../src/types";

// Observe entry without replacing the actual queue's promise or cancellation behavior.
class ObservedQueue extends AsyncEventQueue<AdapterEvent> {
  readonly entered = Promise.withResolvers<void>();
  override [Symbol.asyncIterator](): AsyncIterator<AdapterEvent> {
    const iterator = super[Symbol.asyncIterator]();
    return {
      next: () => {
        const pending = iterator.next();
        this.entered.resolve();
        return pending;
      },
      return: () => iterator.return!(),
    };
  }
}

for (const mode of ["response", "max_tokens", "compaction"] as const) {
  test(`cancel after queue resolves pending next suppresses ${mode} retention`, async () => {
    const queue = new ObservedQueue();
    const retained: Record<string, unknown>[] = [];
    let cancelled = 0;
    let processed = 0;
    const reader = bridgeToResponsesSSE(
      queue, "fixture", undefined, undefined, undefined, () => queue.cancel(), 2_000,
      {
        compaction: mode === "compaction",
        onCompletedResponse: response => retained.push(response),
        onClientCancel: () => { cancelled++; },
        onProcessedTerminalEvent: () => { processed++; },
      },
    ).getReader();
    try {
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("response.created");
      const pendingRead = reader.read();
      await queue.entered.promise; // Empty real queue now owns an unresolved next() waiter.
      queue.push({ type: "done", endTurn: true, ...(mode === "max_tokens" ? { stopReason: "max_tokens" } : {}) });
      await reader.cancel("fixture disconnect"); // Same turn as push, before next() continuation.
      expect((await pendingRead).done).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 0)); // Let the suspended bridge settle.
      expect(cancelled).toBe(1);
      expect(retained).toHaveLength(0);
      expect(processed).toBe(0);
    } finally {
      await reader.cancel();
      queue.cancel();
    }
  }, 2_000);
}

for (const stopReason of [undefined, "max_tokens"] as const) {
  test(`terminal before cancel retains ${stopReason ?? "completed"} output once`, async () => {
    const queue = new AsyncEventQueue<AdapterEvent>();
    const retained: Record<string, unknown>[] = [];
    const reader = bridgeToResponsesSSE(
      queue, "fixture", undefined, undefined, undefined, () => queue.cancel(), 2_000,
      { onCompletedResponse: response => retained.push(response) },
    ).getReader();
    try {
      queue.push({ type: "text_delta", text: "keep this output" });
      queue.push({ type: "done", endTurn: true, stopReason });
      const terminalName = stopReason ? "response.incomplete" : "response.completed";
      let terminal: Record<string, unknown> | undefined;
      while (!terminal) {
        const chunk = await reader.read();
        expect(chunk.done).toBe(false);
        const frame = new TextDecoder().decode(chunk.value);
        if (frame.startsWith(`event: ${terminalName}\n`)) {
          terminal = JSON.parse(frame.split("\n")[1]!.slice(6)).response;
        }
      }
      await reader.cancel("after terminal");
      expect(retained).toEqual([terminal!]);
      expect(retained[0]!.status).toBe(stopReason ? "incomplete" : "completed");
      expect(retained[0]!.incomplete_details).toEqual(stopReason ? { reason: "max_output_tokens" } : undefined);
      expect(JSON.stringify(retained[0]!.output)).toContain("keep this output");
    } finally {
      await reader.cancel();
      queue.cancel();
    }
  }, 2_000);
}
