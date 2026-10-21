# NEKODEX Browser Companion privacy policy

Effective 21 October 2026. Applies to the NEKODEX Browser Companion extension for
Chrome and Firefox (version 0.2.0 and later), published from
[Froraut/NEKODEX](https://github.com/Froraut/NEKODEX).

## Summary

The extension connects **one browser tab that you explicitly select** to the NEKODEX
desktop application running on **your own computer**. It talks only to
`http://127.0.0.1:17843`, the fixed local NEKODEX address. It has no remote server,
no analytics, no telemetry, no advertising and no tracking. The developer receives
no data from the extension.

## What the extension accesses

Nothing is read until you pair the extension with a one-time code shown by NEKODEX
**and** click **Select current tab and connect** on a tab. After that, and only for
that selected tab and document:

- **Page content.** The page URL, title, visible text (up to 16,000 characters) and
  the labels of visible buttons, links and text fields. Password, file and hidden
  fields and form values are never read.
- **Screenshots.** Only when a NEKODEX task explicitly requests an image of the
  selected tab and you approve that request in NEKODEX. Ordinary reads are text only.
- **Input.** Typing into a text field or clicking a control on the selected tab, only
  when NEKODEX sends that exact action after your per-action approval.
- **ChatGPT send (optional).** Only after you separately click **Bind ChatGPT tab** in
  NEKODEX for a selected `https://chatgpt.com` tab:
  - The extension reads your ChatGPT session inside that page (the same request the
    page itself makes) and sends NEKODEX **only a one-way SHA-256 digest of your
    account's user ID**, so NEKODEX can detect an account change. Your access token,
    email address, name and cookies never leave the page.
  - It reads the visible model label, whether the chat is new and empty, and, after a
    send, the message you sent and the answer ChatGPT shows for it.
  - It types one NEKODEX prompt into the composer and clicks Send, once per task. A
    send whose result is unclear is never repeated.

The extension does not read other tabs, browsing history, bookmarks, downloads or
cookies, and it has no background script that watches your browsing.

## Where the data goes

All data described above is sent only to the NEKODEX application on the same
computer, over the loopback address `127.0.0.1:17843`. This destination is fixed in
the extension's host permission and content security policy and cannot be changed by
a website or a task. What NEKODEX then does with it is governed by your own use of
NEKODEX on your computer. When you use ChatGPT send, the prompt is submitted to
ChatGPT through your own signed-in chatgpt.com tab, exactly as if you had typed it;
OpenAI's terms and privacy policy apply to that conversation.

## Storage

The pairing token and the identity of the selected tab are kept in the browser's
**session** storage and are deleted when the browser closes, when you click
**Stop sharing** or **Forget pairing**, or when NEKODEX revokes the pairing. Page
text, screenshots, prompts, answers and URLs are never written to extension storage.

## Permissions

- `activeTab`: access only the tab on which you invoked the extension.
- `scripting`: run the extension's own bundled read/type/click/ChatGPT functions in
  that selected tab. No remote code is loaded or executed.
- `storage`: keep the session token in session storage.
- Host `http://127.0.0.1:17843/*`: reach the local NEKODEX application only.

## Your control

Close the extension's session tab, click **Stop sharing**, use **Unbind** in NEKODEX,
or remove the extension at any time. Each stops access immediately. NEKODEX never
installs the extension or pairs it automatically.

## Sale and sharing

The extension does not sell, transfer or share any data with third parties, and does
not use data for advertising, creditworthiness or any purpose other than the single
purpose above.

## Contact

Questions or concerns: open an issue at
<https://github.com/Froraut/NEKODEX/issues>.
