# Background browser views after window enlargement

On19 October2026, enlarging the macOS development window while Client Usage was
selected exposed part of the embedded ChatGPT page at the lower right. This was
a native child-view placement defect. The separate Agent mode icon correction
replaces its ambiguous shared glyph with a dedicated robot.

Primary browser views deliberately remain drawable and attached outside the
window to preserve their descriptor/CDP identity. Running task views can also
remain drawable. Their hidden bounds were computed from the previous native
content size. The window owner listened only to show/hide/minimize/restore; on
non-browser pages React had already removed the browser-slot ResizeObserver.
Window enlargement could therefore expose a formerly offscreen child view.

BrowserHost now recomputes placement on native resize and fullscreen transitions.
The same event set is registered/unregistered during shell replacement and
destruction. Views, sessions, processes and leases keep their existing owners;
there is no page reload, observation request or model send in the resize handler.

The focused actual Electron `check-renderer-shell.cjs` scenario passed:

- Existing shell recreation retained the original browser process/session/draft.
- An inactive700×500 shell enlarged to1600×1000 kept both primary and running
  child views beyond its content bounds and drawable, preserving both processes
  and their drafts plus the shell's own draft.

The current macOS development core was gracefully stopped while its main endpoint
remained alive, then the old GUI was retired. The replacement kept the same
private application/account data. CUA reopened Client Usage and enlarged the
actual window through macOS Window→Zoom. Its inspected screenshot showed the
correct page without an overlaid ChatGPT view, and the new robot icon was visible.
The selected Codex source remained paused; no import, model or authentication
action was performed. The user-requested application remains open.

This proves the resize placement correction in source/DEV. It is separate from
installed `.8`, release delivery, generic renderer-document invalidation and
other application workflows.
