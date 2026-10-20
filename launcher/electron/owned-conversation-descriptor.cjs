'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const { validateOwnedConversationScope } = require('./owned-conversation-transcript.cjs');
const FILE_NAME = 'launcher-owned-conversation-history.json';
/** Metadata claims only. This advertises no content, execution or external-client authority. */
function createOwnedConversationDescriptorPublisher({coreHome,profile,control}) {
  if (typeof coreHome !== 'string' || !path.isAbsolute(coreHome) || fs.realpathSync(coreHome) !== coreHome || !['production','development'].includes(profile)) throw new Error('Owned conversation descriptor requires exact main profile');
  const endpoint = new URL(control?.endpoint);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || typeof control.token !== 'string' || !/^[A-Za-z0-9_-]{40,256}$/.test(control.token)) throw new Error('Owned conversation descriptor requires owned loopback control');
  const directory = path.join(coreHome,'runtime'), file = path.join(directory,FILE_NAME), instanceId = randomUUID();
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  let last = null;
  function publish({scopes=[],accepting=false}={}) {
    if (!Array.isArray(scopes) || scopes.length > 256 || typeof accepting !== 'boolean') throw new Error('Invalid owned conversation claims');
    const selected = scopes.map(validateOwnedConversationScope);
    if (new Set(selected.map(scope=>scope.conversationId)).size !== selected.length) throw new Error('Ambiguous owned conversation claims');
    const stat = fs.lstatSync(directory);
    if (fs.realpathSync(directory) !== directory || !stat.isDirectory() || stat.isSymbolicLink() || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('Owned conversation descriptor directory changed');
    fs.chmodSync(directory,0o700);
    if (fs.existsSync(file)) { const prior = fs.lstatSync(file); if (!prior.isFile() || prior.isSymbolicLink() || typeof process.getuid === 'function' && prior.uid !== process.getuid()) throw new Error('Owned conversation descriptor is not main-owned'); }
    const value = {version:1,kind:'nekodex-owned-conversation-history',profile,pid:process.pid,instanceId,control:{endpoint:endpoint.origin,token:control.token},accepting,scopes:accepting ? selected : [],createdAt:new Date().toISOString()};
    if (Buffer.byteLength(JSON.stringify(value)) > 512*1024) throw new Error('Owned conversation claims exceed private bound');
    writePrivateFileAtomic(file,`${JSON.stringify(value)}\n`); last = value;
    return {instanceId,accepting,scopes:structuredClone(value.scopes)};
  }
  return Object.freeze({publish,path:file,instanceId,snapshot:()=>last ? {instanceId,accepting:last.accepting,scopes:structuredClone(last.scopes)} : null});
}
module.exports = {createOwnedConversationDescriptorPublisher,OWNED_CONVERSATION_DESCRIPTOR_FILE:FILE_NAME};
