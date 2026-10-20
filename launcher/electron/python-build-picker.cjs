'use strict';
const fs = require('node:fs');
const { parsePythonBuildScope, parsePythonBuildConfig } = require('./python-build-selection-contract.cjs');

/** Main supplies native paths directly to the immutable selection owner. Renderer
 * receives only its bounded summary; choosing files never prepares or runs code. */
function createPythonBuildPicker({ dialog, getWindow, service }) {
  let pending = false;
  const open = options => {
    const window = getWindow?.();
    return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
  };
  async function optionalWheels(title) {
    const options = { type: 'question', title, message: title,
      detail: 'Select local wheel files for the offline build, or continue without additional wheels.',
      buttons: ['Select wheels', 'No additional wheels', 'Cancel'], defaultId: 0, cancelId: 2 };
    const window = getWindow?.();
    const choice = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
    if (choice.response === 2) return null;
    if (choice.response === 1) return [];
    const selected = await open({ title, properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Python wheels', extensions: ['whl'] }] });
    if (selected.canceled) return null;
    if (!selected.filePaths.length || selected.filePaths.length > 16) throw new Error('Select between one and sixteen wheel files');
    return selected.filePaths;
  }
  return async function pick(scopeInput, configInput) {
    if (pending || !dialog || !service) throw new Error('Python build picker is unavailable');
    const scope = parsePythonBuildScope(scopeInput), config = parsePythonBuildConfig(configInput);
    pending = true;
    try {
      const selected = await open({ title: 'Select Python source folder or source archive',
        properties: ['openFile', 'openDirectory'] });
      if (selected.canceled || selected.filePaths.length !== 1) return { cancelled: true };
      const sourcePath = selected.filePaths[0];
      const stat = fs.lstatSync(sourcePath);
      const kind = stat.isDirectory() ? 'tree' : /\.tar\.gz$/i.test(sourcePath) ? 'tar.gz' : /\.zip$/i.test(sourcePath) ? 'zip' : null;
      if (!kind) throw new Error('Select a source folder, ZIP or tar.gz archive');
      const buildWheelPaths = await optionalWheels('Select build backend and build dependency wheels');
      if (buildWheelPaths === null) return { cancelled: true };
      const runtimeWheelPaths = await optionalWheels('Select runtime dependency wheels');
      if (runtimeWheelPaths === null) return { cancelled: true };
      const selection = await service.register(scope, { source: { kind, path: sourcePath }, buildWheelPaths, runtimeWheelPaths, config }, true);
      return { cancelled: false, selection };
    } finally { pending = false; }
  };
}
module.exports = { createPythonBuildPicker };
