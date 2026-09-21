import { describe, expect, test } from "bun:test";
import { deriveWorkspaceReadiness, type WorkspaceReadinessInput } from "../src/workspace-readiness";

const ready = (overrides: Partial<WorkspaceReadinessInput> = {}): WorkspaceReadinessInput => ({
  manual: false,
  development: false,
  authenticationStatus: "verified",
  smokePassed: true,
  installed: true,
  catalogVerified: true,
  pickerConfirmed: true,
  toolsInstalled: true,
  toolsVerified: true,
  runtime: {
    runtimeStatus: "ready",
    nativeAvailability: "ready",
    webAvailability: "ready",
    brokerReady: true,
    tunnelStatus: "ready",
    tunnelRepair: { eligible: false, active: false },
  },
  ...overrides,
});

describe("workspace readiness", () => {
  test("keeps unknown and unavailable authentication distinct from signed out", () => {
    expect(deriveWorkspaceReadiness(ready({ authenticationStatus: "unknown" }))).toMatchObject({
      action: "wait", reason: "session-checking", web: "checking",
    });
    expect(deriveWorkspaceReadiness(ready({ authenticationStatus: "unavailable" }))).toMatchObject({
      action: "retry-session", reason: "session-unavailable", web: "unknown",
    });
    expect(deriveWorkspaceReadiness(ready({ authenticationStatus: "signed-out" }))).toMatchObject({
      action: "open-accounts", reason: "session-signed-out", web: "unavailable",
    });
  });

  test("offers repair only from authoritative eligibility while preserving healthy native", () => {
    const degradedRuntime = {
      runtimeStatus: "degraded",
      nativeAvailability: "ready" as const,
      webAvailability: "degraded" as const,
      brokerReady: true,
      tunnelStatus: "degraded",
      tunnelRepair: { eligible: true, active: false },
    };
    expect(deriveWorkspaceReadiness(ready({ runtime: degradedRuntime }))).toEqual({
      action: "repair-web",
      reason: "web-repair-available",
      native: "ready",
      web: "degraded",
      tools: "degraded",
    });
    expect(deriveWorkspaceReadiness(ready({ runtime: {
      ...degradedRuntime, tunnelRepair: { eligible: false, active: false },
    } }))).toMatchObject({ action: "open-tools", reason: "web-degraded", native: "ready", web: "degraded" });
  });

  test("live Web state overrides old proofs while legacy snapshots retain fallback", () => {
    expect([
      deriveWorkspaceReadiness(ready({ runtime: {
        ...(ready().runtime ?? {}), webAvailability: "unavailable", tunnelRepair: { eligible: false, active: false },
      } })),
      deriveWorkspaceReadiness(ready({ runtime: {
        ...(ready().runtime ?? {}), webAvailability: "unknown", tunnelRepair: { eligible: false, active: false },
      } })),
      deriveWorkspaceReadiness(ready({ runtime: null })),
    ]).toEqual([
      expect.objectContaining({ action: "open-tools", reason: "web-unavailable", tools: "unavailable" }),
      expect.objectContaining({ action: "wait", reason: "web-checking", tools: "checking" }),
      expect.objectContaining({ action: "open-browser", reason: "workspace-ready" }),
    ]);
  });

  test("old connector proof cannot make Tools ready without current broker-backed Web readiness", () => {
    expect(deriveWorkspaceReadiness(ready({ runtime: {
      ...(ready().runtime ?? {}), brokerReady: false, webAvailability: "ready", tunnelStatus: "ready",
    } }))).toMatchObject({ tools: "degraded" });
  });

  test("keeps tools optional in Automatic but required in Manual mode", () => {
    const missingTools = { toolsInstalled: false, toolsVerified: false };
    expect(deriveWorkspaceReadiness(ready(missingTools))).toMatchObject({
      action: "open-browser", reason: "workspace-ready", tools: "unavailable",
    });
    expect(deriveWorkspaceReadiness(ready({ ...missingTools, manual: true, authenticationStatus: "unknown" }))).toMatchObject({
      action: "open-tools", reason: "tools-not-installed",
    });
  });

  test("routes setup prerequisites before live runtime availability", () => {
    expect(deriveWorkspaceReadiness(ready({ installed: false, smokePassed: false }))).toMatchObject({
      action: "open-setup", reason: "browser-check-required", native: "unavailable",
    });
    expect(deriveWorkspaceReadiness(ready({ catalogVerified: false }))).toMatchObject({
      action: "open-setup", reason: "catalog-waiting",
    });
    expect(deriveWorkspaceReadiness(ready({ pickerConfirmed: false }))).toMatchObject({
      action: "open-setup", reason: "picker-confirmation-required",
    });
  });

  test("fresh catalog failure and active transitions override old verified evidence", () => {
    expect([
      deriveWorkspaceReadiness(ready({ catalogUnavailable: true })),
      deriveWorkspaceReadiness(ready({ runtime: { ...ready().runtime, transitionActive: true } })),
    ]).toEqual([
      expect.objectContaining({ action: "open-setup", reason: "catalog-unavailable" }),
      expect.objectContaining({ action: "wait", reason: "runtime-checking", native: "ready" }),
    ]);
  });
});
