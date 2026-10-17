// Projects on this device (see docs/PROJECTS.md): the server's list of projects, with a copy on the phone so the list,
// a project's page and the task chips work offline. Making or changing a project needs the server (it makes tags); a
// task's project, person and waiting day are attributes in its note and are saved like any task change.
import { useEffect, useReducer } from 'preact/hooks';
import { api, NetworkError } from './api.js';
import { DEFAULT_AREA_FOLDERS } from '../../shared/projects.js';

let server = { projects: [], areaFolders: DEFAULT_AREA_FOLDERS };
let loaded = false;
let loading = null;
let error = null;
let fromPhoneCopy = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

/** Ask the server again (the phone copy when out of reach). */
export function loadProjects() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const r = await api.projects();
      server = { projects: r.projects ?? [], areaFolders: r.areaFolders ?? DEFAULT_AREA_FOLDERS };
      fromPhoneCopy = r.fromPhoneCopy ?? null;
      error = null;
    } catch (err) {
      error = err instanceof NetworkError ? 'Projects need a connection the first time.' : err.message;
    } finally {
      loaded = true;
      loading = null;
      emit();
    }
  })();
  return loading;
}

/** { projects, areaFolders, loaded, error, fromPhoneCopy, byId(id) } */
export function projectsState() {
  return { ...server, loaded, error, fromPhoneCopy, byId: (id) => server.projects.find((p) => p.id === id) ?? null };
}

export function subscribeProjects(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The projects list, loaded the first time a screen asks and re-read whenever one appears. */
export function useProjects() {
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const stop = subscribeProjects(bump);
    loadProjects();
    return stop;
  }, []);
  return projectsState();
}

// Changes go straight to the server, then the list is read again. Each returns what the server said.
const thenReload = async (promise) => {
  const r = await promise;
  await loadProjects();
  return r;
};
export const projectActions = {
  create: (body) => thenReload(api.createProject(body)),
  save: (id, body) => thenReload(api.saveProject(id, body)),
  remove: (id) => thenReload(api.removeProject(id)),
  restore: (id) => thenReload(api.restoreProject(id)),
  addNotes: (id, noteIds) => thenReload(api.addNotesToProject(id, noteIds)),
  setAreaFolders: (folders) => thenReload(api.setAreaFolders(folders)),
};
