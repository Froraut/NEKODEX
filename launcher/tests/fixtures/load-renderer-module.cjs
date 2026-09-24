// Load actual TS/JSON locale modules for Node fixtures, including deferred imports.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function loadRendererModule(name) {
  const cache = new Map();
  function load(file) {
    if (file.endsWith('.json')) return require(file);
    if (cache.has(file)) return cache.get(file).exports;
    const loaded = { exports: {} };
    cache.set(file, loaded);
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
    }).outputText;
    Function('module', 'exports', 'require', output)(loaded, loaded.exports, specifier => {
      if (!specifier.startsWith('.')) return require(specifier);
      const target = path.resolve(path.dirname(file), specifier);
      return load(fs.existsSync(target) ? target : target + '.ts');
    });
    return loaded.exports;
  }
  return load(path.resolve(__dirname, '../../src', name));
}
module.exports = { loadRendererModule };
