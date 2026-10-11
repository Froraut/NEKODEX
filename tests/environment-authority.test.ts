import { expect, test } from "bun:test";
import { sameAuthority } from "../src/adapters/chatgpt-web/thread-environment-resolver";

const rollout = {
  cwd: "/work/app", roots: ["/work/app"], writableRoots: ["/work/app", "/tmp/codex-out"],
  sandboxPolicy: { type: "workspaceWrite" as const, writableRoots: ["/work/app", "/tmp/codex-out"], networkAccess: true },
  tools: [],
};
const claim = {
  ...rollout, writableRoots: ["/work/app"],
  sandboxPolicy: { type: "workspaceWrite" as const, writableRoots: ["/work/app"], networkAccess: false },
};

test("a steering envelope may omit extra writable roots and its network statement", () => {
  expect(sameAuthority({ ...claim, statesNetworkAccess: false }, rollout, true)).toBe(true);
});

test("a stated network difference or an unknown writable root still conflicts", () => {
  expect(sameAuthority({ ...claim, statesNetworkAccess: true }, rollout, true)).toBe(false);
  expect(sameAuthority({ ...claim, writableRoots: ["/elsewhere"], statesNetworkAccess: false }, rollout, true)).toBe(false);
  // Non-steering claims keep exact writable-root equality.
  expect(sameAuthority({ ...claim, statesNetworkAccess: false }, rollout, false)).toBe(false);
});
