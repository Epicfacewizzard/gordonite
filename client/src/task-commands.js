// What a screen can ask of one task, by the note's id and the task's id: change it, remove it, edit its words.
//
// A screen does not need to know whether the note is already loaded on this device, whether its editor is open, or how
// the change travels. The change goes through the note's save session: kept on this device first, then sent against the
// note's revision with the usual conflict protection. If the note's editor is open it is one undoable edit in that
// editor; otherwise it is made on the note's document directly (the same rules either way, see
// shared/tasks.js patchedTaskAttrs and tests/client/task-parity.test.js).
import { api as realApi } from './api.js';
import { sync as realSync } from './sync.js';
import { findTask } from '../../shared/tasks.js';

export function createTaskCommands({ api = realApi, sync = realSync } = {}) {
  // The session for a note: the one this device already has, or one made from the server's copy. With `fresh`, a note
  // nobody is editing is first brought up to what the server has now, so the change is made on what the person is looking
  // at and does not come back as a conflict for no reason (adopt never touches a note that has unsent edits or an editor).
  async function sessionFor(noteId, fresh) {
    await sync.ready;
    const have = sync.get(noteId);
    if (have && !fresh) return have;
    const { note } = await api.getNote(noteId);
    return sync.adopt(note);
  }

  return {
    /**
     * Change one task: { checked, due, start, dueTime, startTime, hidden, hideUntil, priority, dismissedAt, completedAt,
     * content } (a null date or hidden: false clears it). Resolves to false when the task is no longer in its note.
     * Rejects (nothing changed) when the note cannot be reached to start from.
     */
    update(noteId, taskId, patch, { fresh = true } = {}) {
      return sync.track(sessionFor(noteId, fresh).then((session) => session.applyTaskPatch(taskId, patch)));
    },

    /** Remove one task and any tasks nested under it. Resolves to false when it is already gone. */
    remove(noteId, taskId, { fresh = true } = {}) {
      return sync.track(sessionFor(noteId, fresh).then((session) => session.removeTask(taskId)));
    },

    /**
     * Start editing one task's words. Resolves to { content, write(content) }: `content` is the task's own paragraphs
     * (not the tasks nested under it) as document JSON, and write() saves new paragraphs into the task, returning false
     * if the task has gone from its note. Resolves to null when there is no such task.
     */
    async text(noteId, taskId) {
      const session = await sessionFor(noteId, false);
      const item = findTask(session.provider ? session.provider() : session.currentDoc(), taskId);
      if (!item) return null;
      return {
        content: (item.content ?? []).filter((c) => c.type !== 'taskList'),
        write: (content) => session.applyTaskPatch(taskId, { content }),
      };
    },
  };
}

/** The page's task commands. */
export const taskCommands = createTaskCommands();
