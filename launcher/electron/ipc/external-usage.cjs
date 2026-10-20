'use strict';
// Composition root supplies its sender-guarded handle and a main-owned service.
function registerExternalUsageIpc({ handle, service }) {
  handle('launcher:external-usage', async (_event, ...args) => {
    if (args.length !== 1 || !args[0] || JSON.stringify(args[0]).length > 65536) throw new Error('Invalid external usage request');
    return service.request(args[0]);
  });
  handle('launcher:external-usage-pick', async (_event, ...args) => {
    if (args.length !== 1 || !args[0] || JSON.stringify(args[0]).length > 1024) throw new Error('Invalid external usage selection');
    return service.selectRoot(args[0]);
  });
}
module.exports = { registerExternalUsageIpc };
