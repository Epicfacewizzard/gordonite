# Linked-note navigation fix — 2026-10-06

## Problem and change

Opening a `[[note link]]` navigated to the link resolver, then added the resolved note as a second history entry. Back revisited the resolver, which immediately redirected forward again, making the user appear stuck on the linked note.

Single-match resolution now replaces its temporary history entry. A chain A → B → C returns to B and then A with the header Back button. Browser Forward follows the same chain. Reloading a linked note retains this history behaviour.

The shared `go()` helper accepts an optional `replace` flag; other navigation still adds normal history entries. Missing and ambiguous links retain their resolver page so the user can read the message or choose a match. No note data, editor content, or saved links are rewritten.

## Checks

Production build passed. Four focused browser tests passed: a new three-note link chain checks Back, Forward, reload, and unchanged source documents; existing note-page tests check stream return, missing/trashed notes, and deletion navigation. Tests use disposable synthetic notes in a phone-sized Chromium context. Actual Samsung S24 testing remains separate.

The first test attempt was blocked by sandbox localhost restrictions; the same focused checks passed with localhost access enabled.
