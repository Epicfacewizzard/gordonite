# Release notes

## 0.1.0 — 2026-10-06

Settings now displays “Gordonite · Version 0.1.0” at the bottom, using the version returned by the server configuration API. This is the application release version, not an individual Git commit number. Keep it aligned with `APP_VERSION` in the server when numbering future releases. A missing version displays “unavailable”.

Validation: production client build passed. Existing server configuration already provides the version; no database or settings migration is required.
