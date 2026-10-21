# macOS desktop helper: TCC grants across updates

This explains why a Screen Recording or Accessibility grant for
**NEKODEX Desktop Helper** keeps working after an update, why one stopped
working on 6.1.33-nekodex.10, and what the runtime does so it does not happen
again. The full provider design is in
[macos-desktop-provider.md](macos-desktop-provider.md#permission-identity-across-updates).

## How TCC matches the helper

A TCC row is keyed by service and client. For the helper the client is the
bundle identifier `dev.nekodex.desktop-provider.v1` (`identifier_type=Bundle
ID`), and each row stores one code requirement (`csreq`). On every check tccd
compares the running helper's signature against that stored requirement. The
bundle's path is not part of the match.

Two things follow:

- **Path does not matter.** On 2026-10-21 the Screen Recording grant made for
  the 6.1.33-nekodex.8 copy also applied to the .10 copy (other path, other
  cdhash). A signed copy at a path that had never been granted (a scratch
  directory) also read as granted. Replacing the bundle in place with the same
  identifier and designated requirement therefore keeps the grant.
- **The stored requirement does matter, and toggling never rewrites it.** The
  row keeps the requirement of whichever build created it (through the `+`
  button or a first permission request). Switching the toggle off and on only
  changes the allowed value. tccd logs this as
  `Failed to match existing code requirement for subject … and service …`,
  followed by the stored requirement and then the subject's own.

## What broke on 6.1.33-nekodex.10

The tccd log for the .10 helper showed, for `kTCCServiceAccessibility`, a
stored requirement `cdhash H"8ae1d2f6…"`, an ad-hoc DEV build, against the
subject's Developer ID requirement. DEV builds were signed ad hoc but carried
the release identifier, so a DEV build had created the Accessibility row with
its own cdhash. No signed release can match that row, whatever its path, while
System Settings shows it switched on. (On .8 Accessibility had read as granted
only because tccd was still judging NEKODEX.app; #139 fixed that attribution.)
The Screen Recording row held the Developer ID requirement and kept working.

A second probe showed that the location matters in one other way. A copy of the
signed helper inside `/Applications/NEKODEX.app/Contents/…` was judged as
`dev.codexwebgpt.launcher` (NEKODEX itself) for Screen Recording, even though
it was its own responsible process: tccd attributes code inside an app bundle to
the outermost app. The helper must not run from inside NEKODEX.app.

## What the runtime does now

- **Separate DEV identity.** Ad-hoc builds carry
  `dev.nekodex.desktop-provider.development.v1` and are named
  "NEKODEX Desktop Helper (Development)". Signing refuses an ad-hoc signature
  on the release Info.plist and a Developer ID signature on the DEV one, so a
  DEV grant can no longer create or occupy the release row.
- **One stable location.** An installed runtime copies its own verified helper
  bundle to

  `~/Library/Application Support/NEKODEX/Desktop Helper/NEKODEX Desktop Helper.app`

  and runs it from there. The copy is byte-identical (same signature, same
  designated requirement). Before every helper start the runtime checks it
  again: an equal copy is left alone, a different one (a newer or older
  version, or damage) is replaced by an atomic rename. The path is outside
  NEKODEX.app and outside `~/.codex-chatgpt-web/versions/`, so it never moves
  and is never pruned. The DEV source CLI keeps its checkout path.
- **The confirmation alert.** "Allow NEKODEX desktop control?" is the helper's
  own `CFUserNotification` alert, not a TCC prompt; it changes nothing in System
  Settings. It exists because any same-user process could start the helper and
  so borrow its grants. The answer now lasts for the life of that helper process
  (a repeated enable on the same process no longer asks), and is never
  persisted: a stored answer would be just as available to whoever starts the
  helper next. "Disable and release desktop access" and a restart end the
  process, so the next enable asks again.

## One-time repair after installing this change

1. Open NEKODEX → Agent tools and choose **Inspect permissions** once. That
   places the helper at the stable path; the panel shows the path.
2. In System Settings → Privacy & Security → Accessibility (macOS 27: Device
   Control and Data Access), select **NEKODEX Desktop Helper** and remove it
   with **–**. A toggle cannot repair the stale row. (Equivalent from a
   terminal: `tccutil reset Accessibility dev.nekodex.desktop-provider.v1`.)
3. Click **+**, press Command-Shift-G, paste
   `~/Library/Application Support/NEKODEX/Desktop Helper/NEKODEX Desktop Helper.app`
   and add it. Make sure it is switched on.
4. Screen & System Audio Recording already holds the correct row; leave it on.
   If it is missing, add the same path there.
5. In NEKODEX → Agent tools, choose **Disable and release desktop access**,
   then **Inspect permissions**. All three should read granted.

Later signed updates keep these rows. Old entries for NEKODEX, a terminal or
"NEKODEX Desktop Helper (Development)" are not used by releases.
