import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentModeStore } from "../src/agent-mode/store";
import { AgentModeRunner } from "../src/agent-mode/runner";
import { createAgentWorkspaceSnapshots } from "../src/agent-workspace/store";
const require = createRequire(import.meta.url);
const { createLocalWorkspaceService } = require("../launcher/electron/local-workspace.cjs");

async function fixture() {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-pre-turn-")));
  const root = join(parent, "repo"); mkdirSync(root); writeFileSync(join(root, "selected.txt"), "before model offer\n");
  writeFileSync(join(root, "unselected.txt"), "never captured\n");
  const keyPath = join(parent, "private", "grant-key");
  const workspace = createLocalWorkspaceService({ pickDirectory: async () => root,
    registryPath: join(parent, "workspace-private", "registry.json"), agentWorkspaceGrantKeyPath: keyPath });
  const selected = await workspace.pickRoot();
  const taskId = randomUUID(); const familyId = randomUUID();
  const grant = workspace.prepareAgentWorkspaceGrant(selected.id, ["selected.txt", "new.txt"], { taskId, familyId, generation: 1 });
  const storagePath = join(parent, "private", "task-snapshots.sqlite");
  let snapshots = createAgentWorkspaceSnapshots({ storagePath, keyPath });
  return { parent, root, keyPath, workspace, selected, taskId, familyId, grant,
    get snapshots() { return snapshots; },
    reopen() { snapshots.close(); snapshots = createAgentWorkspaceSnapshots({ storagePath, keyPath }); },
    task: { id: taskId, familyId, generation: 1, workspaceSnapshotGrant: grant },
    close() { snapshots.close(); rmSync(parent, { recursive: true, force: true }); } };
}

test("the real runner sees a durable selected-file preimage before it offers execution", async () => {
  const f = await fixture(); const agents = new AgentModeStore(join(f.parent, "agents", "store.sqlite"));
  try {
    const task = agents.createTask({ ownerMode: "agent", id: f.taskId, familyId: f.familyId, mode: "manual",
      originalRequest: "Write the disposable selected file after the snapshot boundary.",
      requirements: [{ id: "file", text: "The disposable file is updated." }],
      stages: [{ id: "write", instruction: "Update the disposable file.", requirementIds: ["file"] }],
      bounds: { maxTurns: 2, maxConcurrent: 1, maxSpend: null }, workspaceSnapshotGrant: f.grant });
    let offers = 0;
    const runner = new AgentModeRunner(agents, { async execute(request, ack) {
      offers++;
      // Observe the durable receipt and actual private bytes from the real hook,
      // before this isolated executor changes anything.
      const preimage = f.snapshots.readSnapshot(request.dispatch.id);
      expect(preimage.receipt.state).toBe("admitted");
      expect(preimage.files.map((file) => file.path)).toEqual(["selected.txt", "new.txt"]);
      expect(Buffer.from(preimage.files[0].bytes!, "base64").toString()).toBe("before model offer\n");
      expect(preimage.files[1].bytes).toBeNull();
      writeFileSync(join(f.root, "selected.txt"), "model fixture effect\n");
      ack("accepted-fixture"); return { receiptId: "finished-fixture", outcome: "completed", actualSpend: null, summary: "Disposable effect complete." };
    } }, "fixture-owner", { beforeOffer: async ({ task, dispatch }) => {
      await f.snapshots.beforeTurn({ task, generation: dispatch.generation, dispatchId: dispatch.id });
    } });
    const dispatched = (await runner.runNext(task.id, { explicitUserAction: true, reservedSpend: 0 }))!;
    expect(offers).toBe(1); expect(dispatched.state).toBe("settled");
    expect(readFileSync(join(f.root, "selected.txt"), "utf8")).toBe("model fixture effect\n");
    expect(f.snapshots.listTask(task.id)).toHaveLength(1);
    f.reopen();
    const persisted = f.snapshots.readSnapshot(dispatched.id);
    expect(Buffer.from(persisted.files[0].bytes!, "base64").toString()).toBe("before model offer\n");
    expect(JSON.stringify(persisted.receipt)).not.toContain("before model offer");
  } finally { agents.close(); f.close(); }
}, 10000);

test("exact dispatch deduplicates without replacing its baseline; drift and a new generation require explicit new admission", async () => {
  const f = await fixture();
  try {
    const dispatchId = randomUUID();
    const first = await f.snapshots.beforeTurn({ task: f.task, generation: 1, dispatchId });
    f.reopen();
    const duplicate = await f.snapshots.beforeTurn({ task: f.task, generation: 1, dispatchId });
    expect(first.state).toBe("ready"); expect(duplicate.state).toBe("ready");
    if (first.state === "ready" && duplicate.state === "ready") {
      expect(duplicate.duplicate).toBe(true); expect(duplicate.receipt).toEqual(first.receipt);
    }
    writeFileSync(join(f.root, "selected.txt"), "human edit after capture\n");
    await expect(f.snapshots.beforeTurn({ task: f.task, generation: 1, dispatchId })).rejects.toThrow("baseline changed");
    expect(f.snapshots.listTask(f.taskId)).toHaveLength(1);
    expect(Buffer.from(f.snapshots.readSnapshot(dispatchId).files[0].bytes!, "base64").toString()).toBe("before model offer\n");
    await expect(f.snapshots.beforeTurn({ task: { ...f.task, generation: 2 }, generation: 2, dispatchId: randomUUID() })).rejects.toThrow("task and generation");
    const renewed = f.workspace.prepareAgentWorkspaceGrant(f.selected.id, ["selected.txt"], { taskId: f.taskId, familyId: f.familyId, generation: 2 });
    const newAdmission = await f.snapshots.beforeTurn({ task: { ...f.task, generation: 2, workspaceSnapshotGrant: renewed }, generation: 2, dispatchId: randomUUID() });
    expect(newAdmission.state).toBe("ready"); expect(f.snapshots.listTask(f.taskId)).toHaveLength(2);
  } finally { f.close(); }
}, 10000);

test("capture failure pauses the real task before offer, retains its failed attempt and cannot retry into a different baseline", async () => {
  const f = await fixture(); const agents = new AgentModeStore(join(f.parent, "agents", "store.sqlite"));
  try {
    rmSync(join(f.root, "selected.txt"));
    const outside = join(f.parent, "outside.txt"); writeFileSync(outside, "outside remains untouched");
    symlinkSync(outside, join(f.root, "selected.txt"));
    const task = agents.createTask({ ownerMode: "agent", id: f.taskId, familyId: f.familyId, mode: "manual",
      originalRequest: "A disposable attempt must stop before model dispatch.",
      requirements: [{ id: "no-send", text: "No model offer if snapshot capture fails." }],
      stages: [{ id: "try", instruction: "Inspect the disposable selected file.", requirementIds: ["no-send"] }],
      bounds: { maxTurns: 2, maxConcurrent: 1, maxSpend: null }, workspaceSnapshotGrant: f.grant });
    let offers = 0;
    const runner = new AgentModeRunner(agents, { async execute() { offers++; throw new Error("Must never reach execution"); } }, "failure-owner",
      { beforeOffer: async ({ task, dispatch }) => { await f.snapshots.beforeTurn({ task, generation: dispatch.generation, dispatchId: dispatch.id }); } });
    await expect(runner.runNext(task.id, { explicitUserAction: true, reservedSpend: 0 })).rejects.toThrow("regular files");
    expect(offers).toBe(0); expect(agents.getTask(task.id)).toMatchObject({ status: "paused", reason: "workspace_snapshot_unavailable", reserved: 0 });
    const dispatch = agents.listDispatches(task.id)[0]; expect(dispatch.state).toBe("cancelled");
    expect(f.snapshots.listTask(task.id)[0].state).toBe("failed");
    rmSync(join(f.root, "selected.txt")); writeFileSync(join(f.root, "selected.txt"), "different later baseline");
    f.reopen();
    await expect(f.snapshots.beforeTurn({ task: f.task, generation: 1, dispatchId: dispatch.id })).rejects.toThrow("Do not recapture");
    expect(f.snapshots.listTask(task.id)).toHaveLength(1);
    expect(readFileSync(outside, "utf8")).toBe("outside remains untouched");
  } finally { agents.close(); f.close(); }
}, 10000);

test("signed grants reject forged paths, revoke explicitly, block root removal while active and reject replaced roots", async () => {
  const f = await fixture();
  try {
    const forged = { ...f.grant, paths: ["unselected.txt"] };
    const retry = f.workspace.prepareAgentWorkspaceGrant(f.selected.id, ["selected.txt", "new.txt"], {
      taskId: f.taskId, familyId: f.familyId, generation: 1,
    });
    expect(retry).toEqual(f.grant);
    expect(f.workspace.listAgentWorkspaceGrants(f.selected.id)).toHaveLength(1);
    expect(() => f.workspace.prepareAgentWorkspaceGrant(f.selected.id, ["unselected.txt"], {
      taskId: f.taskId, familyId: f.familyId, generation: 1,
    })).toThrow("different active workspace scope");
    await expect(f.snapshots.beforeTurn({ task: { ...f.task, workspaceSnapshotGrant: forged }, generation: 1, dispatchId: randomUUID() })).rejects.toThrow("task and generation");
    expect(() => f.workspace.forgetRoot(f.selected.id)).toThrow("revoke");
    expect(await f.snapshots.beforeTurn({ task: { ...f.task, workspaceSnapshotGrant: undefined }, generation: 1, dispatchId: randomUUID() })).toEqual({ state: "skipped" });
    expect(f.snapshots.listTask(f.taskId)).toEqual([]);
    renameSync(f.root, `${f.root}-original`); mkdirSync(f.root); writeFileSync(join(f.root, "selected.txt"), "replacement");
    await expect(f.snapshots.beforeTurn({ task: f.task, generation: 1, dispatchId: randomUUID() })).rejects.toThrow("ancestry changed");
    f.workspace.revokeAgentWorkspaceGrant(f.grant.id);
    expect(f.workspace.listAgentWorkspaceGrants(f.selected.id)[0].state).toBe("revoked");
    await expect(f.snapshots.beforeTurn({ task: f.task, generation: 1, dispatchId: randomUUID() })).rejects.toThrow("revoked");
    expect(f.workspace.forgetRoot(f.selected.id)).toBe(true);
  } finally { f.close(); }
}, 10000);
