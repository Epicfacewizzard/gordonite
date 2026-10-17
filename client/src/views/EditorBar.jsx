import { moveTask } from '../editor/task-move.js';
import { useEffect, useReducer, useState } from 'preact/hooks';
import { Toolbar } from '../editor/Toolbar.jsx';
import { uploadStatus } from '../editor/attachments.js';
import { updateTaskById, removeTaskById } from '../editor/NoteEditor.jsx';
import { TaskSheet } from './TaskSheet.jsx';
import { taskText } from '../../../shared/tasks.js';

// "Uploading 2 files…" while files go up, and what went wrong if one did not. Sits just above the toolbar.
function UploadStatus() {
  const [, rerender] = useReducer((n) => n + 1, 0);
  useEffect(() => uploadStatus.subscribe(rerender), []);
  const { busy, error } = uploadStatus.get();
  if (!busy && !error) return null;
  return (
    <div class={`upload-status${error && !busy ? ' error' : ''}`} role={error ? 'alert' : 'status'} data-testid="upload-status">
      {busy > 0 ? <span>Uploading {busy} file{busy === 1 ? '' : 's'}…</span> : null}
      {error ? <span>Could not add: {error}</span> : null}
      {error && !busy ? (
        <button type="button" class="link" onClick={() => uploadStatus.dismiss()}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

/**
 * The formatting toolbar plus the task-dates sheet it opens. Used wherever a note is being edited
 * (a stream, or a note on its own page). `noteDate` is the date of the note being edited.
 */
export function EditorBar({ editor, noteDate, today }) {
  const [sheet, setSheet] = useState(null);

  // The task the caret is in (the innermost one, for nested tasks): open its dates sheet.
  const openTaskDates = () => {
    if (!editor || editor.isDestroyed) return;
    const { $from } = editor.state.selection;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type.name !== 'taskItem') continue;
      const a = node.attrs;
      setSheet({ id: a.id, text: taskText(node.toJSON()), picked: { dueTime: a.dueTime, startTime: a.startTime, due: a.due, start: a.start, hidden: a.hidden, hideUntil: a.hideUntil, priority: a.priority, dismissedAt: a.dismissedAt, repeat: a.repeat, completions: a.completions ?? [] } });
      return;
    }
  };

  return (
    <>
      <UploadStatus />
      <Toolbar editor={editor} onTaskDates={openTaskDates} />
      {sheet && (
        <TaskSheet
          text={sheet.text}
          noteDate={noteDate ?? today}
          today={today}
          picked={sheet.picked}
          onChange={(patch) => updateTaskById(editor, sheet.id, patch)}
          onMove={(direction) => moveTask(editor, sheet.id, direction)}
          onDelete={() => removeTaskById(editor, sheet.id)}
          onClose={() => {
            setSheet(null);
            editor?.chain().focus(undefined, { scrollIntoView: false }).run();
          }}
        />
      )}
    </>
  );
}
