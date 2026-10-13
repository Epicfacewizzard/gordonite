// The document contract (shared/doc.js) against the editor's own schema (client/src/editor/extensions.js).
//
// The server must accept every document the editor can write, and must refuse the structures the editor cannot
// hold. Rather than list cases by hand, these tests generate documents from the editor's schema, mutate them, and
// run real editing commands on them, then check that the validator and the schema agree on every one.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { toggleMark, splitBlock, deleteSelection, joinBackward, setBlockType, lift } from '@tiptap/pm/commands';
import { wrapInList, splitListItem, liftListItem, sinkListItem } from '@tiptap/pm/schema-list';
import { validateDoc, hasOnlyStructureProblems } from '../../shared/doc.js';
import { markdownToDoc } from '../../shared/markdown-import.js';
import { removeTask, updateTask, cleanTaskAttrs } from '../../shared/tasks.js';
import { FIXTURES } from '../fixtures/docs.js';
import { schema, rng, pick, editorAccepts, generate, generateAny, mutate, TYPES } from './generators.js';

// ---------- the contract against the editor ----------

describe('the validator and the editor schema agree', () => {
  test('every fixture is accepted by both', () => {
    for (const { name, doc } of FIXTURES) {
      assert.equal(validateDoc(doc), null, `${name}: validator`);
      assert.equal(editorAccepts(doc), true, `${name}: editor schema`);
    }
  });

  test('everything the editor schema can hold is accepted (including marks on line breaks)', () => {
    const r = rng(11);
    for (let i = 0; i < 500; i++) {
      const json = generate(schema.topNodeType, r);
      assert.equal(editorAccepts(json), true, `generator produced something the schema rejects: ${JSON.stringify(json)}`);
      assert.equal(validateDoc(json), null, `refused: ${JSON.stringify(json)}`);
    }
  });

  test('a changed document is accepted by the validator exactly when the editor accepts it', () => {
    const r = rng(12);
    let accepted = 0;
    let refused = 0;
    for (let i = 0; i < 1500; i++) {
      const json = mutate(generate(schema.topNodeType, r), r);
      const validator = validateDoc(json) === null;
      const editor = editorAccepts(json);
      assert.equal(validator, editor, `validator ${validator ? 'accepts' : `refuses (${validateDoc(json)})`} but editor ${editor ? 'accepts' : 'refuses'}: ${JSON.stringify(json)}`);
      if (validator) accepted++;
      else refused++;
    }
    assert.ok(accepted > 150 && refused > 150, `the mutations should hit both outcomes (accepted ${accepted}, refused ${refused})`);
  });

  test('completely arbitrary trees agree too', () => {
    const r = rng(13);
    for (let i = 0; i < 1500; i++) {
      const json = { type: 'doc', content: Array.from({ length: Math.floor(r() * 4) }, () => generateAny(pick(r, TYPES), r)) };
      const validator = validateDoc(json) === null;
      assert.equal(validator, editorAccepts(json), `disagree on ${JSON.stringify(json)} (${validateDoc(json)})`);
    }
  });

  test('the order of marks is not a reason to refuse a document, and the editor opens it', () => {
    const json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'italic' }, { type: 'bold' }] }] }] };
    assert.equal(validateDoc(json), null);
    assert.doesNotThrow(() => EditorState.create({ schema, doc: schema.nodeFromJSON(json) }));
  });
});

describe('what real editing produces is always accepted', () => {
  const nodes = schema.nodes;
  const commands = [
    (s, d) => toggleMark(schema.marks.bold)(s, d),
    (s, d) => toggleMark(schema.marks.italic)(s, d),
    (s, d) => splitBlock(s, d),
    (s, d) => deleteSelection(s, d),
    (s, d) => joinBackward(s, d),
    (s, d) => lift(s, d),
    (s, d) => wrapInList(nodes.bulletList)(s, d),
    (s, d) => wrapInList(nodes.taskList)(s, d),
    (s, d) => splitListItem(nodes.listItem)(s, d),
    (s, d) => splitListItem(nodes.taskItem)(s, d),
    (s, d) => liftListItem(nodes.listItem)(s, d),
    (s, d) => liftListItem(nodes.taskItem)(s, d),
    (s, d) => sinkListItem(nodes.listItem)(s, d),
    (s, d) => sinkListItem(nodes.taskItem)(s, d),
    (s, d) => setBlockType(nodes.heading, { level: 2 })(s, d),
    (s, d) => setBlockType(nodes.paragraph)(s, d),
    (s, d) => d?.(s.tr.insertText('typed')) ?? true,
    (s, d) => d?.(s.tr.replaceSelectionWith(nodes.hardBreak.create())) ?? true,
    (s, d) => d?.(s.tr.replaceSelectionWith(nodes.attachment.create({ id: 'file-edit-0001', name: 'x.pdf', mime: 'application/pdf', size: 5 }))) ?? true,
  ];

  test('random sequences of formatting, list and line-break commands never leave the contract', () => {
    const r = rng(21);
    for (let run = 0; run < 250; run++) {
      let state = EditorState.create({ schema, doc: schema.nodeFromJSON(generate(schema.topNodeType, r)) });
      const trail = [];
      for (let step = 0; step < 14; step++) {
        const size = state.doc.content.size;
        const a = Math.floor(r() * (size + 1));
        const b = r() < 0.5 ? a : Math.floor(r() * (size + 1));
        state = state.apply(state.tr.setSelection(TextSelection.between(state.doc.resolve(a), state.doc.resolve(b))));
        const index = Math.floor(r() * commands.length);
        trail.push(index);
        try {
          commands[index](state, (tr) => {
            state = state.apply(tr);
          });
        } catch (err) {
          assert.fail(`command ${index} threw: ${err.message}`);
        }
        const json = state.doc.toJSON();
        assert.equal(validateDoc(json), null, `after commands ${trail.join(',')} (seed run ${run}): ${validateDoc(json)}\n${JSON.stringify(json)}`);
      }
    }
  });

  test('bold applied across a line break (the case the validator used to refuse)', () => {
    const json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'line one' }, { type: 'hardBreak' }, { type: 'text', text: 'line two' }] }] };
    let state = EditorState.create({ schema, doc: schema.nodeFromJSON(json) });
    state = state.apply(state.tr.addMark(1, state.doc.content.size - 1, schema.marks.bold.create()));
    const out = state.doc.toJSON();
    assert.deepEqual(out.content[0].content[1], { type: 'hardBreak', marks: [{ type: 'bold' }] });
    assert.equal(validateDoc(out), null);
  });
});

describe('what the app writes itself is always accepted', () => {
  test('Markdown import', () => {
    const r = rng(31);
    const LINES = [
      '# Heading', '## Two', '###### deep', 'Plain words with **bold** and *italic*', '- item', '  - nested', '    - deeper', '* star item',
      '1. numbered', '2) paren', '- [ ] task', '- [x] done', '  - [ ] subtask', '> quote', '```', 'code line', '| a | b |', '|---|---|', '---',
      '', '', '![pic](gordonite-file:abcdefgh12)', '[[Wiki Link]]', '   ', 'text _under_ score', '**', '*', '`', '\\*escaped\\*', '- ', '#', '1)',
      '***both***', '* **nested** *marks*', '\tTabbed item',
    ];
    const resolveAttachment = (id) => ({ id, name: 'pic.png', mime: 'image/png', size: 5 });
    for (let i = 0; i < 600; i++) {
      const md = Array.from({ length: 1 + Math.floor(r() * 14) }, () => pick(r, LINES)).join('\n');
      const doc = markdownToDoc(md, { resolveAttachment });
      assert.equal(validateDoc(doc), null, `${validateDoc(doc)} for:\n${md}\n${JSON.stringify(doc)}`);
      assert.equal(editorAccepts(doc), true, `editor refuses the import of:\n${md}`);
    }
  });

  test('task commands on generated documents', () => {
    const r = rng(41);
    let touched = 0;
    for (let i = 0; i < 400; i++) {
      const doc = generate(schema.topNodeType, r);
      const ids = [];
      (function walk(n) {
        if (n.type === 'taskItem') ids.push(n.attrs.id);
        (n.content ?? []).forEach(walk);
      })(doc);
      for (const id of ids) {
        for (const next of [
          removeTask(doc, id),
          updateTask(doc, id, { checked: true }),
          updateTask(doc, id, { due: '2026-11-01', hidden: true }),
          updateTask(doc, id, { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'renamed' }] }] }),
          cleanTaskAttrs(doc),
        ]) {
          touched++;
          assert.notEqual(next, null);
          assert.equal(validateDoc(next), null, `${validateDoc(next)} after a task command on ${JSON.stringify(doc)}`);
        }
      }
    }
    assert.ok(touched > 200, 'the generated documents should have tasks to work on');
  });
});

describe('what is refused, and how it is explained', () => {
  const doc = (...content) => ({ type: 'doc', content });
  const p = (t) => (t ? { type: 'paragraph', content: [{ type: 'text', text: t }] } : { type: 'paragraph' });
  const task = (t, id = 'task-0001') => ({ type: 'taskItem', attrs: { id, checked: false }, content: [p(t)] });

  test('nesting that the editor cannot hold', () => {
    const cases = [
      [doc({ type: 'paragraph', content: [p('inner')] }), /paragraph cannot go inside paragraph/],
      [doc({ type: 'heading', attrs: { level: 1 }, content: [p('inner')] }), /paragraph cannot go inside heading/],
      [doc({ type: 'text', text: 'loose text' }), /text cannot go inside doc/],
      [doc({ type: 'listItem', content: [p('x')] }), /listItem cannot go inside doc/],
      [doc({ type: 'taskItem', attrs: { id: 'task-0002' }, content: [p('x')] }), /taskItem cannot go inside doc/],
      [doc({ type: 'bulletList', content: [task('a task in a bullet list')] }), /taskItem cannot go inside bulletList/],
      [doc({ type: 'taskList', content: [{ type: 'listItem', content: [p('x')] }] }), /listItem cannot go inside taskList/],
      [doc({ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'h' }] }] }] }), /listItem must start with a paragraph/],
      [doc({ type: 'taskList', content: [{ type: 'taskItem', attrs: { id: 'task-0003' }, content: [{ type: 'taskList', content: [task('x', 'task-0004')] }] }] }), /taskItem must start with a paragraph/],
      [doc({ type: 'bulletList', content: [{ type: 'listItem' }] }), /listItem must start with a paragraph/],
      [doc({ type: 'bulletList' }), /bulletList needs at least one listItem/],
      [doc({ type: 'taskList', content: [] }), /taskList needs at least one taskItem/],
      [{ type: 'doc' }, /document needs at least one block|doc needs at least one block/],
      [{ type: 'doc', content: [] }, /needs at least one block/],
      [doc({ type: 'paragraph', content: [{ type: 'attachment', attrs: { id: 'file-0001-aa', name: 'a.pdf', mime: 'application/pdf', size: 1 } }] }), /attachment cannot go inside paragraph/],
      [doc({ type: 'hardBreak' }), /hardBreak cannot go inside doc/],
    ];
    for (const [json, expected] of cases) {
      const error = validateDoc(json);
      assert.match(String(error), expected, JSON.stringify(json));
      assert.equal(editorAccepts(json), false, `the editor should refuse it too: ${JSON.stringify(json)}`);
    }
  });

  test('marks belong on text and line breaks only, once each', () => {
    assert.match(validateDoc(doc({ ...p('x'), marks: [{ type: 'bold' }] })), /only text and line breaks may carry marks/);
    assert.match(validateDoc(doc({ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'bold' }] }] })), /only be applied once/);
    assert.match(validateDoc(doc({ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'underline' }] }] })), /unsupported mark/);
    assert.equal(validateDoc(doc({ type: 'paragraph', content: [{ type: 'hardBreak', marks: [{ type: 'italic' }] }] })), null);
  });

  test('a document saved by an editor from before files existed may not carry a file', () => {
    const withFile = doc(p('x'), { type: 'attachment', attrs: { id: 'file-0001-aa', name: 'a.pdf', mime: 'application/pdf', size: 1 } });
    assert.equal(validateDoc(withFile, 2), null);
    assert.match(validateDoc(withFile, 1), /attachments need document format 2/);
  });

  test('structure problems can be told apart from every other kind', () => {
    const nested = doc({ type: 'paragraph', content: [p('inner')] });
    assert.equal(hasOnlyStructureProblems(nested), true);
    assert.equal(hasOnlyStructureProblems(doc(p('fine'))), false);
    assert.equal(hasOnlyStructureProblems(doc({ type: 'codeBlock' })), false, 'an unknown node is not merely a nesting problem');
    assert.equal(validateDoc(nested, 2, { structure: false }), null);
  });
});
