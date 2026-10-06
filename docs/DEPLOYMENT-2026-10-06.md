# CasaOS deployment record — 2026-10-06

## Changes delivered

Runtime release: Git commit `120a3ef` on `main`, pushed to GitHub.

- Clicking task text on Today or Tasks opens an inline Tiptap editor. Only the right arrow opens task details.
- Edits update the original task inside its note through the existing durable pending-edit and conflict-preserving save path. Nested tasks and formatting remain intact.
- Task drag handles sit in the left gutter outside the coloured strip and are aligned higher. Moves retain task IDs and undo support.
- `mcp-bridge.md` explains the existing authenticated assistant bridge, setup, limitations, and confirmation before trashing notes.
- `scripts/import-vault.js` provides a repeatable merge import with a dry-run report.

## Obsidian transfer

Imported the previously selected `00 Inbox`, `05 People`, `10 School`, and `20 CSS` folders: **109 notes and 25 new tags**. Existing notes were preserved; a subsequent dry run found 109 unchanged notes and no new notes. The server now has **110 notes and 26 tags**. The vault was not modified.

Hidden files, agent instruction files, and symlinks were excluded. This is a Markdown import, not a complete Obsidian migration. Some unsupported constructs remain readable text. Source copies and transfer reports are local under ignored `data/vault-transfer-*`; personal content is not in Git.

Pre-import backup: `/DATA/AppData/gordonite/data/backups/hq-preimport-20261006-162502.sqlite`.

## Server configuration retained

| Item | Value |
| --- | --- |
| URL | `http://192.168.1.50:8082` |
| SSH user | `gordon` |
| Container / Compose service | `gordonite` |
| Compose file | `/home/gordon/gordonite/deploy/gordonite-casaos.yml` |
| Persistent host directory | `/DATA/AppData/gordonite/data` mounted at `/data` |
| Container user | `1000:1000` |
| Restart policy | `unless-stopped` |
| Port | host 8082 → container 8080 |
| Release directory | `/home/gordon/gordonite/releases/120a3ef` |
| Release image | `gordonite:120a3ef`, also tagged `gordonite:0.1.0` |
| Rollback image | `gordonite:rollback-20261006-1631` |

The existing Compose configuration, assistant token, data mount, and network access were retained. Other containers were not changed. Access remains LAN/WireGuard; no port forwarding or tunnel was configured.

SSH host trust was verified against the public host key retrieved through authenticated CasaOS, then pinned locally. ED25519 fingerprint: `SHA256:oRK/1hCHHHMhjgvySWWiySoOCWlfu1X1Ma+Ix3fCIdY`. Passwords and tokens must not be recorded here.

## Update procedure used

1. Created a consistent verified database backup and tagged the previous image for rollback.
2. Transferred `git archive` of `120a3ef` to the release directory, without private local data.
3. Verified archive SHA-256: `1b92bd52b5804bbcc5f500e720322e6a00c82cc12cf8bca51ed3e58f243c1f0c`.
4. Extracted the release and built the Dockerfile on the server.
5. Recreated the existing Compose service using its unchanged configuration:

```bash
sudo docker build -t gordonite:120a3ef /home/gordon/gordonite/releases/120a3ef
sudo docker image tag gordonite:120a3ef gordonite:0.1.0
sudo docker compose -f /home/gordon/gordonite/deploy/gordonite-casaos.yml up -d --no-build --pull never --force-recreate gordonite
```

Running image: `sha256:de55d3b155fd715d5f854686e572f13a5fb2e8d31ccd06438d61b0833dee43e93`.

## Verification

- Unit/integration suite: 83/83 passed, covering persistence, interruption recovery, conflict preservation, backup/export/import, restore, and MCP.
- Focused task/note browser tests: 18/18 passed; final inline-edit and note-movement tests: 2/2 passed.
- Production client build succeeded locally and Docker build succeeded on CasaOS.
- Container reports `healthy`; HTTP `/api/health` returns `ok: true`.
- Deployed asset `/assets/index-DA4YHMaZ.js` includes the inline editing feature.
- Browser check on the deployed Tasks page: clicking task text opens the inline editor, and Done closes it. No real task text was modified for this check.
- MCP ping succeeded after deployment: home date `2026-10-06`, timezone `America/Edmonton`.
- Verified backups before and after deployment both report 110 notes, 26 tags, no trash, no versions, schema v4.

Before-update backup: `/DATA/AppData/gordonite/data/backups/hq-manual-20261006-163109.sqlite`.

After-update backup: `/DATA/AppData/gordonite/data/backups/hq-manual-20261006-163507.sqlite`.

Copying the after-update private backup to the ignored local `data/` directory for a separate restoration drill is awaiting explicit destination approval after automatic review blocked the transfer. The server backups are verified; an off-server copy and a restoration drill using this actual server snapshot are not yet completed. Automated restoration tests passed against test data. See [BACKUPS.md](BACKUPS.md) for retention and disaster recovery instructions.

## Rollback

For an application rollback, keep the existing database mount and retag the saved image, then recreate:

```bash
sudo docker image tag gordonite:rollback-20261006-1631 gordonite:0.1.0
sudo docker compose -f /home/gordon/gordonite/deploy/gordonite-casaos.yml up -d --no-build --pull never --force-recreate gordonite
```

Do not replace the live database merely to roll back the app. This release uses the same schema v4. If a database restore is required, stop the app first and follow the documented restore procedure with a verified backup.

## Remaining device checks

Actual Samsung S24 keyboard, touch dragging, autocorrect/composition, and interrupted-connection editing must still be tested on the real device. Desktop browser checks do not establish those behaviours. The current server address uses HTTP; the stable HTTPS setup remains a separate follow-up. A configurable dashboard remains future work.
