import { expect, test } from "bun:test";
import { createHash, createPublicKey } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME_COMPANION_ID, FIREFOX_COMPANION_ID, reviewedCompanionExtensionOrigin } from "../src/browser-companion/firefox-identity";
import { BROWSER_COMPANION_CHROME_ID, BROWSER_COMPANION_FIREFOX_ID } from "../launcher/src/browser-companion-types";

const require = createRequire(import.meta.url);
const artifact = fileURLToPath(new URL("../browser-companion/", import.meta.url));
const manifest = (name: string) => JSON.parse(readFileSync(join(artifact, name), "utf8"));
/** Chrome's derivation for a manifest key: the first 128 bits of SHA-256(DER SPKI), hex digits 0-f as a-p. */
const chromeId = (spki: Buffer) => [...createHash("sha256").update(spki).digest("hex").slice(0, 32)]
  .map(digit => String.fromCharCode(97 + Number.parseInt(digit, 16))).join("");

test("the Chrome manifest key fixes one extension ID that every NEKODEX pin expects", () => {
  const key = manifest("manifest.json").key;
  const spki = Buffer.from(key, "base64");
  // Only a public RSA-2048 SubjectPublicKeyInfo ships; unpacked loading needs no private key.
  const publicKey = createPublicKey({ key: spki, format: "der", type: "spki" });
  expect(publicKey.asymmetricKeyType).toBe("rsa");
  expect(publicKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
  const id = chromeId(spki);
  expect(id).toBe(CHROME_COMPANION_ID);
  expect(BROWSER_COMPANION_CHROME_ID).toBe(id);
  expect(require("../launcher/electron/ipc/browser-companion.cjs").CHROME_COMPANION_ID).toBe(id);
  expect(require("../launcher/scripts/release-signing.cjs").chromeExtensionIdFromKey(key)).toBe(id);
  expect(reviewedCompanionExtensionOrigin(id)).toBe(`chrome-extension://${id}`);
  // A path-derived ID (the old unpacked behavior) or any other Chrome ID is not the reviewed artifact.
  expect(() => reviewedCompanionExtensionOrigin("a".repeat(32))).toThrow(id);
  expect(() => reviewedCompanionExtensionOrigin(id, "chrome-extension://" + "a".repeat(32))).toThrow();
  for (const doc of ["../docs/design/browser-companion.md", "../browser-companion/README.md"]) {
    expect(readFileSync(new URL(doc, import.meta.url), "utf8")).toContain(id);
  }
});

test("Firefox keeps its stable gecko ID, carries no Chrome key, and no private key ships", () => {
  const firefox = manifest("manifest.firefox.json");
  expect(firefox.key).toBeUndefined();
  expect(firefox.browser_specific_settings.gecko.id).toBe(FIREFOX_COMPANION_ID);
  expect(BROWSER_COMPANION_FIREFOX_ID).toBe(FIREFOX_COMPANION_ID);
  const origin = "moz-extension://c7b114ab-2233-4455-8899-0123456789ab";
  expect(reviewedCompanionExtensionOrigin(FIREFOX_COMPANION_ID, origin)).toBe(origin);
  expect(() => reviewedCompanionExtensionOrigin(FIREFOX_COMPANION_ID)).toThrow();
  for (const name of readdirSync(artifact, { recursive: true }) as string[]) {
    const path = join(artifact, name);
    if (statSync(path).isFile() && !name.endsWith(".png")) expect(readFileSync(path, "utf8")).not.toContain("PRIVATE KEY");
  }
});
