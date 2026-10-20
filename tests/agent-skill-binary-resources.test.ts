import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { ManagedSkillStore } from "../src/agent-tools/managed-skills";
import { ReadOnlySkillLibrary } from "../src/agent-tools/skills";
import { classifySkillResourcePath, snapshotSkillPackageSource, type SkillResourceImage } from "../src/agent-tools/skill-resources";
import { sha256 } from "../src/agent-tools/config";

function png(seed = 1): Buffer {
  const chunk = (name: string, data: Buffer) => {
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(name), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(128); header.writeUInt32BE(128, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(128 * (128 * 4 + 1)); let state = seed;
  for (let y = 0; y < 128; y++) for (let x = 1; x <= 512; x++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5; pixels[y * 513 + x] = state & 255;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
// A complete baseline grayscale JPEG: 2048x2048 alternating 8-pixel blocks,
// quantization=1, one DC category-8 Huffman symbol and one AC EOB symbol.
function jpeg(): Buffer {
  const segment = (marker: number, body: Buffer) => { const head = Buffer.from([255, marker, 0, 0]); head.writeUInt16BE(body.length + 2, 2); return Buffer.concat([head, body]); };
  const table = (kind: number, symbol: number) => Buffer.from([kind, 1, ...Array(15).fill(0), symbol]);
  const entropy: number[] = []; let value = 0, bits = 0;
  const bit = (next: number) => { value = value << 1 | next; if (++bits === 8) { entropy.push(value); if (value === 255) entropy.push(0); bits = value = 0; } };
  for (let block = 0; block < 256 * 256; block++) { bit(0); const amplitude = block % 2 ? 127 : 128; for (let n = 7; n >= 0; n--) bit(amplitude >> n & 1); bit(0); }
  while (bits) bit(1);
  return Buffer.concat([Buffer.from([255, 216]), segment(219, Buffer.from([0, ...Array(64).fill(1)])),
    segment(192, Buffer.from([8, 8, 0, 8, 0, 1, 1, 0x11, 0])), segment(196, Buffer.concat([table(0, 8), table(16, 0)])),
    segment(218, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from(entropy), Buffer.from([255, 217])]);
}

test("selected PNG/JPEG packages retain exact binary bytes while model selection exposes metadata and explicit reads revalidate authority", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-skill-images-"))); const home = join(root, "private"), source = join(root, "source");
  mkdirSync(home, { mode: 0o700 }); mkdirSync(source); mkdirSync(join(source, "assets")); mkdirSync(join(source, "references")); mkdirSync(join(source, "scripts"));
  const instructions = "---\nname: image-resource-fixture\ndescription: Describe explicitly selected inert image examples.\n---\nUse only selected source material. No execution.\n";
  const reference = "An inert selected reference.\n", pngBytes = png(), jpegBytes = jpeg();
  writeFileSync(join(source, "SKILL.md"), instructions); writeFileSync(join(source, "references/guide.md"), reference);
  writeFileSync(join(source, "assets/sample.png"), pngBytes); writeFileSync(join(source, "references/sample.jpeg"), jpegBytes);
  writeFileSync(join(source, "assets/unselected.png"), pngBytes); writeFileSync(join(source, "scripts/never.sh"), "exit 99\n");
  const grant = { id: "images", root: source, source: "workspace" as const, label: "Temporary inert fixture" };
  const identity = new ReadOnlySkillLibrary([grant]).discover(grant.id).skills[0]!;
  const selection = { identity, resources: ["assets/sample.png", "references/sample.jpeg", "references/guide.md"] };
  const scope = { taskId: "image-fixture", generation: 2, toolCallId: "read-selected-image" }; const store = new ManagedSkillStore(home);
  try {
    expect(pngBytes.length).toBeGreaterThan(32 * 1024); expect(jpegBytes.length).toBeGreaterThan(32 * 1024);
    const legacy = snapshotSkillPackageSource(grant, { identity, resources: ["references/guide.md"] });
    const legacyIdentity = { relativePath: "references/guide.md", mediaType: "text/markdown", digest: sha256(reference), bytes: Buffer.byteLength(reference) };
    expect(legacy.manifest.package!.version).toBe(1); expect(legacy.manifest.package!.packageDigest).toBe(sha256(JSON.stringify(["selected-local-text-package-v1", { digest: identity.digest, bytes: identity.bytes }, [legacyIdentity]])));
    const legacyReview = store.reviewPackage("legacy", grant, { identity, resources: ["references/guide.md"] }, "Legacy text");
    const lineageId = sha256(JSON.stringify(["local-user-text", legacy.manifest.locator]));
    expect(legacyReview.action.versionId).toBe(sha256(JSON.stringify([lineageId, sha256(JSON.stringify(legacy.manifest)), identity.digest, legacy.manifest.package!.packageDigest])));
    const review = store.reviewPackage("images-v1", grant, selection, "Selected image resources");
    expect(review.action.manifest.package!.version).toBe(2); expect(review.action.manifest.package!.kind).toBe("selected-local-mixed-package");
    const images = review.resources.filter(row => row.kind === "image") as SkillResourceImage[];
    expect(images.map(row => row.mediaType)).toEqual(["image/png", "image/jpeg"]);
    expect(images.map(row => [row.width, row.height])).toEqual([[128, 128], [2048, 2048]]);
    expect(images.map(row => Buffer.from(row.data, "base64"))).toEqual([pngBytes, jpegBytes]);
    const imported = store.commit(review.action.actionId, review.action.reviewDigest, grant);
    const selected = store.attach(scope, imported.versionId); const totalBytes = identity.bytes + Buffer.byteLength(reference) + pngBytes.length + jpegBytes.length;
    expect(totalBytes).toBeGreaterThan(128 * 1024); expect(selected.bytes).toBe(totalBytes); expect(selected.promptBytes!).toBeLessThan(2048); expect(selected.versionId).toBe(imported.versionId);
    expect(store.version(imported.versionId)!.bytes).toBe(totalBytes); expect(store.list().capacity.reservedTextBytes).toBe((totalBytes + legacy.manifest.package!.totalBytes) * 2);
    expect(JSON.stringify(selected)).not.toContain(images[0]!.data); expect(JSON.stringify(selected)).not.toContain('"data":');
    expect(store.inspect(imported.actionId)!.resources).toEqual(review.resources);
    for (const image of images) {
      const path = join(imported.target, "resources", image.relativePath);
      expect(statSync(path).mode & 0o777).toBe(0o400); expect(readFileSync(path)).toEqual(Buffer.from(image.data, "base64"));
      expect(store.readResource(scope, imported.versionId, selected.packageDigest!, image.relativePath, image.digest)).toEqual(image);
    }
    expect(existsSync(join(imported.target, "resources/assets/unselected.png"))).toBe(false); expect(existsSync(join(imported.target, "scripts"))).toBe(false);
    expect(() => store.readResource({ ...scope, generation: 1 }, imported.versionId, selected.packageDigest!, images[0]!.relativePath, images[0]!.digest)).toThrow("not attached");
    expect(() => store.readResource(scope, imported.versionId, "0".repeat(64), images[0]!.relativePath, images[0]!.digest)).toThrow("identity or package digest");
    for (const path of ["../outside.png", "assets/secrets.png", "scripts/never.sh", "assets/file.pdf", "assets/file.svg"]) expect(classifySkillResourcePath(path).supported).toBe(false);
    symlinkSync(join(source, "assets/sample.png"), join(source, "assets/link.png"));
    expect(() => snapshotSkillPackageSource(grant, { identity, resources: ["assets/link.png"] })).toThrow("canonical");
    expect(() => snapshotSkillPackageSource({ ...grant, source: "official-plugin" }, selection)).toThrow("local user/workspace");
    const drift = store.reviewPackage("source-drift", grant, selection, "Review before source change");
    writeFileSync(join(source, "assets/sample.png"), png(2));
    expect(() => store.commit(drift.action.actionId, drift.action.reviewDigest, grant)).toThrow("source changed after review");
    const update = store.reviewPackage("images-v2", grant, selection, "Changed image", imported.lineageId);
    expect(update.action.versionId).not.toBe(imported.versionId); expect(update.action.manifest.package!.packageDigest).not.toBe(selected.packageDigest);
    expect(store.selected(scope)[0]!.packageDigest).toBe(selected.packageDigest);
    const retained = join(imported.target, "resources/assets/sample.png"); chmodSync(retained, 0o600); writeFileSync(retained, png(3)); chmodSync(retained, 0o400);
    expect(() => store.readResource(scope, imported.versionId, selected.packageDigest!, images[1]!.relativePath, images[1]!.digest)).toThrow("immutable resource digest");
    chmodSync(retained, 0o600); writeFileSync(retained, pngBytes); chmodSync(retained, 0o400);
    store.revoke(imported.versionId); expect(() => store.readResource(scope, imported.versionId, selected.packageDigest!, images[0]!.relativePath, images[0]!.digest)).toThrow("revoked");
    expect(readFileSync(retained)).toEqual(pngBytes);
    const boundedHome = join(root, "bounded"); mkdirSync(boundedHome, { mode: 0o700 }); const bounded = new ManagedSkillStore(boundedHome, { maxRetainedTextBytes: totalBytes });
    try { expect(() => bounded.reviewPackage("capacity", grant, selection, "Insufficient binary capacity")).toThrow("capacity reached"); expect(bounded.action("capacity")).toBeUndefined(); } finally { bounded.close(); }
    writeFileSync(join(source, "assets/sample.png"), Buffer.alloc(160 * 1024 + 1)); expect(() => snapshotSkillPackageSource(grant, selection)).toThrow("bounds");
    writeFileSync(join(source, "assets/sample.png"), Buffer.from("not an image")); expect(() => snapshotSkillPackageSource(grant, selection)).toThrow();
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
}, 15_000);
