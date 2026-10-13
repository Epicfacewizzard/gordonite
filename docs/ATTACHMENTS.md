# Photos, PDFs and other files

Notes can hold images, PDFs and other documents. They show inside the note (an image is drawn, a PDF or document is a
card that opens it), they are searchable by name, and the assistant can list, read and add them.

## Using it

* **In a note:** tap the paperclip in the toolbar and choose photos or files (on a phone this includes the camera).
  You can also paste a screenshot or drop files onto the note on a computer. The files go up first, and then appear in
  the note as **one** undoable step. A note never ends on a file; a line is left below to keep writing.
* **Taking one out:** the **×** on a file removes it from the note (undoable). That does **not** delete the file.
* **The Files page** (Settings → Files, `#/files`) lists everything stored: search by name, filter by kind (images,
  PDFs, other), show only files not in a note yet, open, download, or remove. Files added there without a note are the
  in-app inbox: later you, or the assistant, can put them in a note.
* **Removing** a file on the Files page hides it everywhere. Notes that showed it then show it as missing. The bytes
  stay on disk and the database row is only marked removed (nothing purges them automatically).
* **Photos from an iPhone (HEIC/HEIF)** are converted to JPEG when they are added, so they show in any browser. The
  original is kept and can be downloaded ("Original" on the Files page).
* **Limits:** 100 MB per file (`MAX_UPLOAD_MB`). The assistant can read files up to 25 MB.

## What is accepted

What a file *is* comes from its bytes, never from its name or the type the sender claims.

| Kind | Types | In the note |
|---|---|---|
| image | JPEG, PNG, GIF, WebP (and HEIC/HEIF, converted to JPEG) | drawn in place; tap to open full size |
| pdf | PDF | a card; opens in the browser's viewer |
| file | anything else (Word, Excel, text, audio, video, zip...) | a card; downloads |

SVG is deliberately **not** an image: it can carry script, so it is treated as an opaque download like any other file.
Files that are not images or PDFs are only ever served as `application/octet-stream` with `Content-Disposition:
attachment`, `nosniff` and a sandboxing `Content-Security-Policy`, so a stored page or script can never run from the
app's address.

## Where things are stored

* **Bytes:** `DATA_DIR/files/<first two hex>/<sha256>` (`FILES_DIR` to move it). A file is named by the SHA-256 of
  its content, so the same bytes are stored once however often they are added, a stored file is never rewritten, and
  damage is detectable.
* **Names and use:** the `attachments` table (schema v6): id, content hash, name, type, size, kind, the note that
  first saved a reference to it, where it came from (`upload`, `assistant`, `import`), and, for a converted photo,
  its original. The id is what notes refer to.
* **In a note:** an `attachment` block with `{ id, name, mime, size }`. This is document **format 2** (format 1 plus
  this block; every format-1 document is already valid). The server still accepts format 1, but an editor from before
  files existed cannot save over a note that has files (it would drop them without knowing); it gets a
  "reload the app" error and the note is untouched.
* **Which note owns a file** is set when a note that refers to it is first saved. It only drives the "in a note" label
  and filters; a file can be used by several notes.

## Backups

This matters: **the database backup does not contain the files.**

* The automatic and manual backups (`hq-*.sqlite`) and the JSON export hold the *list* of files (names, types,
  where used), not their bytes.
* The bytes are in the `files` folder beside the database. In the CasaOS setup that folder is inside the data
  folder that is mounted into the container, so it survives updates and recreating the container.
* To back files up: copy the `files` folder together with the database/backups, or use **Data → All files (zip)**
  (limit 1 GB per zip; beyond that, copy the folder). The Markdown export includes the files its notes use under
  `attachments/`, linked from the notes.
* Restoring a database backup does not change the `files` folder; the files and their rows line up again as long as
  the folder was kept. To check: `node server/cli.js check-files` (add `--hashes` to re-read every file and verify its
  content). It lists any file the database knows that is missing or damaged.
* Importing a JSON backup adds file *records* only for files whose bytes are already in this server's `files`
  folder; others are counted in the import report as `attachmentsMissingFiles` and skipped.

## The assistant

With the assistant key on (see [ASSISTANT.md](ASSISTANT.md)):

| Request | What it does |
|---|---|
| `GET /api/assistant/attachments?q=&kind=&noteId=&unattached=1&limit=` | List files |
| `GET /api/assistant/attachments/:id` | One file's details |
| `GET /api/assistant/attachments/:id/content` | The bytes as base64 (up to 25 MB; `?original=1` for a converted photo's original) |
| `POST /api/assistant/attachments` `{ name, data (base64), noteId? }` | Store a file |
| `POST /api/assistant/notes/:id/attach` `{ attachmentId }` | Put a stored file at the end of a note |

In the Markdown the assistant reads and writes, a file is `![name](gordonite-file:ID)` (image) or
`[name](gordonite-file:ID)` (anything else), alone on its line. `get_note` also lists the note's `attachments`.
Writing such a line back (`append_note`, `create_note`...) places the file with that id, if it exists.

The MCP bridge adds `list_files`, `get_file` (images come back as images, PDFs as documents), `attach_file`, and, for
a folder named in the private config file as `"inboxDir"`: **`list_inbox`** and **`upload_file`**. The inbox tools can
only ever read inside that one folder (no `..`, no absolute paths outside it, no links out of it) and are the way an
agent takes new PDFs and photos from a drop folder into Gordonite. See [MCP.md](MCP.md).

## Limits and known gaps

* PDFs are stored and shown, but their **text is not extracted or searched**; search finds a file by its name.
* No thumbnails or resizing: images are sent at full size and scaled by the browser. A multi-megapixel photo is a
  few MB per view; images load lazily.
* Uploads need the server (they are not queued while offline, unlike text). A failed upload says so and changes
  nothing; try again when connected.
* Removed files are hidden, not purged; there is no "restore removed file" button (the row can be un-hidden in the
  database). Orphaned bytes are never deleted automatically.
* Photo metadata (location, camera) inside a JPEG is kept as sent.
* The zips are built in memory; very large libraries should be backed up by copying the folder.
