import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeResponseSnapshot, encodeResponseSnapshot, snapshotChainEligible,
  serializedResponseStateBytes, type StoredResponseState,
} from "../src/responses/state-snapshot";

const noScope = () => undefined;
function node(items: unknown[], parent?: StoredResponseState): StoredResponseState {
  return { items, createdAt: 123, sizeBytes: serializedResponseStateBytes(items)!,
    depth: parent ? parent.depth + 1 : 0, itemCount: (parent?.itemCount ?? 0) + items.length,
    ...(parent ? { parent } : {}) };
}

test("bounded codec shares ancestors and uses the same exact eligibility budget", () => {
  const parent = node(["first"]);
  const child = node(["second"], parent);
  const roots = new Map([["parent", parent], ["child", child]]);
  const encoded = encodeResponseSnapshot(roots, new Map());
  const decoded = decodeResponseSnapshot(JSON.parse(encoded), noScope)!;
  expect(decoded.entries[1]![1].parent).toBe(decoded.entries[0]![1]);
  expect(decoded.entries[1]![1].itemCount).toBe(2);
  const childOnly = encodeResponseSnapshot(new Map([["child", child]]), new Map());
  const budget = Buffer.byteLength(childOnly);
  expect(snapshotChainEligible("child", child, budget)).toBe(true);
  expect(snapshotChainEligible("child", child, budget - 1)).toBe(false);
  const bounded = encodeResponseSnapshot(roots, new Map(), budget);
  expect(Buffer.byteLength(bounded)).toBeLessThanOrEqual(budget);
  expect(decodeResponseSnapshot(JSON.parse(bounded), noScope)?.entries.map(([id]) => id)).toEqual(["child"]);
});

test("v1 remains readable while invalid parent links and excessive depth are rejected", () => {
  const legacy = decodeResponseSnapshot({ version: 1, states: [["old", { createdAt: 123, items: ["legacy"] }]] }, noScope)!;
  expect(legacy.entries[0]?.[1]).toEqual(node(["legacy"]));
  const invalid = { version: 2, nodes: [{ createdAt: 123, items: [], parent: 0 }], roots: [["bad", 0]] };
  expect(() => decodeResponseSnapshot(invalid, noScope)).toThrow("parent");
  const nodes = Array.from({ length: 9 }, (_, i) => ({ createdAt: 123, items: [], ...(i ? { parent: i - 1 } : {}) }));
  expect(() => decodeResponseSnapshot({ version: 2, nodes, roots: [["deep", 8]] }, noScope)).toThrow("depth");
});

test("rejection-only writes survive a fresh process after an earlier flush; replay remains owner bound", () => {
  const home = mkdtempSync(join(tmpdir(), "responses-snapshot-contract-"));
  const modulePath = new URL("../src/responses/state.ts", import.meta.url).pathname;
  const run = (script: string) => {
    const result = Bun.spawnSync([process.execPath, "-e", `import * as state from ${JSON.stringify(modulePath)};\nimport assert from 'node:assert/strict';\n${script}`], {
      env: { ...process.env, CODEX_CHATGPT_WEB_HOME: home }, timeout: 5000,
    });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  };
  try {
    run(`
      const scope = state.createResponseContinuationScope({providerNamespace:'web', threadId:'one'});
      assert.equal(state.rememberResponseState({input:['first']}, {id:'parent',output:['answer']}, {scope}).status,'retained');
      const replay = state.expandPreviousResponseInput({previous_response_id:'parent', input:['next']}, {scope});
      assert.equal(state.previousResponseReplayPrefixLength(replay),2);
      assert.equal(state.previousResponseReplayPrefixLength({...replay}),0);
      assert.equal(state.rememberResponseState(replay,{id:'child', output:['second']},{scope}).status,'retained');
      state.flushResponseState();
      let reachedSerialization = false;
      const poison = {toJSON(){ reachedSerialization = true; throw new Error('intentional serialization failure'); }};
      assert.deepEqual(state.rememberResponseState({}, {id:'rejected',output:[poison]}),{status:'not-retained',reason:'unserializable'});
      assert.equal(reachedSerialization,true);
      state.flushResponseState();
    `);
    run(`
      const scope = state.createResponseContinuationScope({providerNamespace:'web',threadId:'one'});
      const wrong = state.createResponseContinuationScope({providerNamespace:'web',threadId:'two'});
      assert.equal(state.previousResponseStateStatus('rejected'),'not-retained-unserializable');
      assert.equal(state.previousResponseStateStatus('child',{scope:wrong}),'owner-mismatch');
      const replay = state.resolvePreviousResponseInput({previous_response_id:'child',input:['last']},{scope});
      assert.equal(replay.status,'expanded');
      assert.deepEqual(replay.body.input,['first','answer','next','second','last']);
      assert.equal(state.previousResponseReplayPrefixLength(replay.body),4);
      assert.equal(state.previousResponseReplayPrefixLength({...replay.body}),0);
      const fs = await import('node:fs');
      const path = ${JSON.stringify(join(home, 'responses-state.json'))};
      fs.unlinkSync(path);
      assert.equal(state.previousResponseStateStatus('child',{scope}),'retained');
      assert.equal(state.rememberResponseState({}, {id:'x'.repeat(513),output:[]}).status,'not-retained');
      state.flushResponseState();
      assert.equal(fs.existsSync(path),false);
    `);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
