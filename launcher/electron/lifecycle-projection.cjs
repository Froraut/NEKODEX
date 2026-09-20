const { randomUUID } = require("node:crypto");

const RUNTIME_STATES = new Set([
  "unconfigured", "starting", "ready", "degraded", "recovering", "failed", "stopping", "stopped", "external", "needs-setup",
]);
const TUNNEL_STATES = new Set(["absent", "starting", "ready", "degraded", "recovering", "failed", "stopping"]);
const ROUTE_STATES = new Set(["unknown", "direct", "switching", "managed", "restoring", "failed"]);
const AVAILABILITY_STATES = new Set(["unknown", "ready", "degraded", "unavailable"]);

class LauncherLifecycleProjection {
  constructor(publish) {
    this.publish = publish;
    this.revision = 0;
    this.operation = null;
    this.value = {
      revision: 0,
      runtimeStatus: "unconfigured",
      nativeAvailability: "unknown",
      webAvailability: "unknown",
      tunnelStatus: "absent",
      routeStatus: "unknown",
      detail: null,
      releaseVersion: null,
      daemonPid: null,
      tunnelPid: null,
      catalog: { status: "unknown", request: null, at: null, failure: null },
    };
  }

  update(patch) {
    if (patch.runtimeStatus !== undefined && !RUNTIME_STATES.has(patch.runtimeStatus)) throw new Error("Invalid runtime lifecycle state");
    if (patch.tunnelStatus !== undefined && !TUNNEL_STATES.has(patch.tunnelStatus)) throw new Error("Invalid tunnel lifecycle state");
    if (patch.routeStatus !== undefined && !ROUTE_STATES.has(patch.routeStatus)) throw new Error("Invalid route lifecycle state");
    for (const key of ["nativeAvailability", "webAvailability"]) {
      if (patch[key] !== undefined && !AVAILABILITY_STATES.has(patch[key])) throw new Error(`Invalid ${key}`);
    }
    this.revision += 1;
    this.value = { ...this.value, ...patch, revision: this.revision };
    this.publish?.(this.snapshot());
    return this.snapshot();
  }

  recordOperation(operation) {
    const terminal = operation.status === "completed" || operation.status === "failed";
    const same = this.operation && this.operation.name === operation.name && !this.operation.terminal;
    const operationId = operation.operationId || (same ? this.operation.operationId : randomUUID());
    this.revision += 1;
    const projected = { ...operation, operationId, revision: this.revision };
    this.operation = { name: operation.name, operationId, terminal };
    this.value = { ...this.value, revision: this.revision, operation: projected };
    this.publish?.(this.snapshot());
    return projected;
  }

  snapshot() {
    return structuredClone(this.value);
  }
}

module.exports = { LauncherLifecycleProjection };
