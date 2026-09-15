const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');

test('service installers report owned plist bytes before a bootstrap failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-plist-checkpoint-'));
  const profile = path.join(root, 'profile');
  fs.mkdirSync(profile);
  const binary = path.join(root, 'synthetic-client');
  fs.writeFileSync(binary, 'fixture');
  fs.writeFileSync(path.join(profile, 'test.yaml'), 'fixture');
  const config = { runtimeCommand: ['/stable/synthetic-runtime'], mode: 'full',
    tunnel: { binaryPath: binary, profileDir: profile, profileName: 'test' } };
  try {
    for (const [sourceFile, method] of [['service.ts', 'installService'], ['tunnel-service.ts', 'installTunnelService']]) {
      const loaded = { exports: {} };
      const source = fs.readFileSync(path.join(__dirname, '../../src', sourceFile), 'utf8');
      const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023,
      } }).outputText;
      vm.runInNewContext(code, { module: loaded, exports: loaded.exports,
        process: { platform: 'darwin' },
        require(name) {
          if (name === 'node:os') return { ...os, homedir: () => root };
          if (name === './config') return {
            getConfigDir: () => path.join(root, 'app'), assertDurableRuntimeCommand() {},
            atomicWriteFile(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); },
          };
          if (name === './process') return {
            runCommand: () => ({ status: 1, stdout: '', stderr: '' }),
            runChecked() { throw new Error('synthetic bootstrap failure'); },
          };
          return require(name);
        },
      });
      let checkpoint;
      assert.throws(() => loaded.exports[method](config, definition => {
        checkpoint = definition;
        assert.equal(fs.readFileSync(definition.path, 'utf8'), definition.data);
      }), /synthetic bootstrap failure/);
      assert.ok(checkpoint && checkpoint.path.startsWith(root));
      assert.equal(fs.readFileSync(checkpoint.path, 'utf8'), checkpoint.data);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
