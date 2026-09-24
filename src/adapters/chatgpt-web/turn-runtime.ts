import { randomBytes } from "node:crypto";
import { type ChatGptWebCompactionExecution } from "../../chatgpt-web-compaction-policy";
import { isChatGptWebZeroRiskBackendModel } from "../../chatgpt-web-models";
import {
  cancelLauncherManualTurn,
  endLauncherManualTurn,
  LauncherBrowserTurnCancelledError,
  LauncherManualTurnFailedError,
  LauncherManualTurnTimedOutError,
  markLauncherManualTurnStarted,
  releaseLauncherRetainedConversation,
  startLauncherManualTurn,
  waitForLauncherManualSent,
  waitForLauncherManualTerminal,
  type LauncherManualTurnEnd,
  type LauncherManualTurnOwner,
  type LauncherManualTurnStart,
} from "../../launcher-browser-host";
import { type CodexParsedRequest, type CodexProviderConfig } from "../../types";
import { ChatGptWebAdapterError } from "./adapter-error";
import type { ChatGptBrowserWorker } from "./browser-worker";
import {
  chatGptConversationKey,
  retainedConversationResumeRequest,
} from "./conversation-key";
import { extractChatGptTurnEnvironment, extractChatGptTurnIdentity } from "./environment";
import {
  chatGptManualAttachmentInstructions,
  materializeChatGptManualAttachments,
} from "./manual-attachments";
import { CHATGPT_WEB_LUNA_MODEL_ID, resolveChatGptWebModelMode, type ChatGptWebCapabilities } from "./model";
import { compileChatGptWebPrompt } from "./prompt";
import {
  ChatGptLunaCheckpointStore,
  type CapturedChatGptLunaCheckpoint,
} from "./rolling-checkpoint";
import type { TurnBrokerOwner } from "./turn-broker";
import { chatGptAccountRoutingKey } from "./turn-execution";
import { ChatGptTextFeed, ChatGptTraceFeed, type ChatGptTurnRuntime } from "./turn-feeds";
import { ChatGptExternalTurnProgress } from "./turn-progress";
import { resolveBiggerContextMultipartParts } from "./usage";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<T>((resolveDeferred, rejectDeferred) => {
    resolvePromise = resolveDeferred;
    rejectPromise = rejectDeferred;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function cancellableBrowserTurn(
  run: Promise<string>,
  controller: AbortController,
): { browser: Promise<string>; physicalSettlement: Promise<void>; cancel: (reason?: Error) => void } {
  let rejectCancellation!: (error: Error) => void;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  let cancellationRejected = false;
  return {
    // Cancellation wins immediately even while the detached Playwright helper is still unwinding.
    // The helper keeps the same abort signal and remains responsible for its normal end/cleanup
    // handshake, but the Codex Responses turn no longer waits on that process cleanup.
    browser: Promise.race([run, cancellation]),
    // `browser` is the fast client-facing result. Replacement ownership must wait for the actual
    // worker promise, whose finally block completes the launcher /turn/end handshake.
    physicalSettlement: run.then(() => undefined, () => undefined),
    cancel(reason?: Error) {
      if (!controller.signal.aborted) controller.abort(reason);
      // Explicit targeted cancellation ends the Codex Responses turn immediately. Generic
      // retirement (client disconnect or compaction replacement) still waits for the helper's
      // cleanup handshake before a replacement browser may start.
      if (reason && !cancellationRejected) {
        cancellationRejected = true;
        rejectCancellation(reason);
      }
    },
  };
}

export interface ChatGptZeroRiskManualControl {
  start(descriptorPath: string, activity: LauncherManualTurnStart): Promise<unknown>;
  waitSent(
    descriptorPath: string,
    owner: LauncherManualTurnOwner,
    options?: { abortSignal?: AbortSignal; timeoutMs?: number },
  ): Promise<unknown>;
  waitTerminal(
    descriptorPath: string,
    owner: LauncherManualTurnOwner,
    options?: { abortSignal?: AbortSignal; timeoutMs?: number },
  ): Promise<{ status: "cancelled" | "failed" }>;
  markStarted(descriptorPath: string, owner: LauncherManualTurnOwner): Promise<void>;
  end(descriptorPath: string, activity: LauncherManualTurnEnd): Promise<unknown>;
  cancel(descriptorPath: string, owner: LauncherManualTurnOwner): Promise<void>;
}

export const launcherZeroRiskManualControl: ChatGptZeroRiskManualControl = {
  start: startLauncherManualTurn,
  waitSent: waitForLauncherManualSent,
  waitTerminal: waitForLauncherManualTerminal,
  markStarted: markLauncherManualTurnStarted,
  end: endLauncherManualTurn,
  cancel: cancelLauncherManualTurn,
};

function safeManualAdapterError(error: unknown): Error {
  if (error instanceof DOMException && error.name === "AbortError") return error;
  if (error instanceof ChatGptWebAdapterError) return error;
  if (error instanceof LauncherManualTurnTimedOutError) {
    return new ChatGptWebAdapterError(error.message, {
      status: 408,
      errorType: "invalid_request_error",
      code: "manual_handoff_timeout",
      retryable: false,
    });
  }
  if (error instanceof LauncherBrowserTurnCancelledError) {
    return new ChatGptWebAdapterError(error.message, {
      status: 409,
      errorType: "invalid_request_error",
      code: "manual_turn_cancelled",
      retryable: false,
    });
  }
  if (error instanceof LauncherManualTurnFailedError) {
    return new ChatGptWebAdapterError(error.message, {
      status: 502,
      errorType: "server_error",
      code: "manual_launcher_failed",
      retryable: false,
    });
  }
  return error instanceof Error ? error : new Error(String(error));
}

function safeManualTerminalError(status: "cancelled" | "failed"): ChatGptWebAdapterError {
  if (status === "cancelled") {
    return new ChatGptWebAdapterError("The Manual mode browser turn was cancelled in the Launcher", {
      status: 409,
      errorType: "invalid_request_error",
      code: "manual_turn_cancelled",
      retryable: false,
    });
  }
  return new ChatGptWebAdapterError("The Manual mode browser tab failed before ChatGPT completed the turn", {
    status: 502,
    errorType: "server_error",
    code: "manual_launcher_failed",
    retryable: false,
  });
}

export interface ChatGptTurnRuntimeContext {
  provider: CodexProviderConfig;
  worker: Pick<ChatGptBrowserWorker, "run">;
  broker: Pick<TurnBrokerOwner,
    "register" | "registerSafe" | "waitForRetirement" | "revoke" | "confirmSafeTurnSent"
    | "waitForSafeStart" | "waitForSafeCompletion" | "beginCompletionFence" | "commitCompletionFence">;
  zeroRiskManualControl: ChatGptZeroRiskManualControl;
  lunaCheckpointStore: Pick<ChatGptLunaCheckpointStore, "apply" | "commit">;
  conversationNamespace: (parsed: CodexParsedRequest) => string;
  manualInteraction: boolean;
  retainedLauncherDescriptor?: string;
  timeoutMs?: number;
  experimentalBiggerContext?: boolean;
  experimentalSkillAttachments?: boolean;
  experimentalAsyncToolOperations?: boolean;
}

export interface ChatGptTurnRuntimeRequest {
  parsed: CodexParsedRequest;
  environment: ReturnType<typeof extractChatGptTurnEnvironment> | undefined;
  traceId: string;
  turnCapabilities: ChatGptWebCapabilities;
  hooks?: {
    onCompactionProgress?: () => void;
    compactionExecution?: ChatGptWebCompactionExecution;
  };
}

export function createChatGptTurnRuntimeFactory(context: ChatGptTurnRuntimeContext) {
  const { provider, worker, broker, zeroRiskManualControl, lunaCheckpointStore, conversationNamespace,
    manualInteraction, retainedLauncherDescriptor, timeoutMs, experimentalBiggerContext,
    experimentalSkillAttachments, experimentalAsyncToolOperations } = context;
  return ({ parsed, environment, traceId, turnCapabilities, hooks = {} }: ChatGptTurnRuntimeRequest): ChatGptTurnRuntime => {
    const manualRequest = isChatGptWebZeroRiskBackendModel(parsed.modelId);
    if (manualRequest !== manualInteraction) {
      throw new Error(
        manualInteraction
          ? "ChatGPT Manual mode requires the Manual mode Web model route"
          : "The Manual mode Web model route requires ChatGPT Manual mode interaction mode",
      );
    }
    const mode = manualRequest
      ? { localTools: true }
      : resolveChatGptWebModelMode(parsed.modelId, parsed.options.reasoning, turnCapabilities);
    const identity = extractChatGptTurnIdentity(parsed);
    const captureLunaCheckpoint = parsed.modelId === CHATGPT_WEB_LUNA_MODEL_ID
      && !parsed._compactionRequest
      && Boolean(identity.threadId && identity.turnId);
    const checkpointInput = captureLunaCheckpoint
      ? lunaCheckpointStore.apply(parsed)
      : { parsed, applied: false };
    const conversationKey = !provider.chatgptWeb?.experimentalFreshConversationPerTurn
      && !parsed._compactionRequest
      && parsed.modelId !== CHATGPT_WEB_LUNA_MODEL_ID
      && mode.localTools
      && retainedLauncherDescriptor
      ? chatGptConversationKey(checkpointInput.parsed, conversationNamespace(checkpointInput.parsed))
      : undefined;
    const resumeInput = conversationKey
      ? retainedConversationResumeRequest(checkpointInput.parsed)
      : undefined;
    const retainConversation = conversationKey !== undefined;
    const releaseRetainedConversation = conversationKey && retainedLauncherDescriptor
      ? async () => {
        await releaseLauncherRetainedConversation(retainedLauncherDescriptor, conversationKey);
      }
      : undefined;
    const compileOptionsFor = (input: CodexParsedRequest) => {
      if (manualRequest) return {};
      const experimentalMultipartParts = experimentalBiggerContext
        ? resolveBiggerContextMultipartParts(
          input, turnCapabilities, experimentalSkillAttachments, experimentalAsyncToolOperations,
        )
        : undefined;
      return {
        captureLunaCheckpoint,
        experimentalSkillAttachments,
        experimentalAsyncToolOperations,
        ...(hooks.compactionExecution ? { allowProStaging: false } : {}),
        ...(experimentalMultipartParts !== undefined
          ? { experimentalMultipartParts }
          : {}),
      };
    };
    if (captureLunaCheckpoint) {
      console.info(
        `[chatgpt-web] Luna rolling checkpoint applied=${checkpointInput.applied}${checkpointInput.reason ? ` reason=${checkpointInput.reason}` : ""}`,
      );
    }
    let capturedCheckpoint: CapturedChatGptLunaCheckpoint | undefined;
    let checkpointCaptureError: Error | undefined;
    const captureCheckpoint = (captured: CapturedChatGptLunaCheckpoint): void => {
      if (capturedCheckpoint) {
        checkpointCaptureError = new Error("ChatGPT Luna emitted more than one rolling checkpoint");
        return;
      }
      capturedCheckpoint = captured;
    };
    const finalizeCheckpoint = (browser: Promise<string>): Promise<string> => browser.then(answer => {
      if (!captureLunaCheckpoint) return answer;
      if (checkpointCaptureError) throw checkpointCaptureError;
      if (capturedCheckpoint) lunaCheckpointStore.commit(parsed, capturedCheckpoint, answer);
      return answer;
    });
    const browserAbort = new AbortController();
    let browserOwnerSettled = false;
    const trackBrowserOwner = (browser: Promise<string>): Promise<string> => browser.finally(() => {
      browserOwnerSettled = true;
    });
    const trace = new ChatGptTraceFeed();
    const text = new ChatGptTextFeed();
    const observedCapabilityTokens = new Set<string>();
    const observeCapabilityRetirement = (
      turnToken: string,
      externalProgress: ChatGptExternalTurnProgress,
    ): void => {
      if (observedCapabilityTokens.has(turnToken)) return;
      observedCapabilityTokens.add(turnToken);
      void broker.waitForRetirement(turnToken).then(
        () => {
          const retirement = new Error("Codex Native retired the turn binding before its tool work completed");
          externalProgress.retire(retirement);
          if (!browserOwnerSettled && !browserAbort.signal.aborted) browserAbort.abort(retirement);
        },
        error => {
          const failure = new Error("ChatGPT could not observe Codex Native turn retirement", {
            cause: error,
          });
          externalProgress.retire(failure);
          if (!browserAbort.signal.aborted) browserAbort.abort(failure);
        },
      );
    };
    const submission: NonNullable<ChatGptTurnRuntime["submission"]> = { phase: "prepared" };
    // A canonical compaction request is side-effect free and remains safe to rebuild after an
    // ambiguous browser send. Normal task prompts must never be replayed after Send activation.
    const submissionLifecycle = {
      ...(!parsed._compactionRequest ? {
        onSendActivated: () => { submission.phase = "send_activated" as const; },
      } : {}),
      onSubmitted: () => {
        if (!parsed._compactionRequest) submission.phase = "accepted";
        hooks.onCompactionProgress?.();
      },
    };
    const multipartProgressLifecycle = hooks.onCompactionProgress
      ? { onMultipartStageAcknowledged: hooks.onCompactionProgress }
      : {};
    const automaticLifecycle = () => ({
      accountRoutingKey: chatGptAccountRoutingKey(checkpointInput.parsed),
      traceId,
      modelId: parsed.modelId,
      requestedModel: parsed.requestedModel,
      reasoning: parsed.options.reasoning,
      ...(parsed._chatgptModelFamily ? { modelFamily: parsed._chatgptModelFamily } : {}),
      capabilities: turnCapabilities,
      abortSignal: browserAbort.signal,
      ...(parsed._compactionRequest ? { compaction: true } : {}),
      ...(hooks.compactionExecution ? { compactionExecution: hooks.compactionExecution } : {}),
      ...submissionLifecycle,
      ...multipartProgressLifecycle,
      onReasoningSummary: (text, continuation) => trace.push({ kind: "reasoning", text, ...(continuation ? { continuation: true } : {}) }),
      onCommentary: (text, continuation) => trace.push({ kind: "commentary", text, ...(continuation ? { continuation: true } : {}) }),
      onTextDelta: delta => text.push(delta),
      ...(captureLunaCheckpoint ? {
        captureLunaCheckpoint: true,
        onLunaCheckpoint: captureCheckpoint,
      } : {}),
    } satisfies Partial<Parameters<ChatGptBrowserWorker["run"]>[0]>);
    const startManual = (): ChatGptTurnRuntime => {
      if (!environment) throw new Error("ChatGPT Manual mode requires a trusted Codex environment");
      if (!retainedLauncherDescriptor) throw new Error("ChatGPT Manual mode requires the Launcher browser host");
      const token = deferred<string>();
      const externalProgress = new ChatGptExternalTurnProgress();
      const surfaceNonce = randomBytes(32).toString("base64url");
      const owner: LauncherManualTurnOwner = { traceId, helperPid: process.pid };
      let tokenSettled = false;
      let activeToken: string | undefined;
      let launcherStarted = false;
      let launcherEnded = false;
      const finishLauncher = async (status: LauncherManualTurnEnd["status"]): Promise<void> => {
        if (!launcherStarted || launcherEnded) return;
        await zeroRiskManualControl.end(retainedLauncherDescriptor, {
          ...owner,
          status,
          ...(status === "completed" && retainConversation ? { retain: true } : {}),
        });
        launcherEnded = true;
      };
      const runManual = async (): Promise<string> => {
        try {
          activeToken = await broker.registerSafe(environment, surfaceNonce, undefined, traceId);
          observeCapabilityRetirement(activeToken, externalProgress);
          const compiled = compileChatGptWebPrompt(
            checkpointInput.parsed,
            turnCapabilities,
            activeToken,
            { manualControl: true },
          );
          const resumeCompiled = resumeInput
            ? compileChatGptWebPrompt(
              resumeInput,
              turnCapabilities,
              activeToken,
              { manualControl: true },
            )
            : undefined;
          for (const candidate of [compiled, resumeCompiled]) {
            if (!candidate) continue;
            if (candidate.multipart) {
              throw new ChatGptWebAdapterError("ChatGPT Manual mode does not support multipart browser transport", {
                status: 409,
                errorType: "invalid_request_error",
                code: "manual_multipart_unsupported",
                retryable: false,
              });
            }
          }
          tokenSettled = true;
          token.resolve(activeToken);
          const manualAttachments = await materializeChatGptManualAttachments(`${traceId}-new`, compiled);
          const manualResumeAttachments = resumeCompiled
            ? await materializeChatGptManualAttachments(`${traceId}-resume`, resumeCompiled)
            : undefined;
          if (!parsed._compactionRequest) {
            const attachmentInstructions = manualResumeAttachments
              ? [
                  "For a new ChatGPT conversation:",
                  chatGptManualAttachmentInstructions(manualAttachments),
                  "For the retained Resume prompt:",
                  chatGptManualAttachmentInstructions(manualResumeAttachments),
                  "Use only the file set matching the prompt shown by the launcher.",
                ].join("\n")
              : chatGptManualAttachmentInstructions(manualAttachments);
            trace.push({
              kind: "commentary",
              text: "> **Action required in Manual mode**\n>\n> Open the launcher and copy the prompt into ChatGPT. Select the `Codex Zero Risk4` plugin and the model you want.\n>\n> "
                + attachmentInstructions.replaceAll("\n", "\n> ")
                + "\n>\n> Send only after the exact required files are attached, then confirm `Sent` in the launcher.",
            });
          }
          await zeroRiskManualControl.start(retainedLauncherDescriptor, {
            useSavedChats: provider.chatgptWeb?.useSavedChats === true,
            ...owner,
            prompt: compiled.text,
            ...(resumeCompiled ? { resumePrompt: resumeCompiled.text } : {}),
            ...(conversationKey ? { conversationKey } : {}),
            ...(parsed._compactionRequest ? { compaction: true as const } : {}),
          });
          launcherStarted = true;
          await zeroRiskManualControl.waitSent(retainedLauncherDescriptor, owner, {
            abortSignal: browserAbort.signal,
          });
          await broker.confirmSafeTurnSent(activeToken, surfaceNonce);
          submission.phase = "accepted";
          if (!parsed._compactionRequest) trace.push({
            kind: "commentary",
            text: "> **Waiting for ChatGPT**\n>\n> The prompt is marked `Sent`. Waiting for `Codex Zero Risk4` to bind this turn through the selected ChatGPT connector.",
          });
          const terminalAbort = new AbortController();
          const abortTerminal = () => terminalAbort.abort();
          browserAbort.signal.addEventListener("abort", abortTerminal, { once: true });
          const terminalFailure = zeroRiskManualControl.waitTerminal(
            retainedLauncherDescriptor,
            owner,
            { abortSignal: terminalAbort.signal },
          ).then(observed => Promise.reject(safeManualTerminalError(observed.status)))
            .catch(error => terminalAbort.signal.aborted
              ? new Promise<never>(() => {})
              : Promise.reject(error));
          let answer: string;
          try {
            await Promise.race([
              broker.waitForSafeStart(activeToken, browserAbort.signal),
              terminalFailure,
            ]);
            await zeroRiskManualControl.markStarted(retainedLauncherDescriptor, owner);
            if (!parsed._compactionRequest) trace.push({
              kind: "commentary",
              text: "> **Manual mode connected**\n>\n> `Codex Zero Risk4` is connected. ChatGPT is now working through the native Codex harness; progress remains visible in the launcher.",
            });
            answer = await Promise.race([
              broker.waitForSafeCompletion(activeToken, browserAbort.signal),
              terminalFailure,
            ]);
          } finally {
            terminalAbort.abort();
            browserAbort.signal.removeEventListener("abort", abortTerminal);
          }
          text.push(answer);
          try {
            await finishLauncher("completed");
          } catch (controlError) {
            // The broker result is already authoritative. A launcher acknowledgement failure may
            // leave UI cleanup pending, but it must not replace a completed Codex answer with an
            // error or trigger a contradictory failed terminal mutation.
            console.error(
              `[chatgpt-web] completed Manual mode turn but could not confirm launcher cleanup: ${controlError instanceof Error ? controlError.message : String(controlError)}`,
            );
          }
          return answer;
        } catch (error) {
          const normalized = safeManualAdapterError(error);
          // Capture the causal state before our own cleanup revokes the broker capability. The
          // retirement observer also aborts browserAbort, but that self-induced abort must not turn
          // an ordinary launcher/runtime failure into a user cancellation.
          const externallyAborted = browserAbort.signal.aborted;
          if (activeToken) await Promise.resolve(broker.revoke(activeToken, normalized)).catch(() => {});
          try {
            await finishLauncher(externallyAborted ? "aborted" : "failed");
          } catch (controlError) {
            console.error(
              `[chatgpt-web] failed to release Manual mode launcher turn: ${controlError instanceof Error ? controlError.message : String(controlError)}`,
            );
          }
          throw normalized;
        }
      };
      const browserTurn = cancellableBrowserTurn(trackBrowserOwner(runManual()), browserAbort);
      void browserTurn.browser.catch(error => {
        if (tokenSettled) return;
        tokenSettled = true;
        token.reject(error instanceof Error ? error : new Error(String(error)));
      });
      return {
        mode: "tools",
        token: token.promise,
        externalProgress,
        browser: browserTurn.browser,
        physicalSettlement: browserTurn.physicalSettlement,
        trace,
        text,
        usageInput: checkpointInput.parsed,
        manualControl: { surfaceNonce },
        ...(conversationKey ? { conversationKey } : {}),
        ...(releaseRetainedConversation ? { releaseRetainedConversation } : {}),
        retireCapability: async () => {
          if (activeToken) await broker.revoke(activeToken);
        },
        submission,
        cancel: (reason?: Error) => {
          browserTurn.cancel(reason);
          if (activeToken) {
            void Promise.resolve(broker.revoke(activeToken, reason)).catch(error => {
              console.error(`[chatgpt-web] failed to revoke cancelled Manual mode request: ${error instanceof Error ? error.message : String(error)}`);
            });
          }
        },
      };
    };
    const startReadOnly = (): ChatGptTurnRuntime => {
      const browserTurn = cancellableBrowserTurn(finalizeCheckpoint(worker.run({
        ...automaticLifecycle(),
        prepare: async () => ({
          ...compileChatGptWebPrompt(
            checkpointInput.parsed,
            turnCapabilities,
            undefined,
            compileOptionsFor(checkpointInput.parsed),
          ),
          release: () => {},
        }),
      })), browserAbort);
      return {
        mode: "read-only",
        browser: browserTurn.browser,
        physicalSettlement: browserTurn.physicalSettlement,
        trace,
        text,
        usageInput: checkpointInput.parsed,
        submission,
        cancel: browserTurn.cancel,
      };
    };
    const startTools = (): ChatGptTurnRuntime => {
      if (!environment) throw new Error("Tool-capable ChatGPT web mode requires a trusted Codex environment");
      const token = deferred<string>();
      const externalProgress = new ChatGptExternalTurnProgress();
      let tokenSettled = false;
      let activeToken: string | undefined;
      const prepareWith = async (input: CodexParsedRequest) => {
        const turnToken = activeToken ?? await broker.register(
          environment,
          timeoutMs === undefined ? undefined : timeoutMs + 60_000,
          traceId,
        );
        activeToken = turnToken;
        try {
          const compiled = compileChatGptWebPrompt(
            input,
            turnCapabilities,
            turnToken,
            compileOptionsFor(input),
          );
          // Publish only after preparation succeeds: otherwise its failure revokes the token
          // before the response observer uses it and masks the cause as an expired capability.
          observeCapabilityRetirement(turnToken, externalProgress);
          if (!tokenSettled) {
            tokenSettled = true;
            token.resolve(turnToken);
          }
          return { ...compiled, release: () => {} };
        } catch (error) {
          try {
            await broker.revoke(turnToken);
            activeToken = undefined;
          } catch (revokeError) {
            throw new AggregateError(
              [error, revokeError],
              "ChatGPT browser preparation failed and its broker turn could not be revoked",
            );
          }
          throw error;
        }
      };
      const browserTurn = cancellableBrowserTurn(trackBrowserOwner(finalizeCheckpoint(worker.run({
        ...automaticLifecycle(),
        prepare: () => prepareWith(checkpointInput.parsed),
        ...(resumeInput ? { prepareResume: () => prepareWith(resumeInput) } : {}),
        ...(retainConversation ? { retainConversation: true, conversationKey } : {}),
        externalProgress,
        ...(experimentalAsyncToolOperations ? { asyncToolOperations: true } : {}),
        completionFence: {
          begin: async () => broker.beginCompletionFence(await token.promise),
          commit: async revision => broker.commitCompletionFence(await token.promise, revision),
        },
      }))), browserAbort);
      void browserTurn.browser.catch(error => {
        if (!tokenSettled) {
          tokenSettled = true;
          token.reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      return {
        mode: "tools",
        token: token.promise,
        externalProgress,
        browser: browserTurn.browser,
        physicalSettlement: browserTurn.physicalSettlement,
        trace,
        text,
        usageInput: checkpointInput.parsed,
        ...(conversationKey ? { conversationKey } : {}),
        ...(releaseRetainedConversation ? { releaseRetainedConversation } : {}),
        retireCapability: async () => {
          if (activeToken) await broker.revoke(activeToken);
        },
        submission,
        cancel: (reason?: Error) => {
          browserTurn.cancel(reason);
          if (activeToken) {
            void Promise.resolve(broker.revoke(activeToken, reason)).catch(error => {
              console.error(`[chatgpt-web] failed to revoke cancelled turn token: ${error instanceof Error ? error.message : String(error)}`);
            });
          }
        },
      };
    };
    return manualRequest ? startManual() : mode.localTools ? startTools() : startReadOnly();
  };
}
