# Sign in using an existing Google Chrome profile

The `5.1.0-froraut.2` candidate adds a separate sign-in option for a normal Google Chrome
profile that already has a ChatGPT session. It performs one local transfer of ChatGPT/OpenAI
cookies into the launcher, then disconnects from Chrome. Ordinary application work continues
in the launcher's own browser. It does not create a fresh Chrome profile or copy the browser's
profile directory, passwords, bookmarks, history or other sites' cookies.

## User steps

1. Open the Chrome profile you want to use and confirm that ChatGPT is signed in there. With
   several Chrome profiles, bring the intended profile forward first: Chrome's consent server
   chooses the last-used loaded regular profile.
2. In that Chrome window, manually open `chrome://inspect/#remote-debugging` and enable the
   remote-debugging connection option. Chrome 144 or newer is required. The launcher provides
   the address to copy; it does not navigate to this internal page or change Chrome preferences.
3. Choose the launcher's existing-Chrome sign-in option and review its local import consent.
   Chrome then displays its own generic connection-permission dialog. Allow the connection
   you just requested if you want to proceed. The Chrome dialog does not identify this client
   by the FroRaut name.
4. Wait for the launcher to import and verify the session. The importer creates one temporary
   hidden blank page in the existing profile. Its lifetime is bound to this debugging connection;
   it is removed on cleanup or disconnection. The importer does not close, restart or clear Chrome.

An existing valid session can avoid another password or passkey entry. Cookie presence alone
does not prove authentication, and ChatGPT or Cloudflare may require renewed verification.
The launcher reports success only after its embedded browser confirms authentication and
account capabilities. A missing Chrome connection, denied permission or rejected session is
an explicit error, not an automatic fallback to another profile or account.

After the one-time import disconnects, the imported app session no longer depends on Chrome's
debugging connection. You can turn that Chrome option off manually when other tools do not
need it. The app does not change the setting on your behalf.

## Access boundary

Chrome's permission grants a debugging connection broad capabilities over the chosen profile.
The importer narrows its own implementation to fixed commands: browser-version inspection,
creation/attachment of one owned hidden blank page, URL-filtered cookie retrieval for ChatGPT/OpenAI,
and cleanup. It does not expose a general CDP proxy through launcher IPC, accept arbitrary
methods or URLs, enumerate other tabs, read page DOM or localStorage, or ask for all browser
cookies. The transferred Playwright state has `origins: []`.

The loopback WebSocket endpoint is discovered from Chrome's bounded `DevToolsActivePort` file.
It never uses a remote host, follows a redirect or calls `/json/version` to discover a token.
Chrome waits for the user's permission before completing the WebSocket upgrade. Requests,
responses, retained bytes, deadlines and cancellation are bounded; cookie values and the
debugging endpoint are excluded from progress, errors and logs. Temporary transfer files
remain local and are removed by the owned import cleanup.

The separate-profile passkey flow remains available. Its profile is intentionally isolated;
choosing that alternative does not reuse an existing Chrome account.

## macOS 27: grant access to the connection file

The tested macOS 27 build denied automatic access to Chrome's connection descriptor even though
Chrome remote debugging was enabled. Apple documents new default-denied protections for other
apps' data; adding a privacy usage-description string does not itself authorize that access.
[macOS 27 release notes](https://developer.apple.com/documentation/macos-release-notes/macos-27-release-notes)

Starting with **5.1.0-froraut.4**, the specific `chrome-profile-access-denied` error offers a native
single-file selection path. Select only `DevToolsActivePort` at Chrome's expected location.
The picker grants the installed app access to the selected resource. The same Electron main
process reads at most the bounded connection descriptor and validates the exact path, file type,
owner and endpoint. It passes the descriptor privately to its helper, without placing it in
arguments, environment variables, renderer state or logs. No Chrome profile directory is copied.

This is an explicit system-mediated file grant, not a change to Full Disk Access. Apple describes
native open panels for individual resources belonging to other apps. Dynamic file grants are
not automatically inherited by spawned helpers, which is why the selecting main process must
read and transfer the data itself. No persistent MAS-only security-scoped bookmark is assumed.
[Apple's app-data privacy guidance](https://developer.apple.com/videos/play/wwdc2023/10053/?time=466),
[Apple's sandbox inheritance guidance](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html)

Selecting this file does not replace Chrome's separate native connection approval. If macOS
still denies the selected file, the app must report that outcome and leave the OS protection
unchanged. A successful real file-selection grant and authenticated import need their own live
evidence; the supported mechanism and its local tests do not guarantee every macOS 27 policy
allows the operation.

The selected-file implementation passed 47 focused core tests (265 assertions) and 231 launcher
tests, both typechecks, version consistency and the production renderer/runtime build. The
native picker itself remains an explicit user action; its injected tests do not grant access to
the user's protected Chrome file. Selected data travels only through the private helper stdin;
invalid, missing, cancelled or late data never falls back to an ungranted filesystem read.

The macOS pre4 package and relocated runtime smoke also passed, as did the native UI test with
animation frames disabled. The installed app visibly reports 5.1.0-froraut.4, preserves prior
preferences, and opens the native picker in Chrome's expected directory after the actual denied
discovery result. User confirmation of the selected file and the subsequent authenticated import
were still pending at this publication checkpoint.

- pre4 ZIP SHA-256: `0e7f331db555852e85e2ba88bf9a6a2bd23d10f9656f0c13fb26a32003d02961`
- pre4 installed ASAR SHA-256: `2625bad942f39cde35ca6dc6162f2be35f77a60b64daa62ce8526c25ef737e1c`
- pre4 runtime bundle: `1de1a09389d9c13b8d8579dc3489a684817a0580e7a8a8c89324d2145b1754fc`

## Verification and provenance

The `5.1.0-froraut.2` implementation passed **48 focused core tests / 262 assertions** and
**226 launcher tests**, covering the new importer/control protocol, existing login regressions,
ownership, native-consent results, renderer controls, localization and IPC wiring. The core
importer subset contains 18 tests using a real local WebSocket transport with simulated Chrome
protocol responses. Two independent reviews checked transport and launcher lifecycle boundaries.
Both typechecks, version consistency, production renderer/runtime builds, the macOS package
build, `PACKAGED_LAUNCHER_SMOKE_OK darwin/arm64` and `RELOCATABLE_RUNTIME_SMOKE_OK` passed.

The verified macOS package was installed after preserving the previous app and its private
profile. Strict deep signature verification passed; it remains a locally ad-hoc-signed build,
not a Developer ID/notarized distribution. Archive and installed ASAR checksums matched:

- ZIP SHA-256: `0e41234e9441ae84af5965259603d2236cb44959da46933f21cbfbf2b58dc399`
- Installed ASAR SHA-256: `80c89c7f8138ffd7383413dbcc469ae719bbefd2d08295cb1bed7f0f9dc26e3b`
- Runtime bundle identity: `9c8dd9e4520cad41bd74f1f594a90af291d64100c9be67502cc79101c309bc14`

The green cross-platform CI for `d29ee40` covers `5.1.0-froraut.1`, before this option was added;
the new source receives its own CI run. A real existing-profile transfer must additionally record
user-granted Chrome access and confirmed embedded authentication. At this checkpoint no real
Chrome permission or cookie transfer has been performed by the new importer. Fixtures and the
presence of an already signed-in ordinary Chrome account cannot establish that result.

The protocol follows primary upstream sources:

- [Chrome 144+ existing-session permission flow](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session).
- [Chrome DevTools MCP connection implementation](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/d9a8cb6ec22aadf5cb964c5e97a8b047693046e2/src/browser.ts).
- [Chromium permission-gated WebSocket handling](https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/devtools_http_handler.cc).
- [Chromium's default browser-context selection](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/devtools/devtools_browser_context_manager.cc).
- [Chrome 144 hidden-target session lifetime](https://chromium.googlesource.com/chromium/src/+/144.0.7559.96/content/browser/devtools/protocol/hidden_target_manager.h).
- [CDP `Network.getCookies` URL filtering](https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-getCookies).

These references describe the supported mechanism. They are not evidence that the current
user has enabled it, granted a connection or successfully imported a session.
