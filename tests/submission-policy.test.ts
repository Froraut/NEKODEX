import { expect, test } from "bun:test";
import {
  chatGptNewTurnIdentity,
  chatGptReboundTurnIdentity,
  chatGptSubmissionEvidence,
} from "../src/adapters/chatgpt-web/browser-submission-policy";

test("restored history before a retained turn does not obscure the submitted turn", () => {
  const initial = ["group:user:visible", "group:assistant:visible"];
  const users = ["group:user:restored", "group:user:visible", "group:user:submitted"];
  const responses = ["group:assistant:restored", "group:assistant:visible", "group:assistant:submitted"];
  expect(chatGptSubmissionEvidence({ initialTurnIdentities: initial, userIdentities: users,
    responseIdentities: responses, generationRunning: false })).toBe("user_turn");
  expect(chatGptSubmissionEvidence({ initialTurnIdentities: initial, userIdentities: users.slice(0, -1),
    responseIdentities: responses, generationRunning: false })).toBe("assistant_turn");
  expect(chatGptNewTurnIdentity(initial, users)).toBe("group:user:submitted");
  expect(chatGptReboundTurnIdentity(initial, "detached", responses)).toBe("group:assistant:submitted");
});

test("restoring history alone does not acknowledge a submission", () => {
  expect(chatGptSubmissionEvidence({
    initialTurnIdentities: ["user:visible", "assistant:visible"],
    userIdentities: ["user:restored", "user:visible"],
    responseIdentities: ["assistant:restored", "assistant:visible"],
    generationRunning: false,
  })).toBeUndefined();
});

test("two new turns after the retained anchor still reject duplicate submission", () => {
  expect(() => chatGptNewTurnIdentity(["visible"], ["restored", "visible", "submitted", "foreign"]))
    .toThrow("2 new conversation turns");
});

test("an absent anchor cannot disambiguate multiple unknown turns", () => {
  expect(() => chatGptNewTurnIdentity(["visible"], ["restored", "submitted"]))
    .toThrow("2 new conversation turns");
});

test("retained history must preserve its original order", () => {
  expect(() => chatGptNewTurnIdentity(["old-1", "old-2"], ["old-2", "old-1", "submitted"]))
    .toThrow("history order changed");
});

test("an older retained anchor works when newer known turns are virtualized", () => {
  expect(chatGptNewTurnIdentity(["old-1", "old-2"], ["restored", "old-1", "submitted"]))
    .toBe("submitted");
});

test("first turns and a retained bound response keep their existing identity behavior", () => {
  expect(chatGptNewTurnIdentity([], ["submitted"])).toBe("submitted");
  expect(chatGptNewTurnIdentity(["user:submitted"], ["assistant:submitted"]))
    .toBe("assistant:submitted");
  expect(chatGptNewTurnIdentity(["visible"], [])).toBeUndefined();
  expect(chatGptReboundTurnIdentity(["visible"], "accepted", ["restored", "accepted", "foreign"]))
    .toBe("accepted");
});
