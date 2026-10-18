'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const { AGENT_NATIVE_PROTOCOL, AGENT_NATIVE_OUTPUT_SCHEMA_HASH } = require('./agent-native-protocol.cjs');

const FILE_NAME = 'launcher-agent-native.json';
const text = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f]/u.test(value);
/** Main-only capability advertisement. It never starts a worker or authenticates an account. */
function createAgentNativeDescriptorPublisher({ coreHome, profile, control }) {
  if (typeof coreHome !== 'string' || !path.isAbsolute(coreHome) || fs.realpathSync(coreHome) !== coreHome
    || !['production', 'development'].includes(profile)) throw new Error('Native descriptor requires the exact main profile');
  const endpoint = new URL(control?.endpoint);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port
    || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash
    || typeof control.token !== 'string' || !/^[A-Za-z0-9_-]{40,}$/.test(control.token)) throw new Error('Native descriptor requires the owned loopback control');
  const token = control.token;
  const directory = path.join(coreHome, 'runtime');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(directory) !== directory || !fs.lstatSync(directory).isDirectory()) throw new Error('Native descriptor directory changed');
  const file = path.join(directory, FILE_NAME), instanceId = randomUUID();
  let last = null;
  function publish({ models = [], accepting = false } = {}) {
    if (!Array.isArray(models) || models.length > 64 || typeof accepting !== 'boolean'
      || new Set(models.map(row => `${row.id}:${row.admissionId}`)).size !== models.length
      || models.some(row => !row || Object.keys(row).some(key => !['id', 'admissionId', 'label', 'available', 'accepting', 'provider'].includes(key))
        || !text(row.id, 128) || !text(row.admissionId, 128) || row.available !== true
        || row.provider !== 'owned-native' || row.label !== undefined && !text(row.label, 200)
        || row.accepting !== undefined && typeof row.accepting !== 'boolean')) throw new Error('Native descriptor requires explicitly admitted models');
    const value = { version: 1, kind: 'nekodex-agent-native', profile, pid: process.pid, instanceId,
      control: { endpoint: endpoint.origin, token }, protocol: AGENT_NATIVE_PROTOCOL,
      outputSchemaHash: AGENT_NATIVE_OUTPUT_SCHEMA_HASH, accepting,
      models: models.map(row => ({ ...row, accepting: accepting && row.accepting !== false })),
      capabilities: { textInput: true, imageInput: false }, createdAt: new Date().toISOString() };
    if (fs.realpathSync(directory) !== directory) throw new Error('Native descriptor directory changed');
    if (fs.existsSync(file)) {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid()) throw new Error('Native descriptor file is not owned by main');
    }
    writePrivateFileAtomic(file, `${JSON.stringify(value)}\n`);
    last = value;
    return { instanceId, models: structuredClone(value.models), accepting: value.accepting };
  }
  // No passive call publishes availability or creates a Native profile.
  return Object.freeze({ publish, path: file, instanceId,
    snapshot: () => last ? { instanceId, accepting: last.accepting, models: structuredClone(last.models) } : null });
}
module.exports = { createAgentNativeDescriptorPublisher, AGENT_NATIVE_DESCRIPTOR_FILE: FILE_NAME };
