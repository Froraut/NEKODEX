import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createProcessLineReader } from "./process-line-reader";
import {
  CHATGPT_HELPER_DIAGNOSTIC_BYTES, CHATGPT_HELPER_FRAME_BYTES,
  CHATGPT_HELPER_PENDING_BYTES, assertByteLimit,
} from "./resource-budgets";
import { notifyLauncherTurn, readLauncherBrowserHostDescriptor } from "../../launcher-browser-host";
import { CHATGPT_WEB_BACKEND_MODEL } from "../../chatgpt-web-models";
import {
  parseChatGptWebCompactionExecution,
  type ChatGptWebCompactionExecution,
} from "../../chatgpt-web-compaction-policy";
import { ChatGptCompactionHandoffAccepted, ChatGptWebAdapterError } from "./adapter-error";
import type { CompiledChatGptWebPrompt } from "./prompt";
import type { BrowserTurn, ResolvedBrowserConfig } from "./browser-worker";
import {
  parseChatGptLunaCheckpoint,
  type ChatGptLunaCheckpoint,
} from "./rolling-checkpoint";

interface PendingTurn {
  turn: BrowserTurn;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  abortListener?: () => void;
  sent?: boolean;
  prepared?: CompiledChatGptWebPrompt & { release: () => void };
  localFailure?: Error;
  progressForwarding?: AbortController;
  acknowledgedMultipartStage?: number;
}

function validateCompactionExecution(turn: BrowserTurn): ChatGptWebCompactionExecution | undefined {
  if (turn.compactionExecution === undefined) return undefined;
  let execution: ChatGptWebCompactionExecution;
  try {
    execution = parseChatGptWebCompactionExecution(turn.compactionExecution);
  } catch {
    throw new Error("Launcher browser compaction execution is invalid");
  }
  if (turn.compaction !== true
    || turn.modelId !== CHATGPT_WEB_BACKEND_MODEL
    || turn.reasoning !== execution.effort
    || turn.capabilities.localToolsEnabled
    || !turn.capabilities.solAvailable
    || !turn.capabilities.proAvailable) {
    throw new Error("Launcher browser compaction execution is invalid");
  }
  return execution;
}

type HelperMessage =
  | { type: "ready"; features?: string[] }
  | { type: "event"; id: string; event: "heartbeat" | "submitted" | "reasoning" | "commentary" | "text"; text?: string; continuation?: boolean }
  | { type: "event"; id: string; event: "send_activated"; requestId?: number }
  | { type: "event"; id: string; event: "turn_settled" }
  | { type: "event"; id: string; event: "tool_batch_observed"; revision: number }
  | { type: "event"; id: string; event: "multipart_stage_acknowledged"; stageIndex: number }
  | { type: "event"; id: string; event: "completion_fence_begin"; requestId: number }
  | { type: "event"; id: string; event: "completion_fence_commit"; requestId: number; revision: number }
  | { type: "event"; id: string; event: "prepared_selected"; reused: boolean }
  | { type: "event"; id: string; event: "luna_checkpoint"; checkpoint: ChatGptLunaCheckpoint; answerHash: string }
  | { type: "result"; id: string; text: string }
  | {
      type: "error";
      id: string;
      name?: string;
      message: string;
      status?: number;
      errorType?: string;
      code?: string;
      retryable?: boolean;
    };

function parseHelperMessage(line: string): HelperMessage {
  const value = JSON.parse(line) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Launcher browser helper message is not an object");
  }
  const message = value as Record<string, unknown>;
  if (message.type === "ready") {
    const features = message.features;
    if (features !== undefined
      && (!Array.isArray(features) || features.some(feature => typeof feature !== "string"))) {
      throw new Error("Launcher browser helper advertised invalid features");
    }
    return { type: "ready", ...(features ? { features: features as string[] } : {}) };
  }
  if (typeof message.id !== "string" || !message.id) {
    throw new Error("Launcher browser helper message has no turn identity");
  }
  if (message.type === "event") {
    const event = message.event;
    if (event === "turn_settled") return { type: "event", id: message.id, event };
    if (event === "send_activated") {
      if (message.requestId !== undefined
        && (!Number.isSafeInteger(message.requestId) || (message.requestId as number) <= 0)) {
        throw new Error("Launcher browser helper Send activation request id is invalid");
      }
      return { type: "event", id: message.id, event,
        ...(message.requestId !== undefined ? { requestId: message.requestId as number } : {}) };
    }
    if (event === "multipart_stage_acknowledged") {
      if (!Number.isSafeInteger(message.stageIndex) || (message.stageIndex as number) <= 0) {
        throw new Error("Launcher browser helper multipart stage index is invalid");
      }
      return { type: "event", id: message.id, event, stageIndex: message.stageIndex as number };
    }
    if (event === "tool_batch_observed") {
      if (!Number.isSafeInteger(message.revision) || (message.revision as number) <= 0) {
        throw new Error("Launcher browser helper tool-boundary revision is invalid");
      }
      return { type: "event", id: message.id, event, revision: message.revision as number };
    }
    if (event === "completion_fence_begin") {
      if (!Number.isSafeInteger(message.requestId) || (message.requestId as number) <= 0) {
        throw new Error("Launcher browser helper completion fence request id is invalid");
      }
      return { type: "event", id: message.id, event, requestId: message.requestId as number };
    }
    if (event === "completion_fence_commit") {
      if (!Number.isSafeInteger(message.requestId) || (message.requestId as number) <= 0
        || !Number.isSafeInteger(message.revision) || (message.revision as number) < 0) {
        throw new Error("Launcher browser helper completion fence revision is invalid");
      }
      return {
        type: "event",
        id: message.id,
        event,
        requestId: message.requestId as number,
        revision: message.revision as number,
      };
    }
    if (event === "luna_checkpoint") {
      if (typeof message.answerHash !== "string" || !/^[a-f0-9]{64}$/.test(message.answerHash)) {
        throw new Error("Launcher browser helper Luna checkpoint answer hash is invalid");
      }
      return {
        type: "event",
        id: message.id,
        event,
        checkpoint: parseChatGptLunaCheckpoint(message.checkpoint),
        answerHash: message.answerHash,
      };
    }
    const text = message.text;
    const continuation = message.continuation;
    if (event === "prepared_selected") {
      if (typeof message.reused !== "boolean") {
        throw new Error("Launcher browser helper prompt selection is invalid");
      }
      return { type: "event", id: message.id, event, reused: message.reused };
    }
    if (!["heartbeat", "submitted", "reasoning", "commentary", "text"].includes(String(event))) {
      throw new Error("Launcher browser helper emitted an unknown event");
    }
    if (text !== undefined && typeof text !== "string") {
      throw new Error("Launcher browser helper event text is invalid");
    }
    if (continuation !== undefined && typeof continuation !== "boolean") {
      throw new Error("Launcher browser helper continuation flag is invalid");
    }
    return {
      type: "event",
      id: message.id,
      event: event as "heartbeat" | "submitted" | "reasoning" | "commentary" | "text",
      ...(text !== undefined ? { text: text as string } : {}),
      ...(continuation !== undefined ? { continuation: continuation as boolean } : {}),
    };
  }
  if (message.type === "result") {
    const text = message.text;
    if (typeof text !== "string") {
      throw new Error("Launcher browser helper result text is invalid");
    }
    return { type: "result", id: message.id, text };
  }
  if (message.type === "error") {
    const errorMessage = message.message;
    const errorName = message.name;
    const status = message.status;
    const errorType = message.errorType;
    const code = message.code;
    const retryable = message.retryable;
    const structured = status !== undefined
      || errorType !== undefined
      || code !== undefined
      || retryable !== undefined;
    if (typeof errorMessage !== "string"
      || (errorName !== undefined && typeof errorName !== "string")
      || (structured && (
        !Number.isInteger(status)
        || (status as number) < 400
        || (status as number) > 599
        || typeof errorType !== "string"
        || !errorType
        || typeof code !== "string"
        || !code
        || typeof retryable !== "boolean"
      ))) {
      throw new Error("Launcher browser helper error payload is invalid");
    }
    return {
      type: "error",
      id: message.id,
      message: errorMessage,
      ...(errorName !== undefined ? { name: errorName as string } : {}),
      ...(structured ? {
        status: status as number,
        errorType: errorType as string,
        code: code as string,
        retryable: retryable as boolean,
      } : {}),
    };
  }
  throw new Error("Launcher browser helper emitted an unknown message type");
}

export class LauncherBrowserHelperClient {
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  private closed = false;
  private closing?: Promise<void>;
  private readonly pending = new Map<string, PendingTurn>();
  // A rejected abort write settles the caller, but the helper may still own this trace ID.
  // Only its post-cleanup event (or this exact child's exit) releases the reservation.
  private readonly unresolved = new Map<string, ChildProcessWithoutNullStreams>();
  private helperFeatures = new Set<string>();

  constructor(private readonly config: ResolvedBrowserConfig) {}

  /**
   * The helper that shipped with this daemon, when one sits beside its own entrypoint.
   *
   * The launcher advertises the helper inside its application bundle while the daemon runs from a
   * versioned runtime directory, so the two sides update independently and can disagree about the
   * protocol. Preferring the sibling keeps daemon and helper on the same build by construction;
   * anything else — a source checkout, an unbundled entrypoint — falls back to the advertised path.
   */
  private bundledHelperScript(): string | undefined {
    const entrypoint = process.argv[1];
    // Only the packaged runtime layout is claimed: the bundle builder emits cli.js and
    // browser-helper.cjs into one directory. Matching on that entrypoint name keeps a source
    // checkout, or any other launch shape, on the launcher-advertised helper rather than adopting
    // an unrelated sibling that merely shares a filename.
    if (typeof entrypoint !== "string" || basename(entrypoint) !== "cli.js") return undefined;
    const sibling = join(dirname(entrypoint), "browser-helper.cjs");
    return existsSync(sibling) ? sibling : undefined;
  }

  async run(turn: BrowserTurn): Promise<string> {
    if (this.closed) throw new DOMException("Launcher browser helper is closing", "AbortError");
    if (turn.abortSignal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
    await this.ensureChild();
    if (this.closed) throw new DOMException("Launcher browser helper is closing", "AbortError");
    if (turn.abortSignal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
    if (turn.accountRoutingKey !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(turn.accountRoutingKey)) {
        throw new Error("Launcher browser helper account routing key is invalid");
      }
      if (!this.helperFeatures.has("account-routing-key")) {
        throw new Error("Launcher browser helper does not support account routing; update or restart the launcher");
      }
    }
    if (turn.onMultipartStageAcknowledged && !this.helperFeatures.has("multipart-stage-ack")) {
      throw new Error(
        "Launcher browser helper does not support multipart acknowledgement forwarding; update or restart the launcher",
      );
    }
    if (turn.externalProgress && !this.helperFeatures.has("tool-boundary-ack")) {
      throw new Error(
        "Launcher browser helper does not support causal Codex tool-boundary acknowledgement; update or restart the launcher",
      );
    }
    if (turn.externalProgress && !this.helperFeatures.has("completion-fence")) {
      throw new Error(
        "Launcher browser helper does not support the MCP completion fence; update or restart the launcher",
      );
    }
    if (turn.asyncToolOperations && !this.helperFeatures.has("completion-fence-reasons")) {
      throw new Error(
        "Launcher browser helper does not support Native5 completion-fence diagnostics; update or restart the launcher",
      );
    }
    const compactionExecution = validateCompactionExecution(turn);
    if (compactionExecution && !this.helperFeatures.has("compaction-execution")) {
      throw new ChatGptWebAdapterError(
        "Launcher browser helper does not support compaction execution; update or restart the launcher",
        {
          status: 409,
          errorType: "invalid_request_error",
          code: "compaction_control_unavailable",
          retryable: false,
        },
      );
    }
    return await new Promise<string>((resolveResult, rejectResult) => {
        if (this.pending.has(turn.traceId) || this.unresolved.has(turn.traceId)) {
          rejectResult(new Error(`Duplicate launcher browser turn: ${turn.traceId}`));
          return;
        }
        const pending: PendingTurn = { turn, resolve: resolveResult, reject: rejectResult };
        this.pending.set(turn.traceId, pending);
        if (turn.abortSignal) {
          const abortListener = () => {
            if (!pending.sent) {
              this.finishWithError(
                turn.traceId,
                new DOMException("ChatGPT web turn aborted", "AbortError"),
              );
              return;
            }
            void this.sendAbort(pending, {
              type: "abort",
              id: turn.traceId,
              ...(turn.abortSignal?.reason instanceof ChatGptCompactionHandoffAccepted
                ? { reason: "compaction_handoff_accepted" }
                : {}),
            }).catch(error => {
              this.reserveUnresolved(pending);
              this.finishWithError(
                turn.traceId,
                error instanceof Error ? error : new Error(String(error)),
              );
            });
          };
          pending.abortListener = abortListener;
          turn.abortSignal.addEventListener("abort", abortListener, { once: true });
          if (turn.abortSignal.aborted) {
            abortListener();
            return;
          }
        }
        // Setting this before the synchronous write call makes an abort either prevent dispatch or
        // queue an `abort` after the `run` frame; it can never overtake the run frame in the pipe.
        pending.sent = true;
        const progressForwarding = new AbortController();
        pending.progressForwarding = progressForwarding;
        void this.send({
          type: "run",
          id: turn.traceId,
          config: {
            appName: this.config.appName,
            browserHostDescriptorPath: this.config.browserHostDescriptorPath!,
            browserDiagnosticsPath: this.config.browserDiagnosticsPath,
            turnTimeoutMs: this.config.turnTimeoutMs,
            autoApproveToolCalls: this.config.autoApproveToolCalls,
          },
          turn: {
            traceId: turn.traceId,
            modelId: turn.modelId,
            requestedModel: turn.requestedModel,
            reasoning: turn.reasoning,
            capabilities: turn.capabilities,
            ...(turn.nativeConnector ? { nativeConnector: true } : {}),
            ...(turn.prepareResume ? { resumeAvailable: true } : {}),
            ...(turn.retainConversation ? { retainConversation: true } : {}),
            ...(turn.requireRetainedConversation ? { requireRetainedConversation: true } : {}),
            ...(turn.conversationKey ? { conversationKey: turn.conversationKey } : {}),
            ...(turn.accountRoutingKey !== undefined ? { accountRoutingKey: turn.accountRoutingKey } : {}),
            ...(turn.compaction ? { compaction: true } : {}),
            ...(compactionExecution ? { compactionExecution } : {}),
            ...(turn.captureLunaCheckpoint ? { captureLunaCheckpoint: true } : {}),
            ...(turn.externalProgress ? { externalProgress: true } : {}),
          },
        })
          // Only mirror once the run frame is on the wire, so the helper never sees progress for a
          // turn it has not been told about and cannot accumulate state for unknown ids.
          .then(() => {
            if (!progressForwarding.signal.aborted) this.forwardProgress(turn, progressForwarding.signal);
          })
          .catch(error => this.finishWithError(turn.traceId, error instanceof Error ? error : new Error(String(error))));
      });
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const child = this.child;
    // Settle startup before detaching its child: exit and timeout handlers only own the current child.
    this.readyReject?.(new DOMException("Launcher browser helper is closing", "AbortError"));
    this.child = undefined;
    this.ready = undefined;
    this.readyResolve = undefined;
    this.readyReject = undefined;
    this.helperFeatures.clear();
    this.unresolved.clear();
    for (const id of [...this.pending.keys()]) {
      this.finishWithError(id, new DOMException("Launcher browser helper is closing", "AbortError"));
    }
    this.closing = child
      ? (async () => {
          await this.sendTo(child, { type: "shutdown" }).catch(() => {});
          await this.terminateChild(child, 2_000);
        })()
      : Promise.resolve();
    return this.closing;
  }

  private async ensureChild(): Promise<void> {
    if (this.closed) throw new DOMException("Launcher browser helper is closing", "AbortError");
    if (this.child
      && !this.child.killed
      && this.child.exitCode === null
      && this.child.signalCode === null
      && this.ready) {
      return this.ready;
    }
    const descriptor = readLauncherBrowserHostDescriptor(this.config.browserHostDescriptorPath!);
    const child = spawn(
      descriptor.helper.executable,
      [this.config.browserHelperScriptPath ?? this.bundledHelperScript() ?? descriptor.helper.script],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          CODEX_CHATGPT_WEB_BROWSER_HELPER_PROCESS: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.child = child;
    this.ready = new Promise<void>((resolveReady, rejectReady) => {
      this.readyResolve = resolveReady;
      this.readyReject = rejectReady;
    });
    const failChild = (error: Error) => this.failChild(child, error);
    const output = createProcessLineReader(child.stdout, line => this.handleLine(child, line), failChild);
    const errors = createProcessLineReader(child.stderr, line => console.info(`[chatgpt-web-helper] ${line}`), failChild, {
      maxLineBytes: CHATGPT_HELPER_DIAGNOSTIC_BYTES,
    });
    child.once("close", () => { output.close(); errors.close(); });
    child.once("error", failChild);
    child.stdin.once("error", error => failChild(new Error(
      `Launcher browser helper input failed: ${error instanceof Error ? error.message : String(error)}`,
    )));
    child.once("exit", (code, signal) => this.handleExit(child, new Error(
      `Launcher browser helper exited ${signal ? `from signal ${signal}` : `with status ${code ?? 1}`}`,
    )));
    const timer = setTimeout(() => {
      if (this.child === child && !this.closed) this.readyReject?.(new Error("Launcher browser helper did not become ready"));
    }, 15_000);
    try {
      await this.ready;
    } catch (error) {
      // close() owns termination after it detaches the child and rejects startup.
      if (this.closed) throw error;
      if (this.child === child) {
        this.child = undefined;
        this.ready = undefined;
        this.readyResolve = undefined;
        this.readyReject = undefined;
      }
      try {
        await this.terminateChild(child, 500);
      } catch (cleanupError) {
        const primary = error instanceof Error ? error.message : String(error);
        const cleanup = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        throw new Error(`${primary}; launcher browser helper cleanup failed: ${cleanup}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private failChild(child: ChildProcessWithoutNullStreams, error: Error): void {
    const owned = this.child === child;
    this.handleExit(child, error);
    if (owned && Number.isInteger(child.pid) && child.exitCode === null && child.signalCode === null) {
      void this.terminateChild(child, 0).catch(cleanupError => {
        console.error(`[chatgpt-web-helper] process-error cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      });
    }
  }

  private handleLine(child: ChildProcessWithoutNullStreams, line: string): void {
    if (this.child !== child) return;
    let message: HelperMessage;
    try { message = parseHelperMessage(line); }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.handleExit(child, new Error(`Launcher browser helper emitted invalid protocol data: ${detail}`));
      void this.terminateChild(child, 0).catch(error => {
        console.error(`[chatgpt-web-helper] invalid-protocol cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      return;
    }
    if (message.type === "ready") {
      // Optional frames are sent only when the helper advertises support for them.
      this.helperFeatures = new Set(message.features ?? []);
      this.readyResolve?.();
      this.readyResolve = undefined;
      this.readyReject = undefined;
      return;
    }
    if (message.type === "event" && message.event === "turn_settled") {
      if (this.unresolved.get(message.id) === child) this.unresolved.delete(message.id);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      // Older helpers complete their cleanup synchronously after writing the final frame.
      // They do not advertise the explicit post-cleanup event.
      if ((message.type === "result" || message.type === "error")
        && !this.helperFeatures.has("turn-settled")
        && this.unresolved.get(message.id) === child) this.unresolved.delete(message.id);
      return;
    }
    if (message.type === "event") {
      if (pending.localFailure) return;
      try {
        if (message.event === "heartbeat") pending.turn.onHeartbeat?.();
        else if (message.event === "tool_batch_observed") {
          const progress = pending.turn.externalProgress;
          if (!progress) {
            this.abortWithLocalFailure(
              message.id,
              new Error("Launcher browser helper observed a tool boundary for a turn without progress transport"),
              pending,
            );
            return;
          }
          void progress.acknowledgeToolBatch(message.revision).catch(error => this.abortWithLocalFailure(
            message.id,
            error instanceof Error ? error : new Error(String(error)),
            pending,
          ));
        }
        else if (message.event === "completion_fence_begin") {
          const fence = pending.turn.completionFence;
          if (!fence) {
            this.abortWithLocalFailure(
              message.id,
              new Error("Launcher browser helper requested a completion fence for an unfenced turn"),
              pending,
            );
            return;
          }
          void fence.begin().then(result => {
            if (this.pending.get(message.id) !== pending || pending.localFailure || pending.turn.abortSignal?.aborted) return;
            return this.send({
              type: "completion_fence_begin_ack",
              id: message.id,
              requestId: message.requestId,
              ...("revision" in result
                ? { revision: result.revision }
                : {
                  revision: null,
                  blockedReason: result.blockedReason,
                  blockedCount: result.blockedCount,
                }),
            });
          }).catch(error => this.abortWithLocalFailure(
            message.id,
            error instanceof Error ? error : new Error(String(error)),
            pending,
          ));
        }
        else if (message.event === "completion_fence_commit") {
          const fence = pending.turn.completionFence;
          if (!fence) {
            this.abortWithLocalFailure(
              message.id,
              new Error("Launcher browser helper requested a completion fence for an unfenced turn"),
              pending,
            );
            return;
          }
          void fence.commit(message.revision).then(committed => {
            if (this.pending.get(message.id) !== pending || pending.localFailure || pending.turn.abortSignal?.aborted) return;
            return this.send({
              type: "completion_fence_commit_ack",
              id: message.id,
              requestId: message.requestId,
              committed,
            });
          }).catch(error => this.abortWithLocalFailure(
            message.id,
            error instanceof Error ? error : new Error(String(error)),
            pending,
          ));
        }
        else if (message.event === "send_activated") {
          void Promise.resolve().then(() => {
            if (this.pending.get(message.id) !== pending || pending.localFailure
              || pending.turn.abortSignal?.aborted) return;
            return pending.turn.onSendActivated?.();
          }).then(() => {
            if (this.pending.get(message.id) !== pending || pending.localFailure
              || pending.turn.abortSignal?.aborted) return;
            return this.send({ type: "send_activation_ack", id: message.id,
              ...(message.requestId !== undefined ? { requestId: message.requestId } : {}) });
          }).catch(error => {
            if (pending.turn.abortSignal?.aborted) return;
            this.abortWithLocalFailure(
              message.id, error instanceof Error ? error : new Error(String(error)), pending,
            );
          });
        }
        else if (message.event === "submitted") pending.turn.onSubmitted?.();
        else if (message.event === "multipart_stage_acknowledged") {
          const multipart = pending.prepared?.multipart;
          if (!multipart
            || message.stageIndex >= multipart.parts.length
            || message.stageIndex !== (pending.acknowledgedMultipartStage ?? 0) + 1) {
            this.abortWithLocalFailure(
              message.id,
              new Error("Launcher browser helper acknowledged an unexpected multipart stage"),
              pending,
            );
            return;
          }
          pending.acknowledgedMultipartStage = message.stageIndex;
          void Promise.resolve().then(() => pending.turn.onMultipartStageAcknowledged?.(message.stageIndex))
            .catch(error => this.abortWithLocalFailure(
              message.id,
              error instanceof Error ? error : new Error(String(error)),
              pending,
            ));
        }
        else if (message.event === "prepared_selected") {
          const prepare = message.reused ? pending.turn.prepareResume : pending.turn.prepare;
          void Promise.resolve().then(() => prepare?.()).then(prepared => {
            if (!prepared) throw new Error("Launcher browser helper selected an unavailable continuation prompt");
            if (this.pending.get(message.id) !== pending) {
              prepared.release();
              return;
            }
            pending.prepared = prepared;
            if (prepared.skillFiles?.length && !this.helperFeatures.has("skill-attachments")) {
              throw new Error("Launcher browser helper does not support skill attachments; update or restart the launcher");
            }
            if (prepared.files?.length && !this.helperFeatures.has("file-attachments")) {
              throw new Error("Launcher browser helper does not support file attachments; update or restart the launcher");
            }
            return Promise.resolve(pending.turn.onPreparedSelected?.(message.reused)).then(() => {
              if (this.pending.get(message.id) !== pending) return;
              return this.send({
                type: "prepared_selected_ack",
                id: message.id,
                prepared: {
                  text: prepared.text,
                  images: prepared.images,
                  ...(prepared.files?.length ? { files: prepared.files } : {}),
                  ...(prepared.skillFiles ? { skillFiles: prepared.skillFiles } : {}),
                  ...(prepared.multipart ? { multipart: prepared.multipart } : {}),
                  ...(prepared.trimmedCompactionMessages !== undefined
                    ? { trimmedCompactionMessages: prepared.trimmedCompactionMessages }
                    : {}),
                } satisfies CompiledChatGptWebPrompt,
              });
            });
          }).catch(error => this.abortWithLocalFailure(
            message.id,
            error instanceof Error ? error : new Error(String(error)),
            pending,
          ));
        }
        else if (message.event === "luna_checkpoint") {
          if (!pending.turn.captureLunaCheckpoint || !pending.turn.onLunaCheckpoint) {
            this.finishWithError(message.id, new Error("Launcher browser helper emitted an unexpected Luna checkpoint"));
            return;
          }
          pending.turn.onLunaCheckpoint({ checkpoint: message.checkpoint, answerHash: message.answerHash });
        }
        else if (message.event === "reasoning" && message.text) {
          pending.turn.onReasoningSummary?.(message.text, message.continuation === true);
        }
        else if (message.event === "commentary" && message.text) pending.turn.onCommentary?.(message.text, message.continuation === true);
        else if (message.event === "text" && message.text) pending.turn.onTextDelta(message.text);
      } catch (error) {
        this.abortWithLocalFailure(message.id, error instanceof Error ? error : new Error(String(error)), pending);
      }
      return;
    }
    if (message.type === "result") {
      this.finish(message.id);
      if (pending.localFailure) pending.reject(pending.localFailure);
      else pending.resolve(message.text);
    } else if (message.type === "error") {
      const error = message.status !== undefined
        ? new ChatGptWebAdapterError(message.message, {
          status: message.status,
          errorType: message.errorType!,
          code: message.code!,
          retryable: message.retryable!,
        })
        : message.name === "AbortError"
          ? new DOMException(message.message, "AbortError")
          : new Error(message.message);
      this.finish(message.id);
      pending.reject(pending.localFailure ?? error);
    }
  }

  private abortWithLocalFailure(id: string, error: Error, pending: PendingTurn): void {
    if (this.pending.get(id) !== pending || pending.localFailure) return;
    pending.localFailure = error;
    void this.sendAbort(pending, { type: "abort", id }).catch(sendError => {
      if (this.pending.get(id) !== pending) return;
      this.reserveUnresolved(pending);
      this.finishWithError(
        id,
        new AggregateError(
          [error, sendError instanceof Error ? sendError : new Error(String(sendError))],
          "Launcher browser helper could not abort after a local protocol failure",
        ),
      );
    });
  }

  /**
   * Mirrors daemon-recorded MCP progress into the helper process for the life of the turn.
   *
   * The browser worker runs out of process, so without this the worker sees no external progress
   * and cancels turns whose tool calls are still completing.
   */
  private forwardProgress(turn: BrowserTurn, stop: AbortSignal): void {
    const progress = turn.externalProgress;
    if (!progress) return;
    if (!this.helperFeatures.has("progress")) {
      console.warn(
        `[chatgpt-web] browser turn ${turn.traceId} runs without an MCP progress mirror:`
        + " the launcher browser helper predates the progress frame",
      );
      return;
    }
    void (async () => {
      let revision = 0;
      while (!stop.aborted) {
        const snapshot = await progress.waitForChange(revision, stop);
        revision = snapshot.revision;
        if (stop.aborted) return;
        await this.send({ type: "progress", id: turn.traceId, snapshot });
      }
    })().catch(error => {
      // Ending, aborting, or losing the helper stops the mirror by design and is not a fault.
      // Anything else leaves the worker on DOM-only health without saying so, which is exactly the
      // silent degradation this transport exists to remove, so it is surfaced rather than dropped.
      if (stop.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      console.warn(
        `[chatgpt-web] browser turn ${turn.traceId} lost its MCP progress mirror:`
        + ` ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  private finish(id: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    if (pending.abortListener && pending.turn.abortSignal) {
      pending.turn.abortSignal.removeEventListener("abort", pending.abortListener);
    }
    pending.progressForwarding?.abort();
    pending.progressForwarding = undefined;
    pending.prepared?.release();
    pending.prepared = undefined;
    this.pending.delete(id);
  }

  private finishWithError(id: string, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.finish(id);
    pending.reject(error);
  }

  private reserveUnresolved(pending: PendingTurn): void {
    const id = pending.turn.traceId;
    const child = this.child;
    if (this.pending.get(id) === pending && child && child.exitCode === null
      && child.signalCode === null) this.unresolved.set(id, child);
  }

  private handleExit(child: ChildProcessWithoutNullStreams, error: Error): void {
    // Transport failure can detach a child before it exits. Keep its unresolved IDs reserved
    // until this exact process has actually stopped, even if a replacement helper starts.
    if (child.exitCode !== null || child.signalCode !== null) {
      for (const [id, owner] of this.unresolved) {
        if (owner === child) this.unresolved.delete(id);
      }
    }
    if (this.child !== child) return;
    if (child.exitCode === null && child.signalCode === null) {
      for (const id of this.pending.keys()) this.unresolved.set(id, child);
    }
    this.readyReject?.(error);
    this.readyReject = undefined;
    this.readyResolve = undefined;
    this.ready = undefined;
    this.child = undefined;
    for (const id of [...this.pending.keys()]) {
      const pending = this.pending.get(id);
      if (!pending) continue;
      void notifyLauncherTurn(this.config.browserHostDescriptorPath!, {
        phase: "end",
        traceId: id,
        helperPid: child.pid!,
        status: "failed",
        message: "Launcher browser helper exited before completing the turn",
      }).then(
        () => this.finishWithError(id, pending.localFailure ?? error),
        controlError => this.finishWithError(
          id,
          new AggregateError(
            [pending.localFailure ?? error, controlError instanceof Error ? controlError : new Error(String(controlError))],
            `Launcher browser helper exited and failed to release turn ${id}`,
          ),
        ),
      );
    }
  }

  private async waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    return await new Promise<boolean>(resolveExit => {
      let settled = false;
      const finish = (exited: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.off("exit", onExit);
        child.off("close", onExit);
        resolveExit(exited);
      };
      const onExit = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      child.once("exit", onExit);
      child.once("close", onExit);
    });
  }

  private async terminateChild(child: ChildProcessWithoutNullStreams, gracefulTimeoutMs: number): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.stdin.end();
    if (await this.waitForExit(child, gracefulTimeoutMs)) return;
    if (!child.kill("SIGTERM") && child.exitCode === null && child.signalCode === null) {
      throw new Error("Launcher browser helper refused termination");
    }
    if (await this.waitForExit(child, 2_000)) return;
    if (!child.kill("SIGKILL") && child.exitCode === null && child.signalCode === null) {
      throw new Error("Launcher browser helper refused forced termination");
    }
    if (!await this.waitForExit(child, 2_000)) {
      throw new Error("Launcher browser helper did not exit after forced termination");
    }
  }

  private send(message: unknown): Promise<void> {
    const child = this.child;
    if (!child
      || child.killed
      || child.exitCode !== null
      || child.signalCode !== null) {
      return Promise.reject(new Error("Launcher browser helper is not running"));
    }
    return this.sendTo(child, message);
  }

  private sendAbort(pending: PendingTurn, message: unknown): Promise<void> {
    const child = this.child;
    if (!child || child.killed || child.exitCode !== null || child.signalCode !== null) {
      return Promise.reject(new Error("Launcher browser helper is not running"));
    }
    // An abort is a small control frame. Give a congested pipe a bounded chance to drain instead
    // of failing a locally rejected prompt and leaving its helper-side selection waiting.
    return this.sendTo(child, message, {
      waitForCapacityMs: 5_000,
      cancellation: pending.progressForwarding?.signal,
      currentTurn: pending,
    });
  }

  private waitForInputDrain(child: ChildProcessWithoutNullStreams, timeoutMs: number,
    cancellation?: AbortSignal): Promise<void> {
    return new Promise<void>((resolveDrain, rejectDrain) => {
      const cleanup = () => {
        clearTimeout(timer);
        child.stdin.off("drain", onDrain);
        child.stdin.off("error", onError);
        child.stdin.off("close", onClose);
        child.off("exit", onExit);
        cancellation?.removeEventListener("abort", onAbort);
      };
      const onDrain = () => { cleanup(); resolveDrain(); };
      const onError = (error: Error) => { cleanup(); rejectDrain(error); };
      const onClose = () => {
        cleanup();
        const error = new Error("Launcher browser helper input closed while congested");
        this.failChild(child, error);
        rejectDrain(error);
      };
      const onExit = () => { cleanup(); rejectDrain(new Error("Launcher browser helper exited while input was congested")); };
      const onAbort = () => { cleanup(); rejectDrain(new DOMException("Browser helper turn ended before abort delivery", "AbortError")); };
      const timer = setTimeout(() => {
        cleanup();
        rejectDrain(new Error("Launcher browser helper input queue did not drain before abort deadline"));
      }, timeoutMs);
      child.stdin.once("drain", onDrain);
      child.stdin.once("error", onError);
      child.stdin.once("close", onClose);
      child.once("exit", onExit);
      cancellation?.addEventListener("abort", onAbort, { once: true });
      if (cancellation?.aborted) onAbort();
    });
  }

  private async sendTo(child: ChildProcessWithoutNullStreams, message: unknown, options?: {
    waitForCapacityMs: number;
    cancellation?: AbortSignal;
    currentTurn: PendingTurn;
  }): Promise<void> {
    const encoded = `${JSON.stringify(message)}\n`;
    const bytes = Buffer.byteLength(encoded, "utf8");
    assertByteLimit(bytes - 1, CHATGPT_HELPER_FRAME_BYTES, "Browser helper IPC frame");
    const deadline = options ? Date.now() + options.waitForCapacityMs : 0;
    while (child.stdin.writableLength + bytes > CHATGPT_HELPER_PENDING_BYTES && options) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await this.waitForInputDrain(child, remaining, options.cancellation);
    }
    // Both limits are checked immediately before write. A local size/queue rejection has sent no
    // bytes and belongs to this caller; only a broken pipe or failed write corrupts the transport.
    assertByteLimit(child.stdin.writableLength + bytes, CHATGPT_HELPER_PENDING_BYTES, "Browser helper IPC input queue");
    if (options && (this.child !== child
      || this.pending.get(options.currentTurn.turn.traceId) !== options.currentTurn
      || options.cancellation?.aborted)) {
      throw new DOMException("Browser helper turn ended before abort delivery", "AbortError");
    }
    if (child.stdin.destroyed || child.stdin.writableEnded) {
      const error = new Error("Launcher browser helper input is closed");
      this.failChild(child, error);
      throw error;
    }
    await new Promise<void>((resolveWrite, rejectWrite) => {
      try {
        child.stdin.write(encoded, error => {
          if (error) {
            this.failChild(child, error);
            rejectWrite(error);
          }
          else resolveWrite();
        });
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        this.failChild(child, failure);
        rejectWrite(failure);
      }
    });
  }
}
