import { expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AccountBrowserPool } = require("../launcher/electron/account-pool.cjs");

test("the selected account becomes usable before a slower background account finishes", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const background = new Promise<void>(resolve => { release = resolve; });
  const accounts = [{ id: "default", enabled: true }, { id: "selected", enabled: true }];
  const hosts = new Map(accounts.map(({ id }) => [id, {
    state: { authenticated: true },
    async refreshAuthentication() { calls.push(`${id}:auth`); if (id === "default") await background; },
    async inspectSession() { calls.push(`${id}:models`); return {}; },
    async verifyConnector() { calls.push(`${id}:tools`); },
    connectorName: () => `connector-${id}`,
  }]));
  const pool: any = {
    registry: { snapshot: () => ({ accounts, selectedId: "selected" }) },
    connectors: new Map(), getHost: (id: string) => hosts.get(id),
    leases: () => ({ exclusiveLabel: () => null }),
    invalidateEvidence: () => 1, evidenceIsCurrent: () => true,
    recordCapabilityEvidence() {}, publish() {}, snapshot: () => ({}),
    options: { bootstrapAccountConnectors: () => true }, logger: { info() {}, warn() {} },
  };
  const checking = AccountBrowserPool.prototype.refreshAuthentication.call(pool);
  await new Promise(resolve => setImmediate(resolve));
  expect(calls).toEqual(["selected:auth", "selected:models", "selected:tools", "default:auth"]);
  expect(pool.connectors.get("selected")).toBe("connector-selected");
  expect(pool.evidenceRefreshing.has("selected")).toBe(false);
  release();
  await checking;
  expect(calls.slice(-2)).toEqual(["default:models", "default:tools"]);
  expect(pool.evidenceRefreshing.size).toBe(0);
});
