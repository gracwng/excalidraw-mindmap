import { useEffect, useState } from "react";
import { reconcileElements } from "@excalidraw/excalidraw";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { projectStorage } from "../services/projectStorage";
import { clearUnloadBackup, readUnloadBackups } from "../services/unloadBackup";
import { notifyProjectsChanged } from "../lib/projectEvents";
import type { Project } from "../types/project";

/**
 * Loads a project and folds in any emergency copies left by an unload that cut
 * a save short (one per tab). Merging per element (newer version wins) means a
 * stale copy can never overwrite newer work, e.g. changes synced from another device.
 */
export async function loadWithRecovery(projectId: string): Promise<Project | undefined> {
  const project = await projectStorage.loadProject(projectId);
  const backups = readUnloadBackups(projectId);
  if (backups.size === 0 || !project) {
    for (const tabId of backups.keys()) clearUnloadBackup(projectId, tabId);
    return project;
  }
  let changed = false;
  for (const [tabId, backup] of backups) {
    const tab = project.tabs.find((t) => t.id === tabId && !t.deleted);
    if (tab) {
      const elements = reconcileElements(
        tab.elements as readonly OrderedExcalidrawElement[],
        backup.elements as readonly RemoteExcalidrawElement[],
        {} as AppState,
      );
      await projectStorage.saveTab(
        { projectId, tabId, elements, appState: { ...tab.appState, ...backup.appState } },
        [],
        backup.contentChanged ? Date.now() : null,
      );
      changed ||= backup.contentChanged;
    }
    clearUnloadBackup(projectId, tabId);
  }
  if (changed) notifyProjectsChanged();
  return (await projectStorage.loadProject(projectId)) ?? project;
}

export type ProjectLoadState =
  | { status: "loading" }
  | { status: "ready"; project: Project }
  | { status: "missing" }
  | { status: "error"; message: string };

type Settled = Exclude<ProjectLoadState, { status: "loading" }>;

/** Loads one complete project (metadata, scene, files) once per id. */
export function useProject(projectId: string | undefined): ProjectLoadState {
  // Results are tagged with the id they belong to, so a stale result for a
  // previous id is never shown — it simply reads as "loading".
  const [result, setResult] = useState<{ id: string; state: Settled } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    loadWithRecovery(projectId)
      .then((project) => {
        if (cancelled) return;
        setResult({
          id: projectId,
          state: project ? { status: "ready", project } : { status: "missing" },
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error(err);
        setResult({ id: projectId, state: { status: "error", message: "Couldn't open this project." } });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!projectId) return { status: "missing" };
  if (!result || result.id !== projectId) return { status: "loading" };
  return result.state;
}
