# In-app updates — installed completion evidence

Completed on 2026-09-16 with installed NEKODEX `5.2.0-nekodex.9`.
Release source: `42bf855c602ae0b44ee684e771bbb9e14c05a692`.
Release workflow: https://github.com/Froraut/NEKODEX/actions/runs/35096605521
Release: https://github.com/Froraut/NEKODEX/releases/tag/v5.2.0-nekodex.9

The original reference image showed the macOS NEKODEX application menu. The completed implementation includes that entry point as well as the sidebar screen; the sidebar alone was not the full requested placement.

| Requirement | Authoritative observed result |
| --- | --- |
| Update entry in the pictured application menu | The installed native macOS menu exposed About NEKODEX, then Check for updates…, followed by Services and the standard hide/quit commands. |
| Updating UI | Selecting the native menu action opened the installed Updates screen. Its heading moved from Checking GitHub… to You're up to date, with installed version 5.2.0-nekodex.9 and the Check for updates button. |
| Discover the latest compatible GitHub release | The installed .7 controller offered published .9 through its actual Updates screen. The native .9 menu subsequently completed its own current-version check. |
| Download instead of manually reinstalling a DMG | The installed .7 Download and restart button downloaded the .9 ZIP. No archive was manually downloaded or copied into its cache for this transition. The observed updater phases included downloading and installing. |
| Verify and install the package, then restart | The native updater's journal recorded: 12:47:10 UTC waiting for launcher PID 16696; 12:47:19 UTC v5.2.0-nekodex.9 committed after launcher and runtime readiness. This was the application's own update transaction, not the separate bootstrap used for .7. |
| Usable replacement | The installed bundle and native UI showed .9; the new gateway PID 54631 reported .9 and accepted requests. A real native request returned exactly NEKODEX_UPDATE_READY after the update. This does not prove large-context compaction. |
| Preserve normal app state | The installed UI still reported Signed in to ChatGPT and retained the existing profile. The operation replaced the application bundle; no login/profile reset or global route change was performed. Active HTTP/browser work was drained to zero before the update. |
| Cleanup | The .9 completed download cache was removed after commit. No update-recovery directory or app swap leftovers remained. Temporary development instances/profiles were removed. |

## Source-level safeguards and focused development evidence

- Existing publisher metadata, ZIP digest, application identity and transactional readiness/rollback checks remain on the install path.
- Packaged identity uses persisted fork metadata, not electron-builder's stripped development-only build section. That defect was discovered during the earlier real .5-to-.6 attempt and fixed in .7.
- The GitHub anonymous quota fallback authenticates signed metadata after public feed discovery; a real quota-exhausted lookup succeeded during development.
- Available candidates can be refreshed after the existing cooldown. One focused controller regression passed, and the source Electron UI showed both check and install controls.
- The native menu action was checked in a real isolated Electron source run before release. Its renderer-startup request is represented by a monotonic revision rather than a destructively consumed flag.
- Existing successful checks were reused; no full repository/package suite was run for this completion pass. .8 was cancelled before publication and its changes were included in .9.

The separate large-context native compaction incident remains unresolved. Completion here applies to the requested in-app update feature and its installed native-menu entry, not to that incident or the PageSpeed work continued in another task.
