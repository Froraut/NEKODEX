import { mkdirSync, rmSync, writeFileSync, renameSync, lstatSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const { assertGeneratedDestination } = createRequire(import.meta.url)("./build-output.cjs");

const root = resolve(import.meta.dir, "..");
const output = resolve(process.argv[2] ?? join(root, ".launcher-runtime", "browser-helper.cjs"));
assertGeneratedDestination(output, root);
const previous = lstatSync(output, { throwIfNoEntry: false });
if (previous && (!previous.isFile() || previous.isSymbolicLink())) throw new Error("Browser helper output must be a regular generated file");

const build = await Bun.build({
  entrypoints: [join(root, "src", "adapters", "chatgpt-web", "browser-helper-main.ts")],
  target: "node",
  format: "cjs",
  minify: true,
  packages: "external",
  external: ["playwright-core"],
  naming: basename(output),
});
if (!build.success) throw new Error(`Browser helper build failed: ${build.logs.map(log => log.message).join("; ")}`);
if (build.outputs.length !== 1) throw new Error("Browser helper build produced an unexpected artifact set");
mkdirSync(dirname(output), { recursive: true });
const temporary = join(dirname(output), `.${basename(output)}.${randomUUID()}.tmp`);
try {
  writeFileSync(temporary, Buffer.from(await build.outputs[0]!.arrayBuffer()), { flag: "wx", mode: 0o755 });
  renameSync(temporary, output);
} finally { rmSync(temporary, { force: true }); }
process.stdout.write(`${output}\n`);
