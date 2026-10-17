// Projects and Waiting on (see docs/PROJECTS.md).
import { sendJson } from '../http.js';
import { areaFolders, setAreaFolders } from '../settings.js';
import { addNotesToProject, createProject, listProjects, projectDetails, setProjectRemoved, updateProject, waitingTasks } from '../projects.js';

export function registerProjectRoutes({ route, db, store }) {
  route('GET', '/api/projects', async ({ res, query }) =>
    sendJson(res, 200, { projects: listProjects(db, { removed: query.get('removed') === '1' }), areaFolders: areaFolders(db) }),
  );
  route('POST', '/api/projects', async ({ res, body }) => sendJson(res, 201, { project: createProject(db, body) }));
  route('PUT', '/api/projects/folders', async ({ res, body }) => sendJson(res, 200, { areaFolders: setAreaFolders(db, body) }));
  route('GET', '/api/projects/:id', async ({ res, params }) => sendJson(res, 200, projectDetails(db, store, params.id)));
  route('PUT', '/api/projects/:id', async ({ res, params, body }) => sendJson(res, 200, { project: updateProject(db, params.id, body) }));
  route('DELETE', '/api/projects/:id', async ({ res, params }) => sendJson(res, 200, { project: setProjectRemoved(db, params.id, true) }));
  route('POST', '/api/projects/:id/restore', async ({ res, params }) => sendJson(res, 200, { project: setProjectRemoved(db, params.id, false) }));
  route('POST', '/api/projects/:id/notes', async ({ res, params, body }) => sendJson(res, 200, addNotesToProject(db, store, params.id, body?.noteIds)));
  route('GET', '/api/waiting', async ({ res, query }) =>
    sendJson(res, 200, { tasks: waitingTasks(db, store, { person: query.get('person'), project: query.get('project') }) }),
  );
}
