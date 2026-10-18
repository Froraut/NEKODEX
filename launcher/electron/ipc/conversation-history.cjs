const fs = require('node:fs/promises');
const ACTIONS = new Set(['status', 'set-recording', 'threads', 'thread', 'message', 'search', 'delete-thread', 'delete-message', 'export', 'import-selected']);
/** Guarded main handle is injected by the composition root. The current daemon
 * remains the only DB writer; this registrar never launches/probes another app. */
function registerConversationHistory({ handle, runtimeHost, clipboard, dialog }) {
  handle('launcher:conversation-history', async (_event, body) => {
    if (!body || !ACTIONS.has(body.action) || JSON.stringify(body).length > 600000) throw new Error('Invalid history request');
    const supervisor = runtimeHost.supervisor;
    const config = supervisor.readConfig();
    if (!await supervisor.ownedRuntimeReady(config)) throw new Error('Start the current NEKODEX runtime to use conversation history');
    const receipt = await supervisor.control(config, 'conversation-history', { body });
    if (!receipt || receipt.ok !== true) throw new Error(receipt?.error || 'History operation failed');
    return receipt.value;
  });
  handle('launcher:conversation-history-copy', async (_event, text) => {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 8 * 1024 * 1024) throw new Error('History copy exceeds the text limit');
    clipboard.writeText(text); return { copied: true };
  });
  handle('launcher:conversation-history-save', async (_event, markdown) => {
    if (typeof markdown !== 'string' || Buffer.byteLength(markdown, 'utf8') > 8 * 1024 * 1024) throw new Error('History export exceeds the text limit');
    const result = await dialog.showSaveDialog({ title: 'Save selected conversation text', defaultPath: 'nekodex-conversation.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return { saved: false };
    await fs.writeFile(result.filePath, markdown, { encoding: 'utf8', mode: 0o600 });
    await fs.chmod(result.filePath, 0o600);
    return { saved: true, path: result.filePath };
  });
}
module.exports = { registerConversationHistory };
