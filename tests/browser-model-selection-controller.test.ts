import { expect, test } from "bun:test";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";

test("cancelled selection does not acquire or mutate the composer", async () => {
  const worker: { activeComposer(): Promise<never>; selectModelAndEffort(...args: unknown[]): Promise<unknown> } = Object.create(ChatGptBrowserWorker.prototype);
  let acquisitions = 0;
  worker.activeComposer = async () => { acquisitions++; throw new Error("unexpected acquisition"); };
  const abort = new AbortController();
  abort.abort();
  await expect(worker.selectModelAndEffort({}, "gpt-5.6-sol", "max",
    { solAvailable: true, proAvailable: true, proModelVersion: "5.6" }, undefined, undefined, abort.signal))
    .rejects.toMatchObject({ name: "AbortError" });
  expect(acquisitions).toBe(0);
});
