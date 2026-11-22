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

const PREFIX = "mindboard:unsaved:";
const key = (projectId: string, tabId: string) => `${PREFIX}${projectId}:${tabId}`;

export function writeUnloadBackup(projectId: string, tabId: string, backup: UnloadBackup) {
  try {
    localStorage.setItem(key(projectId, tabId), JSON.stringify(backup));
  } catch {
    // Quota exceeded or storage unavailable; the async save may still complete.
  }
}

/** All emergency copies for a project, keyed by tab id. */
export function readUnloadBackups(projectId: string): Map<string, UnloadBackup> {
  const result = new Map<string, UnloadBackup>();
  try {
    const prefix = `${PREFIX}${projectId}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(prefix)) continue;
      const raw = localStorage.getItem(k);
      if (raw) result.set(k.slice(prefix.length), JSON.parse(raw) as UnloadBackup);
    }
  } catch {
    /* ignore */
  }
  return result;
}

export function clearUnloadBackup(projectId: string, tabId: string) {
  try {
    localStorage.removeItem(key(projectId, tabId));
  } catch {
    /* ignore */
  }
}
