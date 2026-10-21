# NEKODEX Browser Companion (development artifact)

This Manifest V3 extension for Chrome and Firefox 153+ shares one explicitly selected page with the
fixed local NEKODEX host while its dedicated selected-tab session remains open. It is a source artifact;
it has not been published, installed in your browser, or verified against a real
account by the fixture tests.

Review [the protocol and privacy contract](../docs/design/browser-companion.md)
before loading it. A trusted local app owner must create the private loopback
host, pin the extension ID, and display its one-time pairing JSON. There is no
public pairing-code endpoint and no automatic account sign-in.

When that local owner is configured, load this directory as an unpacked extension
in a development Chrome profile, invoke its action on an ordinary web page, pair,
and choose **Select current tab and connect**. The manifest `key` fixes its Chrome
ID to `bocnhdmjkjcoedkephdeoeipmmfbanpc` on every path and NEKODEX version, and NEKODEX
accepts only that Chrome ID; after an update, load the new directory the same way.
Firefox keeps its stable add-on ID `browser-companion@nekodex.local`.
The local host is fixed to `http://127.0.0.1:17843`; changing it requires reviewing
the manifest permission, CSP, popup code and backend validation together.

Selection opens an inactive extension session tab through a one-time handoff; the
selected web page stays active. The toolbar popup may then close while NEKODEX
continues using that exact document. Closing the session stops polling; reload
cannot resume a consumed handoff. Stop sharing revokes the pairing. Another tab
or document requires a fresh explicit selection. A same-document SPA URL change
can be inspected after Send, but input on that changed URL requires explicit
selection. Page text and URLs are never written to persistent storage; the token
and minimal selected binding live only in browser session storage. Images are
captured only for an explicit includeImage observation, with selected active tab
and document checks on both sides of capture; oversized images are omitted.
DOM click success confirms input execution, not website acceptance.

**ChatGPT send.** After the selected tab is a `https://chatgpt.com` new chat and you
click **Bind ChatGPT tab** in NEKODEX (stating the model that tab visibly has selected),
the existing NEKODEX ChatGPT turn owner may send Browser-only text turns through this
tab, but only those that opt in: Local API Chat Completions requests with the
`X-NEKODEX-Companion-Account` header naming the bound account fingerprint. All
other work keeps using the NEKODEX built-in browser. Each send re-checks the signed-in account digest, the visible model label and an
empty new chat, types the prompt once, clicks Send once, and returns the message ID.
NEKODEX then only reads the answer that follows that message. A send without a
terminal receipt is held in NEKODEX and never resent. Open a new chat in the tab
before each further message.

See [PRIVACY.md](PRIVACY.md). Store packages are produced by
`bun run scripts/build-browser-companion.ts <chrome|firefox> <new-output-directory>`;
the archive has `manifest.json` at its root and contains only shipped files. The
Chrome archive omits the development `key`: a Chrome Web Store listing (not
published yet) would get its own store-assigned ID, different from the unpacked one.
