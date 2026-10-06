// Explicit one-way import of the previously selected vault folders. Never writes to the vault.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { markdownToDoc } from '../shared/markdown-import.js';
import { normalizeTag } from '../shared/tags.js';
import { dateInTz } from '../shared/dates.js';
import { validateDoc } from '../shared/doc.js';

const [vault, address, flag] = process.argv.slice(2);
if (!vault || !address) throw new Error('Usage: node scripts/import-vault.js <vault> <server-url> [--apply]');
const server = new URL(address);
if (!['localhost', '127.0.0.1', '192.168.1.50'].includes(server.hostname)) throw new Error('Use the authorized local/home server only.');
const request = async (route, body) => {
  const r = await fetch(new URL(route, server), { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(300000), headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!r.ok) throw new Error(`Server HTTP ${r.status}; no automatic write retry.`);
  return r.json();
};
const old = await request('/api/export/json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const stage = path.resolve('data', `vault-transfer-${stamp}`);
fs.mkdirSync(stage, { recursive: true });
fs.writeFileSync(path.join(stage, 'server-before.json'), JSON.stringify(old));
const stableId = (value) => {
  const h = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`;
};
const comparable = (doc) => JSON.stringify(doc, (key, value) => key === 'id' || value === null || value === false ? undefined : value);
const tags = new Map(), notes = [], report = { scanned: 0, unchanged: 0, new: 0, changedPreservedAsVersions: 0 };
const now = new Date().toISOString();
const walk = (folder) => {
  for (const file of fs.readdirSync(folder, { withFileTypes: true })) {
    if (file.name.startsWith('.') || /^(agents?|claude)\.md$/i.test(file.name) || file.isSymbolicLink()) continue;
    const full = path.join(folder, file.name);
    if (file.isDirectory()) { walk(full); continue; }
    if (!file.isFile() || !/\.md$/i.test(file.name)) continue;
    const relative = path.relative(vault, full).replaceAll('\\', '/');
    const id = stableId(`gordonite-preview:${relative}`);
    const existing = old.notes.find((n) => n.id === id);
    const raw = fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '');
    const doc = markdownToDoc(raw);
    let index = 0;
    const ids = (node) => { if (node.type === 'taskItem') node.attrs.id = stableId(`gordonite-vault-task:${relative}:${index++}`); (node.content ?? []).forEach(ids); };
    ids(doc);
    const invalid = validateDoc(doc);
    if (invalid) throw new Error(`Invalid document at ${relative}: ${invalid}`);
    report.scanned++;
    if (existing && [existing.doc, ...(existing.versions ?? []).map((v) => v.doc)].some((d) => comparable(d) === comparable(doc))) { report.unchanged++; continue; }
    const tag = normalizeTag(path.posix.dirname(relative));
    if (!tag) throw new Error(`Unsupported folder tag: ${relative}`);
    if (!tags.has(tag)) tags.set(tag, { id: stableId(`gordonite-vault-tag:${tag}`), path: tag, createdAt: now, daily: false, favorite: false });
    const original = path.join(stage, 'originals', relative);
    fs.mkdirSync(path.dirname(original), { recursive: true }); fs.writeFileSync(original, raw);
    notes.push({ id, kind: 'note', title: path.basename(relative, '.md'), date: existing?.date ?? /^\d{4}-\d{2}-\d{2}/.exec(file.name)?.[0] ?? dateInTz(new Date(), old.homeTimeZone), docFormat: 1, doc, revision: 1, createdAt: now, updatedAt: now, deletedAt: null, tags: [tags.get(tag).id], versions: [] });
    report[existing ? 'changedPreservedAsVersions' : 'new']++;
  }
};
for (const folder of ['00 Inbox', '05 People', '10 School', '20 CSS']) walk(path.join(vault, folder));
const payload = { format: 'hq-export', formatVersion: 1, exportedAt: now, homeTimeZone: old.homeTimeZone, tags: [...tags.values()], notes };
fs.writeFileSync(path.join(stage, 'import.json'), JSON.stringify(payload));
if (flag === '--apply' && notes.length) report.import = await request('/api/import?mode=merge', payload);
fs.writeFileSync(path.join(stage, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
