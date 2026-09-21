const { createServer } = require("node:http");
const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");
const { validateNativeUsageSample } = require("./usage-store.cjs");

const { isTaskModel } = require("./browser-task-ledger.cjs");

const MAX_BODY_BYTES = 16 * 1024;
const MAX_MANUAL_START_BODY_BYTES = 3 * 1024 * 1024;
const MANUAL_SENT_OBSERVER_TIMEOUT_MS = 35_000;
const MAX_AUTOMATIC_MUTATION_RECEIPTS = 4096;

function secureTokenMatches(expected, authorization) {
  const prefix = "Bearer ";
  if (typeof authorization !== "string" || !authorization.startsWith(prefix)) return false;
  const supplied = Buffer.from(authorization.slice(prefix.length));
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) throw new Error("request body is empty");
  return JSON.parse(text);
}

function writeJson(response, status, body) {
  const encoded = Buffer.from(`${JSON.stringify(body)}\n`);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": String(encoded.length),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(encoded);
}

class BrowserControlServer {
  constructor({ logger, getBrowserHost, getPreferences, resolveNativeProxy }) {
    this.logger = logger;
    this.getBrowserHost = getBrowserHost;
    this.getPreferences = getPreferences;
    this.resolveNativeProxy = resolveNativeProxy;
    this.token = randomBytes(32).toString("base64url");
    this.automaticMutationReceipts = new Map();
    this.port = 0;
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error("browser.control_request_failed", { message });
        if (response.destroyed) return;
        if (response.headersSent) {
          response.destroy();
          return;
        }
        try {
          writeJson(response, 500, { error: "internal_error" });
        } catch {
          response.destroy();
        }
      });
    });
    this.server.on("error", (error) => {
      this.logger.error("browser.control_server_error", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
    this.server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
  }

  async start() {
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        const address = this.server.address();
        this.port = address && typeof address === "object" ? address.port : 0;
        if (!this.port) reject(new Error("Browser control server did not receive a port"));
        else resolve();
      });
    });
    this.logger.info("browser.control_started", { port: this.port });
    return this;
  }

  descriptor() {
    if (!this.port) throw new Error("Browser control server is not started");
    return { endpoint: `http://127.0.0.1:${this.port}`, token: this.token };
  }

  async reconcileAutomaticMutation(action, body, mutation) {
    const mutationId = body.mutationId ?? randomBytes(12).toString("base64url");
    const key = `${action}:${body.traceId}:${body.helperPid}:${mutationId}`;
    const fingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const existing = this.automaticMutationReceipts.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        const error = new Error(`Automatic browser ${action} payload changed for the same turn owner`);
        error.code = "turn_owner_conflict";
        throw error;
      }
      return existing.promise;
    }
    while (this.automaticMutationReceipts.size >= MAX_AUTOMATIC_MUTATION_RECEIPTS) {
      const oldest = [...this.automaticMutationReceipts].find(([, receipt]) => receipt.settled === true);
      if (!oldest) throw new Error("Automatic browser mutation receipt capacity is full");
      this.automaticMutationReceipts.delete(oldest[0]);
    }
    const receipt = { fingerprint, settled: false, promise: null };
    receipt.promise = Promise.resolve().then(mutation).then(result => {
      receipt.settled = true;
      return result;
    }, error => {
      if (this.automaticMutationReceipts.get(key) === receipt) {
        this.automaticMutationReceipts.delete(key);
      }
      throw error;
    });
    this.automaticMutationReceipts.set(key, receipt);
    return receipt.promise;
  }

  async handle(request, response) {
    if (!secureTokenMatches(this.token, request.headers.authorization)) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }
    const isNativeProxy = request.url === "/v1/network/resolve-proxy";
    const isNativeUsage = request.url === "/v1/usage/native";
    const isTurn = request.url === "/v1/turn/start"
      || request.url === "/v1/turn/start-cancel"
      || request.url === "/v1/turn/start-ack"
      || request.url === "/v1/turn/progress"
      || request.url === "/v1/turn/usage"
      || request.url === "/v1/turn/heartbeat"
      || request.url === "/v1/turn/end";
    const isTurnRelease = request.url === "/v1/turn/release";
    const artifactAction = new Map([
      ["/v1/turn/artifact-register", "register"],
      ["/v1/turn/artifact-wait", "wait"],
      ["/v1/turn/artifact-cancel", "cancel"],
    ]).get(request.url);
    const isSessionInspect = request.url === "/v1/session/inspect";
    const manualAction = new Map([
      ["/v1/manual/start", "start"],
      ["/v1/manual/wait-sent", "wait-sent"],
      ["/v1/manual/wait-terminal", "wait-terminal"],
      ["/v1/manual/started", "started"],
      ["/v1/manual/end", "end"],
      ["/v1/manual/cancel", "cancel"],
    ]).get(request.url);
    if (request.method !== "POST" || (!isNativeProxy && !isNativeUsage && !isTurn && !isTurnRelease && !isSessionInspect && !manualAction && !artifactAction)) {
      writeJson(response, 404, { error: "not_found" });
      return;
    }
    try {
      const body = await readJson(
        request,
        manualAction === "start" ? MAX_MANUAL_START_BODY_BYTES : MAX_BODY_BYTES,
      );
      if (isNativeProxy) {
        if (!body || typeof body.url !== "string" || body.url.length > 16_384
          || typeof this.resolveNativeProxy !== "function") {
          writeJson(response, 400, { error: "invalid_native_proxy_request" });
          return;
        }
        const proxy = await this.resolveNativeProxy(body.url);
        if (!response.destroyed) writeJson(response, 200, { proxy });
        return;
      }
      const preferences = this.getPreferences();
      const host = this.getBrowserHost();
      if (!host) throw new Error("browser host is not ready");
      if (isNativeUsage) {
        validateNativeUsageSample(body);
        const result = host.recordNativeUsage(body);
        writeJson(response, result.unavailable ? 503 : 200, { ok: !result.unavailable, recorded: result.recorded === true, duplicate: result.duplicate === true });
        return;
      }
      if (isSessionInspect) {
        if (host.browserInteractionMode() === "manual") {
          const error = new Error(
            "ChatGPT session and capability inspection is disabled in Manual mode",
          );
          error.code = "manual_browser_inspection_disabled";
          throw error;
        }
        const result = await host.inspectSession(body?.detectCapabilities === true, body?.accountId);
        writeJson(response, 200, result);
        return;
      }
      if (isTurnRelease) {
        if (typeof body?.conversationKey !== "string" || !/^[a-f0-9]{64}$/.test(body.conversationKey)) {
          throw new Error("conversationKey is invalid");
        }
        const released = host.releaseRetainedConversation(body.conversationKey);
        this.logger.info("browser.retained_conversation_released", { released });
        writeJson(response, 200, { ok: true, released });
        return;
      }
      if (!body || typeof body !== "object" || !/^[A-Za-z0-9_-]{6,128}$/.test(body.traceId || "")) {
        throw new Error("traceId is invalid");
      }
      if (!Number.isInteger(body.helperPid) || body.helperPid < 1) {
        throw new Error("browser helper pid is invalid");
      }
      if (body.taskProgressVersion !== undefined && (body.taskProgressVersion !== 1 || request.url !== '/v1/turn/start')) {
        throw new Error('Invalid task progress version');
      }
      if (body.conversationKey !== undefined && !/^[a-f0-9]{64}$/.test(body.conversationKey)) {
        throw new Error("conversationKey is invalid");
      }
      if (body.connectorIdentity !== undefined
        && (typeof body.connectorIdentity !== "string"
          || !body.connectorIdentity.trim()
          || body.connectorIdentity.length > 80)) {
        throw new Error("connectorIdentity is invalid");
      }
      if (body.requireRetainedConversation !== undefined
        && typeof body.requireRetainedConversation !== "boolean") {
        throw new Error("requireRetainedConversation is invalid");
      }
      if (body.requireRetainedConversation === true && body.conversationKey === undefined) {
        throw new Error("requireRetainedConversation requires conversationKey");
      }
      if (body.connectorIdentity !== undefined && body.conversationKey === undefined) {
        throw new Error("connectorIdentity requires conversationKey");
      }
      if (body.retain !== undefined && typeof body.retain !== "boolean") {
        throw new Error("retain is invalid");
      }
      if (body.connectorBound !== undefined && typeof body.connectorBound !== "boolean") {
        throw new Error("connectorBound is invalid");
      }
      if (body.refreshViewport !== undefined && typeof body.refreshViewport !== "boolean") {
        throw new Error("refreshViewport is invalid");
      }
      if (body.refreshViewport !== undefined && request.url !== "/v1/turn/heartbeat") {
        throw new Error("refreshViewport is only valid for a turn heartbeat");
      }
      if (body.surfaceId !== undefined
        && (!["/v1/turn/heartbeat", "/v1/turn/progress", "/v1/turn/start-ack",
          "/v1/turn/artifact-register", "/v1/turn/artifact-wait", "/v1/turn/artifact-cancel"].includes(request.url)
          || typeof body.surfaceId !== "string"
          || !/^[A-Za-z0-9_-]{32}$/.test(body.surfaceId))) {
        throw new Error("surfaceId must identify a supported exact turn operation and owned surface");
      }
      if (artifactAction) {
        if (typeof body.surfaceId !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(body.surfaceId)) {
          throw new Error("Artifact surface identity is invalid");
        }
        if (artifactAction === "register") {
          if (typeof body.assistantTurnId !== "string" || body.assistantTurnId.length < 1 || body.assistantTurnId.length > 256
            || typeof body.expectedFilename !== "string" || body.expectedFilename.length < 1 || body.expectedFilename.length > 160
            || !Number.isFinite(body.maxBytes) || body.maxBytes <= 0 || body.maxBytes > 50_000_000
            || !Number.isFinite(body.deadlineMs) || body.deadlineMs <= 0 || body.deadlineMs > 60_000) {
            throw new Error("Artifact registration payload is invalid");
          }
          const lease = await this.reconcileAutomaticMutation("artifact-register", body, () => (
            host.registerArtifactDownload(
              body.traceId, body.helperPid, body.surfaceId, body.assistantTurnId,
              body.expectedFilename, body.maxBytes, body.deadlineMs,
            )
          ));
          writeJson(response, 200, { ok: true, ...lease });
          return;
        }
        if (typeof body.leaseId !== "string" || !/^artifact_[a-f0-9]{32}$/.test(body.leaseId)) {
          throw new Error("Artifact lease identity is invalid");
        }
        if (artifactAction === "wait") {
          const receipt = await host.waitArtifactDownload(body.traceId, body.helperPid, body.surfaceId, body.leaseId);
          writeJson(response, 200, { ok: true, ...receipt });
          return;
        }
        if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 500)) {
          throw new Error("Artifact cancellation reason is invalid");
        }
        const result = host.cancelArtifactDownload(
          body.traceId, body.helperPid, body.surfaceId, body.leaseId, body.reason,
        );
        writeJson(response, 200, { ok: true, ...result });
        return;
      }
      if (manualAction) {
        if (manualAction === "start") {
          if (host.browserInteractionMode() !== "manual") {
            throw new Error("Manual mode is not enabled");
          }
          if (typeof body.prompt !== "string" || body.prompt.length < 1) {
            throw new Error("manual prompt is invalid");
          }
          if (body.resumePrompt !== undefined
            && (typeof body.resumePrompt !== "string" || body.resumePrompt.length < 1)) {
            throw new Error("manual resume prompt is invalid");
          }
          if (body.compaction !== undefined && body.compaction !== true) {
            throw new Error("manual compaction flag is invalid");
          }
          const lease = host.beginManualTurn(
            body.traceId,
            body.helperPid,
            body.prompt,
            body.conversationKey,
            body.resumePrompt,
            body.compaction === true,
          );
          this.logger.info("browser.manual_control_started", {
            traceId: body.traceId,
            reused: lease.reused,
          });
          writeJson(response, 200, { ok: true, ...lease });
          return;
        }
        if (manualAction === "wait-sent") {
          const observed = await host.waitManualSent(
            body.traceId,
            body.helperPid,
            MANUAL_SENT_OBSERVER_TIMEOUT_MS,
          );
          if (observed.status === "pending") {
            writeJson(response, 202, { ok: true, status: "pending" });
            return;
          }
          if (observed.status === "timeout") {
            writeJson(response, 408, { error: "Manual prompt was not confirmed within its allowed time", code: "manual_turn_timed_out" });
            return;
          }
          if (observed.status === "cancelled") {
            writeJson(response, 409, { error: "Manual mode turn was cancelled", code: "turn_cancelled" });
            return;
          }
          if (observed.status !== "sent") {
            writeJson(response, 409, { error: "Manual mode turn failed before Sent confirmation", code: "manual_turn_failed" });
            return;
          }
          writeJson(response, 200, { ok: true, status: "sent", sentAt: observed.sentAt });
          return;
        }
        if (manualAction === "wait-terminal") {
          const observed = await host.waitManualTerminal(
            body.traceId,
            body.helperPid,
            MANUAL_SENT_OBSERVER_TIMEOUT_MS,
          );
          if (observed.status === "pending") {
            writeJson(response, 202, { ok: true, status: "pending" });
            return;
          }
          if (observed.status === "timeout") {
            writeJson(response, 408, {
              error: "Codex Zero Risk4 did not start within its allowed time after Sent confirmation",
              code: "manual_turn_timed_out",
            });
            return;
          }
          if (!['cancelled', 'failed'].includes(observed.status)) {
            throw new Error("manual terminal state is invalid");
          }
          writeJson(response, 200, { ok: true, status: observed.status });
          return;
        }
        if (manualAction === "started") {
          host.markManualTurnStarted(body.traceId, body.helperPid);
          writeJson(response, 200, { ok: true });
          return;
        }
        if (manualAction === "cancel") {
          const result = host.cancelManualTurn(body.traceId, body.helperPid);
          writeJson(response, 200, { ok: true, ...result });
          return;
        }
        if (!['completed', 'failed', 'aborted'].includes(body.status)) {
          throw new Error("manual turn status is invalid");
        }
        const release = host.endManualTurn(
          body.traceId,
          body.helperPid,
          body.status,
          body.retain === true,
        );
        writeJson(response, 200, { ok: true, ...release });
        return;
      }
      if (request.url !== "/v1/turn/usage" && body.mutationId !== undefined
        && (typeof body.mutationId !== "string"
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.mutationId))) {
        throw new Error("automatic turn mutationId is invalid");
      }
      if (body.accountRoutingKey !== undefined && !/^[a-f0-9]{64}$/.test(body.accountRoutingKey)) throw new Error("Invalid account routing key");
      if (body.requestedModel !== undefined && !isTaskModel(body.requestedModel)) throw new Error("Invalid requested model");
      if (body.requestedEffort !== undefined && !["luna", "low", "medium", "high", "xhigh", "max"].includes(body.requestedEffort)) throw new Error("Invalid requested effort");
      if (request.url === "/v1/turn/usage") {
        if (body.outcome !== undefined && body.outcome !== "completed") throw new Error("Invalid usage outcome");
        if (!['luna', 'low', 'medium', 'high', 'xhigh', 'max', 'unknown'].includes(body.effort)) {
          throw new Error("Invalid usage effort");
        }
        if (!['5.5', '5.6', '6', 'unknown'].includes(body.modelVersion)) {
          throw new Error("Invalid usage model version");
        }
        if (body.modelVersionSource !== undefined && !['observed', 'pinned', 'unknown'].includes(body.modelVersionSource)) {
          throw new Error("Invalid usage model version source");
        }
        if (body.messageKind !== undefined && !['task', 'context_stage', 'compaction', 'unknown'].includes(body.messageKind)) {
          throw new Error("Invalid usage message kind");
        }
        host.usageObservation(body.traceId, body.helperPid, body.receipt, body.effort, body.modelVersion, body.outcome,
          body.modelVersionSource ?? 'unknown', body.messageKind ?? 'unknown');
        writeJson(response, 200, { ok: true }); return;
      }
      if (request.url === "/v1/turn/start") {
        if (host.browserInteractionMode() === "manual") {
          throw new Error("Automatic browser interaction is disabled");
        }
        if (body.taskProgressVersion === 1) {
          const result = host.queueTurn(body, preferences.showBrowserDuringTurns === true);
          writeJson(response, result.queued ? 202 : 200, { ok: true, ...result }); return;
        }
        const result = await this.reconcileAutomaticMutation("start", body, async () => {
          const lease = await host.beginTurn(
            body.traceId,
            preferences.showBrowserDuringTurns === true,
            body.helperPid,
            body.conversationKey,
            body.connectorIdentity,
            body.requireRetainedConversation === true,
            { requestedModel: body.requestedModel, effort: body.requestedEffort, routingKey: body.accountRoutingKey, taskProgressVersion: body.taskProgressVersion },
          );
          this.logger.info("browser.turn_started", { traceId: body.traceId });
          return { ok: true, ...lease };
        });
        writeJson(response, 200, result);
        return;
      } else if (request.url === '/v1/turn/start-cancel') {
        const result = await host.cancelQueuedOwner(body.traceId, body.helperPid);
        writeJson(response, result.cancelling ? 202 : 200, { ok: true, ...result }); return;
      } else if (request.url === '/v1/turn/start-ack') {
        const result = host.acknowledgeQueuedOwner(body.traceId, body.helperPid, body.surfaceId);
        writeJson(response, 200, { ok: true, ...result }); return;
      } else if (request.url === '/v1/turn/progress') {
        const result = await this.reconcileAutomaticMutation('progress', body, () => {
          host.taskProgress(body.traceId, body.helperPid, body.surfaceId, body.taskPhase, body.sequence);
          return { ok: true };
        });
        writeJson(response, 200, result); return;
      } else if (request.url === "/v1/turn/heartbeat") {
        const result = await this.reconcileAutomaticMutation("heartbeat", body, () => {
          host.heartbeatTurn(body.traceId, body.helperPid, body.refreshViewport === true, body.surfaceId);
          this.logger.debug?.("browser.turn_heartbeat", { traceId: body.traceId });
          return { ok: true };
        });
        writeJson(response, 200, result);
        return;
      } else {
        if (!['completed', 'failed', 'aborted'].includes(body.status)) throw new Error("turn status is invalid");
        if (body.failureCode !== undefined && !['rate_limit_exceeded', 'account_safety_stop', 'context_length_exceeded',
          'model_unavailable', 'tool_timeout', 'browser_failure', 'other'].includes(body.failureCode)) {
          throw new Error("Invalid account failure code");
        }
        const result = await this.reconcileAutomaticMutation("end", body, async () => {
          const release = await host.endTurn(
            body.traceId,
            body.helperPid,
            body.status,
            preferences.showBrowserDuringTurns === true,
            body.message,
            body.retain === true,
            body.connectorBound === true,
            body.failureCode,
          );
          this.logger.info("browser.turn_ended", { traceId: body.traceId, status: body.status });
          return { ok: true, ...release };
        });
        writeJson(response, 200, result);
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn("browser.control_rejected", { message });
      const cancelled = error?.code === "turn_cancelled";
      const retainedUnavailable = error?.code === "retained_conversation_unavailable";
      const manualInspectionDisabled = error?.code === "manual_browser_inspection_disabled";
      const manualOwnerLost = error?.code === "manual_turn_owner_lost";
      const manualTimedOut = error?.code === "manual_turn_timed_out";
      writeJson(
        response,
        cancelled || retainedUnavailable || manualInspectionDisabled || manualOwnerLost
          ? 409
          : manualTimedOut ? 408 : 400,
        {
        error: message,
        ...(error?.code === "account_cooldown" ? { code: "account_cooldown", retryAt: error.retryAt } : {}),
        ...(cancelled ? { code: "turn_cancelled" } : {}),
        ...(retainedUnavailable ? { code: "retained_conversation_unavailable" } : {}),
        ...(manualInspectionDisabled ? { code: "manual_browser_inspection_disabled" } : {}),
        ...(manualOwnerLost ? { code: "manual_turn_owner_lost" } : {}),
        ...(manualTimedOut ? { code: "manual_turn_timed_out" } : {}),
        },
      );
    }
  }

  async close() {
    if (!this.server.listening) return;
    await new Promise((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }
}

module.exports = { BrowserControlServer, MAX_MANUAL_START_BODY_BYTES, MANUAL_SENT_OBSERVER_TIMEOUT_MS };
