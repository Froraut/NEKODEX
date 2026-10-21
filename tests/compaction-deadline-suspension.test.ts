import { expect, test } from "bun:test";
import { suspensionAwareDeadline } from "../src/adapters/chatgpt-web/browser-stage-budget";

function fakeClock() {
  let suspended = 0;
  return { start() {}, suspendedMs: () => suspended, sleep(ms: number) { suspended += ms; } };
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("expires on time when the process stays awake", async () => {
  let expired = 0;
  const deadline = suspensionAwareDeadline(40, () => { expired += 1; }, fakeClock());
  deadline.arm();
  await wait(80);
  expect(expired).toBe(1);
  deadline.arm();
  await wait(80);
  expect(expired).toBe(1);
});

test("refunds slept time instead of expiring", async () => {
  let expired = 0;
  let now = 0;
  const clock = fakeClock();
  const deadline = suspensionAwareDeadline(40, () => { expired += 1; }, clock, () => now);
  deadline.arm();
  // The whole budget elapsed on the wall clock, but the machine was asleep for it.
  now = 45;
  clock.sleep(45);
  await wait(60);
  expect(expired).toBe(0);
  now = 45 + 40;
  await wait(300);
  expect(expired).toBe(1);
});

test("progress re-arms a full budget and clear stops it", async () => {
  let expired = 0;
  const deadline = suspensionAwareDeadline(60, () => { expired += 1; }, fakeClock());
  deadline.arm();
  await wait(40);
  deadline.arm();
  await wait(40);
  expect(expired).toBe(0);
  deadline.clear();
  await wait(80);
  expect(expired).toBe(0);
});
