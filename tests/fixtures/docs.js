// One document for every structure the app supports. They are used by the editor-parity tests (tests/client) and the
// save / export / import round trips (tests/server): a structure that is supported must work in all of them.
//
// A fixture is { name, doc }. Files are written with the id in FILE_ID; a test that needs a real stored file
// replaces it with `withFileId(doc, id)`.
export const FILE_ID = 'file-fixture-0001';

const text = (t, ...marks) => ({ type: 'text', text: t, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
const p = (...content) => (content.length ? { type: 'paragraph', content: content.map((c) => (typeof c === 'string' ? text(c) : c)) } : { type: 'paragraph' });
const h = (level, t) => ({ type: 'heading', attrs: { level }, content: [text(t)] });
const li = (...content) => ({ type: 'listItem', content });
const ul = (...items) => ({ type: 'bulletList', content: items });
const task = (id, t, attrs = {}, ...rest) => ({ type: 'taskItem', attrs: { id, checked: false, ...attrs }, content: [p(t), ...rest] });
const tasks = (...items) => ({ type: 'taskList', content: items });
const file = (name = 'Lease.pdf', mime = 'application/pdf', size = 48213) => ({ type: 'attachment', attrs: { id: FILE_ID, name, mime, size } });
const doc = (...content) => ({ type: 'doc', content });

export const FIXTURES = [
  { name: 'an empty note the editor can type into', doc: doc(p()) },
  { name: 'paragraphs', doc: doc(p('First paragraph.'), p('Second paragraph, with more words.')) },
  { name: 'headings of every level', doc: doc(h(1, 'Title'), h(2, 'Section'), h(3, 'Part'), p('Body.')) },
  { name: 'bold and italic, alone and together', doc: doc(p('plain ', text('bold', 'bold'), ' ', text('italic', 'italic'), ' ', text('both', 'bold', 'italic'))) },
  { name: 'a line break inside bold text', doc: doc(p(text('first line', 'bold'), { type: 'hardBreak', marks: [{ type: 'bold' }] }, text('second line', 'bold'))) },
  { name: 'a line break between plain lines', doc: doc(p('one', { type: 'hardBreak' }, 'two')) },
  { name: 'a bullet list three levels deep', doc: doc(ul(li(p('top'), ul(li(p('middle'), ul(li(p('bottom')))))), li(p('second top')))) },
  { name: 'tasks, done and open', doc: doc(tasks(task('task-aaaa0001', 'open'), task('task-aaaa0002', 'done', { checked: true }))) },
  { name: 'a task with nested tasks and a nested bullet list', doc: doc(tasks(task('task-bbbb0001', 'parent', {}, tasks(task('task-bbbb0002', 'child'), task('task-bbbb0003', 'other child')), ul(li(p('a note under the task')))))) },
  { name: 'a task inside a bullet list item', doc: doc(ul(li(p('shopping'), tasks(task('task-cccc0001', 'milk'), task('task-cccc0002', 'eggs'))))) },
  {
    name: 'a task with every attribute set',
    doc: doc(
      tasks(
        task('task-dddd0001', 'call the bank', {
          due: '2026-10-20', dueTime: '09:30', start: '2026-10-15', startTime: '08:00', hidden: true, hideUntil: '2026-10-14',
          priority: 'urgent', completedAt: '2026-10-13T15:04:05.000Z', dismissedAt: '2026-10-13T16:00:00.000Z',
        }),
      ),
    ),
  },
  { name: 'a file between paragraphs', doc: doc(p('Before.'), file(), p('After.')) },
  { name: 'a photo', doc: doc(file('Kitchen.jpg', 'image/jpeg', 120_000), p()) },
  {
    name: 'files inside a bullet item and a task item, after the first paragraph',
    doc: doc(ul(li(p('contract'), file())), tasks(task('task-eeee0001', 'sign it', {}, file('Signature page.pdf')))),
  },
  { name: 'a note that is only a file', doc: doc(file(), p()) },
  { name: 'headings, lists, tasks and a file together', doc: doc(h(1, 'Move-in'), p('Things to do:'), tasks(task('task-ffff0001', 'keys')), ul(li(p('floor plan'))), file(), p()) },
];

/** A copy of the document with the fixture file id replaced everywhere. */
export function withFileId(source, id) {
  return JSON.parse(JSON.stringify(source).replaceAll(FILE_ID, id));
}

export const hasFile = (source) => JSON.stringify(source).includes(FILE_ID);
