import { moveTask } from '../editor/task-move.js';
import { useState } from 'preact/hooks';
import { Toolbar } from '../editor/Toolbar.jsx';
import { updateTaskById, removeTaskById } from '../editor/NoteEditor.jsx';
import { TaskSheet } from './TaskSheet.jsx';
import { taskText } from '../../../shared/tasks.js';

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
      setSheet({ id: a.id, text: taskText(node.toJSON()), picked: { dueTime: a.dueTime, startTime: a.startTime, due: a.due, start: a.start, hidden: a.hidden, hideUntil: a.hideUntil, priority: a.priority, dismissedAt: a.dismissedAt } });
      return;
    }
  };

  return (
    <>
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
