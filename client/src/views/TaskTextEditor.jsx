import { useEffect, useRef, useState } from 'preact/hooks';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../editor/extensions.js';
import { api } from '../api.js';
import { sync } from '../sync.js';
import { taskText } from '../../../shared/tasks.js';

// Only the selected row gets an editor. Keep rich text intact and save into the
// original task node; nested tasks are preserved by the normal note save path.
export function TaskTextEditor({ task, onText, onDone }) {
  const host = useRef(null), editorRef = useRef(null), callbacks = useRef({ onText, onDone });
  callbacks.current = { onText, onDone };
  const [error, setError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await sync.ready;
      const session = sync.get(task.noteId) ?? sync.adopt((await api.getNote(task.noteId)).note);
      let item;
      const find = (node) => {
        if (node.type === 'taskItem' && node.attrs?.id === task.taskId) item = node;
        for (const child of node.content ?? []) find(child);
      };
      find(session.provider ? session.provider() : session.currentDoc());
      if (!item) throw new Error('That task is no longer in its note.');
      if (cancelled) return;
      const editor = new Editor({
        element: host.current,
        extensions: createExtensions(),
        content: { type: 'doc', content: item.content.filter((c) => c.type !== 'taskList') },
        editorProps: { attributes: { role: 'textbox', 'aria-label': 'Edit task text', 'data-testid': 'task-text-editor', class: 'task-inline-editor' } },
        onUpdate: ({ editor }) => {
          const content = editor.getJSON().content ?? [{ type: 'paragraph' }];
          if (!session.applyTaskPatch(task.taskId, { content })) {
            setError('That task is no longer in its note. Copy your text before closing.');
            return;
          }
          callbacks.current.onText(taskText({ content }));
        },
      });
      editorRef.current = editor;
      editor.commands.focus('end');
    })().catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; editorRef.current?.destroy(); editorRef.current = null; };
  }, [task.noteId, task.taskId]);
  return <div class="task-inline-edit">
    <div ref={host} />
    {error && <p role="alert" class="error">{error}</p>}
    <button type="button" class="link-plain" onClick={() => callbacks.current.onDone()} data-testid="task-text-done">Done editing</button>
  </div>;
}
