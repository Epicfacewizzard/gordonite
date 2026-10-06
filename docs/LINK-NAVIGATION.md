# Linked-note navigation fix — 2026-10-06

## Problem and change

Opening a `[[note link]]` navigated to the link resolver, then added the resolved note as a second history entry. Back revisited the resolver, which immediately redirected forward again, making the user appear stuck on the linked note.

Single-match resolution now replaces its temporary history entry. A chain A → B → C returns to B and then A with the header Back button. Browser Forward follows the same chain. Reloading a linked note retains this history behaviour.

The shared `go()` helper accepts an optional `replace` flag; other navigation still adds normal history entries. Missing and ambiguous links retain their resolver page so the user can read the message or choose a match. No note data, editor content, or saved links are rewritten.

## Checks

Production build passed. Four focused browser tests passed: a new three-note link chain checks Back, Forward, reload, and unchanged source documents; existing note-page tests check stream return, missing/trashed notes, and deletion navigation. Tests use disposable synthetic notes in a phone-sized Chromium context. Actual Samsung S24 testing remains separate.

The first test attempt was blocked by sandbox localhost restrictions; the same focused checks passed with localhost access enabled.

## CasaOS rollout

Code release `e222a06` was pushed to GitHub and deployed on the existing server at `http://192.168.1.50:8082`. Release directory: `/home/gordon/gordonite/releases/e222a06`; image: `gordonite:e222a06`, also tagged `gordonite:0.1.0`. The source archive was verified against SHA-256 `d67a5d0fd28fe124f9ab7c8d601b894398604820d53c88ebb353ccea8b40b181` before extraction.

Used the existing Compose file `/home/gordon/gordonite/deploy/gordonite-casaos.yml`, retaining the data mount, port, and assistant configuration. The old image is saved as `gordonite:rollback-before-e222a06`. To roll back, retag that image as `gordonite:0.1.0` and recreate the same Compose service with `--no-build --pull never --force-recreate`. Do not replace the database for an application rollback.

Before-update backup: `/DATA/AppData/gordonite/data/backups/hq-manual-20261006-164721.sqlite`.

After-update backup: `/DATA/AppData/gordonite/data/backups/hq-manual-20261006-164835.sqlite`.

Both verified backups contain 111 notes, 26 tags, two versions, and no trash (schema v4). The container reports healthy; MCP ping succeeds. A read-only live browser check opened a linked note and confirmed the header Back button returned to the original source note without revisiting the resolver. No note content was changed for this check.
