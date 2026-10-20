import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedSkillStore } from "../src/agent-tools/managed-skills";
import { ReadOnlySkillLibrary } from "../src/agent-tools/skills";
import { classifySkillResourcePath, snapshotSkillPackageSource, type SkillResourceScript } from "../src/agent-tools/skill-resources";
import { sha256 } from "../src/agent-tools/config";

test("reviewed selected JS/MJS retain exact inert v3 code and expose metadata with immutable script/package/task bindings", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-skill-scripts-"))); const home = join(root, "private"), source = join(root, "source"), marker = join(root, "must-never-execute");
  mkdirSync(home, { mode: 0o700 }); mkdirSync(source); for (const name of ["assets", "references", "scripts"]) mkdirSync(join(source, name));
  const instructions = "---\nname: selected-script-fixture\ndescription: Use explicitly selected inert code as reviewed fixture material.\n---\nOnly the explicitly selected resources are retained. No import executes code.\n";
  const text = "Inert accompanying reference.\n";
  const code = `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'THIS_CODE_MUST_STAY_INERT');\n`;
  const codePrefix = "// JS_MAX_BOUNDARY_FIXTURE\n";
  const largeCode = codePrefix + " ".repeat(32 * 1024 - Buffer.byteLength(codePrefix)); // exactly the ordinary per-resource code bound
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNg+A8AAQIBAEK+vGgAAAAASUVORK5CYII=", "base64");
  writeFileSync(join(source, "SKILL.md"), instructions); writeFileSync(join(source, "references/guide.md"), text); writeFileSync(join(source, "assets/sample.png"), png);
  writeFileSync(join(source, "scripts/inert.mjs"), code); writeFileSync(join(source, "scripts/bounded.js"), largeCode); writeFileSync(join(source, "scripts/unselected.mjs"), "throw new Error('never execute or import');\n");
  const grant = { id: "scripts", root: source, source: "workspace" as const, label: "Inert script fixture" };
  const identity = new ReadOnlySkillLibrary([grant]).discover(grant.id).skills[0]!;
  const scope = { taskId: "script-fixture", generation: 3, toolCallId: "explicit-script-owner" };
  const selection = { identity, resources: ["scripts/inert.mjs", "scripts/bounded.js", "references/guide.md", "assets/sample.png"] };
  const store = new ManagedSkillStore(home);
  try {
    const textIdentity = { relativePath: "references/guide.md", mediaType: "text/markdown", digest: sha256(text), bytes: Buffer.byteLength(text) };
    const imageIdentity = { relativePath: "assets/sample.png", mediaType: "image/png", digest: sha256(png), bytes: png.length, kind: "image", width: 1, height: 1 };
    for (const [resources, domain, expectedResources, version] of [
      [["references/guide.md"], "selected-local-text-package-v1", [textIdentity], 1],
      [["assets/sample.png", "references/guide.md"], "selected-local-mixed-package-v2", [imageIdentity, textIdentity], 2],
    ] as const) {
      const snapshot = snapshotSkillPackageSource(grant, { identity, resources: [...resources] });
      expect(snapshot.manifest.package!.version).toBe(version);
      expect(snapshot.manifest.package!.packageDigest).toBe(sha256(JSON.stringify([domain, { digest: identity.digest, bytes: identity.bytes }, expectedResources])));
      const reviewed = store.reviewPackage(`legacy-v${version}`, grant, { identity, resources: [...resources] }, `Legacy ${version}`);
      const lineage = sha256(JSON.stringify(["local-user-text", snapshot.manifest.locator]));
      expect(reviewed.action.versionId).toBe(sha256(JSON.stringify([lineage, sha256(JSON.stringify(snapshot.manifest)), identity.digest, snapshot.manifest.package!.packageDigest])));
    }
    const reviewed = store.reviewPackage("script-v3", grant, selection, "Reviewed scripts");
    expect(reviewed.action.manifest.package!.version).toBe(3); expect(reviewed.action.manifest.package!.kind).toBe("selected-local-executable-package");
    const script = reviewed.resources.find(row => row.relativePath === "scripts/inert.mjs") as SkillResourceScript;
    expect(script).toEqual({ relativePath: "scripts/inert.mjs", mediaType: "text/javascript", digest: sha256(code), bytes: Buffer.byteLength(code), kind: "script", content: code, role: "selected-skill-source-material" });
    expect(reviewed.resources.find(row => row.relativePath === "scripts/bounded.js")!.bytes).toBe(Buffer.byteLength(largeCode));
    expect(existsSync(marker)).toBe(false);
    const imported = store.commit(reviewed.action.actionId, reviewed.action.reviewDigest, grant);
    expect(existsSync(marker)).toBe(false); expect(existsSync(join(imported.target, "resources/scripts/unselected.mjs"))).toBe(false);
    const selected = store.attach(scope, imported.versionId); const descriptor = selected.resources!.find(row => row.relativePath === script.relativePath)!;
    expect(descriptor).toEqual({ relativePath: script.relativePath, mediaType: "text/javascript", digest: script.digest, bytes: script.bytes, kind: "script", role: "selected-skill-source-material" });
    expect(JSON.stringify(selected)).not.toContain("THIS_CODE_MUST_STAY_INERT"); expect(JSON.stringify(selected)).not.toContain("JS_MAX_BOUNDARY_FIXTURE");
    expect(selected.promptBytes!).toBeLessThan(2048); expect(selected.bytes).toBe(identity.bytes + Buffer.byteLength(text) + png.length + script.bytes + Buffer.byteLength(largeCode));
    expect(store.readResource(scope, imported.versionId, selected.packageDigest!, script.relativePath, script.digest)).toEqual(script);
    expect(store.inspect(imported.actionId)!.resources!.find(row => row.relativePath === script.relativePath)).toEqual(script);
    const retained = join(imported.target, "resources", script.relativePath); expect(statSync(retained).mode & 0o777).toBe(0o400); expect(readFileSync(retained)).toEqual(Buffer.from(code));
    expect(() => store.readResource({ ...scope, generation: 2 }, imported.versionId, selected.packageDigest!, script.relativePath, script.digest)).toThrow("not attached");
    expect(() => store.readResource(scope, imported.versionId, selected.packageDigest!, script.relativePath, "0".repeat(64))).toThrow("identity or package digest");
    const changedReview = store.reviewPackage("source-change", grant, selection, "Before code source change"); writeFileSync(join(source, script.relativePath), `${code}// changed code\n`);
    expect(() => store.commit(changedReview.action.actionId, changedReview.action.reviewDigest, grant)).toThrow("source changed after review");
    const update = store.reviewPackage("script-v4", grant, selection, "Changed script version", imported.lineageId);
    expect(update.action.versionId).not.toBe(imported.versionId); expect(update.action.manifest.package!.packageDigest).not.toBe(selected.packageDigest);
    expect(store.selected(scope)[0]!.packageDigest).toBe(selected.packageDigest); expect(store.readResource(scope, imported.versionId, selected.packageDigest!, script.relativePath, script.digest)).toEqual(script);
    chmodSync(retained, 0o600); writeFileSync(retained, `${code}// retained mutation\n`); chmodSync(retained, 0o400);
    expect(() => store.selected(scope)).toThrow("immutable resource digest");
    expect(() => store.readResource(scope, imported.versionId, selected.packageDigest!, "assets/sample.png", imageIdentity.digest)).toThrow("immutable resource digest");
    chmodSync(retained, 0o600); writeFileSync(retained, code); chmodSync(retained, 0o400);
    store.revoke(imported.versionId); expect(() => store.readResource(scope, imported.versionId, selected.packageDigest!, script.relativePath, script.digest)).toThrow("revoked"); expect(readFileSync(retained, "utf8")).toBe(code);
    for (const path of ["scripts/../outside.js", "scripts/secret.js", "scripts/code.sh", "assets/code.js", "references/code.mjs", "scripts/.hidden.js"]) expect(classifySkillResourcePath(path).supported).toBe(false);
    expect(classifySkillResourcePath("scripts/code.py").mediaType).toBe("text/x-python");
    expect(classifySkillResourcePath("scripts/nested/code.mjs").mediaType).toBe("text/javascript");
    symlinkSync(join(source, "scripts/inert.mjs"), join(source, "scripts/link.js")); expect(() => snapshotSkillPackageSource(grant, { identity, resources: ["scripts/link.js"] })).toThrow("canonical");
    expect(() => snapshotSkillPackageSource({ ...grant, source: "vendor-plugin" }, selection)).toThrow("local user/workspace");
    writeFileSync(join(source, "scripts/bounded.js"), Buffer.alloc(32 * 1024 + 1, 32)); expect(() => snapshotSkillPackageSource(grant, selection)).toThrow("bounds");
    writeFileSync(join(source, "scripts/bounded.js"), Buffer.from([255])); expect(() => snapshotSkillPackageSource(grant, selection)).toThrow();
    writeFileSync(join(source, "scripts/bounded.js"), "bad\0code"); expect(() => snapshotSkillPackageSource(grant, selection)).toThrow("UTF-8");
    expect(existsSync(marker)).toBe(false);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
}, 15_000);
