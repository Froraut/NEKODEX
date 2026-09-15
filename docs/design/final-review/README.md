# NEKODEX final usability and identity review

## Product identity contract

NEKODEX is a calm local coding workspace: charcoal surfaces, lavender actions,
neutral secondary controls, and a single playful cat identity. Keep the current
cat artwork and icon. Product Design guidance and Creative Production's Styles
and source-preservation principles inform this pass; no replacement imagery or
creative board is needed for form consistency.

Use tokens.css as the palette/typography/shape source. Form fields share the
36px control minimum, 9px radius, 15px body type, and visible lavender focus ring.
Errors use pink plus explanatory text; status never depends on color alone.
Allow long text and account names to wrap. Keep one obvious next action.
Motion belongs only to the cat head, ears, eyes, mouth and paws.

## Review steps and evidence

1. Current installed Settings: valid screenshot in 01-settings-before.png.
   Clear sections, but fields differ in styling; accessibility tree exposes
   unnamed switches. Invalid capacity previously only disabled Save.
2. Updated development Settings: 02-form-validation.png. Invalid or empty
   capacity has an inline range explanation and invalid border, connected to
   the input via aria-describedby/aria-invalid. Save is disabled.
3. Keyboard submission: Enter saved 17 in disposable /tmp/nekodex-final-review;
   UI reported Active 16 / Saved 17 and explicitly explained restart. Production
   capacity and accounts were not changed. Switch names are exposed in AX.

## Applied improvements

- Unified account, MCP, activity, settings and capacity field styling, focus,
  disabled colors and wrapping. Existing layout breakpoints remain in effect.
- Capacity form supports Enter and distinguishes invalid, unsaved and saved.
  Save handler guards invalid, unchanged and busy submissions.
- Every Switch requires a localized accessible name, including the context dialog.
- Preference writes disable switches until completion and surface failures.
- Manual prompt countdown changes from four UI updates/second to one; hidden
  documents stop the interval and resume from real wall time. Listener/interval
  cleanup on unmount is explicit. No new animation loop or dependency added.

## Verification boundaries

Renderer typecheck and development build passed. Actual Electron form validation,
keyboard save and accessible labels were observed. Countdown lifecycle and form
failure paths were reviewed directly in source. This is a focused final review,
not a full accessibility certification, memory leak benchmark or backend retest.
Previous setup progression and responsive-workspace changes remain in place.
No network route, production credentials, model choice or active account changed.

## Typography follow-up

Shared scale: 15px body/connection/event text, 14px status/actions, 13px
secondary metadata, 17px section titles. Legacy 9–12px labels now use shared
tokens across launcher styles. Overview rows have 52px minimum height; narrow
connection cards place status below the label instead of shrinking text.
Development build passed and Connections was visually inspected at 900×650.
