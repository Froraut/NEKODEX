import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { AccountBrowserPool } = require("../launcher/electron/account-pool.cjs");
const { AccountToolProof } = require("../launcher/electron/account-tool-proof.cjs");
const connector = "Codex Native6";
const principal = "a".repeat(64);
const alternate = "00000000-0000-4000-8000-000000000001";

function admission(mode = "selected") {
  const config = { mode, selectedId: "default", accounts: ["default", alternate].map(id => ({ id, enabled: true })) };
  const hosts = new Map(config.accounts.map(({ id }) => [id, { state: { authenticated: true }, turnTabs: new Map() }]));
  const pool: any = Object.assign(Object.create(AccountBrowserPool.prototype), {
    registry: { snapshot: () => config }, hosts, getHost: (id: string) => hosts.get(id),
    connectors: new Map([[alternate, connector]]),
    capabilities: new Map(config.accounts.map(({ id }) => [id, { solAvailable: true }])),
    traceOwners: new Map(), affinity: new Map(), pendingAffinity: new Map(), reservations: new Map(),
    lastAssigned: new Map(), accountOperationLabel: () => null,
    accountTunnel: () => ({ required: true, ready: true }),
    safety: { availability: () => ({ eligible: true }) },
  });
  const select = () => pool.chooseAccount("fixture-trace", null, false, { connector, effort: "low" });
  return { pool, hosts, select };
}

test("selected account may prove an unverified connector during the real turn while other requirements remain", () => {
  const { pool, hosts, select } = admission();
  expect(select()).toBe("default");
  hosts.get("default")!.state.authenticated = false;
  expect(select).toThrow("No enabled ChatGPT account");
  hosts.get("default")!.state.authenticated = true;
  pool.accountTunnel = () => ({ required: true, ready: false });
  expect(select).toThrow("No enabled ChatGPT account");
  pool.accountTunnel = () => ({ required: true, ready: true });
  pool.capabilities.set("default", { solAvailable: false });
  expect(select).toThrow("No enabled ChatGPT account");
});

test("balanced routing still chooses a connector-verified account", () => {
  const { pool, select } = admission("balanced");
  expect(select()).toBe(alternate);
  pool.connectors.clear();
  expect(select).toThrow("No enabled ChatGPT account");
});

test("only a successful actual tool result promotes the current turn identity's connector proof", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nekodex-selected-proof-"));
  try {
    const toolProof = new AccountToolProof(directory);
    const tab = { id: "tab", traceId: "fixture-trace", helperPid: 1, connectorIdentity: connector,
      authPrincipalFingerprint: principal, authIdentityEpoch: 7 };
    const owner: any = { accountId: "default", authPrincipalFingerprint: principal, authIdentityEpoch: 7,
      connectorName: () => connector, turnTabs: new Map([["tab", tab]]), endTurn: async () => ({}) };
    const pool: any = Object.assign(Object.create(AccountBrowserPool.prototype), {
      ownerForTrace: () => owner, traceOwners: new Map(), unsentAdmissions: new Map(),
      admissionQueue: { retire() {} }, recordUsage() {}, toolProof, connectors: new Map(),
      safety: { fail() {} }, logger: { warn() {} }, publish() {},
    });
    const end = (status = "completed", proof: unknown = { tool: "codex_exec" }) =>
      pool.endTurn(tab.traceId, 1, status, false, undefined, false, true, undefined, proof);
    await end("completed", null);
    expect(pool.connectors.size).toBe(0);
    await end("failed");
    expect(pool.connectors.size).toBe(0);
    owner.authIdentityEpoch++;
    await end();
    expect(pool.connectors.size).toBe(0);
    expect(toolProof.snapshot("default", principal)).toBeNull();
    owner.authIdentityEpoch = 7;
    await end();
    expect(pool.connectors.get("default")).toBe(connector);
    expect(toolProof.snapshot("default", principal)?.tool).toBe("codex_exec");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
