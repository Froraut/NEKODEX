'use strict';
const path = require('node:path');
const record = value => value && typeof value === 'object' && !Array.isArray(value);
function exact(value, keys) { return record(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','); }
/** handle is the existing sender/lifecycle guard. resolveProject returns only an
 * already user-granted local project. Selection opens the OS picker; no caller
 * file path, URL, background discovery, or implicit Run is accepted. */
function registerLoopFileWatcher({ handle, service, dialog, getWindow, resolveProject }) {
  if (!service || typeof handle !== 'function' || typeof resolveProject !== 'function') throw new Error('Loop source IPC owner unavailable');
  handle('launcher:loop-file-watcher', async (_event, body) => {
    if (!record(body) || Buffer.byteLength(JSON.stringify(body)) > 12 * 1024) throw new Error('Invalid Loop file source request');
    if (body.action === 'status' && exact(body, ['action'])) return service.status();
    if (body.action === 'select' && exact(body, ['action', 'taskId', 'scope', 'projectId', 'explicitUserAction']) && body.explicitUserAction === true && dialog) {
      const project = await resolveProject(body.projectId);
      if (!project || project.id !== body.projectId || typeof project.path !== 'string' || !path.isAbsolute(project.path)) throw new Error('Select an existing granted local project');
      const options = { title: 'Select one local file for bounded Loop metadata events', defaultPath: project.path, properties: ['openFile'] };
      const window = getWindow?.();
      const selected = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      if (selected.canceled) return { cancelled: true };
      if (!Array.isArray(selected.filePaths) || selected.filePaths.length !== 1) throw new Error('Select one regular local project file');
      return { cancelled: false, source: await service.select({ taskId: body.taskId, scope: body.scope, projectId: body.projectId, filePath: selected.filePaths[0] }) };
    }
    if (body.action === 'enable' && exact(body, ['action', 'watcherId', 'scope', 'instruction', 'eventBound', 'explicitUserAction'])) {
      const { action, ...input } = body; return service.enable(input);
    }
    if (['disable', 'refresh'].includes(body.action) && exact(body, ['action', 'watcherId']) && typeof body.watcherId === 'string') return service[body.action](body.watcherId);
    if (body.action === 'reconcile' && exact(body, ['action', 'watcherId', 'eventId'])) return service.reconcile({ watcherId: body.watcherId, eventId: body.eventId });
    throw new Error('Invalid Loop file source request');
  });
}
module.exports = { registerLoopFileWatcher };
