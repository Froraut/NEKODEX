# Finish-update restart button UI

The runtime update banner now treats restart as a single-flight action. The first click immediately marks the button busy, shows the existing localized restarting copy with a spinner, and disables further clicks. A successful IPC acknowledgement keeps the pending state until the app actually closes; a rejected IPC request restores the action.

The button is no longer disabled by the launcher's broad operation busy state, so a pending read-only inspection does not prevent the restart request from reaching the main process. Active tasks and login flows remain subject to the main-process quit policy.

If restart IPC rejects, the pending state clears while the banner and restart action remain available, and the existing launcher error UI keeps the rejection message. The renderer does not infer or display successful completion from local state; a successful restart is completed by the main process closing and reopening NEKODEX.

The initial sidecar used manual review. The parent subsequently completed the authorized focused Electron restart cases and systematic UI pass; see [integrated readiness evidence](ui-polish-restart-5.8.0-nekodex.3.md).
