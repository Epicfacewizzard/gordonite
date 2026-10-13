// Files attached to notes (images, PDFs and other documents): what the app accepts, how a file is named
// and shown, and how a note document points at one. Shared by the server, the editor and the assistant bridge.
// See docs/ATTACHMENTS.md.

// Images the browser can show everywhere. HEIC/HEIF is accepted too but converted to JPEG on upload
// (the original is kept). SVG is deliberately not an image here: it can carry script.
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export const PDF_TYPE = 'application/pdf';

export const isImageType = (mime) => IMAGE_TYPES.includes(mime);

/** 'image' (shown in the note), 'pdf' (opens in the browser's viewer) or 'file' (downloaded). */
export function kindOfType(mime) {
  return isImageType(mime) ? 'image' : mime === PDF_TYPE ? 'pdf' : 'file';
}

const MAX_NAME = 200;

/** A safe display name: one line, no folders, no control characters, at most 200 characters. */
export function cleanFileName(value, fallback = 'file') {
  let name = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  name = name.replace(/^\.+/, '');
  if (name.length > MAX_NAME) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
    name = name.slice(0, MAX_NAME - ext.length) + ext;
  }
  return name || fallback;
}

/** "1.4 MB", "820 KB", "12 B". */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** Where the browser fetches a file's bytes. */
export const fileHref = (id) => `/api/attachments/${id}/file`;

// How the Markdown the assistant reads and writes refers to a file: ![name](gordonite-file:ID) for an image,
// [name](gordonite-file:ID) for anything else. The id is the attachment's id.
export const FILE_SCHEME = 'gordonite-file:';
export const fileRef = (id) => `${FILE_SCHEME}${id}`;
export const FILE_REF_LINE = /^\s*!?\[([^\]]*)\]\(gordonite-file:([A-Za-z0-9_-]{8,64})\)\s*$/;

const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,60}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,100}$/i;
export const isPlausibleMime = (mime) => typeof mime === 'string' && MIME_RE.test(mime);
