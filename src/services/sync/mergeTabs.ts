/**
 * Merging two copies of a project's tabs (this device's and the cloud's).
 *
 * - Tabs are matched by id; a tab that exists on only one side is kept.
 * - A tab's name/order/deleted flag come from the side with the higher tab
 *   version (ties: lower versionNonce, as Excalidraw does for elements).
 * - A tab's canvas is merged element by element with `mergeElements`, so
 *   edits to the same tab on two devices both survive.
 * - Deleted tabs stay deleted (tombstones keep their higher version).
 */
import type { ExcalidrawElement, ProjectTab, TabMeta } from "../../types/project";
import { DEVICE_ONLY_APP_STATE_KEYS } from "../../types/project";

export type MergeElements = (
  local: readonly ExcalidrawElement[],
  remote: readonly ExcalidrawElement[],
) => readonly ExcalidrawElement[] | Promise<readonly ExcalidrawElement[]>;

function newerMeta(a: TabMeta, b: TabMeta) {
  if (a.version !== b.version) return a.version > b.version ? a : b;
  return a.versionNonce <= b.versionNonce ? a : b;
}

export async function mergeTabs(
  local: readonly ProjectTab[],
  remote: readonly ProjectTab[],
  mergeElements: MergeElements,
): Promise<ProjectTab[]> {
  const localById = new Map(local.map((t) => [t.id, t]));
  const remoteById = new Map(remote.map((t) => [t.id, t]));
  const ids = [...new Set([...remoteById.keys(), ...localById.keys()])];

  const merged: ProjectTab[] = [];
  for (const id of ids) {
    const l = localById.get(id);
    const r = remoteById.get(id);
    if (!l || !r) {
      merged.push((l ?? r)!);
      continue;
    }
    const meta = newerMeta(l, r);
    if (meta.deleted) {
      merged.push({ ...(meta === l ? l : r), elements: [], appState: {} });
      continue;
    }
    // Canvas settings follow the cloud; this device keeps its own viewport.
    const appState: Record<string, unknown> = { ...r.appState };
    for (const key of DEVICE_ONLY_APP_STATE_KEYS) {
      const value = (l.appState as Record<string, unknown>)[key];
      if (value !== undefined) appState[key] = value;
    }
    merged.push({
      id,
      name: meta.name,
      order: meta.order,
      version: meta.version,
      versionNonce: meta.versionNonce,
      ...(meta.deleted ? { deleted: true } : {}),
      elements: await mergeElements(l.elements, r.elements),
      appState,
    });
  }
  return merged;
}

/** Identity of an element list: ids with versions. */
export function sceneSignature(elements: readonly ExcalidrawElement[]) {
  return elements
    .map((el) => `${el.id}:${el.version}:${el.versionNonce}`)
    .sort()
    .join("|");
}

/** Identity of a project's tabs: tab metadata versions plus each canvas's signature. */
export function tabsSignature(tabs: readonly ProjectTab[]) {
  return [...tabs]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(
      (t) =>
        `${t.id}:${t.version}:${t.versionNonce}:${t.deleted ? 1 : 0}[${sceneSignature(t.elements)}]`,
    )
    .join("#");
}
