import { useEffect, useReducer } from 'preact/hooks';

const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d={d} />
  </svg>
);

const ICONS = {
  bullet: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  task: 'M4 5h6v6H4zM4 14h6v6H4zM14 8h6M14 17h6M5.5 8l1.3 1.4L9 6.5',
  calendar: 'M5 5h14v15H5zM5 10h14M9 3v4M15 3v4',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
};

// Cancelling pointer/mouse down stops the button from taking focus, so the text
// keeps its selection and the on-screen keyboard stays up. The command runs on click.
const keepFocus = (e) => e.preventDefault();

// Defined at module level on purpose: a component created inside render would be
// re-mounted on every transaction and could swallow a tap.
function Btn({ label, active, disabled, onClick, children, testid }) {
  return (
    <button
      type="button"
      class={`tb-btn${active ? ' on' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      // aria-disabled, not `disabled`: a disabled button can let focus leave the editor.
      aria-disabled={disabled ? 'true' : undefined}
      data-testid={testid}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={disabled ? undefined : onClick}
    >
      {children}
    </button>
  );
}

/** Formatting bar: bold, italic, headings, bullets, tasks, task dates, undo/redo. The dates button opens a sheet; the rest open nothing. */
export function Toolbar({ editor, onTaskDates }) {
  const [, rerender] = useReducer((n) => n + 1, 0);

  useEffect(() => {
    if (!editor) return;
    editor.on('transaction', rerender);
    editor.on('selectionUpdate', rerender);
    return () => {
      editor.off('transaction', rerender);
      editor.off('selectionUpdate', rerender);
    };
  }, [editor]);

  const ready = !!editor && !editor.isDestroyed;
  const run = (fn) => () => ready && fn(editor.chain().focus(undefined, { scrollIntoView: false })).run();
  const active = (name, attrs) => ready && editor.isActive(name, attrs);
  const can = (fn) => ready && fn(editor.can());

  return (
    <div class="toolbar" role="toolbar" aria-label="Formatting" data-testid="toolbar">
      <Btn label="Bold" testid="tb-bold" disabled={!ready} active={active('bold')} onClick={run((c) => c.toggleBold())}>
        <b>B</b>
      </Btn>
      <Btn label="Italic" testid="tb-italic" disabled={!ready} active={active('italic')} onClick={run((c) => c.toggleItalic())}>
        <i>I</i>
      </Btn>
      <Btn label="Heading 1" testid="tb-h1" disabled={!ready} active={active('heading', { level: 1 })} onClick={run((c) => c.toggleHeading({ level: 1 }))}>
        H1
      </Btn>
      <Btn label="Heading 2" testid="tb-h2" disabled={!ready} active={active('heading', { level: 2 })} onClick={run((c) => c.toggleHeading({ level: 2 }))}>
        H2
      </Btn>
      <Btn label="Bulleted list" testid="tb-bullet" disabled={!ready} active={active('bulletList')} onClick={run((c) => c.toggleBulletList())}>
        <Icon d={ICONS.bullet} />
      </Btn>
      <Btn label="Task" testid="tb-task" disabled={!ready} active={active('taskList')} onClick={run((c) => c.toggleTaskList())}>
        <Icon d={ICONS.task} />
      </Btn>
      <Btn label="Task dates" testid="tb-taskdates" disabled={!ready || !active('taskItem')} onClick={() => onTaskDates?.()}>
        <Icon d={ICONS.calendar} />
      </Btn>
      <span class="tb-gap" />
      <Btn label="Undo" testid="tb-undo" disabled={!can((c) => c.undo())} onClick={run((c) => c.undo())}>
        <Icon d={ICONS.undo} />
      </Btn>
      <Btn label="Redo" testid="tb-redo" disabled={!can((c) => c.redo())} onClick={run((c) => c.redo())}>
        <Icon d={ICONS.redo} />
      </Btn>
    </div>
  );
}
