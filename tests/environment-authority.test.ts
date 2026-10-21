import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolveCurrentCodexRolloutEnvironment } from "../src/adapters/chatgpt-web/codex-rollout-environment";
import { adoptFullAccessClaimRoots, sameAuthority } from "../src/adapters/chatgpt-web/thread-environment-resolver";

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

test("extra claimed roots must be exact native grants and no native root may disappear", () => {
  const output = { ...rollout, roots: ["/work/app"], writableRoots: ["/work/app", "/tmp/codex-out"] };
  const exact = { ...output, sandboxPolicy: output.sandboxPolicy };
  // Codex 0.163 lists its granted output directory among the envelope's workspace roots.
  expect(sameAuthority({ ...exact, roots: ["/work/app", "/tmp/codex-out"] }, output)).toBe(true);
  expect(sameAuthority({ ...exact, roots: ["/work/app", "/tmp/ungranted"] }, output)).toBe(false);
  expect(sameAuthority({ ...exact, roots: ["/tmp/codex-out"] }, output)).toBe(false);
});

const fullAccess = {
  cwd: "/work/app", roots: ["/work/app", "/work/lib"], writableRoots: ["/work/app", "/work/lib"],
  sandboxPolicy: { type: "dangerFullAccess" as const }, tools: [],
};
const nativeFallback = { ...fullAccess, roots: ["/work/app"], writableRoots: ["/work/app"] };

test("a full-access rollout without workspace_roots keeps the current envelope's workspace list", () => {
  const adopted = adoptFullAccessClaimRoots({ environment: nativeFallback, workspaceRootsDeclared: false }, fullAccess);
  expect(adopted.roots).toEqual(fullAccess.roots);
  expect(adopted.writableRoots).toEqual(fullAccess.roots);
  expect(sameAuthority(fullAccess, adopted)).toBe(true);
  // The [cwd] fallback alone would have rejected the claim.
  expect(sameAuthority(fullAccess, nativeFallback)).toBe(false);
});

test("declared roots, restricted sandboxes and a different cwd keep the native rollout roots", () => {
  expect(adoptFullAccessClaimRoots({ environment: nativeFallback, workspaceRootsDeclared: true }, fullAccess)).toBe(nativeFallback);
  expect(adoptFullAccessClaimRoots({ environment: nativeFallback, workspaceRootsDeclared: false }, undefined)).toBe(nativeFallback);
  expect(adoptFullAccessClaimRoots({ environment: nativeFallback, workspaceRootsDeclared: false },
    { ...fullAccess, cwd: "/work/lib" })).toBe(nativeFallback);
  expect(adoptFullAccessClaimRoots({ environment: nativeFallback, workspaceRootsDeclared: false },
    { ...fullAccess, sandboxPolicy: { type: "workspaceWrite", writableRoots: fullAccess.roots, networkAccess: true } })).toBe(nativeFallback);
  const restricted = { ...rollout, writableRoots: ["/work/app"], sandboxPolicy: { ...rollout.sandboxPolicy, writableRoots: ["/work/app"] } };
  expect(adoptFullAccessClaimRoots({ environment: restricted, workspaceRootsDeclared: false }, fullAccess)).toBe(restricted);
});

describe("rollout workspace_roots declaration", () => {
  const threadId = "01a06c66-4232-7ae1-9108-69b5f70e0671";
  const turnId = "01a06c66-4380-75c6-a0df-318f890ef6de";
  const homes: string[] = [];
  afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });

  function resolveWith(roots: unknown, metadataRoots: string[]) {
    const codexHome = mkdtempSync(join(tmpdir(), "nekodex-rollout-roots-"));
    homes.push(codexHome);
    const cwd = resolve(codexHome, "work");
    const rolloutPath = join(codexHome, "sessions", "2026", "10", "21", `rollout-2026-10-21T10-00-00-${threadId}.jsonl`);
    mkdirSync(dirname(rolloutPath), { recursive: true });
    const payload: Record<string, unknown> = {
      turn_id: turnId, cwd, approval_policy: "never",
      sandbox_policy: { type: "danger-full-access" }, permission_profile: { type: "disabled" },
    };
    if (roots !== undefined) payload.workspace_roots = roots === "cwd" ? [cwd] : roots;
    writeFileSync(rolloutPath, [
      JSON.stringify({ type: "session_meta", payload: { id: threadId, source: "vscode" } }),
      JSON.stringify({ type: "turn_context", payload }),
    ].join("\n") + "\n");
    return resolveCurrentCodexRolloutEnvironment({
      codexHome, sqliteHome: join(codexHome, "missing-sqlite"), turnId,
      lineage: { threadId, sandboxType: "dangerFullAccess", workspaceRoots: metadataRoots.map(root => resolve(cwd, root)) },
    });
  }

  test("an omitted list on a full-access record is undeclared and cannot conflict with request metadata", () => {
    const result = resolveWith(undefined, [".", "../other"]);
    expect(result?.workspaceRootsDeclared).toBe(false);
    expect(result?.environment.roots).toHaveLength(1);
  });

  test("a declared list still bounds request metadata, and null stays invalid", () => {
    expect(resolveWith("cwd", ["."])?.workspaceRootsDeclared).toBe(true);
    expect(() => resolveWith("cwd", [".", "../other"])).toThrow("conflicts with its Codex rollout roots");
    expect(() => resolveWith(null, ["."])).toThrow();
  });
});
