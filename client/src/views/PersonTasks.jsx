import { useTaskData } from '../hooks.js';
import { useProjects } from '../projects-data.js';
import { usePeople } from './PersonProfile.jsx';
import { TaskLinkChips } from './TaskChips.jsx';
import { byWaitingLongest, isWaiting } from '../../../shared/projects.js';

/**
 * "Tasks with them" on a person's page (docs/PROJECTS.md): the open tasks linked to this person, the ones waiting for
 * their reply first (longest waiting first). The tasks stay in their notes; tapping one opens its note.
 */
export function PersonTasks({ noteId, today }) {
  const data = useTaskData();
  const { projects } = useProjects();
  const { people } = usePeople();
  const all = (data.tasks() ?? []).filter((t) => !t.checked && !t.dismissedAt);
  const mine = all.filter((t) => t.person === noteId && t.owner !== noteId);
  const theirs = all.filter((t) => t.owner === noteId); // their commitments (0.21.0)
  if (mine.length === 0 && theirs.length === 0) return null;
  const waiting = mine.filter(isWaiting).sort(byWaitingLongest);
  const rest = mine.filter((t) => !isWaiting(t));
  const row = (t) => (
    <li key={`${t.noteId}:${t.taskId}`} class="person-task" data-testid="person-task">
      <a href={`#/n/${t.noteId}`} class="person-task-text">{t.text}</a>
      <span class="task-meta">
        <TaskLinkChips task={t} today={today} projects={projects} people={people} hidePerson hideOwner />
      </span>
    </li>
  );
  return (
    <div class="person-tasks" data-testid="person-tasks">
      {theirs.length > 0 && (
        <div data-testid="person-owns">
          <div class="person-section-head">
            <h3 class="person-section-title">They said they would</h3>
          </div>
          <ul class="person-task-list">{theirs.map(row)}</ul>
        </div>
      )}
      {mine.length > 0 && (
        <div class="person-section-head">
          <h3 class="person-section-title">Tasks with them</h3>
        </div>
      )}
      {waiting.length > 0 && <p class="muted small">Waiting for a reply</p>}
      <ul class="person-task-list">{waiting.map(row)}</ul>
      {rest.length > 0 && waiting.length > 0 && <p class="muted small">Other open tasks</p>}
      <ul class="person-task-list">{rest.map(row)}</ul>
    </div>
  );
}
