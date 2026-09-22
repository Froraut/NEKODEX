import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

const roots = ["src", "launcher/src", "launcher/electron", "scripts", "launcher/scripts", "launcher/assets", ".github"];
const ignored = new Set(["node_modules", "dist", "build", "release", "artifacts", "output", ".git", ".DS_Store", ".env"]);
const codeExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const metadata = ["package.json", "bun.lock", "tsconfig.json", "launcher/package.json", "launcher/bun.lock",
  "launcher/tsconfig.json", "launcher/vite.config.ts", "launcher/release-trust.json"];
const portable = (value: string) => value.split(sep).join("/");
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
type ModuleEntry = { path: string; dependencies: string[] };

/** Static runtime imports and file inventory; type-only/dynamic computed edges need human review. */
export function createArchitectureMap(root: string) {
  const files = new Set<string>();
  const visit = (directory: string) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || ignored.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.add(portable(relative(root, path)));
    }
  };
  roots.forEach(path => visit(join(root, path)));
  metadata.forEach(path => { if (existsSync(join(root, path))) files.add(path); });
  const transpilers = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }) };
  const modules: ModuleEntry[] = [...files].sort(lexical).map(path => {
    const dependencies = new Set<string>();
    if (codeExtensions.has(extname(path))) {
      const source = readFileSync(join(root, path), "utf8").replace(/^#![^\r\n]*(?:\r?\n|$)/, "");
      const imports = transpilers[path.endsWith(".tsx") ? "tsx" : "ts"].scanImports(source);
      for (const item of imports) {
        if (!item.path.startsWith(".")) { dependencies.add(item.path); continue; }
        const target = resolve(root, dirname(path), item.path);
        const resolved = [target, ...[".ts", ".tsx", ".js", ".cjs", ".mjs", ".json"].map(ext => target + ext),
          ...["index.ts", "index.tsx", "index.js", "index.cjs"].map(name => join(target, name))]
          .find(candidate => existsSync(candidate) && lstatSync(candidate).isFile());
        dependencies.add(resolved ? portable(relative(root, resolved)) : `unresolved:${item.path}`);
      }
    }
    return { path, dependencies: [...dependencies].sort(lexical) };
  });
  return { schemaVersion: 1, roots, modules };
}

export function architectureMapText(root: string): string {
  const map = createArchitectureMap(root);
  return `{"schemaVersion":${map.schemaVersion},"roots":${JSON.stringify(map.roots)},"modules":[\n`
    + map.modules.map(entry => "  " + JSON.stringify(entry)).join(",\n") + "\n]}\n";
}

export function checkArchitectureLinks(root: string): void {
  for (const name of ["ARCHITECTURE.md", "docs/development/extending-nekodex.md"]) {
    const text = readFileSync(join(root, name), "utf8");
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1]!.split("#")[0]!;
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      if (!existsSync(resolve(root, dirname(name), decodeURIComponent(target)))) {
        throw new Error(`${name} links to a missing path: ${target}`);
      }
    }
  }
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const output = join(root, "docs/development/module-map.json");
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--write"].includes(mode)) throw new Error("Use --check or --write");
  const expected = architectureMapText(root);
  if (mode === "--write") {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, expected);
    console.log("Updated docs/development/module-map.json; review architecture prose for changed responsibilities.");
  } else if (!existsSync(output) || readFileSync(output, "utf8") !== expected) {
    throw new Error("Architecture map is stale. Review ARCHITECTURE.md, then run bun run architecture:update and commit the map.");
  } else console.log("Architecture module map is current.");
  checkArchitectureLinks(root);
  console.log("Documented architecture paths are current.");
}
