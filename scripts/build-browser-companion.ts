import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, renameSync, mkdtempSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const sourceDirectory = fileURLToPath(new URL("../browser-companion/", import.meta.url));
const sourceFiles = ["popup.html", "popup.css", "popup.js", "page.js", "dispatch.js", "transport.js", "session.html", "session.js"] as const;

/** Prepare reviewed development artifacts only; never install, sign, launch or publish. */
export function buildBrowserCompanion(browser: "chrome" | "firefox", outputDirectory: string) {
  if (!["chrome", "firefox"].includes(browser)) throw new Error("Choose chrome or firefox");
  const target = resolve(outputDirectory);
  const insideSource = (path: string) => {
    const pathFromSource = relative(realpathSync(sourceDirectory), path);
    return !pathFromSource || (!isAbsolute(pathFromSource) && pathFromSource !== ".." && !pathFromSource.startsWith(`..${sep}`));
  };
  // An explicit new directory avoids destroying a previous receipt or unrelated output.
  if (existsSync(target)) throw new Error("Companion output already exists; choose a new directory");
  if (insideSource(target)) throw new Error("Companion output must be outside the source artifact");
  mkdirSync(dirname(target), { recursive: true });
  const canonicalParent = realpathSync(dirname(target));
  if (insideSource(canonicalParent)) throw new Error("Companion output must be outside the source artifact");
  const manifest = JSON.parse(readFileSync(join(sourceDirectory, browser === "firefox" ? "manifest.firefox.json" : "manifest.json"), "utf8"));
  const bytes: Record<string, Uint8Array> = { "manifest.json": new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`) };
  for (const file of sourceFiles) bytes[file] = readFileSync(join(sourceDirectory, file));
  const temporary = mkdtempSync(join(dirname(target), ".nekodex-companion-"));
  try {
    const unpacked = join(temporary, browser); mkdirSync(unpacked);
    for (const [file, content] of Object.entries(bytes)) writeFileSync(join(unpacked, file), content);
    // Fixed ZIP timestamps make the artifact identity reproducible for unchanged input.
    const entries = Object.fromEntries(Object.entries(bytes).map(([file, content]) => [file, [content, { mtime: new Date(1980, 0, 1) }]])) as Parameters<typeof zipSync>[0];
    const archiveName = `nekodex-browser-companion-${browser}-${manifest.version}.zip`;
    writeFileSync(join(temporary, archiveName), zipSync(entries, { level: 9 }));
    writeFileSync(join(temporary, "development-artifact.json"), JSON.stringify({ browser, version: manifest.version, installState: "not-installed", signed: false, published: false, unpackedDirectory: browser, archive: archiveName, ...(browser === "firefox" ? { addonId: manifest.browser_specific_settings.gecko.id, minimumVersion: manifest.browser_specific_settings.gecko.strict_min_version } : {}) }, null, 2) + "\n");
    renameSync(temporary, target);
    return { directory: join(target, browser), manifestPath: join(target, browser, "manifest.json"), archive: join(target, archiveName) };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (import.meta.main) {
  const [browser, output, ...rest] = process.argv.slice(2);
  if ((browser !== "chrome" && browser !== "firefox") || !output || rest.length) throw new Error("Usage: bun run scripts/build-browser-companion.ts <chrome|firefox> <new-output-directory>");
  console.log(JSON.stringify(buildBrowserCompanion(browser, output), null, 2));
}
