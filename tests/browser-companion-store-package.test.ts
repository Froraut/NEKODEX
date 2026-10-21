import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { BROWSER_COMPANION_FILES, buildBrowserCompanion } from "../scripts/build-browser-companion";
import { CHROME_COMPANION_ID } from "../src/browser-companion/firefox-identity";

const pngSize = (bytes: Uint8Array) => {
  expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
};

for (const browser of ["chrome", "firefox"] as const) {
  test(`${browser} store archive is uploadable as built: root manifest, icons, shipped files only, minimal permissions`, () => {
    const temporary = mkdtempSync(join(tmpdir(), `nekodex-${browser}-store-`));
    try {
      const built = buildBrowserCompanion(browser, join(temporary, "out"));
      const files = unzipSync(readFileSync(built.archive));
      expect(Object.keys(files).sort()).toEqual(["manifest.json", ...BROWSER_COMPANION_FILES].sort());
      const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
      expect(manifest).toMatchObject({ manifest_version: 3, name: "NEKODEX Browser Companion", version: "0.2.0",
        permissions: ["activeTab", "scripting", "storage"], host_permissions: ["http://127.0.0.1:17843/*"] });
      expect(manifest.content_scripts).toBeUndefined(); expect(manifest.background).toBeUndefined();
      expect(manifest.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'none'; connect-src http://127.0.0.1:17843");
      for (const [size, path] of Object.entries({ ...manifest.icons, ...manifest.action.default_icon }) as [string, string][]) {
        expect(pngSize(files[path]!)).toEqual([Number(size), Number(size)]);
      }
      expect(Object.keys(manifest.icons)).toEqual(["16", "32", "48", "128"]);
      // Every page/module reference resolves inside the archive.
      for (const [name, content] of Object.entries(files)) {
        if (name.endsWith(".js")) for (const match of strFromU8(content).matchAll(/from\s+["']\.\/([^"']+)["']/g)) expect(files[match[1]!]).toBeDefined();
        if (name.endsWith(".html")) for (const match of strFromU8(content).matchAll(/(?:src|href)="(?!https:)([^"#]+)"/g)) expect(files[match[1]!]).toBeDefined();
      }
      if (browser === "firefox") expect(manifest.browser_specific_settings.gecko).toMatchObject({ id: "browser-companion@nekodex.local", strict_min_version: "153.0" });
      else expect(manifest.minimum_chrome_version).toBe("106");
      // The store upload carries no development key (a listing gets its own store ID); the unpacked
      // directory keeps it, so loading that directory gives the pinned ID.
      expect(manifest.key).toBeUndefined();
      const unpacked = JSON.parse(readFileSync(built.manifestPath, "utf8"));
      expect(unpacked).toEqual(browser === "chrome" ? { ...manifest, key: unpacked.key } : manifest);
      const receipt = JSON.parse(readFileSync(join(temporary, "out", "development-artifact.json"), "utf8"));
      if (browser === "chrome") {
        expect(unpacked.key).toMatch(/^[A-Za-z0-9+/]{300,}={0,2}$/);
        expect(receipt).toMatchObject({ unpackedExtensionId: CHROME_COMPANION_ID, archiveManifestKey: false });
      } else expect(receipt.unpackedExtensionId).toBeUndefined();
      expect(strFromU8(files["popup.html"]!)).toContain("https://github.com/Froraut/NEKODEX/blob/main/browser-companion/PRIVACY.md");
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });
}

test("linked privacy policy states local-only transport, no telemetry and the ChatGPT account digest boundary", () => {
  const path = new URL("../browser-companion/PRIVACY.md", import.meta.url);
  expect(existsSync(path)).toBe(true);
  const policy = readFileSync(path, "utf8");
  for (const phrase of ["127.0.0.1:17843", "no telemetry", "one-way SHA-256 digest", "session", "does not sell"]) expect(policy).toContain(phrase);
});
