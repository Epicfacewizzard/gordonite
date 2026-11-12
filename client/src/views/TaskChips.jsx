import { projectOfTask, waitingLabel } from '../../../shared/projects.js';

/** The chips naming who a task is with (and how long it has waited) and its project. Shared with the project and person pages. */
export function TaskLinkChips({ task, today, projects, people, hideProject = false, hidePerson = false, hideOwner = false }) {
  const project = hideProject ? null : projectOfTask(task, projects);
  const owner = task.owner ? people.find((p) => p.noteId === task.owner) : null;
  const person = task.person && !hidePerson ? people.find((p) => p.noteId === task.person) : null;
  return (
    <>
      {task.waitingSince && !task.checked && !task.dismissedAt && (
        <span class="task-chip waiting" data-testid="chip-waiting">{waitingLabel(task.waitingSince, today)}</span>
      )}
      {task.owner && !hideOwner && (
        <a class="task-chip person owner" href={`#/people/${task.owner}`} data-testid="chip-owner">{owner ? `${owner.title}’s task` : 'Someone’s task'}</a>
      )}
      {task.person && !hidePerson && (
        <a class="task-chip person" href={`#/n/${task.person}`} data-testid="chip-person">@{person ? person.title : 'someone removed'}</a>
      )}
      {project && (
        <a class="task-chip project" href={`#/projects/${project.id}`} data-testid="chip-project">{project.name}</a>
      )}
    </>
  );
}
