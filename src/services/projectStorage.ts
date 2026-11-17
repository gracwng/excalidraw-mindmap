/**
 * Persistence layer. No React, no Excalidraw runtime imports — only types.
 *
 * `ProjectStorage` is the contract the rest of the app depends on; the
 * IndexedDB implementation below can be swapped for a cloud-backed one later
 * without touching the editor or dashboard.
 *
 * IndexedDB layout (database "mindboard", v1):
 *   projects    keyPath "id"                   ProjectMeta
 *   scenes      keyPath "projectId"            ProjectScene
 *   files       keyPath ["projectId","id"]     StoredFile (index "byProject")
 *   thumbnails  keyPath "projectId"            ProjectThumbnail
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  BinaryFileData,
  BinaryFiles,
  Project,
  ProjectMeta,
  ProjectScene,
  ProjectThumbnail,
} from "../types/project";

export interface StoredFile extends BinaryFileData {
  projectId: string;
}

export interface ProjectStorage {
  listProjects(): Promise<ProjectMeta[]>;
  getProjectMeta(id: string): Promise<ProjectMeta | undefined>;
  loadProject(id: string): Promise<Project | undefined>;
  /** Writes metadata, scene and files atomically. */
  createProject(project: Project): Promise<void>;
  /**
   * Persists the latest scene plus any files not yet stored, atomically.
   * If `touch` is set, bumps the project's `updatedAt`.
   */
  saveScene(
    scene: ProjectScene,
    newFiles: readonly BinaryFileData[],
    touch: number | null,
  ): Promise<void>;
  updateMeta(id: string, patch: Partial<Omit<ProjectMeta, "id">>): Promise<ProjectMeta | undefined>;
  deleteProject(id: string): Promise<void>;
  saveThumbnail(thumbnail: ProjectThumbnail): Promise<void>;
  getThumbnail(id: string): Promise<ProjectThumbnail | undefined>;
  deleteThumbnail(id: string): Promise<void>;
  listThumbnails(): Promise<ProjectThumbnail[]>;
}

interface MindboardDB extends DBSchema {
  projects: { key: string; value: ProjectMeta };
  scenes: { key: string; value: ProjectScene };
  files: {
    key: [string, string];
    value: StoredFile;
    indexes: { byProject: string };
  };
  thumbnails: { key: string; value: ProjectThumbnail };
}

const DB_NAME = "mindboard";
const DB_VERSION = 1;

class IndexedDBProjectStorage implements ProjectStorage {
  private dbPromise: Promise<IDBPDatabase<MindboardDB>> | null = null;

  private db() {
    if (!this.dbPromise) {
      this.dbPromise = openDB<MindboardDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          db.createObjectStore("projects", { keyPath: "id" });
          db.createObjectStore("scenes", { keyPath: "projectId" });
          const files = db.createObjectStore("files", { keyPath: ["projectId", "id"] });
          files.createIndex("byProject", "projectId");
          db.createObjectStore("thumbnails", { keyPath: "projectId" });
        },
      }).catch((err) => {
        this.dbPromise = null;
        throw err;
      });
    }
    return this.dbPromise;
  }

  async listProjects() {
    return (await this.db()).getAll("projects");
  }

  async getProjectMeta(id: string) {
    return (await this.db()).get("projects", id);
  }

  async loadProject(id: string): Promise<Project | undefined> {
    const db = await this.db();
    const tx = db.transaction(["projects", "scenes", "files"], "readonly");
    const [meta, scene, files] = await Promise.all([
      tx.objectStore("projects").get(id),
      tx.objectStore("scenes").get(id),
      tx.objectStore("files").index("byProject").getAll(id),
      tx.done,
    ]);
    if (!meta) return undefined;
    return {
      ...meta,
      elements: scene?.elements ?? [],
      appState: scene?.appState ?? {},
      files: toBinaryFiles(files),
    };
  }

  async createProject(project: Project) {
    const db = await this.db();
    const tx = db.transaction(["projects", "scenes", "files"], "readwrite");
    const { elements, appState, files, ...meta } = project;
    await Promise.all([
      tx.objectStore("projects").put(meta),
      tx.objectStore("scenes").put({
        projectId: project.id,
        elements,
        appState,
        savedAt: project.updatedAt,
      }),
      ...Object.values(files).map((file) =>
        tx.objectStore("files").put({ ...file, projectId: project.id }),
      ),
      tx.done,
    ]);
  }

  async saveScene(scene: ProjectScene, newFiles: readonly BinaryFileData[], touch: number | null) {
    const db = await this.db();
    const tx = db.transaction(["projects", "scenes", "files"], "readwrite");
    const projects = tx.objectStore("projects");
    const meta = await projects.get(scene.projectId);
    if (!meta) {
      // Project was deleted (e.g. from another tab) — don't resurrect it.
      tx.abort();
      await tx.done.catch(() => {});
      throw new ProjectNotFoundError(scene.projectId);
    }
    await Promise.all([
      tx.objectStore("scenes").put(scene),
      ...newFiles.map((file) =>
        tx.objectStore("files").put({ ...file, projectId: scene.projectId }),
      ),
      touch !== null ? projects.put({ ...meta, updatedAt: touch }) : null,
      tx.done,
    ]);
  }

  async updateMeta(id: string, patch: Partial<Omit<ProjectMeta, "id">>) {
    const db = await this.db();
    const tx = db.transaction("projects", "readwrite");
    const meta = await tx.store.get(id);
    if (!meta) {
      await tx.done;
      return undefined;
    }
    const next = { ...meta, ...patch, id };
    await Promise.all([tx.store.put(next), tx.done]);
    return next;
  }

  async deleteProject(id: string) {
    const db = await this.db();
    const tx = db.transaction(["projects", "scenes", "files", "thumbnails"], "readwrite");
    const fileKeys = await tx.objectStore("files").index("byProject").getAllKeys(id);
    await Promise.all([
      tx.objectStore("projects").delete(id),
      tx.objectStore("scenes").delete(id),
      tx.objectStore("thumbnails").delete(id),
      ...fileKeys.map((key) => tx.objectStore("files").delete(key)),
      tx.done,
    ]);
  }

  async saveThumbnail(thumbnail: ProjectThumbnail) {
    const db = await this.db();
    const tx = db.transaction(["projects", "thumbnails"], "readwrite");
    // Only store thumbnails for projects that still exist.
    if (await tx.objectStore("projects").getKey(thumbnail.projectId)) {
      await tx.objectStore("thumbnails").put(thumbnail);
    }
    await tx.done;
  }

  async getThumbnail(id: string) {
    return (await this.db()).get("thumbnails", id);
  }

  async deleteThumbnail(id: string) {
    await (await this.db()).delete("thumbnails", id);
  }

  async listThumbnails() {
    return (await this.db()).getAll("thumbnails");
  }
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project ${id} no longer exists`);
    this.name = "ProjectNotFoundError";
  }
}

function toBinaryFiles(files: StoredFile[]): BinaryFiles {
  const result: BinaryFiles = {};
  for (const { projectId: _projectId, ...file } of files) {
    result[file.id] = file;
  }
  return result;
}

export const projectStorage: ProjectStorage = new IndexedDBProjectStorage();
