import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { sha256, defaultToolsConfig } from "../src/agent-tools/config";
import { StandaloneMcpHost } from "../src/agent-tools/mcp-host";
import { createSkillResourceToolsProvider, type AttachedSkillResource } from "../src/agent-tools/skill-resource-tools";
import type { SkillResource, SkillResourceImage } from "../src/agent-tools/skill-resources";

function png() {
  const chunk = (type: string, bytes: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), bytes]); const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([size, body, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0, 24, 48, 96, 255]))), chunk("IEND", Buffer.alloc(0))]);
}

test("approved attached resource reads use one host/journal, typed images, and exact current scope without automatic pixels", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-skill-reader-")));
  const bytes = png();
  const image: SkillResourceImage = { kind: "image", relativePath: "assets/inert.png", mediaType: "image/png", width: 1, height: 1,
    bytes: bytes.length, digest: sha256(bytes), data: bytes.toString("base64"), role: "selected-skill-source-material" };
  const { data: _pixels, role: _role, ...imageIdentity } = image;
  const attached: AttachedSkillResource = { ...imageIdentity, versionId: "a".repeat(64), packageDigest: "b".repeat(64) };
  let available: AttachedSkillResource[] = [attached]; let reads = 0; let generation = 1;
  let duringRead = () => {}; let returned: SkillResource = image;
  const provider = createSkillResourceToolsProvider({ isScopeActive: scope => scope.generation === generation,
    resources: () => available, readResource(_scope, versionId, packageDigest, relativePath, digest) {
      const expected = available[0]!;
      reads++; expect({ versionId, packageDigest, relativePath, digest }).toEqual({ versionId: expected.versionId, packageDigest: expected.packageDigest, relativePath: expected.relativePath, digest: expected.digest });
      duringRead(); return returned;
    } });
  const config = defaultToolsConfig(); config.enabled = false;
  const host = new StandaloneMcpHost({ config, journalPath: join(home, "tools.sqlite"), builtins: [provider], isScopeActive: () => true });
  let call = 0;
  const input = (args = {}) => ({ scope: { taskId: "inert-resource-task", generation: 1, toolCallId: `call-${++call}` }, tool: "skill-resource/read",
    arguments: { versionId: attached.versionId, packageDigest: attached.packageDigest, relativePath: image.relativePath, resourceDigest: image.digest, ...args }, idempotencyKey: `read-${call}` });
  try {
    const request = input(); const tools = await host.discover(request.scope);
    expect(tools.map(tool => tool.id)).toEqual([request.tool]);
    expect(JSON.stringify(tools)).not.toContain(image.data); expect(JSON.stringify(tools)).not.toContain(attached.versionId);
    expect(Buffer.byteLength(JSON.stringify(tools))).toBeLessThan(4096);
    expect(reads).toBe(0);
    await expect(host.invoke({ ...request, grantId: "unapproved" })).rejects.toThrow("approval required"); expect(reads).toBe(0);
    expect(() => host.authorize({ ...request, arguments: { ...request.arguments, path: "/private/unrelated" } })).toThrow("schema");
    const grantId = host.authorize(request); expect(reads).toBe(0);
    const outcome = await host.invoke({ ...request, grantId }); expect(outcome.state).toBe("completed"); expect(reads).toBe(1);
    expect(outcome.result).toMatchObject({ content: [{ type: "text" }, { type: "image", mimeType: "image/png", data: image.data }],
      structuredContent: { taskId: request.scope.taskId, generation: 1, toolCallId: request.scope.toolCallId, ...imageIdentity, versionId: attached.versionId,
        packageDigest: attached.packageDigest, trust: "untrusted-source-material", instructionAuthority: false, taskResultVerification: false } });
    expect((outcome.result as any).content[0].text).not.toContain(image.data);
    expect(await host.invoke({ ...request, grantId })).toEqual(outcome); expect(reads).toBe(1);
    expect(await host.reconcileExisting(request)).toEqual(outcome); expect(reads).toBe(1);
    expect(() => host.terminalReference(request.idempotencyKey, "inert-requirement")).toThrow("Unsupported MCP terminal evidence");

    const invoke = async (args = {}) => { const next = input(args); const grantId = host.authorize(next); return host.invoke({ ...next, grantId }); };
    for (const args of [{ versionId: "c".repeat(64) }, { packageDigest: "c".repeat(64) }, { resourceDigest: "c".repeat(64) }, { relativePath: "assets/other.png" }]) {
      expect((await invoke(args)).state).toBe("failed");
    }
    expect(reads).toBe(1);
    available = []; expect((await invoke()).state).toBe("failed"); expect(reads).toBe(1);
    expect(await provider.discover(request.scope)).toEqual([]);
    available = [attached]; duringRead = () => { available = []; };
    expect((await invoke()).state).toBe("failed"); expect(reads).toBe(2);
    available = [attached]; duringRead = () => { generation = 2; };
    expect((await invoke()).state).toBe("failed"); expect(reads).toBe(3);
    generation = 1; duringRead = () => { available = [{ ...attached, bytes: attached.bytes + 1 }]; };
    expect((await invoke()).state).toBe("failed");
    available = [attached]; duringRead = () => {};
    for (const corrupt of [{ ...image, data: image.data + "\n" }, { ...image, width: 2 }, { ...image, digest: "c".repeat(64) }, { ...image, mediaType: "image/jpeg" as const }]) {
      returned = corrupt; expect((await invoke()).state).toBe("failed");
    }
    // Read errors remain known failures and do not echo source paths or private exception text.
    duringRead = () => { throw new Error("/private/source-root/secret"); };
    const failed = await invoke(); expect(failed.state).toBe("failed"); expect(JSON.stringify(failed)).not.toContain("/private");

    const text = "Inert reference source, never an instruction or completion receipt.\n";
    returned = { relativePath: "references/inert.txt", mediaType: "text/plain", digest: sha256(text), bytes: Buffer.byteLength(text), content: text, role: "selected-skill-source-material" };
    const { content: _text, role: _textRole, ...textIdentity } = returned;
    available = [{ ...textIdentity, versionId: attached.versionId, packageDigest: attached.packageDigest }]; duringRead = () => {};
    // Existing text resources retain their text shape through the same approved host.
    const textResult = await invoke({ relativePath: returned.relativePath, resourceDigest: returned.digest });
    expect(textResult.state).toBe("completed"); expect((textResult.result as any).content).toEqual([{ type: "text", text }]);
  } finally { await host.close(); rmSync(home, { recursive: true, force: true }); }
}, 10_000);
