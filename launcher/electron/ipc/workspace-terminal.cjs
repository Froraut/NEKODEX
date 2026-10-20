"use strict";

/** Sender/lifecycle authorization is supplied by main. A path is never accepted
 * over this IPC boundary; resolveGrant is the picker service's validating port. */
function registerWorkspaceTerminalIpc({ registerIpcHandler, service, resolveGrant }) {
  const id = (value) => {
    if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value)) throw new Error("Invalid terminal identifier");
    return value;
  };
  const object = (value, keys) => {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).some((key) => !keys.includes(key))) throw new Error("Invalid terminal request");
    return value;
  };
  const reference = (value) => {
    object(value, ["id", "generation"]); return { id: id(value.id), generation: id(value.generation) };
  };
  const geometry = (value = {}) => {
    object(value, ["cols", "rows"]);
    if ([value.cols, value.rows].some((v) => v !== undefined && !Number.isInteger(v))) throw new Error("Invalid terminal dimensions");
    return { cols: value.cols, rows: value.rows };
  };
  const handle = (channel, action, min, max = min) => registerIpcHandler(channel, (_event, ...args) => {
    if (args.length < min || args.length > max) throw new Error("Invalid terminal argument count");
    return action(...args);
  });
  const grantFor = (ref) => {
    // Get workspace identity from the owned session, never from the request.
    const current = service.get(ref);
    return resolveGrant(current.workspaceId);
  };
  handle("launcher:terminal-availability", () => service.availability(), 0);
  handle("launcher:terminal-open", (workspaceId, size) => service.open(resolveGrant(id(workspaceId)), geometry(size)), 1, 2);
  handle("launcher:terminal-list", (workspaceId) => {
    const grant = resolveGrant(id(workspaceId)); return service.list(grant.id);
  }, 1);
  handle("launcher:terminal-read", (ref, cursor) => service.read(reference(ref), cursor), 1, 2);
  handle("launcher:terminal-write", (ref, data) => {
    const captured = reference(ref); return service.write(captured, data, grantFor(captured));
  }, 2);
  handle("launcher:terminal-resize", (ref, size) => {
    const captured = reference(ref); return service.resize(captured, geometry(size), grantFor(captured));
  }, 2);
  // Revoked grants still permit closing the exact child they originally created.
  handle("launcher:terminal-close", (ref) => service.close(reference(ref)), 1);
}

module.exports = { registerWorkspaceTerminalIpc };
