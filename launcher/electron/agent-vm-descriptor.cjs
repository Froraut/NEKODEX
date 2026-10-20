'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');

const FILE_NAME = 'launcher-agent-vm-export.json';
/** Main advertises its existing control listener; this creates no VM or export resource. */
function createAgentVmExportDescriptorPublisher({ coreHome, profile, control }) {
  if (typeof coreHome !== 'string' || !path.isAbsolute(coreHome) || fs.realpathSync(coreHome) !== coreHome
    || !['production', 'development'].includes(profile)) throw new Error('VM export descriptor requires the exact main profile');
  const endpoint = new URL(control?.endpoint);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.username || endpoint.password
    || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || typeof control.token !== 'string'
    || !/^[A-Za-z0-9_-]{40,256}$/.test(control.token)) throw new Error('VM export descriptor requires the owned loopback control');
  const directory = path.join(coreHome, 'runtime');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const instanceId = randomUUID(), file = path.join(directory, FILE_NAME);
  let last = null;
  function publish() {
    const stat = fs.lstatSync(directory);
    if (fs.realpathSync(directory) !== directory || !stat.isDirectory() || stat.isSymbolicLink()
      || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('VM export descriptor directory changed');
    fs.chmodSync(directory, 0o700);
    if (fs.existsSync(file)) {
      const current = fs.lstatSync(file);
      if (!current.isFile() || current.isSymbolicLink() || typeof process.getuid === 'function' && current.uid !== process.getuid()) throw new Error('VM export descriptor is not owned by main');
    }
    const value = { version: 1, kind: 'nekodex-agent-vm-export', profile, pid: process.pid, instanceId,
      control: { endpoint: endpoint.origin, token: control.token }, createdAt: new Date().toISOString() };
    writePrivateFileAtomic(file, `${JSON.stringify(value)}\n`);
    last = value;
    return { instanceId };
  }
  return Object.freeze({ publish, path: file, instanceId, snapshot: () => last ? { instanceId } : null });
}
module.exports = { createAgentVmExportDescriptorPublisher, AGENT_VM_EXPORT_DESCRIPTOR_FILE: FILE_NAME };
