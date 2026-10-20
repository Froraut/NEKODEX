import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { createLocalWorkspaceService } = require("../launcher/electron/local-workspace.cjs");
const { registerWorkspaceIpc } = require("../launcher/electron/ipc/workspace.cjs");
const { registerLoggedIpc } = require("../launcher/electron/logging.cjs");

test("workspace IPC preserves host admission and picker provenance while retaining an editor draft separately from file save", async () => {
  const root = mkdtempSync(join(tmpdir(), "nekodex-workspace-ipc-"));
  try {
    writeFileSync(join(root, "file.txt"), "disk");
    let pickerCalls = 0;
    const service = createLocalWorkspaceService({ pickDirectory: async () => { pickerCalls++; return root; } });
    const channels = new Map<string, (event: unknown, ...args: unknown[]) => Promise<any>>();
    const ipcMain = { handle: (name: string, handler: (event: unknown, ...args: unknown[]) => Promise<any>) => channels.set(name, handler) };
    const trustedSender = {};
    registerWorkspaceIpc({ service, registerIpcHandler: (name: string, handler: (...args: unknown[]) => unknown) =>
      registerLoggedIpc(ipcMain, { error() {} }, name, handler, (event: any) => event.sender === trustedSender) });
    const invoke = (name: string, ...args: unknown[]) => channels.get(`launcher:workspace-${name}`)!({ sender: trustedSender }, ...args);
    await expect(channels.get("launcher:workspace-pick")!({ sender: {} })).rejects.toThrow("Unauthorized");
    await expect(invoke("pick", { path: root, provenance: "native-directory-picker" })).rejects.toThrow("no incoming path");
    expect(pickerCalls).toBe(0);
    expect(await invoke("roots")).toEqual([]);
    const selected = await invoke("pick");
    expect(pickerCalls).toBe(1);
    expect((await invoke("list", selected.id)).entries[0].name).toBe("file.txt");
    const preview = await invoke("preview", selected.id, "file.txt");
    await expect(invoke("preview", selected.id, "../file.txt")).rejects.toThrow("relative");
    await expect(invoke("save", selected.id, { path: "file.txt", text: "bad", expectedRevision: preview.revision,
      rootPath: root })).rejects.toThrow("Invalid workspace draft");
    await expect(invoke("retain-draft", selected.id, { path: "file.txt", text: "bad", expectedRevision: [preview.revision] }))
      .rejects.toThrow("Invalid workspace draft");
    const draft = await invoke("retain-draft", selected.id, { path: "file.txt", text: "recover me", expectedRevision: preview.revision });
    expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("disk");
    // Autosaved recovery text and the later explicit save share a single file draft.
    await invoke("retain-draft", selected.id, { path: "file.txt", text: "latest draft", expectedRevision: preview.revision });
    expect((await invoke("drafts", selected.id)).length).toBe(1);
    expect((await invoke("drafts", selected.id))[0].id).toBe(draft.id);
    const saved = await invoke("save", selected.id, { path: "file.txt", text: "published", expectedRevision: preview.revision, draftId: draft.id });
    expect(saved.state).toBe("saved");
    expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("published");
    expect(await invoke("drafts", selected.id)).toEqual([]);
    // Main-only capability is deliberately absent from renderer registration.
    expect(channels.has("launcher:workspace-resolve-grant")).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 10000);
