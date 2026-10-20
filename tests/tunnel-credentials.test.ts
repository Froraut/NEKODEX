import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { createCredentialProvider, CredentialProviderError, isCredentialReference, isCredentialScope } = require("../launcher/electron/tunnel-credentials.cjs");

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "nekodex-credential-provider-"));
  const records = new Map<string, any>();
  const mutations: string[] = [];
  const backend = { request(request: any) {
    const key = (ref: any) => `${ref.id}:${ref.revision}`;
    if (request.operation === "capabilities") return { version: 1, status: "ok" };
    if (request.operation === "prepare") {
      const id = key(request.record.reference);
      if (records.has(id)) return { version: 1, status: "conflict" };
      records.set(id, structuredClone(request.record)); mutations.push(`prepare:${id}`);
      return { version: 1, status: "ok" };
    }
    const stored = records.get(key(request.reference));
    if (!stored) return { version: 1, status: "not-found" };
    if (request.operation === "resolve") {
      if (request.scopeHash !== stored.scopeHash) return { version: 1, status: "scope-mismatch" };
      return { version: 1, status: "ok", record: structuredClone(stored) };
    }
    if (request.operation === "remove") {
      if (request.scopeHash !== stored.scopeHash) return { version: 1, status: "scope-mismatch" };
      if (request.owner !== stored.owner) return { version: 1, status: "owner-mismatch" };
      records.delete(key(request.reference)); mutations.push(`remove:${key(request.reference)}`);
      return { version: 1, status: "ok", removed: true };
    }
    return { version: 1, status: "unsupported" };
  } };
  return { home, records, mutations, backend, provider: createCredentialProvider({ coreHome: home, backend }),
    cleanup() { rmSync(home, { recursive: true, force: true }); } };
}
const scope = { accountId: "legacy", interactionMode: "automatic", tunnelId: `tunnel_${"a".repeat(32)}` };
const secret = "SYNTHETIC_ONLY_PROTECTED_KEY";
function expectCode(action: () => unknown, code: string) {
  try { action(); throw new Error("expected provider error"); }
  catch (error) { expect(error).toBeInstanceOf(CredentialProviderError); expect((error as any).code).toBe(code); expect(String(error)).not.toContain(secret); }
}

test("immutable protected prepare/readback and exact scope isolation write no local plaintext", () => {
  const f = fixture();
  try {
    const receipt = f.provider.prepare(scope, secret);
    expect(isCredentialReference(receipt.reference)).toBe(true);
    expect(isCredentialScope(receipt.scope)).toBe(true);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.reference)).toBe(true);
    expect(f.provider.resolve(receipt.reference, scope)).toBe(secret);
    expect(JSON.stringify(receipt)).not.toContain(secret);
    expect(readdirSync(f.home)).toEqual([]);
    for (const changed of [{ ...scope, accountId: "default" }, { ...scope, interactionMode: "manual" }, { ...scope, tunnelId: `tunnel_${"b".repeat(32)}` }]) {
      expectCode(() => f.provider.resolve(receipt.reference, changed), "scope-mismatch");
    }
    const dev = createCredentialProvider({ coreHome: join(f.home, "dev"), backend: f.backend });
    expectCode(() => dev.resolve(receipt.reference, scope), "scope-mismatch");
    expectCode(() => dev.discardPrepared(receipt, []), "scope-mismatch");
    expect(f.records.size).toBe(1);
    const second = f.provider.prepare(scope, secret);
    expect(second.reference).not.toEqual(receipt.reference);
    expect(second.owner).not.toBe(receipt.owner);
  } finally { f.cleanup(); }
});

test("cleanup preserves referenced and differently owned records, then removes only exact unreferenced revision", () => {
  const f = fixture();
  try {
    const receipt = f.provider.prepare(scope, secret);
    const other = f.provider.prepare({ ...scope, accountId: "default" }, "OTHER_SYNTHETIC_KEY");
    expect(f.provider.discardPrepared(receipt, [receipt.reference])).toBe(false);
    expectCode(() => f.provider.discardPrepared({ ...receipt, owner: other.owner }, []), "owner-mismatch");
    expectCode(() => f.provider.discardPrepared(receipt), "invalid-input");
    expectCode(() => f.provider.retire(receipt.reference, scope, { currentReferences: [] }), "owner-proof-required");
    expect(f.provider.retire(receipt.reference, scope, { ownerProof: true, currentReferences: [receipt.reference] })).toBe(false);
    expect(f.provider.discardPrepared(receipt, [other.reference])).toBe(true);
    expect(f.provider.discardPrepared(receipt, [])).toBe(false);
    expect(f.provider.resolve(other.reference, other.scope)).toBe("OTHER_SYNTHETIC_KEY");
    expect(f.provider.retire(other.reference, other.scope, { ownerProof: true, currentReferences: [] })).toBe(true);
    expect(f.records.size).toBe(0);
    expect(f.mutations.filter(item => item.startsWith("remove:")).length).toBe(2);
  } finally { f.cleanup(); }
});

test("locked/unavailable/unsupported/corrupt ports preserve records and return fixed nonsecret failures", () => {
  const f = fixture();
  try {
    const receipt = f.provider.prepare(scope, secret);
    for (const code of ["locked", "unavailable", "not-found", "unsupported", "corrupt"]) {
      const unavailable = createCredentialProvider({ coreHome: f.home, backend: { request: () => ({ version: 1, status: code, message: secret }) } });
      expectCode(() => unavailable.resolve(receipt.reference, scope), code);
      expect(unavailable.capabilities()).toMatchObject({ available: false, status: code, plaintextFallback: false });
      expect(JSON.stringify(unavailable.capabilities())).not.toContain(secret);
    }
    const throwing = createCredentialProvider({ coreHome: f.home, backend: { request() { throw new Error(secret); } } });
    expectCode(() => throwing.resolve(receipt.reference, scope), "unavailable");
    expect(f.records.size).toBe(1);
    for (const platform of ["win32", "linux"]) {
      const unsupported = createCredentialProvider({ coreHome: f.home, platform });
      expect(unsupported.capabilities()).toMatchObject({ supported: false, available: false, status: "unsupported", plaintextFallback: false });
      expectCode(() => unsupported.prepare(scope, secret), "unsupported");
    }
  } finally { f.cleanup(); }
});

test("unknown-outcome prepare preserves exact secret-free receipt without retry or automatic cleanup", () => {
  const f = fixture();
  try {
    const backend = { request(request: any) {
      if (request.operation === "prepare") { f.backend.request(request); throw new Error(`lost response ${secret}`); }
      return f.backend.request(request);
    } };
    const provider = createCredentialProvider({ coreHome: f.home, backend });
    let receipt: any;
    try { provider.prepare(scope, secret); } catch (error) {
      expect((error as any).code).toBe("unavailable"); receipt = (error as any).preparedReceipt;
      expect(JSON.stringify(error)).not.toContain(secret);
    }
    expect(isCredentialReference(receipt.reference)).toBe(true);
    expect(f.mutations.length).toBe(1);
    expect(f.records.size).toBe(1);
    expect(provider.resolve(receipt.reference, scope)).toBe(secret);
    expect(provider.discardPrepared(receipt, [])).toBe(true);
  } finally { f.cleanup(); }
});

test("canonical home aliases resolve to the same scope while invalid references fail before vault access", () => {
  const f = fixture();
  const alias = `${f.home}-alias`;
  try {
    symlinkSync(f.home, alias);
    const same = createCredentialProvider({ coreHome: alias, backend: f.backend });
    const receipt = f.provider.prepare(scope, secret);
    expect(same.resolve(receipt.reference, scope)).toBe(secret);
    expectCode(() => same.resolve({ ...receipt.reference, extra: secret }, scope), "invalid-input");
    expectCode(() => same.prepare({ ...scope, accountId: "someone@example.com" }, secret), "invalid-input");
    expectCode(() => same.prepare(scope, `${secret}\n`), "invalid-input");
    expect(f.records.size).toBe(1);
  } finally { rmSync(alias, { force: true }); f.cleanup(); }
});
