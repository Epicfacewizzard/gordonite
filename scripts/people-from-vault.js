// One-time: fill in People details from the front matter of the vault's `05 People` notes (see docs/PEOPLE.md).
// Never writes to the vault and never talks to a server: it writes an import file that only adds details, to be
// imported on the Data page with "Merge" (details already on the server are kept, never replaced).
//
//   node scripts/people-from-vault.js "<vault folder>" [out.json]
//
// The notes were imported with ids made from their path in the vault (scripts/import-vault.js), so each file finds
// its note exactly; the name is never guessed. Taken: birthday, role, aliases, contact, and department / major /
// cohort / grad_year / status as "More details". circle is the person's group (their tag) already; the rest is left.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { cleanProfile, emptyProfile, isBirthday } from '../shared/people.js';

const stableId = (value) => {
  const h = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`;
};

/** The simple `key: value` lines of a leading front matter block ([a, b] lists become arrays). */
export function frontMatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(raw.replace(/^﻿/, ''));
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w -]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^(['"])(.*)\1$/, '$2')).filter(Boolean);
    out[kv[1].trim()] = v;
  }
  return out;
}

const EXTRA = [
  ['department', 'Department'],
  ['major', 'Major'],
  ['cohort', 'Cohort'],
  ['grad_year', 'Grad year'],
  ['status', 'Status'],
];

/** A person's details from their front matter, or null when there is nothing to take. */
export function profileFromFrontMatter(fm) {
  const p = emptyProfile();
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  if (isBirthday(str(fm.birthday))) p.birthday = str(fm.birthday);
  p.role = str(fm.role).slice(0, 120);
  p.aliases = (Array.isArray(fm.aliases) ? fm.aliases : str(fm.aliases) ? [fm.aliases] : []).map((a) => String(a).slice(0, 60)).slice(0, 10);
  const contact = str(fm.contact);
  if (contact) p.contacts = [{ kind: /@/.test(contact) && !contact.startsWith('@') ? 'email' : /^[+\d][\d\s().-]{6,}$/.test(contact) ? 'phone' : 'other', value: contact.slice(0, 200) }];
  p.extra = EXTRA.filter(([k]) => str(fm[k]) && !(k === 'status' && str(fm[k]) === 'unknown')).map(([k, label]) => ({ label, value: str(fm[k]).slice(0, 300) }));
  const cleaned = cleanProfile(p);
  return JSON.stringify(cleaned) === JSON.stringify(emptyProfile()) ? null : cleaned;
}

function main() {
  const [vault, outArg] = process.argv.slice(2);
  if (!vault) throw new Error('Usage: node scripts/people-from-vault.js "<vault folder>" [out.json]');
  const root = path.join(vault, '05 People');
  if (!fs.existsSync(root)) throw new Error(`No "05 People" folder in ${vault}`);
  const people = [];
  const report = { files: 0, withDetails: 0, birthdays: 0, roles: 0 };
  const walk = (folder) => {
    for (const f of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, f.name);
      if (f.isDirectory() && !f.name.startsWith('.')) walk(full);
      if (!f.isFile() || !/\.md$/i.test(f.name)) continue;
      report.files++;
      const fm = frontMatter(fs.readFileSync(full, 'utf8'));
      if (fm.type && fm.type !== 'person') continue; // the folder's own hub page
      const profile = profileFromFrontMatter(fm);
      if (!profile) continue;
      const relative = path.relative(vault, full).replaceAll('\\', '/');
      people.push({ noteId: stableId(`gordonite-preview:${relative}`), profile });
      report.withDetails++;
      if (profile.birthday) report.birthdays++;
      if (profile.role) report.roles++;
    }
  };
  walk(root);
  const out = path.resolve(outArg ?? path.join('data', 'people-from-vault.json'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(out, JSON.stringify({ format: 'hq-export', formatVersion: 1, exportedAt: now, tags: [], notes: [], people: people.map((p) => ({ ...p, createdAt: now, updatedAt: now })) }));
  console.log(JSON.stringify({ ...report, out }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
