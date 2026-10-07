// Turn the tasks inside notes under some tags into plain bullet points, through the app's normal save route
// (revision-checked, so a note you edited in the meantime is skipped, and the old text is kept as a version).
// Dry run by default; add --apply to save. Usage:
//   node scripts/detask-notes.js <server-url> <tag> [<tag>...] [--apply]
// A ticked task keeps a leading "✓ ". Tags include their sub-tags.
import { randomUUID } from 'node:crypto';
import { validateDoc } from '../shared/doc.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const [address, ...tags] = args.filter((a) => a !== '--apply');
if (!address || !tags.length) throw new Error('Usage: node scripts/detask-notes.js <server-url> <tag> [<tag>...] [--apply]');
const server = new URL(address);
if (!['localhost', '127.0.0.1', '192.168.1.50'].includes(server.hostname)) throw new Error('Use the authorized local/home server only.');

const request = async (route, method = 'GET', body) => {
  const r = await fetch(new URL(route, server), { method, redirect: 'error', signal: AbortSignal.timeout(60000), headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} ${route}`), { status: r.status });
  return r.json();
};

let converted = 0;
const detask = (node) => {
  if (node.type === 'taskList') return { ...node, type: 'bulletList', content: node.content.map(detask) };
  if (node.type === 'taskItem') {
    const done = !!node.attrs?.checked;
    const content = node.content.map(detask);
    if (done && content[0]?.type === 'paragraph') content[0] = { ...content[0], content: [{ type: 'text', text: '✓ ' }, ...(content[0].content ?? [])] };
    converted++;
    return { type: 'listItem', content };
  }
  return node.content ? { ...node, content: node.content.map(detask) } : node;
};

const ids = new Map();
for (const tag of tags) {
  for (let offset = 0, more = true; more; offset += 100) {
    const page = await request(`/api/notes?tag=${encodeURIComponent(tag)}&sub=1&limit=100&offset=${offset}`);
    for (const n of page.notes) ids.set(n.id, n.title);
    more = page.hasMore;
  }
}

const rows = [];
for (const [id, title] of ids) {
  const { note } = await request(`/api/notes/${id}`);
  const before = converted;
  const doc = detask(note.doc);
  const count = converted - before;
  if (!count) continue;
  const invalid = validateDoc(doc);
  if (invalid) throw new Error(`Invalid result for "${title}": ${invalid}`);
  rows.push({ note, doc, title, count });
}

console.log(`${apply ? 'APPLY' : 'Dry run'}: ${rows.length} of ${ids.size} notes under ${tags.join(', ')} contain tasks (${rows.reduce((s, r) => s + r.count, 0)} tasks)`);
for (const r of rows) console.log(`  ${String(r.count).padStart(3)}  ${r.title}  [${r.note.tags.map((t) => t.path).join(', ')}]`);

if (apply && rows.length) {
  const backup = await request('/api/backups', 'POST');
  console.log('Backup taken first:', backup.name ?? backup.file ?? JSON.stringify(backup).slice(0, 120));
  for (const r of rows) {
    try {
      await request(`/api/notes/${r.note.id}`, 'PUT', {
        baseRevision: r.note.revision, doc: r.doc, docFormat: r.note.docFormat, kind: r.note.kind, title: r.note.title,
        date: r.note.date, tags: r.note.tags.map((t) => t.path), opId: randomUUID(),
      });
      console.log('  saved   ', r.title);
    } catch (e) {
      console.log('  SKIPPED ', r.title, '-', e.message, e.status === 409 ? '(changed since it was read; nothing overwritten)' : '');
    }
  }
}
