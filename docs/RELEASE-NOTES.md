# Release notes

## Unreleased — Tags page: collapsed parents and drag to move

The Tags page now opens with every parent collapsed. Dragging a tag by its grip puts it inside another tag (the target is highlighted), takes it back out (top-level bar or between tags at another level), or reorders it among siblings (a line shows the position). Moving renames the tag path of the tag and its children; notes, ids and favourites are unchanged. Manual order is stored in settings (`tag_order`) and exported/imported with settings. No schema migration. Validation: server and browser tests (`tests/server/tag-move.test.js`, `tests/e2e/tag-move.test.js`). Known limit: dragging uses a grip and needs a pointer or finger (no keyboard-only move yet). Not yet deployed.

## 0.1.0 — 2026-10-06

Settings now displays “Gordonite · Version 0.1.0” at the bottom, using the version returned by the server configuration API. This is the application release version, not an individual Git commit number. Keep it aligned with `APP_VERSION` in the server when numbering future releases. A missing version displays “unavailable”.

Validation: production client build passed. Existing server configuration already provides the version; no database or settings migration is required.

Deployed code commit `e4e47a7` to CasaOS with the existing Compose configuration and persistent data directory. Browser checks confirmed the label on both the local preview and server Settings page. Pre-update verified backup: `/DATA/AppData/gordonite/data/backups/hq-manual-20261006-165950.sqlite` (111 notes, 26 tags, two versions). Release directory/image: `/home/gordon/gordonite/releases/e4e47a7`, `gordonite:e4e47a7`; rollback image: `gordonite:rollback-before-e4e47a7`. Recreate the existing service after retagging the rollback image as `gordonite:0.1.0` if needed.
