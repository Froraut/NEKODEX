import { expect, test } from "bun:test";
import { createRequire } from "node:module";

test("Electron companion enable and clipboard share exact Firefox identity authority", async () => {
  const { registerBrowserCompanion } = createRequire(import.meta.url)("../launcher/electron/ipc/browser-companion.cjs");
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const forwarded: unknown[] = [], copied: string[] = [];
  registerBrowserCompanion({ handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler),
    runtimeHost: { supervisor: { readConfig: () => ({}), ownedRuntimeReady: async () => true,
      control: async (_config: unknown, route: string, envelope: unknown) => { expect(route).toBe("browser-companion"); forwarded.push(envelope); return { ok: true, value: { enabled: true } }; } } },
    clipboard: { writeText: (text: string) => copied.push(text) } });
  const request = (body: object) => handlers.get("launcher:browser-companion")!(null, body);
  const copy = (pairing: object) => handlers.get("launcher:browser-companion-copy")!(null, JSON.stringify(pairing));
  const identity = { extensionId: "browser-companion@nekodex.local", extensionOrigin: "moz-extension://c7b114ab-2233-4455-8899-0123456789ab" };
  const pairing = { version: 1, origin: "http://127.0.0.1:17843", hostId: "fixture-host", pairingCode: "p".repeat(43), ...identity };
  const enabled = { action: "enable", ...identity };
  expect(await request(enabled)).toEqual({ enabled: true });
  expect(forwarded).toEqual([{ body: enabled }]);
  expect(await copy(pairing)).toEqual({ copied: true });
  expect(copied).toEqual([JSON.stringify(pairing)]);

  for (const invalid of [
    { extensionId: identity.extensionId },
    { ...identity, extensionOrigin: `${identity.extensionOrigin}/` },
    { ...identity, extensionId: "foreign@example.com" },
    { extensionId: "a".repeat(32), extensionOrigin: identity.extensionOrigin },
  ]) {
    await expect(request({ action: "enable", ...invalid })).rejects.toThrow("Invalid browser companion request");
    await expect(copy({ ...pairing, extensionOrigin: undefined, ...invalid })).rejects.toThrow("Invalid pairing text");
  }
  await expect(copy({ ...pairing, token: "unreviewed-extra-field" })).rejects.toThrow("Invalid pairing text");
  await expect(copy({ ...pairing, hostId: "" })).rejects.toThrow("Invalid pairing text");
  expect(forwarded).toHaveLength(1);
  expect(copied).toHaveLength(1);
});
