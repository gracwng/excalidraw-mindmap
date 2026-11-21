/** Lets the sync engine reach the editor that has a given project open. */
import type { ActiveEditorHandle } from "../services/sync/syncEngine";

const editors = new Map<string, ActiveEditorHandle>();

export function registerActiveEditor(projectId: string, handle: ActiveEditorHandle) {
  editors.set(projectId, handle);
  return () => {
    if (editors.get(projectId) === handle) editors.delete(projectId);
  };
}

export function getActiveEditor(projectId: string) {
  return editors.get(projectId);
}
