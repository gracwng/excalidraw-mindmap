/**
 * Project-level operations built on top of the storage abstraction.
 * Every write is scoped to a single project id, so operations on one project
 * can never touch another.
 */
import { projectStorage } from "./projectStorage";
import type { ExcalidrawElement, PersistedAppState, Project, BinaryFiles } from "../types/project";
import { PERSISTED_APP_STATE_KEYS } from "../types/project";
import { notifyProjectsChanged } from "../lib/projectEvents";

export const DEFAULT_PROJECT_NAME = "Untitled mind map";

export function generateProjectId() {
  // randomUUID only exists in secure contexts (HTTPS/localhost). Fall back to
  // getRandomValues so the app also works over plain http on a local network.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function pickPersistedAppState(appState: Record<string, unknown>): PersistedAppState {
  const result: Record<string, unknown> = {};
  for (const key of PERSISTED_APP_STATE_KEYS) {
    if (appState[key] !== undefined) result[key] = appState[key];
  }
  return result as PersistedAppState;
}

export async function createProject(
  init: {
    name?: string;
    elements?: readonly ExcalidrawElement[];
    appState?: PersistedAppState;
    files?: BinaryFiles;
  } = {},
): Promise<Project> {
  const now = Date.now();
  const project: Project = {
    id: generateProjectId(),
    name: init.name?.trim() || DEFAULT_PROJECT_NAME,
    createdAt: now,
    updatedAt: now,
    elements: init.elements ?? [],
    appState: init.appState ?? {},
    files: init.files ?? {},
  };
  await projectStorage.createProject(project);
  notifyProjectsChanged();
  return project;
}

export async function renameProject(id: string, name: string) {
  const trimmed = name.trim() || DEFAULT_PROJECT_NAME;
  const meta = await projectStorage.updateMeta(id, { name: trimmed, updatedAt: Date.now() });
  notifyProjectsChanged();
  return meta;
}

export async function duplicateProject(id: string) {
  const source = await projectStorage.loadProject(id);
  if (!source) throw new Error("Project not found");
  // structuredClone guarantees the copy shares no references with the source.
  const copy = await createProject({
    name: `${source.name} (copy)`,
    elements: structuredClone(source.elements),
    appState: structuredClone(source.appState),
    files: structuredClone(source.files),
  });
  const thumb = await projectStorage.getThumbnail(id);
  if (thumb) {
    await projectStorage.saveThumbnail({ ...thumb, projectId: copy.id });
    notifyProjectsChanged();
  }
  return copy;
}

export async function deleteProject(id: string) {
  await projectStorage.deleteProject(id);
  notifyProjectsChanged();
}
