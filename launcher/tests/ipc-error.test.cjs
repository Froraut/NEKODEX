const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/ipc-error.ts"), "utf8");
const loaded = { exports: {} };
Function("module", "exports", ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText)(loaded, loaded.exports);
const { stripIpcErrorPrefix } = loaded.exports;

test("IPC failures shown in the UI omit Electron's remote-method wrapper", () => {
  assert.equal(stripIpcErrorPrefix("Error invoking remote method 'launcher:update-check': Error: Release metadata is unavailable"),
    "Release metadata is unavailable");
  assert.equal(stripIpcErrorPrefix("Error invoking remote method 'launcher:open-browser-workspace': Workspace is busy"),
    "Workspace is busy");
  assert.equal(stripIpcErrorPrefix("Plain failure"), "Plain failure");
});
