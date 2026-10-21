import { producerHashesEqual, producerCheck, producerDigest, producerRegistrationFingerprint, type ProducerRegistration, type ProducerRotation, type ProducerEvent, type ExternalProducerRecord, type ExternalProducerReceipt } from './external-producer-types';
import type { AgentLoopSourceAuthority } from './types';
import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { projectNativeSelectedAttachments } from "./native-images";
import { activeTaskEvidence } from "./evidence";
import { buildSemanticReviewPacket, semanticRequirementBasis, type SemanticReviewInput } from "./semantic-review";
import { invocationFingerprint } from "../agent-tools/journal";
import { AGENT_NATIVE_PROTOCOL, nativeDigest, nativeToolCallId } from "./native-protocol";
import type { AgentControl, AgentDispatch, AgentExecutionConfig, AgentTask, AgentToolOutcome, AgentToolReceiptRequest, AgentToolReconciliation, AgentWorker, AgentWorkPacket, CreateAgentTask, ExecutionResult, MailMessage, OutcomeEvidence, OutcomeReview, Requirement, SemanticOutcomeReview, SemanticReviewInvalidEvidence, StageInput } from "./types";

function text(value: string, name: string, max = 16_384): void {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > max) throw new Error(`Invalid ${name}`);
}
function id(value: string): void { text(value, "identity", 160); }
function integer(value: number, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
}
function plan(requirements: Requirement[], stages: StageInput[]): void {
  if (!Array.isArray(requirements) || !requirements.length || requirements.length > 128 || !Array.isArray(stages) || !stages.length || stages.length > 128) throw new Error("Invalid plan size");
  const requirementIds = new Set<string>();
  for (const row of requirements) { id(row.id); text(row.text, "requirement"); if (requirementIds.has(row.id)) throw new Error("Duplicate requirement"); requirementIds.add(row.id); }
  const seen = new Set<string>();
  for (const row of stages) {
    id(row.id); text(row.instruction, "stage instruction");
    if (/^(?:continue|proceed|go on|keep (?:going|working)|продолжай|продолжить)[.!\s]*$/iu.test(row.instruction.trim())) throw new Error("Empty Continue is not a substantive stage");
    if (seen.has(row.id) || !row.requirementIds.length || row.requirementIds.some(key => !requirementIds.has(key)) || (row.dependsOn ?? []).some(key => !seen.has(key))) throw new Error("Invalid stage dependency or requirement");
    seen.add(row.id);
  }
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
const unsettled = new Set(["admitted", "offered", "acked", "unknown"]);

/** One SQLite transaction owner. Opening/reading never starts, retries or recovers execution. */
export class AgentModeStore {
  private readonly db: Database;
  private closed = false;
  constructor(readonly path: string, private readonly now = Date.now) {
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const dir = lstatSync(directory);
    if (!dir.isDirectory() || (process.platform !== "win32" && ((dir.mode & 0o077) !== 0 || (process.getuid && dir.uid !== process.getuid())))) throw new Error("Agent store requires an owner-only directory");
    const file = lstatSync(path, { throwIfNoEntry: false });
    if (file && (!file.isFile() || (process.getuid && file.uid !== process.getuid()))) throw new Error("Unsafe Agent store database");
    this.db = new Database(path, { create: true, strict: true });
    try {
      if (process.platform !== "win32") chmodSync(path, 0o600);
      this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA max_page_count=16384");
      const version = (this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
      if (version > 1) throw new Error("Unsupported Agent store schema");
      this.atomic(() => {
        this.db.exec(`CREATE TABLE IF NOT EXISTS agent_tasks (id TEXT PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS agent_workers (id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES agent_tasks(id), body TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS agent_workers_task ON agent_workers(taskId);
          CREATE TABLE IF NOT EXISTS agent_dispatches (id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES agent_tasks(id), body TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS agent_dispatches_task ON agent_dispatches(taskId);
          CREATE TABLE IF NOT EXISTS agent_mail (id TEXT NOT NULL, revision INTEGER NOT NULL, taskId TEXT NOT NULL REFERENCES agent_tasks(id), body TEXT NOT NULL, PRIMARY KEY(id, revision));
          CREATE INDEX IF NOT EXISTS agent_mail_task ON agent_mail(taskId);
          CREATE TABLE IF NOT EXISTS agent_receipts (id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES agent_tasks(id), kind TEXT NOT NULL, body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS agent_tool_outcomes (id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES agent_tasks(id), body TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS agent_tool_outcomes_task ON agent_tool_outcomes(taskId);
          CREATE TABLE IF NOT EXISTS agent_tool_reconciliations (id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES agent_tasks(id), receiptKey TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS agent_tool_reconciliations_task ON agent_tool_reconciliations(taskId);
          CREATE TABLE IF NOT EXISTS agent_work (id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES agent_tasks(id), workKey TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(taskId,workKey));
          CREATE INDEX IF NOT EXISTS agent_work_task ON agent_work(taskId);
          CREATE TABLE IF NOT EXISTS agent_external_producers (id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES agent_tasks(id), registrationActionId TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS agent_external_producers_task ON agent_external_producers(taskId);
          CREATE TABLE IF NOT EXISTS agent_external_events (id TEXT NOT NULL, producerId TEXT NOT NULL REFERENCES agent_external_producers(id), sourceEventKey TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(producerId,id), UNIQUE(producerId,sourceEventKey));
          PRAGMA user_version=1`);
      });
    } catch (error) { this.db.close(); throw error; }
  }
  close(): void { if (!this.closed) { this.db.close(); this.closed = true; } }
  private atomic<T>(fn: () => T): T { return this.db.transaction(fn).immediate(); }
  private row<T>(table: string, key: string): T | undefined {
    const row = this.db.query(`SELECT body FROM ${table} WHERE id=?`).get(key) as { body: string } | null;
    return row ? JSON.parse(row.body) as T : undefined;
  }
  private rows<T>(table: string, taskId?: string): T[] {
    const rows = (taskId ? this.db.query(`SELECT body FROM ${table} WHERE taskId=? ORDER BY rowid`).all(taskId) : this.db.query(`SELECT body FROM ${table} ORDER BY rowid`).all()) as { body: string }[];
    return rows.map(row => JSON.parse(row.body) as T);
  }
  private saveTask(task: AgentTask): void {
    if (task.archivedAt !== undefined) {
      // Late usage accounting still lands on an archived task; every other field is frozen.
      const frozen = (row: AgentTask) => JSON.stringify({ ...row, spent: 0, reserved: 0, unpricedTurns: 0, updatedAt: 0 });
      const stored = this.row<AgentTask>("agent_tasks", task.id);
      if (!stored || frozen(stored) !== frozen(task)) throw new Error("Task is archived; its ledger is read-only");
    }
    task.updatedAt = this.now();
    const body = JSON.stringify(task);
    if (Buffer.byteLength(body) > 512 * 1024) throw new Error("Agent task quota exceeded; preserve history and export before extending");
    this.db.query("UPDATE agent_tasks SET body=? WHERE id=?").run(body, task.id);
  }
  private saveDispatch(row: AgentDispatch): void { this.db.query("UPDATE agent_dispatches SET body=? WHERE id=?").run(JSON.stringify(row), row.id); }
  private saveWorker(row: AgentWorker): void { this.db.query("UPDATE agent_workers SET body=? WHERE id=?").run(JSON.stringify(row), row.id); }
  private receipt(key: string, taskId: string, kind: string, value: unknown): boolean {
    id(key);
    const old = this.db.query("SELECT taskId, kind, body FROM agent_receipts WHERE id=?").get(key) as { taskId: string; kind: string; body: string } | null;
    if (old) { if (old.taskId !== taskId || old.kind !== kind || old.body !== JSON.stringify(value)) throw new Error("Receipt identity conflict"); return false; }
    this.db.query("INSERT INTO agent_receipts VALUES (?, ?, ?, ?)").run(key, taskId, kind, JSON.stringify(value));
    return true;
  }
  getTask(taskId: string): AgentTask { const row = this.row<AgentTask>("agent_tasks", taskId); if (!row) throw new Error("Unknown Agent task"); return row; }
  listTasks(): AgentTask[] { return this.rows("agent_tasks"); }
  listWorkers(taskId: string): AgentWorker[] { return this.rows("agent_workers", taskId); }
  listDispatches(taskId: string): AgentDispatch[] { return this.rows("agent_dispatches", taskId); }
  getDispatch(dispatchId: string): AgentDispatch { const row = this.row<AgentDispatch>("agent_dispatches", dispatchId); if (!row) throw new Error("Unknown dispatch"); return row; }
  /** A host can display this hold without polling or spending another turn. */
  hold(taskId: string, ownerId: string, generation: number, reason: "turn_bound" | "spend_bound" | "no_new_work"): AgentTask {
    return this.atomic(() => {
      const task = this.getTask(taskId); this.assertOwner(task, ownerId, generation);
      task.status = "paused"; task.reason = reason; this.saveTask(task); return task;
    });
  }
  listReceipts(taskId: string): { id: string; kind: string; body: unknown }[] {
    return (this.db.query("SELECT id, kind, body FROM agent_receipts WHERE taskId=? ORDER BY rowid").all(taskId) as { id: string; kind: string; body: string }[]).map(row => ({ ...row, body: JSON.parse(row.body) }));
  }
  /** Stable host action IDs prevent duplicate UI/network retries from preparing a second turn. */
  command<T>(taskId: string, actionId: string, kind: string, input: unknown, apply: () => T): { result: T; duplicate: boolean } {
    id(actionId); id(kind);
    return this.atomic(() => {
      const key = `action:${actionId}`;
      const old = this.db.query("SELECT taskId, kind, body FROM agent_receipts WHERE id=?").get(key) as { taskId: string; kind: string; body: string } | null;
      if (old) {
        const body = JSON.parse(old.body) as { input: unknown; result: T };
        if (old.taskId !== taskId || old.kind !== kind || !same(body.input, input)) throw new Error("Action identity conflict");
        return { result: body.result, duplicate: true };
      }
      const result = apply(); this.receipt(key, taskId, kind, { input, result }); return { result, duplicate: false };
    });
  }
  readCommandResult<T>(taskId: string, actionId: string, kind: string, input: unknown): { result: T } | undefined {
    id(actionId); id(kind);
    const old = this.db.query("SELECT taskId, kind, body FROM agent_receipts WHERE id=?").get(`action:${actionId}`) as { taskId: string; kind: string; body: string } | null;
    if (!old) return undefined;
    const body = JSON.parse(old.body) as { input: unknown; result: T };
    if (old.taskId !== taskId || old.kind !== kind || !same(body.input, input)) throw new Error("Action identity conflict");
    return { result: body.result };
  }
  createTask(input: CreateAgentTask, nativeMaxConcurrent = 1): AgentTask {
    if (input.ownerMode !== "agent") throw new Error("Client-owned tasks cannot acquire an Agent scheduler");
    if (!["manual", "goal", "loop"].includes(input.mode) || (input.mode === "loop" && input.recurringAuthorized !== true)) throw new Error("Loop requires explicit recurrence authorization");
    text(input.originalRequest, "original request"); plan(input.requirements, input.stages);
    integer(input.bounds.maxConcurrent, "concurrency", 1, 32); integer(input.bounds.maxTurns, "turn bound", 1, 10_000); if (input.bounds.maxSpend !== null) integer(input.bounds.maxSpend, "spend bound", 1);
    if (input.execution) {
      if (!["local-responses", "owned-native"].includes(input.execution.provider)) throw new Error("Unsupported execution provider");
      id(input.execution.model);
      if (input.execution.provider === "owned-native") { id(input.execution.admissionId); if (!Number.isSafeInteger(nativeMaxConcurrent) || nativeMaxConcurrent < 1 || nativeMaxConcurrent > 2 || input.bounds.maxConcurrent > nativeMaxConcurrent) throw new Error("Native task exceeds admitted concurrency capacity"); }
    }
    const task: AgentTask = { schemaVersion: 1, id: input.id ?? randomUUID(), familyId: input.familyId ?? randomUUID(), ownerMode: "agent", mode: input.mode, status: "ready", generation: 1, revision: 1, originalRequest: input.originalRequest, corrections: [], requirements: structuredClone(input.requirements), stages: input.stages.map(stage => ({ ...structuredClone(stage), status: "pending" })), bounds: { ...input.bounds }, turns: 0, spent: 0, reserved: 0, unpricedTurns: 0, ...(input.execution ? { execution: { ...input.execution } } : {}), evidenceRevision: 0, evidence: [], cycle: 1, createdAt: this.now(), updatedAt: this.now() };
    task.turnUnit = input.execution?.provider === "owned-native" ? "native-offers" : "responses-requests";
    id(task.id); id(task.familyId);
    if (input.workspaceSnapshotGrant !== undefined) {
      if (Buffer.byteLength(JSON.stringify(input.workspaceSnapshotGrant)) > 32 * 1024) throw new Error("Workspace snapshot grant exceeds limit");
      task.workspaceSnapshotGrant = structuredClone(input.workspaceSnapshotGrant);
    }
    if (input.nativeAttachments !== undefined) {
      if (input.execution?.provider !== "owned-native") throw new Error("Task selected attachments require Native execution");
      projectNativeSelectedAttachments({ attachments: input.nativeAttachments, modelImageInput: true });
      task.nativeAttachments = structuredClone(input.nativeAttachments);
    }
    if (Buffer.byteLength(JSON.stringify(task)) > 512 * 1024) throw new Error("Task data exceeds bounded storage");
    this.db.query("INSERT INTO agent_tasks VALUES (?, ?)").run(task.id, JSON.stringify(task));
    return structuredClone(task);
  }
  claim(taskId: string, ownerId: string, generation: number): AgentTask {
    id(ownerId);
    return this.atomic(() => {
      const task = this.getTask(taskId);
      if (task.generation !== generation || (task.ownerId && task.ownerId !== ownerId)) throw new Error("Execution owner or generation conflict");
      if (!["ready", "running"].includes(task.status)) throw new Error(`Task ${task.status}`);
      task.ownerId = ownerId; this.saveTask(task); return task;
    });
  }
  release(taskId: string, ownerId: string): void {
    this.atomic(() => {
      const task = this.getTask(taskId);
      if (task.ownerId !== ownerId) throw new Error("Execution owner mismatch");
      if (this.listDispatches(taskId).some(row => row.ownerId === ownerId && ["admitted", "offered", "acked"].includes(row.state))) throw new Error("Owner still has live work");
      delete task.ownerId; this.saveTask(task);
    });
  }
  control(taskId: string, control: AgentControl): AgentTask {
    return this.atomic(() => {
      const task = this.getTask(taskId);
      if (task.status === "stopped" && control.action !== "stop") throw new Error("Stopped task is terminal; create a new task");
      let correctionWork: AgentWorkPacket | undefined;
      if (control.action === "correct") {
        text(control.text, "correction"); plan(control.requirements, control.stages);
        const current = this.listWork(taskId).filter(packet => packet.state === "claimed" && packet.cycle === task.cycle);
        if (current.length > 1 || current.some(packet => packet.workKey !== task.lastWorkKey || packet.enqueuedGeneration > task.generation)) throw new Error("Task current mailbox input requires reconciliation");
        correctionWork = current[0];
      }
      if (control.action === "resume" && task.status === "awaiting_input" && task.stages.some(stage => stage.waitingFor === "user")) throw new Error("Task requires a substantive reply before resuming");
      if (control.action === "reply") {
        text(control.text, "user reply");
        if (task.stages.some(stage => stage.waitingFor === "tools")) throw new Error("Task requires exact pending tool results before applying a user reply");
        if (task.status !== "awaiting_input" || !task.stages.some(stage => stage.waitingFor === "user") || this.listDispatches(taskId).some(row => unsettled.has(row.state))) throw new Error("Task is not settled awaiting user input");
      }
      if (control.action === "mode" && (!["manual", "goal", "loop"].includes(control.mode) || (control.mode === "loop" && control.recurringAuthorized !== true))) throw new Error("Loop requires explicit recurrence authorization");
      // Invalidate before aborting the physical port; late results remain attached to the old generation.
      task.generation++; delete task.ownerId; delete task.review; delete task.semanticReview;
      delete task.loopRun;
      task.status = control.action === "stop" ? "stopped" : control.action === "pause" ? "paused" : "ready";
      task.reason = control.action;
      if (control.action === "correct") {
        task.revision++; task.corrections.push({ revision: task.revision, text: control.text });
        const unchangedRequirements = new Set(control.requirements.filter(row => task.requirements.some(old => old.id === row.id && old.text === row.text)).map(row => row.id));
        const retained = new Set<string>();
        task.stages = control.stages.map(row => {
          const old = task.stages.find(old => old.id === row.id);
          const reusable = old?.status === "completed" && old.instruction === row.instruction && same(old.requirementIds, row.requirementIds) && same(old.dependsOn ?? [], row.dependsOn ?? [])
            && row.requirementIds.every(key => unchangedRequirements.has(key)) && (row.dependsOn ?? []).every(key => retained.has(key));
          if (reusable) retained.add(row.id);
          // StageInput carries plan intent only. Current-cycle mailbox data is
          // restored from its durable claimed packet, including replacement IDs;
          // caller fields never transfer tool continuations or execution grants.
          const { id, instruction, requirementIds, dependsOn } = row;
          return { ...structuredClone({ id, instruction, requirementIds, ...(dependsOn ? { dependsOn } : {}) }),
            ...(correctionWork ? { userInput: correctionWork.text } : {}), status: reusable ? "completed" : "pending",
            ...(reusable && old.dispatchId ? { dispatchId: old.dispatchId } : {}) };
        });
        task.requirements = structuredClone(control.requirements);
        if (task.stages.every(row => row.status === "completed")) task.status = "review_required";
      } else {
        for (const stage of task.stages) if (stage.status === "running") {
          const dispatch = stage.dispatchId ? this.getDispatch(stage.dispatchId) : undefined;
          // Never make an offered instruction eligible for another send when a generation changes.
          stage.status = dispatch && dispatch.state !== "admitted" ? "blocked" : "pending";
          if (stage.status === "pending") delete stage.dispatchId;
        }
      }
      if (control.action === "reply") for (const stage of task.stages) if (stage.waitingFor === "user") {
        stage.userInput = control.text; delete stage.waitingFor;
      }
      if (control.action === "mode") task.mode = control.mode;
      if (["resume", "mode"].includes(control.action)) {
        if (task.stages.some(stage => stage.waitingFor)) { task.status = "awaiting_input"; task.reason = task.stages.some(stage => stage.waitingFor === "user") ? "user_input_required" : "tool_results_required"; }
        else if (task.stages.every(stage => stage.status === "completed")) task.status = "review_required";
      }
      if (control.action === "correct" || control.action === "mode") for (const packet of this.listWork(taskId)) if (packet.state === "pending") {
        packet.state = "held"; this.db.query("UPDATE agent_work SET body=? WHERE id=?").run(JSON.stringify(packet), packet.workId);
      }
      for (const row of this.listDispatches(taskId)) if (row.state === "admitted") {
        row.state = "cancelled"; task.reserved -= row.reservedSpend; this.saveDispatch(row); this.sleepWorker(row);
      }
      this.saveTask(task); return task;
    });
  }
  /** Hides a settled stopped or verified task. Dispatches, receipts, mail, tool outcomes and evidence are kept unchanged. */
  archiveTask(taskId: string): AgentTask {
    return this.atomic(() => {
      const task = this.getTask(taskId);
      if (task.archivedAt !== undefined) return task;
      if (task.status !== "stopped" && task.status !== "verified_complete") throw new Error("Task archive requires a stopped or verified complete task");
      const dispatches = this.listDispatches(taskId);
      if (task.ownerId || task.loopRun || dispatches.some(row => unsettled.has(row.state))) throw new Error("Task archive requires settled execution");
      // A stopped task never applies late tool outcomes to its row; a verified one could, so it must have none left.
      const outcomes = this.effectiveToolOutcomes(taskId), recorded = new Set(this.listToolOutcomes(taskId).map(row => row.idempotencyKey));
      if (task.status === "verified_complete" && (outcomes.some(row => row.state === "outcome_unknown") || dispatches.some(row => row.generation === task.generation
        && (row.result?.continuation?.pending ?? []).some(call => !recorded.has(this.toolKey(row.id, call.toolCallId)))))) throw new Error("Task archive requires settled tool outcomes");
      task.archivedAt = this.now(); task.updatedAt = task.archivedAt;
      this.db.query("UPDATE agent_tasks SET body=? WHERE id=?").run(JSON.stringify(task), task.id);
      return task;
    });
  }
  /** Host-resolved pins only. Completed work and immutable dispatch history survive rebinding. */
  refreshExecution(taskId: string, execution: AgentExecutionConfig, nativeMaxConcurrent = 1): AgentTask {
    return this.atomic(() => {
      const task = this.getTask(taskId);
      if (["stopped", "verified_complete"].includes(task.status)) throw new Error("Task is terminal; execution cannot be refreshed");
      if (!task.execution || task.execution.provider !== execution.provider || task.execution.model !== execution.model) throw new Error("Agent provider/model cannot change during execution refresh");
      id(execution.model);
      if (execution.provider === "owned-native") {
        id(execution.admissionId);
        if (!Number.isSafeInteger(nativeMaxConcurrent) || nativeMaxConcurrent < 1 || nativeMaxConcurrent > 2 || task.bounds.maxConcurrent > nativeMaxConcurrent || task.bounds.maxSpend !== null) throw new Error("Task Native bounds are incompatible with execution refresh");
      }
      if (task.reserved !== 0 || this.listDispatches(taskId).some(row => unsettled.has(row.state))
        || this.effectiveToolOutcomes(taskId).some(row => row.state === "outcome_unknown")) throw new Error("Task has live or unknown execution; reconcile before refreshing");
      const userPaused = task.status === 'paused' && task.reason === 'pause';
      const awaitingInput = task.status === 'awaiting_input';
      task.execution = structuredClone(execution);
      task.generation++;
      delete task.ownerId; delete task.review; delete task.semanticReview; delete task.loopRun; delete task.workspaceSnapshotGrant;
      task.status = userPaused ? 'paused' : awaitingInput ? 'awaiting_input' : task.stages.every(stage => stage.status === "completed") ? "review_required" : "ready";
      task.reason = userPaused ? 'pause' : 'execution_refreshed';
      this.saveTask(task); return task;
    });
  }
  worker(taskId: string, name: string, options: { freshNativeStage?: boolean } = {}): AgentWorker {
    text(name, "worker name", 160);
    return this.atomic(() => {
      const task = this.getTask(taskId);
      const workers = this.listWorkers(taskId);
      const old = workers.find(row => row.name === name);
      if (old && !options.freshNativeStage) return old;
      const freshNativeStage = options.freshNativeStage === true && task.execution?.provider === "owned-native";
      if (workers.length >= 10_000 || (freshNativeStage ? workers.filter(row => row.state !== "sleeping").length >= task.bounds.maxConcurrent : workers.length >= task.bounds.maxConcurrent)) throw new Error("Worker concurrency bound");
      const row: AgentWorker = { id: randomUUID(), taskId, familyId: task.familyId, name, state: "sleeping" };
      this.db.query("INSERT INTO agent_workers VALUES (?, ?, ?)").run(row.id, taskId, JSON.stringify(row)); return row;
    });
  }
  sendMessage(input: { taskId: string; id?: string; revision?: number; sender: string; recipient: string; text: string }): MailMessage {
    return this.atomic(() => this.insertMessage(input));
  }
  private insertMessage(input: { taskId: string; id?: string; revision?: number; sender: string; recipient: string; text: string }): MailMessage {
    const task = this.getTask(input.taskId);
    const key = input.id ?? randomUUID(); const revision = input.revision ?? 1;
    id(key); id(input.sender); id(input.recipient); text(input.text, "mail message"); integer(revision, "message revision", 1);
    const old = this.db.query("SELECT body FROM agent_mail WHERE id=? AND revision=?").get(key, revision) as { body: string } | null;
    if (old) {
      const row = JSON.parse(old.body) as MailMessage;
      if (row.taskId !== task.id || row.sender !== input.sender || row.recipient !== input.recipient || row.text !== input.text) throw new Error("Message identity conflict");
      return row;
    }
    const prior = this.db.query("SELECT body FROM agent_mail WHERE id=? ORDER BY revision DESC LIMIT 1").get(key) as { body: string } | null;
    if (prior) {
      const row = JSON.parse(prior.body) as MailMessage;
      if (row.taskId !== task.id || row.sender !== input.sender || row.recipient !== input.recipient || revision !== row.revision + 1) throw new Error("Message revision conflict");
    } else if (revision !== 1) throw new Error("Message starts at revision one");
    const count = (this.db.query("SELECT count(*) AS count FROM agent_mail WHERE taskId=?").get(task.id) as { count: number }).count;
    if (count >= 10_000) throw new Error("Mailbox quota reached; messages preserved");
    const row: MailMessage = { id: key, revision, taskId: task.id, familyId: task.familyId, generation: task.generation, sender: input.sender, recipient: input.recipient, text: input.text, state: "pending", createdAt: this.now() };
    this.db.query("INSERT INTO agent_mail VALUES (?, ?, ?, ?)").run(key, revision, task.id, JSON.stringify(row)); return row;
  }
  mailbox(taskId: string, recipient: string, unreadOnly = false): MailMessage[] {
    return this.rows<MailMessage>("agent_mail", taskId).filter(row => row.recipient === recipient && (!unreadOnly || row.state !== "acked"));
  }
  listMessages(taskId: string): MailMessage[] { return this.rows("agent_mail", taskId); }
  listToolOutcomes(taskId: string): AgentToolOutcome[] { return this.rows("agent_tool_outcomes", taskId); }
  listToolReconciliations(taskId: string): AgentToolReconciliation[] { return this.rows("agent_tool_reconciliations", taskId); }
  effectiveToolOutcomes(taskId: string): AgentToolOutcome[] {
    const resolved = new Map(this.listToolReconciliations(taskId).map(fact => [fact.idempotencyKey, fact.outcome]));
    return this.listToolOutcomes(taskId).map(outcome => resolved.get(outcome.idempotencyKey) ?? outcome);
  }
  attachWorkspaceSnapshotGrant(taskId: string, grant: unknown): AgentTask {
    if (grant === undefined || Buffer.byteLength(JSON.stringify(grant)) > 32 * 1024) throw new Error("Invalid bounded workspace snapshot grant");
    return this.atomic(() => {
      const task = this.getTask(taskId);
      if (["stopped", "verified_complete"].includes(task.status) || this.listDispatches(taskId).some(row => unsettled.has(row.state))) throw new Error("Task has unsettled work; workspace snapshot grant cannot change");
      task.workspaceSnapshotGrant = structuredClone(grant);
      if (task.status === "paused" && ["workspace_snapshot_unavailable", "workspace_snapshot_grant_renewal_required"].includes(task.reason ?? "")) { task.status = "ready"; task.reason = "workspace_snapshot_grant_updated"; }
      this.saveTask(task); return task;
    });
  }
  offerMessage(taskId: string, messageId: string, revision: number, recipient: string): MailMessage {
    return this.mailTransition(taskId, messageId, revision, recipient);
  }
  acknowledgeMessage(taskId: string, messageId: string, revision: number, recipient: string, receipt: string): MailMessage {
    id(receipt); return this.mailTransition(taskId, messageId, revision, recipient, receipt);
  }
  private mailTransition(taskId: string, key: string, revision: number, recipient: string, receipt?: string): MailMessage {
    return this.atomic(() => {
      const found = this.db.query("SELECT body FROM agent_mail WHERE id=? AND revision=? AND taskId=?").get(key, revision, taskId) as { body: string } | null;
      if (!found) throw new Error("Unknown message revision");
      const row = JSON.parse(found.body) as MailMessage;
      if (row.recipient !== recipient) throw new Error("Mailbox recipient mismatch");
      if (row.state === "acked") { if (receipt && row.ackReceipt !== receipt) throw new Error("Mailbox receipt conflict"); return row; }
      if (receipt && row.state !== "offered") throw new Error("Message was not offered");
      row.state = receipt ? "acked" : "offered";
      if (receipt) row.ackReceipt = receipt;
      this.db.query("UPDATE agent_mail SET body=? WHERE id=? AND revision=?").run(JSON.stringify(row), key, revision); return row;
    });
  }
  admit(taskId: string, ownerId: string, generation: number, workerId: string, stageId: string, reservedSpend: number): AgentDispatch {
    integer(reservedSpend, "reserved spend");
    return this.atomic(() => {
      const task = this.getTask(taskId); this.assertOwner(task, ownerId, generation);
      const rows = this.listDispatches(taskId);
      if (rows.some(row => row.state === "unknown")) throw new Error("Unknown send requires reconciliation; replay forbidden");
      if (this.effectiveToolOutcomes(taskId).some(row => row.state === "outcome_unknown")) throw new Error("Unknown send requires tool reconciliation; replay forbidden");
      if (rows.some(row => row.generation !== generation && unsettled.has(row.state))) throw new Error("Prior generation still owns unsettled work");
      if (rows.filter(row => unsettled.has(row.state)).length >= task.bounds.maxConcurrent) throw new Error("Concurrency bound");
      if ((task.bounds.maxSpend !== null && reservedSpend < 1) || task.turns + rows.filter(row => row.state === "admitted").length >= task.bounds.maxTurns || (task.bounds.maxSpend !== null && task.spent + task.reserved + reservedSpend > task.bounds.maxSpend)) throw new Error("Task turn/spend bound");
      const stage = task.stages.find(row => row.id === stageId);
      if (!stage || stage.status !== "pending" || stage.waitingFor || (stage.dependsOn ?? []).some(key => task.stages.find(row => row.id === key)?.status !== "completed")) throw new Error("Stage is not ready");
      if (stage.continuationFrom) {
        const source = this.getDispatch(stage.continuationFrom);
        const outcomes = this.effectiveToolOutcomes(taskId);
        if ((source.generation !== generation && stage.continuationGeneration !== generation) || source.taskRevision !== task.revision || !source.result?.continuation || source.result.continuation.pending.some(call => !outcomes.some(row => row.scope.generation === source.generation && row.scope.toolCallId === call.toolCallId && row.state !== "outcome_unknown"))) throw new Error("Unknown send requires current exact tool continuation results");
      }
      const worker = this.row<AgentWorker>("agent_workers", workerId);
      if (!worker || worker.taskId !== taskId || worker.familyId !== task.familyId || worker.state !== "sleeping") throw new Error("Worker is not sleeping in this task family");
      const dispatchId = randomUUID();
      const message = this.insertMessage({ taskId, sender: "coordinator", recipient: workerId, text: stage.instruction });
      if (stage.userInput) this.insertMessage({ taskId, sender: "user", recipient: workerId, text: stage.userInput });
      const packet = new Map<string, MailMessage>();
      for (const mail of this.mailbox(taskId, workerId, true)) if (mail.generation === generation) packet.set(mail.id, mail);
      const row: AgentDispatch = { id: dispatchId, taskId, familyId: task.familyId, generation, taskRevision: task.revision, ownerId, workerId, stageId, messageId: message.id, messages: [...packet.values()].map(mail => ({ id: mail.id, revision: mail.revision })), state: "admitted", reservedSpend, createdAt: this.now() };
      if (stage.continuationFrom) row.continuationOf = stage.continuationFrom;
      this.db.query("INSERT INTO agent_dispatches VALUES (?, ?, ?)").run(row.id, taskId, JSON.stringify(row));
      worker.state = "busy"; worker.dispatchId = row.id; this.saveWorker(worker);
      stage.status = "running"; stage.dispatchId = row.id; task.reserved += reservedSpend; task.status = "running"; this.saveTask(task); return row;
    });
  }
  private assertOwner(task: AgentTask, ownerId: string, generation: number): void {
    if (task.ownerId !== ownerId || task.generation !== generation || !["ready", "running"].includes(task.status)) throw new Error("Stale execution owner or generation");
  }
  offer(dispatchId: string, ownerId: string): AgentDispatch {
    return this.atomic(() => {
      const row = this.getDispatch(dispatchId); this.assertOwner(this.getTask(row.taskId), ownerId, row.generation);
      if (row.ownerId !== ownerId || row.state !== "admitted") throw new Error("Dispatch cannot be offered twice");
      row.state = "offered"; this.saveDispatch(row);
      const task = this.getTask(row.taskId); task.turns++; this.saveTask(task);
      for (const mail of row.messages) this.offerMessage(row.taskId, mail.id, mail.revision, row.workerId);
      return row;
    });
  }
  failBeforeOffer(dispatchId: string, ownerId: string): void {
    this.atomic(() => {
      const row = this.getDispatch(dispatchId); const task = this.getTask(row.taskId);
      if (row.state !== "admitted" || task.ownerId !== ownerId || task.generation !== row.generation) return;
      row.state = "cancelled"; this.saveDispatch(row); this.sleepWorker(row); task.reserved -= row.reservedSpend;
      const stage = task.stages.find(stage => stage.dispatchId === row.id);
      if (stage) { stage.status = "pending"; delete stage.dispatchId; }
      if (["ready", "running"].includes(task.status)) { task.status = "paused"; task.reason = "workspace_snapshot_unavailable"; }
      this.saveTask(task);
    });
  }
  acknowledge(dispatchId: string, acceptanceReceipt: string): AgentDispatch {
    id(acceptanceReceipt);
    return this.atomic(() => {
      const row = this.getDispatch(dispatchId);
      if (row.acceptanceReceipt) { if (row.acceptanceReceipt !== acceptanceReceipt) throw new Error("Acceptance receipt conflict"); return row; }
      if (!["offered", "unknown"].includes(row.state)) throw new Error("Dispatch not offered");
      row.acceptanceReceipt = acceptanceReceipt;
      // A late ACK proves acceptance, not completion; keep unknown after owner recovery.
      if (row.state !== "unknown") row.state = "acked";
      this.saveDispatch(row);
      for (const mail of row.messages) this.acknowledgeMessage(row.taskId, mail.id, mail.revision, row.workerId, acceptanceReceipt);
      return row;
    });
  }
  /** The in-process Responses ingress consumes one dispatch exactly once before model admission. */
  claimTransport(dispatchId: string, ownerId: string, payloadDigest: string): void {
    if (!/^[a-f0-9]{64}$/.test(payloadDigest)) throw new Error("Invalid transport payload identity");
    this.atomic(() => {
      const row = this.getDispatch(dispatchId); this.assertOwner(this.getTask(row.taskId), ownerId, row.generation);
      if (row.ownerId !== ownerId || row.state !== "offered" || row.transportClaim) throw new Error("Dispatch transport was already consumed");
      row.transportClaim = { id: `http:${row.id}`, payloadDigest };
      this.saveDispatch(row); this.receipt(row.transportClaim.id, row.taskId, "transport_claim", { dispatchId, payloadDigest });
    });
  }
  markUnknown(dispatchId: string, reason: string): void {
    text(reason, "unknown reason");
    this.atomic(() => {
      const row = this.getDispatch(dispatchId);
      if (row.state === "settled" || row.state === "cancelled") return;
      if (row.state === "admitted") throw new Error("Never-offered work has no uncertain send");
      row.state = "unknown"; this.saveDispatch(row);
      const worker = this.row<AgentWorker>("agent_workers", row.workerId)!; worker.state = "unknown"; this.saveWorker(worker);
      const task = this.getTask(row.taskId);
      if (task.generation === row.generation && task.status !== "stopped") { task.status = "paused"; task.reason = reason; this.saveTask(task); }
    });
  }
  private sleepWorker(row: AgentDispatch): void {
    const worker = this.row<AgentWorker>("agent_workers", row.workerId)!;
    if (worker.dispatchId === row.id) { worker.state = "sleeping"; delete worker.dispatchId; this.saveWorker(worker); }
  }
  settle(dispatchId: string, result: ExecutionResult): AgentDispatch {
    id(result.receiptId); text(result.summary, "result summary");
    if (!["completed", "failed", "awaiting_input", "not_sent"].includes(result.outcome)) throw new Error("Invalid execution outcome");
    if (result.actualSpend !== null) integer(result.actualSpend, "actual spend");
    if (result.outcome === "not_sent" && result.actualSpend !== 0) throw new Error("Not-sent requires zero known spend");
    if (result.continuation) {
      const next = result.continuation;
      id(next.rootDispatchId);
      if (result.outcome !== "awaiting_input" || !Array.isArray(next.pending) || !next.pending.length || next.pending.length > 16 || Buffer.byteLength(JSON.stringify(next)) > 512 * 1024) throw new Error("Invalid bounded tool continuation");
      const calls = new Set<string>();
      for (const call of next.pending) { id(call.toolCallId); text(call.tool, "tool identity", 240); if (calls.has(call.toolCallId) || !call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)) throw new Error("Invalid tool call identity"); calls.add(call.toolCallId); }
      if (next.kind === "owned-native") {
        const source = this.getDispatch(dispatchId);
        if (this.getTask(source.taskId).execution?.provider !== "owned-native" || next.version !== 1 || next.protocol !== AGENT_NATIVE_PROTOCOL || next.pending.length !== 1
          || next.taskGeneration !== source.generation || next.taskRevision !== source.taskRevision || !Array.isArray(next.catalog) || next.catalog.length > 64
          || next.catalogDigest !== nativeDigest(next.catalog) || !Array.isArray(next.requestIds) || !next.requestIds.length || next.requestIds.length > 128 || new Set(next.requestIds).size !== next.requestIds.length) throw new Error("Invalid Native tool continuation");
        id(next.workerBindingId); integer(next.workerGeneration, "Native worker generation", 1); id(next.nativeTurnReceiptId);
        if (next.imageUsage) { integer(next.imageUsage.count, "Native image count", 0, 2); integer(next.imageUsage.byteLength, "Native image bytes", 0, 160 * 1024); }
        for (const requestId of next.requestIds) id(requestId);
        for (const call of next.pending) {
          if (call.protocol !== AGENT_NATIVE_PROTOCOL || !next.requestIds.includes(call.requestId) || call.toolCallId !== nativeToolCallId(dispatchId, call.requestId)) throw new Error("Invalid Native adapter call identity");
        }
      } else {
        if (next.kind !== undefined && next.kind !== "responses" || !Array.isArray(next.input) || !Array.isArray(next.output) || !Array.isArray(next.tools) || !Array.isArray(next.toolMap)) throw new Error("Invalid Responses tool continuation");
        id(next.responseId); for (const call of next.pending) id(call.wireName);
      }
    }
    return this.atomic(() => {
      const row = this.getDispatch(dispatchId);
      if (row.result) { if (!same(row.result, result)) throw new Error("Terminal receipt conflict"); return row; }
      if (!["offered", "acked", "unknown"].includes(row.state)) throw new Error("Dispatch has no offered execution");
      const task = this.getTask(row.taskId);
      this.receipt(result.receiptId, task.id, "execution", { dispatchId, result });
      row.result = structuredClone(result); row.state = "settled"; row.late = task.generation !== row.generation || task.revision !== row.taskRevision;
      if (result.outcome === "not_sent") task.turns--;
      if (!row.acceptanceReceipt && result.outcome !== "not_sent") {
        row.acceptanceReceipt = result.receiptId;
        for (const mail of row.messages) this.acknowledgeMessage(row.taskId, mail.id, mail.revision, row.workerId, result.receiptId);
      }
      if (result.actualSpend !== null) { task.reserved -= row.reservedSpend; task.spent += result.actualSpend; }
      else task.unpricedTurns++;
      this.saveDispatch(row); this.sleepWorker(row);
      this.insertMessage({ taskId: task.id, id: `result:${row.id}`, sender: row.workerId, recipient: "coordinator", text: result.summary });
      if (!row.late) {
        const stage = task.stages.find(stage => stage.id === row.stageId && stage.dispatchId === row.id);
        if (stage) {
          stage.status = result.outcome === "completed" ? "completed" : result.outcome === "failed" ? "failed" : "pending";
          if (stage.status === "pending") delete stage.dispatchId;
          if (result.outcome === "awaiting_input") stage.waitingFor = result.continuation ? "tools" : "user"; else delete stage.waitingFor;
          if (result.continuation) { stage.continuationFrom = row.id; stage.continuationGeneration = task.generation; }
          else { delete stage.continuationFrom; delete stage.continuationGeneration; }
        }
        // Another worker's failure, unknown result or human wait must survive this receipt.
        if (task.status !== "paused") this.updateProgress(task);
        if (result.outcome === "not_sent") { task.status = "paused"; task.reason = "not_sent"; }
        else if (task.status !== "paused" && task.status !== "awaiting_input") task.reason = result.outcome;
      } else if (task.revision === row.taskRevision && task.status !== "stopped") {
        const stage = task.stages.find(stage => stage.id === row.stageId && stage.dispatchId === row.id);
        if (stage && stage.status !== "completed") { stage.status = "blocked"; task.status = "paused"; task.reason = "late_result_review_required"; }
      }
      if (task.status !== "stopped" && task.bounds.maxSpend !== null && (result.actualSpend === null || result.actualSpend > row.reservedSpend || task.spent + task.reserved >= task.bounds.maxSpend)) { task.status = "paused"; task.reason = result.actualSpend === null ? "usage_unknown" : "spend_bound"; }
      this.saveTask(task); return row;
    });
  }
  private updateProgress(task: AgentTask): void {
    if (task.stages.some(stage => stage.status === "failed" || stage.status === "blocked")) { task.status = "paused"; task.reason = "stage_failure_or_review_required"; }
    else if (task.stages.some(stage => stage.waitingFor)) { task.status = "awaiting_input"; task.reason = task.stages.some(stage => stage.waitingFor === "user") ? "user_input_required" : "tool_results_required"; }
    else task.status = task.stages.every(stage => stage.status === "completed") ? "review_required" : task.stages.some(stage => stage.status === "running") ? "running" : "ready";
  }
  resolveToolCall(scope: AgentToolOutcome["scope"]): { tool: string; arguments: Record<string, unknown>; idempotencyKey: string } | undefined {
    const task = this.getTask(scope.taskId);
    if (task.generation !== scope.generation || ["stopped", "verified_complete"].includes(task.status)) return undefined;
    for (const row of this.listDispatches(task.id).reverse()) {
      if (row.generation !== scope.generation || row.taskRevision !== task.revision || row.state !== "settled") continue;
      const call = row.result?.continuation?.pending.find(call => call.toolCallId === scope.toolCallId);
      if (call) return { tool: call.tool, arguments: structuredClone(call.arguments), idempotencyKey: this.toolKey(row.id, call.toolCallId) };
    }
    return undefined;
  }
  /** Canonical historical observation only. Unlike resolveToolCall this confers
   * no current invocation authority; use solely with the matching retained journal. */
  resolveSavedToolCall(scope: AgentToolOutcome['scope']): { tool: string; arguments: Record<string, unknown>; idempotencyKey: string } | undefined {
    this.getTask(scope.taskId);
    for (const row of this.listDispatches(scope.taskId).reverse()) {
      if (row.generation !== scope.generation || row.state !== 'settled') continue;
      const call = row.result?.continuation?.pending.find(call => call.toolCallId === scope.toolCallId);
      if (call) return { tool: call.tool, arguments: structuredClone(call.arguments), idempotencyKey: this.toolKey(row.id, call.toolCallId) };
    }
    return undefined;
  }
  recordToolOutcome(outcome: AgentToolOutcome): AgentTask {
    id(outcome.idempotencyKey); id(outcome.scope.toolCallId);
    if (!["completed", "failed", "outcome_unknown"].includes(outcome.state) || Buffer.byteLength(JSON.stringify(outcome)) > 256 * 1024) throw new Error("Invalid bounded tool outcome");
    return this.atomic(() => {
      const task = this.getTask(outcome.scope.taskId);
      const old = this.row<AgentToolOutcome>("agent_tool_outcomes", outcome.idempotencyKey);
      if (old) {
        if (same(old, outcome)) return task;
        const reconciled = this.listToolReconciliations(task.id).find(fact => fact.idempotencyKey === outcome.idempotencyKey);
        if (old.state === "outcome_unknown" && reconciled && same(reconciled.outcome, outcome)) return task;
        throw new Error("Tool terminal receipt conflict");
      }
      const source = this.listDispatches(task.id).find(row => row.generation === outcome.scope.generation && row.result?.continuation?.pending.some(call => call.toolCallId === outcome.scope.toolCallId));
      const call = source?.result?.continuation?.pending.find(call => call.toolCallId === outcome.scope.toolCallId);
      if (!source || !call || call.tool !== outcome.tool || outcome.idempotencyKey !== this.toolKey(source.id, call.toolCallId)) throw new Error("Tool outcome has no exact owned call");
      this.db.query("INSERT INTO agent_tool_outcomes VALUES (?, ?, ?)").run(outcome.idempotencyKey, task.id, JSON.stringify(outcome));
      if (task.generation === outcome.scope.generation && task.revision === source.taskRevision && task.status !== "stopped") {
        if (outcome.state === "outcome_unknown") { task.status = "paused"; task.reason = "tool_outcome_unknown"; }
        else if (source.result!.continuation!.pending.every(pending => this.effectiveToolOutcomes(task.id).some(result => result.scope.generation === outcome.scope.generation && result.scope.toolCallId === pending.toolCallId && result.state !== "outcome_unknown"))) {
          const stage = task.stages.find(row => row.continuationFrom === source.id);
          if (stage) delete stage.waitingFor;
          if (["ready", "running", "awaiting_input"].includes(task.status)) { this.updateProgress(task); if (task.status !== "awaiting_input") task.reason = "tool_results_ready"; }
        }
        this.saveTask(task);
      }
      return task;
    });
  }
  toolReceiptRequest(taskId: string, idempotencyKey: string): AgentToolReceiptRequest {
    id(idempotencyKey); this.getTask(taskId);
    for (const source of this.listDispatches(taskId)) if (source.state === "settled") for (const call of source.result?.continuation?.pending ?? []) {
      if (this.toolKey(source.id, call.toolCallId) === idempotencyKey) return { scope: { taskId, generation: source.generation, toolCallId: call.toolCallId }, tool: call.tool, arguments: structuredClone(call.arguments), idempotencyKey };
    }
    throw new Error("Tool receipt has no exact owned request");
  }
  recordToolReconciliation(taskId: string, request: AgentToolReceiptRequest, outcome: AgentToolOutcome, executionOwnerId?: string): { task: AgentTask; reconciliation: AgentToolReconciliation } {
    if (outcome.state === "outcome_unknown" || !["completed", "failed"].includes(outcome.state) || Buffer.byteLength(JSON.stringify(outcome)) > 256 * 1024) throw new Error("Tool reconciliation requires a bounded terminal receipt");
    return this.atomic(() => {
      const exact = this.toolReceiptRequest(taskId, request.idempotencyKey);
      const fingerprint = invocationFingerprint(exact);
      if (invocationFingerprint(request) !== fingerprint || outcome.idempotencyKey !== exact.idempotencyKey || outcome.tool !== exact.tool
        || outcome.scope.taskId !== exact.scope.taskId || outcome.scope.generation !== exact.scope.generation || outcome.scope.toolCallId !== exact.scope.toolCallId) throw new Error("Tool reconciliation receipt scope mismatch");
      const task = this.getTask(taskId);
      const original = this.listToolOutcomes(taskId).find(row => row.idempotencyKey === exact.idempotencyKey);
      if (!original || original.state !== "outcome_unknown" || original.tool !== exact.tool || !same(original.scope, exact.scope)) throw new Error("Tool reconciliation has no original unknown outcome");
      const previous = this.listToolReconciliations(taskId).find(row => row.idempotencyKey === exact.idempotencyKey);
      if (previous) { if (previous.requestFingerprint !== fingerprint || !same(previous.outcome, outcome)) throw new Error("Tool reconciliation terminal receipt conflict"); return { task, reconciliation: previous }; }
      const source = this.listDispatches(taskId).find(row => row.generation === exact.scope.generation && row.result?.continuation?.pending.some(call => call.toolCallId === exact.scope.toolCallId && this.toolKey(row.id, call.toolCallId) === exact.idempotencyKey))!;
      const digest = createHash("sha256").update(JSON.stringify(outcome)).digest("hex");
      const fact: AgentToolReconciliation = { id: `tool-reconciliation:${createHash("sha256").update(JSON.stringify([exact.idempotencyKey, fingerprint, digest])).digest("hex")}`, taskId,
        idempotencyKey: exact.idempotencyKey, sourceDispatchId: source.id, originalScope: structuredClone(exact.scope), sourceTaskRevision: source.taskRevision,
        observedTaskGeneration: task.generation, observedTaskRevision: task.revision, requestFingerprint: fingerprint, terminalReceiptDigest: digest,
        outcome: structuredClone(outcome), late: task.generation !== source.generation || task.revision !== source.taskRevision, createdAt: this.now() };
      this.db.query("INSERT INTO agent_tool_reconciliations VALUES (?, ?, ?, ?)").run(fact.id, taskId, exact.idempotencyKey, JSON.stringify(fact));
      const stage = task.stages.find(stage => stage.continuationFrom === source.id);
      if (!fact.late && task.ownerId === executionOwnerId && source.ownerId === executionOwnerId && stage && task.status === "paused" && task.reason === "tool_outcome_unknown"
        && !this.effectiveToolOutcomes(taskId).some(row => row.state === "outcome_unknown")
        && source.result!.continuation!.pending.every(call => this.effectiveToolOutcomes(taskId).some(row => row.scope.generation === source.generation && row.scope.toolCallId === call.toolCallId && row.tool === call.tool && row.state !== "outcome_unknown"))) {
        delete stage.waitingFor; this.updateProgress(task); task.reason = "tool_receipt_reconciled"; this.saveTask(task);
      }
      return { task, reconciliation: fact };
    });
  }
  private toolKey(dispatchId: string, callId: string): string { return `tool:${createHash("sha256").update(JSON.stringify([dispatchId, callId])).digest("hex")}`; }
  toolCallReceiptKey(dispatchId: string, callId: string): string { return this.toolKey(dispatchId, callId); }
  resumeContinuation(taskId: string, sourceId: string, receiptId: string): AgentTask {
    return this.atomic(() => {
      const task = this.getTask(taskId); const source = this.getDispatch(sourceId);
      const stage = task.stages.find(stage => stage.continuationFrom === sourceId);
      const outcomes = this.effectiveToolOutcomes(taskId);
      if (source.result?.continuation?.kind === "owned-native" && source.generation !== task.generation) throw new Error("Current complete Native binding cannot resume across generations");
      if (source.taskId !== taskId || source.taskRevision !== task.revision || !source.result?.continuation || !stage || ["stopped", "verified_complete"].includes(task.status)
        || this.listDispatches(taskId).some(row => unsettled.has(row.state)) || outcomes.some(row => row.state === "outcome_unknown")
        || source.result.continuation.pending.some(call => !outcomes.some(row => row.scope.generation === source.generation && row.scope.toolCallId === call.toolCallId && row.tool === call.tool && row.state !== "outcome_unknown"))) throw new Error("Current complete tool receipts required to resume this continuation");
      this.receipt(receiptId, taskId, "resume_continuation", { sourceId, generation: task.generation, revision: task.revision });
      stage.status = "pending"; delete stage.waitingFor; stage.continuationGeneration = task.generation;
      this.updateProgress(task); task.reason = "known_tool_results_adopted"; this.saveTask(task); return task;
    });
  }
  /** Unknown usage keeps its reservation until an independent, idempotent usage receipt arrives. */
  reconcileUsage(dispatchId: string, receipt: { id: string; actualSpend: number }): AgentDispatch {
    id(receipt.id); integer(receipt.actualSpend, "actual spend");
    return this.atomic(() => {
      const row = this.getDispatch(dispatchId);
      if (row.usageReceipt) { if (!same(row.usageReceipt, receipt)) throw new Error("Usage receipt conflict"); return row; }
      if (row.state !== "settled" || !row.result || row.result.actualSpend !== null) throw new Error("Dispatch has no unknown usage");
      this.receipt(receipt.id, row.taskId, "usage", { dispatchId, ...receipt });
      const task = this.getTask(row.taskId); task.reserved -= row.reservedSpend; task.spent += receipt.actualSpend; task.unpricedTurns--;
      row.usageReceipt = { ...receipt }; this.saveDispatch(row); this.saveTask(task); return row;
    });
  }
  /** Explicit human/host reconciliation may adopt a late success; it never repeats the send. */
  adoptLateResult(taskId: string, dispatchId: string, reviewReceiptId: string): AgentTask {
    return this.atomic(() => {
      const task = this.getTask(taskId); const dispatch = this.getDispatch(dispatchId);
      if (dispatch.taskId !== taskId || dispatch.taskRevision !== task.revision || dispatch.state !== "settled" || dispatch.result?.outcome !== "completed" || task.status === "stopped") throw new Error("Late result does not match current work");
      if (!this.receipt(reviewReceiptId, taskId, "adopt_late_result", { dispatchId, taskRevision: task.revision })) return task;
      const stage = task.stages.find(row => row.id === dispatch.stageId && row.dispatchId === dispatchId);
      if (!stage || stage.status !== "blocked") throw new Error("Stage is not awaiting late-result review");
      stage.status = "completed";
      task.status = task.stages.every(row => row.status === "completed") ? "review_required" : "ready";
      task.reason = "late_result_adopted"; this.saveTask(task); return task;
    });
  }
  /** Only the lifecycle host may certify this owner stopped. No timeout or opened window is proof. */
  recoverOwner(taskId: string, proof: { ownerId: string; stopped: true; receiptId: string }): AgentTask {
    if (proof.stopped !== true) throw new Error("Stopped owner proof required");
    return this.atomic(() => {
      const task = this.getTask(taskId);
      if (!this.receipt(proof.receiptId, taskId, "owner_stopped", proof)) return task;
      for (const row of this.listDispatches(taskId)) if (row.ownerId === proof.ownerId) {
        if (row.state === "admitted") {
          row.state = "cancelled"; task.reserved -= row.reservedSpend; this.saveDispatch(row); this.sleepWorker(row);
          const stage = task.stages.find(stage => stage.dispatchId === row.id);
          if (stage) { stage.status = "pending"; delete stage.dispatchId; }
        } else if (["offered", "acked"].includes(row.state)) {
          row.state = "unknown"; this.saveDispatch(row);
          const worker = this.row<AgentWorker>("agent_workers", row.workerId)!; worker.state = "unknown"; this.saveWorker(worker);
        }
      }
      if (task.ownerId === proof.ownerId) {
        delete task.ownerId; task.generation++; delete task.review; delete task.semanticReview;
        delete task.loopRun;
        if (["ready", "running"].includes(task.status)) { task.status = "paused"; task.reason = "owner_recovery"; }
      }
      this.saveTask(task); return task;
    });
  }
  recordEvidence(taskId: string, evidence: OutcomeEvidence): AgentTask {
    id(evidence.id); id(evidence.requirementId); id(evidence.sourceEventId); id(evidence.observer);
    text(evidence.subject, "evidence subject"); text(evidence.subjectRevision, "subject revision"); text(evidence.property, "evidence property");
    if (!["passed", "failed", "unknown"].includes(evidence.outcome)) throw new Error("Invalid observed outcome");
    return this.atomic(() => {
      const task = this.getTask(taskId);
      if (task.revision !== evidence.taskRevision || !task.requirements.some(row => row.id === evidence.requirementId)) throw new Error("Stale evidence revision");
      const old = task.evidence.find(row => row.id === evidence.id);
      if (old) { if (!same(old, evidence)) throw new Error("Evidence identity conflict"); return task; }
      if (evidence.supersedes !== undefined) {
        if (!Array.isArray(evidence.supersedes) || evidence.supersedes.length > 512 || new Set(evidence.supersedes).size !== evidence.supersedes.length) throw new Error("Invalid evidence supersession");
        for (const key of evidence.supersedes) {
          id(key);
          const previous = task.evidence.find(row => row.id === key);
          if (key === evidence.id || !previous || previous.taskRevision !== evidence.taskRevision || previous.requirementId !== evidence.requirementId
            || previous.property !== evidence.property || previous.subject !== evidence.subject || previous.observer !== evidence.observer) throw new Error("Evidence supersession scope mismatch");
        }
      }
      if (task.evidence.length >= 512) throw new Error("Evidence quota reached");
      task.evidence.push(structuredClone(evidence)); task.evidenceRevision++; delete task.review; delete task.semanticReview;
      if (task.status === "verified_complete") { task.status = "review_required"; task.reason = "evidence_changed"; }
      this.saveTask(task); return task;
    });
  }
  recordReview(taskId: string, review: OutcomeReview): AgentTask {
    id(review.id); text(review.recommendation, "review recommendation");
    return this.atomic(() => {
      const task = this.getTask(taskId);
      if (review.generation !== task.generation || review.taskRevision !== task.revision || review.evidenceRevision !== task.evidenceRevision) throw new Error("Stale outcome review");
      if (task.review && task.review.taskRevision === review.taskRevision && task.review.evidenceRevision === review.evidenceRevision) {
        if (!same(task.review, review)) throw new Error("This unchanged evidence revision was already reviewed"); return task;
      }
      if (!Array.isArray(review.findings) || review.findings.length > 128 || review.findings.some(value => typeof value !== "string" || value.length > 16_384) || !Array.isArray(review.coverage) || review.coverage.length > 128 || typeof review.completeInput !== "boolean") throw new Error("Invalid outcome review");
      const active = activeTaskEvidence(task);
      for (const coverage of review.coverage) if (!task.requirements.some(row => row.id === coverage.requirementId) || !Array.isArray(coverage.evidenceIds) || coverage.evidenceIds.some(key => !active.some(row => row.id === key && row.requirementId === coverage.requirementId))) throw new Error("Review coverage references unavailable evidence");
      task.review = structuredClone(review); this.saveTask(task); return task;
    });
  }
  /** Pure projection of the current ledger that a semantic reviewer receives and Verify rebuilds. */
  semanticReviewInput(taskId: string): SemanticReviewInput {
    const task = this.getTask(taskId);
    return buildSemanticReviewPacket({ task, dispatches: this.listDispatches(taskId), outcomes: this.effectiveToolOutcomes(taskId), receiptKey: (dispatchId, toolCallId) => this.toolCallReceiptKey(dispatchId, toolCallId) });
  }
  /** Attempts for one exact reviewed input, split by whether their durable result is a settled
   * invalid output. In-flight, lost and recorded attempts form the original bound. */
  private semanticAttempts(taskId: string, inputDigest: string): { bounded: number; invalid: number } {
    const receipts = this.listReceipts(taskId);
    const invalid = new Set(receipts.filter(row => row.kind === "semantic_review_result" && (row.body as { state?: unknown }).state === "invalid_output").map(row => (row.body as { attemptId?: unknown }).attemptId));
    const attempts = receipts.filter(row => row.kind === "semantic_review_attempt" && (row.body as { inputDigest?: unknown }).inputDigest === inputDigest);
    const settledInvalid = attempts.filter(row => invalid.has((row.body as { attemptId?: unknown }).attemptId)).length;
    return { bounded: attempts.length - settledInvalid, invalid: settledInvalid };
  }
  /** Durable intent before any reviewer request. Bounded per exact reviewed input; a lost
   * terminal stays an unknown attempt and is never replayed under the same identity. A settled
   * invalid output is a completed turn without a verdict: it does not use up that bound, so a
   * new explicit action may review again, within a separate backstop for the unchanged ledger. */
  recordSemanticReviewAttempt(taskId: string, attempt: { attemptId: string; actionId: string; generation: number; taskRevision: number; evidenceRevision: number; inputDigest: string; reviewer: { provider: "local-responses"; model: string } }): void {
    id(attempt.attemptId); id(attempt.actionId); id(attempt.reviewer.model);
    this.atomic(() => {
      const task = this.getTask(taskId);
      if (task.archivedAt !== undefined || attempt.generation !== task.generation || attempt.taskRevision !== task.revision || attempt.evidenceRevision !== task.evidenceRevision || attempt.inputDigest !== this.semanticReviewInput(taskId).digest) throw new Error("Stale task semantic review scope");
      const attempts = this.semanticAttempts(taskId, attempt.inputDigest);
      if (attempts.bounded >= 3) throw new Error("Task semantic review attempt bound reached for this unchanged ledger; change the facts or inspect the attempt receipts");
      if (attempts.invalid >= 8) throw new Error("Task semantic review invalid-output bound reached for this unchanged ledger; change the facts or inspect the attempt receipts");
      this.receipt(`semantic-attempt:${attempt.attemptId}`, taskId, "semantic_review_attempt", attempt);
    });
  }
  /** One exact reviewer request per attempt. A second claim is refused, never resent. */
  claimSemanticReviewTransport(taskId: string, attemptId: string, payloadDigest: string): void {
    if (!/^[a-f0-9]{64}$/.test(payloadDigest)) throw new Error("Invalid semantic review payload digest");
    this.atomic(() => {
      if (!this.listReceipts(taskId).some(row => row.id === `semantic-attempt:${attemptId}`)) throw new Error("Unknown semantic review attempt");
      if (!this.receipt(`semantic-transport:${attemptId}`, taskId, "semantic_review_transport", { attemptId, payloadDigest })) throw new Error("Semantic review transport already claimed");
    });
  }
  /** Immutable result receipt for every terminal attempt; only a still-current review is attached.
   * An invalid output may carry its bounded diagnosis, never a verdict. */
  recordSemanticReviewResult(taskId: string, result: { attemptId: string; state: "recorded" | "invalid_output" | "outcome_unknown"; receiptId?: string; review?: SemanticOutcomeReview; invalid?: SemanticReviewInvalidEvidence }): { task: AgentTask; current: boolean } {
    if (result.invalid !== undefined && (result.state !== "invalid_output" || Buffer.byteLength(JSON.stringify(result.invalid)) > 16 * 1024)) throw new Error("Invalid semantic review result evidence");
    return this.atomic(() => {
      this.receipt(`semantic-result:${result.attemptId}`, taskId, "semantic_review_result", result);
      const task = this.getTask(taskId), review = result.review;
      if (result.state !== "recorded" || !review) return { task, current: false };
      id(review.id); if (review.attemptId !== result.attemptId) throw new Error("Semantic review attempt identity conflict");
      if (task.archivedAt !== undefined || review.generation !== task.generation || review.taskRevision !== task.revision || review.evidenceRevision !== task.evidenceRevision || review.inputDigest !== this.semanticReviewInput(taskId).digest) return { task, current: false };
      if (!Array.isArray(review.requirements) || review.requirements.length !== task.requirements.length || task.requirements.some(row => review.requirements.filter(verdict => verdict.requirementId === row.id).length !== 1)) throw new Error("Invalid semantic outcome review");
      task.semanticReview = structuredClone(review); this.saveTask(task); return { task, current: true };
    });
  }
  verifyComplete(taskId: string, reviewId: string): AgentTask {
    return this.atomic(() => {
      const task = this.getTask(taskId); const review = task.review;
      if (task.status === "verified_complete" && review?.id === reviewId) return task;
      if (task.mode === "loop" || task.status !== "review_required" || task.reserved !== 0 || !review || review.id !== reviewId || review.generation !== task.generation || review.taskRevision !== task.revision || review.evidenceRevision !== task.evidenceRevision || !review.completeInput || this.listDispatches(taskId).some(row => unsettled.has(row.state))) throw new Error("Current complete outcome review required");
      // The local helper lists findings for any requirement without host evidence. Those
      // may still be closed only by an independent semantic pass over observed facts.
      const semantic = task.semanticReview;
      for (const requirement of task.requirements) {
        const facts = activeTaskEvidence(task).filter(row => row.requirementId === requirement.id);
        if (facts.some(row => row.outcome !== "passed") || (!facts.length && !semantic)) throw new Error("Requirement outcome is not verified");
      }
      const input = this.semanticReviewInput(taskId);
      if (!semantic || semantic.generation !== task.generation || semantic.taskRevision !== task.revision || semantic.evidenceRevision !== task.evidenceRevision
        || semantic.inputDigest !== input.digest || !semantic.completeInput || !input.packet.completeInput || semantic.deliverable.verdict !== "pass") throw new Error("Current independent semantic review required");
      for (const requirement of task.requirements) {
        const verdict = semantic.requirements.find(row => row.requirementId === requirement.id);
        if (!verdict || verdict.verdict !== "pass" || verdict.sufficiency !== "complete" || !semanticRequirementBasis(input.packet, verdict).length) throw new Error("Requirement outcome is not semantically verified");
      }
      task.status = "verified_complete"; delete task.ownerId; this.saveTask(task); return task;
    });
  }
  nextLoopCycle(taskId: string, input: { workKey: string; stages: StageInput[] }): AgentTask {
    text(input.workKey, "new work key", 160);
    return this.atomic(() => {
      const task = this.getTask(taskId);
      if (task.mode !== "loop" || task.status !== "review_required" || this.listDispatches(taskId).some(row => unsettled.has(row.state))) throw new Error("Loop cycle is not settled");
      if (!input.stages.length || input.workKey === task.lastWorkKey) { task.status = "paused"; task.reason = "no_new_work"; this.saveTask(task); return task; }
      plan(task.requirements, input.stages);
      task.generation++; task.revision++; task.cycle++; delete task.ownerId; delete task.review; delete task.semanticReview;
      task.lastWorkKey = input.workKey; task.stages = input.stages.map(row => ({ ...structuredClone(row), status: "pending" })); task.status = "ready";
      this.saveTask(task); return task;
    });
  }
  listWork(taskId: string): AgentWorkPacket[] { return this.rows("agent_work", taskId); }
  enqueueWork(taskId: string, input: Pick<AgentWorkPacket, "workId" | "workKey" | "text">): { packet: AgentWorkPacket; duplicate: boolean } {
    id(input.workId); id(input.workKey); text(input.text, "new work instruction");
    if (/^(?:continue|proceed|go on|keep (?:going|working)|продолжай|продолжить)[.!\s]*$/iu.test(input.text.trim())) throw new Error("Empty Continue is not substantive new work");
    return this.atomic(() => {
      const task = this.getTask(taskId);
      if (task.mode !== "loop" || task.status === "stopped") throw new Error("Task is not an active recurring Loop");
      const duplicate = this.listWork(taskId).find(row => row.workId === input.workId || row.workKey === input.workKey);
      if (duplicate) {
        if (duplicate.workKey !== input.workKey || duplicate.text !== input.text) throw new Error("Work packet identity conflict");
        return { packet: duplicate, duplicate: true };
      }
      if (this.listWork(taskId).length >= 512) throw new Error("Work mailbox quota reached; packets preserved");
      const packet: AgentWorkPacket = { ...input, taskId, state: "pending", enqueuedGeneration: task.generation, createdAt: this.now() };
      this.db.query("INSERT INTO agent_work VALUES (?, ?, ?, ?)").run(packet.workId, taskId, packet.workKey, JSON.stringify(packet));
      return { packet, duplicate: false };
    });
  }
  /** Same SQLite writer as the mailbox. No raw credential enters these methods. */
  externalProducers(taskId?: string): ExternalProducerRecord[] { return this.rows('agent_external_producers', taskId); }
  externalProducer(producerId: string): ExternalProducerRecord | undefined { return this.row('agent_external_producers', producerId); }
  externalProducerReceipts(producerId: string): ExternalProducerReceipt[] {
    return (this.db.query('SELECT body FROM agent_external_events WHERE producerId=? ORDER BY rowid').all(producerId) as { body: string }[]).map(row => JSON.parse(row.body));
  }
  externalProducerReceipt(producerId: string, eventId: string): ExternalProducerReceipt | undefined {
    const row = this.db.query('SELECT body FROM agent_external_events WHERE producerId=? AND id=?').get(producerId, eventId) as { body: string } | null;
    return row ? JSON.parse(row.body) : undefined;
  }
  registerExternalProducer(input: ProducerRegistration, authority: AgentLoopSourceAuthority, assertCurrent: () => void) {
    return this.atomic(() => {
      const fingerprint = producerRegistrationFingerprint(input);
      const all = this.externalProducers();
      producerCheck(!all.some(row => row.rotationActions.some(action => action.actionId === input.actionId)), 'producer_action_identity_conflict');
      const old = all.find(row => row.registrationActionId === input.actionId);
      if (old) { producerCheck(old.registrationFingerprint === fingerprint, 'producer_registration_conflict'); return { producer: old, created: false }; }
      assertCurrent();
      producerCheck(!this.externalProducers(input.taskId).some(row => !row.revoked && row.authority.runId === authority.runId), 'producer_already_registered_for_run');
      const producer: ExternalProducerRecord = { version: 1, producerId: randomUUID(), taskId: input.taskId, label: input.label,
        instruction: input.instruction, eventBound: input.eventBound, acceptedEvents: 0, credentialHash: input.credentialHash,
        registrationActionId: input.actionId, registrationFingerprint: fingerprint, rotationActions: [], authority, revoked: false, createdAt: this.now() };
      this.db.query('INSERT INTO agent_external_producers VALUES (?,?,?,?)').run(producer.producerId, producer.taskId, input.actionId, JSON.stringify(producer));
      return { producer, created: true };
    });
  }
  rotateExternalProducer(input: ProducerRotation, assertCurrent: (producer: ExternalProducerRecord) => void) {
    return this.atomic(() => {
      const row = this.externalProducer(input.producerId); producerCheck(row, 'producer_not_found');
      const fingerprint = producerDigest({ producerId: input.producerId, actionId: input.actionId });
      producerCheck(!this.externalProducers().some(other => other.registrationActionId === input.actionId || other.producerId !== row.producerId && other.rotationActions.some(action => action.actionId === input.actionId)), 'producer_action_identity_conflict');
      const prior = row.rotationActions.find(old => old.actionId === input.actionId);
      if (prior) { producerCheck(prior.fingerprint === fingerprint, 'producer_rotation_conflict'); return { producer: row, rotated: false }; }
      assertCurrent(row); producerCheck(!row.revoked, 'producer_revoked');
      producerCheck(row.rotationActions.length < 512, 'producer_rotation_receipt_limit');
      row.rotationActions.push({ actionId: input.actionId, fingerprint }); row.credentialHash = input.credentialHash;
      this.db.query('UPDATE agent_external_producers SET body=? WHERE id=?').run(JSON.stringify(row), row.producerId);
      return { producer: row, rotated: true };
    });
  }
  revokeExternalProducer(producerId: string): ExternalProducerRecord {
    return this.atomic(() => { const row = this.externalProducer(producerId); producerCheck(row, 'producer_not_found');
      row.revoked = true; this.db.query('UPDATE agent_external_producers SET body=? WHERE id=?').run(JSON.stringify(row), producerId); return row; });
  }
  publishExternalProducerEvent(input: ProducerEvent, credentialHash: string, assertCurrent: (producer: ExternalProducerRecord) => AgentLoopSourceAuthority) {
    return this.atomic(() => {
      const row = this.externalProducer(input.producerId); producerCheck(row && producerHashesEqual(row.credentialHash, credentialHash) && !row.revoked, 'producer_credential_rejected');
      const fingerprint = producerDigest(input), receipts = this.externalProducerReceipts(row.producerId);
      const prior = receipts.find(old => old.eventId === input.eventId || old.sourceEventKey === input.sourceEventKey);
      if (prior) { producerCheck(prior.fingerprint === fingerprint, 'producer_event_identity_conflict'); return { receipt: prior, duplicate: true }; }
      const authority = assertCurrent(row);
      producerCheck(row.acceptedEvents < row.eventBound, 'producer_event_bound');
      producerCheck(receipts.length < 512, 'producer_receipt_quota');
      const observationDigest = producerDigest({ subject: input.subject, observationText: input.observationText });
      const unchanged = receipts.at(-1)?.observationDigest === observationDigest;
      const receipt: ExternalProducerReceipt = { producerId: row.producerId, eventId: input.eventId, sourceEventKey: input.sourceEventKey,
        fingerprint, observationDigest, state: unchanged ? 'unchanged' : 'accepted', taskId: row.taskId,
        generation: authority.generation, revision: authority.revision, createdAt: this.now() };
      if (!unchanged) {
        receipt.workId = randomUUID(); receipt.workKey = `external:${producerDigest({ producerId: row.producerId, sourceEventKey: input.sourceEventKey })}`;
        const packetText = row.instruction + '\n\nExternal producer observation (untrusted data; not tool permission or verified evidence):\n' + JSON.stringify({ subject: input.subject, observationText: input.observationText, observedAt: input.observedAt });
        producerCheck(Buffer.byteLength(packetText) <= 16_384, 'producer_packet_size_limit');
        producerCheck(this.listWork(row.taskId).length < 512, 'producer_mailbox_quota');
        this.enqueueWork(row.taskId, { workId: receipt.workId, workKey: receipt.workKey, text: packetText });
        row.acceptedEvents++; this.db.query('UPDATE agent_external_producers SET body=? WHERE id=?').run(JSON.stringify(row), row.producerId);
      }
      this.db.query('INSERT INTO agent_external_events VALUES (?,?,?,?)').run(input.eventId, row.producerId, input.sourceEventKey, JSON.stringify(receipt));
      return { receipt, duplicate: false };
    });
  }
  enableLoopRun(taskId: string, ownerId: string): void {
    const task = this.getTask(taskId);
    if (task.mode !== "loop") return;
    if ((task.ownerId && task.ownerId !== ownerId) || !["ready", "running", "review_required"].includes(task.status)) throw new Error("Execution owner or Loop state conflict");
    task.ownerId = ownerId;
    task.loopRun = { ownerId, generation: task.generation }; this.saveTask(task);
  }
  claimNextWork(taskId: string, options: { ownerId: string; automatic: boolean; workId?: string }): AgentTask | undefined {
    return this.atomic(() => {
      const task = this.getTask(taskId);
      if (task.mode !== "loop" || task.status !== "review_required") return undefined;
      if (options.automatic && (task.loopRun?.ownerId !== options.ownerId || task.loopRun.generation !== task.generation || task.ownerId !== options.ownerId)) return undefined;
      const packet = this.listWork(taskId).find(row => options.workId ? row.workId === options.workId && row.state !== "claimed" : row.state === "pending");
      if (!packet) { task.reason = "waiting_for_mailbox_work"; this.saveTask(task); return undefined; }
      if (task.turns >= task.bounds.maxTurns) { task.status = "paused"; task.reason = "turn_bound"; delete task.loopRun; this.saveTask(task); return undefined; }
      const continuedConsent = options.automatic && task.loopRun?.ownerId === options.ownerId;
      const stages = task.stages.map(({ id, instruction, requirementIds, dependsOn }) => ({ id, instruction, requirementIds, ...(dependsOn ? { dependsOn } : {}) }));
      const next = this.nextLoopCycle(taskId, { workKey: packet.workKey, stages });
      if (next.status !== "ready") return next;
      for (const stage of next.stages) stage.userInput = packet.text;
      packet.state = "claimed"; packet.cycle = next.cycle;
      this.db.query("UPDATE agent_work SET body=? WHERE id=?").run(JSON.stringify(packet), packet.workId);
      if (continuedConsent) next.loopRun = { ownerId: options.ownerId, generation: next.generation };
      else delete next.loopRun;
      if (next.workspaceSnapshotGrant !== undefined && next.workspaceSnapshotGrant !== null) { next.status = "paused"; next.reason = "workspace_snapshot_grant_renewal_required"; delete next.loopRun; }
      this.saveTask(next); return next;
    });
  }
}
