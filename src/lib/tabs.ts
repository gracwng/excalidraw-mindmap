/** Pure helpers for working with project tabs. */
import {
  DEFAULT_TAB_ID,
  type ExcalidrawElement,
  type PersistedAppState,
  type ProjectTab,
  type TabMeta,
} from "../types/project";

export function randomNonce() {
  return Math.floor(Math.random() * 2 ** 31);
}

export function newTabId() {
  return `tab-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function createTab(init: {
  id?: string;
  name: string;
  order: number;
  elements?: readonly ExcalidrawElement[];
  appState?: PersistedAppState;
}): ProjectTab {
  return {
    id: init.id ?? newTabId(),
    name: init.name,
    order: init.order,
    version: 1,
    versionNonce: randomNonce(),
    elements: init.elements ?? [],
    appState: init.appState ?? {},
  };
}

/** The tab a project starts with (and what a pre-tabs project becomes). */
export function defaultTab(
  elements: readonly ExcalidrawElement[] = [],
  appState: PersistedAppState = {},
): ProjectTab {
  // Deterministic version/nonce so every device migrates an old project the same way.
  return { id: DEFAULT_TAB_ID, name: "Tab 1", order: 0, version: 1, versionNonce: 0, elements, appState };
}

/** Records a change to a tab's metadata so it wins over older copies when merging. */
export function bumpTab<T extends TabMeta>(tab: T, changes: Partial<Omit<TabMeta, "id">>): T {
  return { ...tab, ...changes, version: tab.version + 1, versionNonce: randomNonce() };
}

/** Visible tabs in display order. */
export function visibleTabs<T extends TabMeta>(tabs: readonly T[]): T[] {
  return tabs.filter((t) => !t.deleted).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function firstTab<T extends TabMeta>(tabs: readonly T[]): T | undefined {
  return visibleTabs(tabs)[0];
}

export function nextTabName(tabs: readonly TabMeta[]) {
  const used = new Set(visibleTabs(tabs).map((t) => t.name));
  for (let n = visibleTabs(tabs).length + 1; ; n++) {
    if (!used.has(`Tab ${n}`)) return `Tab ${n}`;
  }
}

export function tabMeta({ id, name, order, version, versionNonce, deleted }: TabMeta): TabMeta {
  return { id, name, order, version, versionNonce, ...(deleted ? { deleted } : {}) };
}

/** Removes a tab's content and marks it deleted (a tombstone). */
export function deleteTab(tab: ProjectTab): ProjectTab {
  return { ...bumpTab(tab, { deleted: true }), elements: [], appState: {} };
}
