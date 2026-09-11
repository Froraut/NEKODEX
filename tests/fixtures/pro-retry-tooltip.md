Pro retry tooltip evidence and validation
=======================================

Source: [upstream PR #432](https://github.com/miuuyy/codex-chatgpt-web/pull/432),
commit `5b8face7b97f066da8e5fe40fbfcc4d7c0e0a3c8`.

The author reports an exact `Pro` row with `role="menuitemradio"`, a slider range
of `0..3` while Pro is unavailable, and a hover-mounted portal containing
`Limit reached. Try again after Sep 15, 2026.` The upstream report does not supply
captured HTML, `role="tooltip"`, or accessibility ownership attributes.

The adjacent HTML fixture is synthetic. Its `aria-describedby` relationship,
tooltip role, IDs, portal structure, and competing conversation content test a
conservative attribution boundary; they do not claim to reproduce verified live
ChatGPT ownership markup. Unlinked portals intentionally produce no retry detail.

On September 11, 2026, a separate ephemeral headless Chrome session loaded only
this local fixture. Actual Playwright hover and browser visibility checks passed:

| Synthetic browser case | Result |
| --- | --- |
| Pro explicitly describes the hover-mounted visible tooltip | `Try again after Sep 15, 2026.` |
| Hover mounts a portal without the explicit relationship | No hint |
| Linked tooltip has `visibility: hidden` | No hint |
| Description points into conversation content | No hint |
| Only a preexisting unrelated tooltip and chat dates exist | No hint |

A follow-up browser check after requiring exactly one visible Pro row confirmed
that the unique linked row still returns its date, while duplicate visible Pro
rows return no hint and do not choose either control.

This was a browser fixture smoke test, not a live account test or installed
Codex integration acceptance. No account, stored browser profile, or network
ChatGPT session was used.
