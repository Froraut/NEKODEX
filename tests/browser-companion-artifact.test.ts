import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { browserCompanionArtifactDirectory, createBrowserCompanionRuntime } from "../src/browser-companion/runtime";

test("source and bundled runtime resolve only their own shipped companion artifact", async () => {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-companion-artifact-")));
  const source = resolve(import.meta.dir, "../src/browser-companion/runtime.ts");
  const sourceArtifact = resolve(import.meta.dir, "../browser-companion");
  const app = join(temporary, "app"); mkdirSync(app);
  try {
    expect(createBrowserCompanionRuntime().status().extensionArtifact).toMatchObject({ directory: sourceArtifact, available: true });
    expect(browserCompanionArtifactDirectory(pathToFileURL(source).href)).toBe(sourceArtifact);
    expect(() => browserCompanionArtifactDirectory(pathToFileURL(join(temporary, "unexpected.js")).href)).toThrow("unsupported");
    const built = await Bun.build({ entrypoints: [source], target: "bun", outdir: app, naming: "cli.js", minify: true });
    expect(built.success).toBe(true);
    cpSync(sourceArtifact, join(app, "browser-companion"), { recursive: true });
    const bundled = await import(pathToFileURL(join(app, "cli.js")).href) as { createBrowserCompanionRuntime: typeof createBrowserCompanionRuntime };
    const runtime = bundled.createBrowserCompanionRuntime();
    expect(runtime.status().extensionArtifact).toEqual({ directory: join(app, "browser-companion"), manifestPath: join(app, "browser-companion", "manifest.json"), available: true });
    expect(runtime.status().enabled).toBe(false);
    await runtime.close();
    rmSync(join(app, "browser-companion", "manifest.json"));
    const missing = bundled.createBrowserCompanionRuntime();
    expect(missing.status().extensionArtifact).toMatchObject({ directory: join(app, "browser-companion"), available: false });
    await missing.close();
    const explicitMissing = join(temporary, "explicit-missing");
    expect(bundled.createBrowserCompanionRuntime({ extensionArtifactPath: explicitMissing }).status().extensionArtifact).toMatchObject({ directory: explicitMissing, available: false });
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}, 10_000);
