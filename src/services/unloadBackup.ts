/**
 * Emergency copy of unsaved edits, written synchronously when the page is
 * closing. IndexedDB writes are asynchronous and a browser may abort one that
 * is still running when the page unloads, so the last fraction of a second of
 * drawing could otherwise be lost. localStorage writes are synchronous, so
 * they always land. The copy is merged back in the next time the project opens.
 */
import type { ExcalidrawElement, PersistedAppState } from "../types/project";

export interface UnloadBackup {
  elements: readonly ExcalidrawElement[];
  appState: PersistedAppState;
  /** True if it contains content edits (not just a viewport change). */
  contentChanged: boolean;
  writtenAt: number;
}

const key = (projectId: string) => `mindboard:unsaved:${projectId}`;

export function writeUnloadBackup(projectId: string, backup: UnloadBackup) {
  try {
    localStorage.setItem(key(projectId), JSON.stringify(backup));
  } catch {
    // Quota exceeded or storage unavailable; the async save may still complete.
  }
}

export function readUnloadBackup(projectId: string): UnloadBackup | null {
  try {
    const raw = localStorage.getItem(key(projectId));
    return raw ? (JSON.parse(raw) as UnloadBackup) : null;
  } catch {
    return null;
  }
}

export function clearUnloadBackup(projectId: string) {
  try {
    localStorage.removeItem(key(projectId));
  } catch {
    /* ignore */
  }
}
