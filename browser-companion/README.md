# NEKODEX Browser Companion (development artifact)

This Manifest V3 Chrome extension shares one explicitly selected page with the
fixed local NEKODEX host while its popup remains open. It is a source artifact;
it has not been published, installed in your browser, or verified against a real
account by the fixture tests.

Review [the protocol and privacy contract](../docs/design/browser-companion.md)
before loading it. A trusted local app owner must create the private loopback
host, pin the extension ID, and display its one-time pairing JSON. There is no
public pairing-code endpoint and no automatic account sign-in.

When that local owner is configured, load this directory as an unpacked extension
in a development Chrome profile, give its exact ID to the owner, invoke its action
on an ordinary web page, pair, and choose **Select current tab and connect**.
The local host is fixed to `http://127.0.0.1:17843`; changing it requires reviewing
the manifest permission, CSP, popup code and backend validation together.

Closing the popup stops its polling. Stop sharing revokes the pairing. Another
tab/navigation requires a fresh explicit selection. Page text and URLs are never
written to persistent storage; the token lives only in browser session storage.
DOM click success confirms input execution, not website acceptance.
