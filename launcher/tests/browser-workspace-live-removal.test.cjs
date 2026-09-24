const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BrowserWorkspaceWindows } = require('../electron/browser-workspace-windows.cjs');
const { BrowserWorkspaceManifest } = require('../electron/browser-workspace-manifest.cjs');

class Window extends EventEmitter {
  constructor() {
    super(); this.destroyed = false;
    this.webContents = new EventEmitter();
    this.webContents.setWindowOpenHandler = () => {};
    this.webContents.getURL = () => 'https://chatgpt.com/c/retry';
  }
  isDestroyed() { return this.destroyed; }
  close() { this.destroyed = true; this.emit('closed'); }
  destroy() { this.close(); }
  getBounds() { return { x: 0, y: 0, width: 900, height: 700 }; }
}

for (const source of ['manager', 'native']) {
  test(`${source} live close retains durable retry row after actual deletion commit failure`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-live-removal-'));
    const file = path.join(root, 'a.json');
    const store = new BrowserWorkspaceManifest(file, 'a');
    const changes = [];
    const workspaces = new BrowserWorkspaceWindows({ BrowserWindow: Window, accountId: 'a',
      manifestPath: file, register() {}, unregister() {},
      getVerifiedPrincipal: () => 'a'.repeat(64), onChanged: snapshot => changes.push(snapshot),
    });
    const rename = fs.renameSync;
    const failure = Object.assign(new Error('Injected deletion commit failure'), { code: 'EIO' });
    let commits = 0;
    try {
      workspaces.ensureManifestLoaded();
      const win = new Window();
      workspaces.bind(win, { id: 'live', groupId: 'group', preserveOnClose: false });
      workspaces.capture(win);
      assert.equal(store.read().entries[0].id, 'live', 'initial live capture committed');
      const before = fs.readFileSync(file);
      fs.renameSync = (candidate, destination) => {
        if (destination !== file) return rename(candidate, destination);
        assert.deepEqual(JSON.parse(fs.readFileSync(candidate, 'utf8')).entries, [],
          'valid deletion candidate reached the atomic publication boundary');
        commits++;
        throw failure;
      };
      if (source === 'manager') await assert.rejects(workspaces.close('live'), error => error === failure);
      else win.close();
      assert.equal(commits, 1);
      assert.equal(win.isDestroyed(), true);
      assert.equal(workspaces.windows.size, 0);
      assert.equal(workspaces.windowMeta.size, 0);
      assert.deepEqual(fs.readFileSync(file), before);
      assert.equal(changes.at(-1).persistenceFailed, true);
      assert.deepEqual(changes.at(-1).items.map(({ id, state }) => ({ id, state })),
        [{ id: 'live', state: 'saved' }]);
      fs.renameSync = rename;
      assert.equal(await workspaces.close('live'), true);
      assert.deepEqual(store.read().entries, []);
      assert.deepEqual(workspaces.snapshot().items, []);
      assert.equal(workspaces.snapshot().persistenceFailed, false);
    } finally {
      fs.renameSync = rename;
      workspaces.destroy();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
