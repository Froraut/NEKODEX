'use strict';

// This dependency-free validator is shared by Electron and the Bun API/bridge.
// Limits match the existing ToolJournal; a public DTO never grants execution.
const VM_EXPORT_LIMITS = Object.freeze({ toolCallId: 200, idempotencyKey: 240, requestBytes: 64 * 1024, outputBytes: 16 * 1024 * 1024, rows: 64 });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

function exact(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new TypeError('Invalid VM export request');
}
function identity(value, maximum) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
}
function parseVmExportTaskScope(value) {
  exact(value, ['taskId', 'generation']);
  if (typeof value.taskId !== 'string' || !UUID.test(value.taskId) || !Number.isSafeInteger(value.generation) || value.generation < 1) throw new TypeError('Invalid VM export scope');
  return { taskId: value.taskId, generation: value.generation };
}
function parseVmExportRequest(value) {
  exact(value, ['scope', 'tool', 'arguments', 'idempotencyKey']);
  exact(value.scope, ['taskId', 'generation', 'toolCallId']);
  const task = parseVmExportTaskScope({ taskId: value.scope.taskId, generation: value.scope.generation });
  exact(value.arguments, ['reviewId', 'reviewDigest']);
  if (value.tool !== 'vm-shell/export' || !identity(value.scope.toolCallId, VM_EXPORT_LIMITS.toolCallId)
    || !identity(value.idempotencyKey, VM_EXPORT_LIMITS.idempotencyKey)
    || typeof value.arguments.reviewId !== 'string' || !UUID.test(value.arguments.reviewId)
    || typeof value.arguments.reviewDigest !== 'string' || !HASH.test(value.arguments.reviewDigest)) throw new TypeError('Invalid VM export request');
  return { scope: { ...task, toolCallId: value.scope.toolCallId }, tool: value.tool,
    arguments: { reviewId: value.arguments.reviewId, reviewDigest: value.arguments.reviewDigest }, idempotencyKey: value.idempotencyKey };
}

module.exports = { VM_EXPORT_LIMITS, parseVmExportTaskScope, parseVmExportRequest };
