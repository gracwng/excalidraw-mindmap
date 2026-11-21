/**
 * Persistence layer. No React, no Excalidraw runtime imports — only types.
 *
 * `ProjectStorage` is the contract the rest of the app depends on. This
 * IndexedDB implementation is the local source of truth on every device; the
 * sync engine (services/sync) mirrors it to the cloud.
 *
 * IndexedDB layout (database "mindboard"):
 *   projects    keyPath "id"                   ProjectMeta
 *   scenes      keyPath "projectId"            ProjectScene
 *   files       keyPath ["projectId","id"]     StoredFile (index "byProject")
 *   thumbnails  keyPath "projectId"            ProjectThumbnail
 *   deletions   keyPath "id"                   Deletion (v2: deletes waiting to sync)
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawElement,
  PersistedAppState,
  Project,
  ProjectMeta,
  ProjectScene,
  ProjectThumbnail,
} from "../types/project";
import { DEVICE_ONLY_APP_STATE_KEYS } from "../types/project";

export interface StoredFile extends BinaryFileData {
  projectId: string;
  /** True once this file exists in cloud storage. */
  uploaded?: boolean;
}

export interface Deletion {
  id: string;
  deletedAt: number;
}

/** A project as it exists in the cloud, ready to be written locally. */
export interface IncomingProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  elements: readonly ExcalidrawElement[];
  appState: PersistedAppState;
  revision: number;
}

export interface ProjectStorage {
  listProjects(): Promise<ProjectMeta[]>;
  getProjectMeta(id: string): Promise<ProjectMeta | undefined>;
  loadProject(id: string): Promise<Project | undefined>;
  /** Writes metadata, scene and files atomically. */
  createProject(project: Omit<Project, keyof SyncFields>): Promise<void>;
  /**
   * Persists the latest scene plus any files not yet stored, atomically.
   * If `touch` is set, this is a content change: bumps `updatedAt` and `localVersion`.
   */
  saveScene(
    scene: ProjectScene,
    newFiles: readonly BinaryFileData[],
    touch: number | null,
  ): Promise<void>;
  renameProject(id: string, name: string, at: number): Promise<ProjectMeta | undefined>;
  /** Deletes a project. With `tombstone`, records the delete so it syncs to the cloud. */
  deleteProject(id: string, options?: { tombstone?: boolean }): Promise<void>;
  saveThumbnail(thumbnail: ProjectThumbnail): Promise<void>;
  getThumbnail(id: string): Promise<ProjectThumbnail | undefined>;
  deleteThumbnail(id: string): Promise<void>;
  listThumbnails(): Promise<ProjectThumbnail[]>;

  // --- sync support ---
  listDeletions(): Promise<Deletion[]>;
  clearDeletion(id: string): Promise<void>;
  /** Records a successful push of `pushedVersion` that produced `revision`. */
  markSynced(id: string, pushedVersion: number, revision: number): Promise<void>;
  /**
   * Writes a cloud version of a project locally. If `expectedLocalVersion` is a
   * number and the local project changed since it was read, nothing is written
   * and `false` is returned. With `dirty`, the result still needs pushing (it
   * contains local edits merged with the cloud copy).
   */
  applyRemoteProject(
    incoming: IncomingProject,
    options: { expectedLocalVersion: number | null; dirty: boolean },
  ): Promise<boolean>;
  putFiles(projectId: string, files: readonly BinaryFileData[], uploaded: boolean): Promise<void>;
  listPendingUploads(projectId: string): Promise<BinaryFileData[]>;
  markFilesUploaded(projectId: string, fileIds: readonly string[]): Promise<void>;
  getFileIds(projectId: string): Promise<Set<string>>;
  /** Forget all cloud state (used when a different account signs in). */
  resetSyncState(): Promise<void>;
}

type SyncFields = Pick<ProjectMeta, "localVersion" | "syncedVersion" | "remoteRevision">;

interface MindboardDB extends DBSchema {
  projects: { key: string; value: ProjectMeta };
  scenes: { key: string; value: ProjectScene };
  files: {
    key: [string, string];
    value: StoredFile;
    indexes: { byProject: string };
  };
  thumbnails: { key: string; value: ProjectThumbnail };
  deletions: { key: string; value: Deletion };
}

const DB_VERSION = 2;

/** Projects created before sync existed lack sync fields; treat them as never synced. */
function normalizeMeta(meta: ProjectMeta): ProjectMeta {
  return {
    ...meta,
    localVersion: meta.localVersion ?? 1,
    syncedVersion: meta.syncedVersion ?? 0,
    remoteRevision: meta.remoteRevision ?? null,
  };
}

export function isDirty(meta: ProjectMeta) {
  return meta.localVersion !== meta.syncedVersion;
}

class IndexedDBProjectStorage implements ProjectStorage {
  private dbPromise: Promise<IDBPDatabase<MindboardDB>> | null = null;
  private readonly dbName: string;

  constructor(dbName: string) {
    this.dbName = dbName;
  }

  private db() {
    if (!this.dbPromise) {
      this.dbPromise = openDB<MindboardDB>(this.dbName, DB_VERSION, {
        upgrade(db, oldVersion) {
          if (oldVersion < 1) {
            db.createObjectStore("projects", { keyPath: "id" });
            db.createObjectStore("scenes", { keyPath: "projectId" });
            const files = db.createObjectStore("files", { keyPath: ["projectId", "id"] });
            files.createIndex("byProject", "projectId");
            db.createObjectStore("thumbnails", { keyPath: "projectId" });
          }
          if (oldVersion < 2) {
            db.createObjectStore("deletions", { keyPath: "id" });
          }
        },
        blocking(_current, _blocked, event) {
          // A newer version of the app opened in another tab; step aside.
          (event.target as IDBDatabase).close();
        },
      }).catch((err) => {
        this.dbPromise = null;
        throw err;
      });
    }
    return this.dbPromise;
  }

  async listProjects() {
    return (await (await this.db()).getAll("projects")).map(normalizeMeta);
  }

  async getProjectMeta(id: string) {
    const meta = await (await this.db()).get("projects", id);
    return meta && normalizeMeta(meta);
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
      ...normalizeMeta(meta),
      elements: scene?.elements ?? [],
      appState: scene?.appState ?? {},
      files: toBinaryFiles(files),
    };
  }

  async createProject(project: Omit<Project, keyof SyncFields>) {
    const db = await this.db();
    const tx = db.transaction(["projects", "scenes", "files"], "readwrite");
    const { elements, appState, files, ...meta } = project;
    await Promise.all([
      tx.objectStore("projects").put({
        ...meta,
        localVersion: 1,
        syncedVersion: 0,
        remoteRevision: null,
      }),
      tx.objectStore("scenes").put({
        projectId: project.id,
        elements,
        appState,
        savedAt: project.updatedAt,
      }),
      ...Object.values(files).map((file) =>
        tx.objectStore("files").put({ ...file, projectId: project.id, uploaded: false }),
      ),
      tx.done,
    ]);
  }

  async saveScene(scene: ProjectScene, newFiles: readonly BinaryFileData[], touch: number | null) {
    const db = await this.db();
    const tx = db.transaction(["projects", "scenes", "files"], "readwrite");
    const projects = tx.objectStore("projects");
    const raw = await projects.get(scene.projectId);
    if (!raw) {
      // Project was deleted (e.g. from another tab or device) — don't resurrect it.
      tx.abort();
      await tx.done.catch(() => {});
      throw new ProjectNotFoundError(scene.projectId);
    }
    const meta = normalizeMeta(raw);
    await Promise.all([
      tx.objectStore("scenes").put(scene),
      ...newFiles.map((file) =>
        tx.objectStore("files").put({ ...file, projectId: scene.projectId, uploaded: false }),
      ),
      touch !== null
        ? projects.put({ ...meta, updatedAt: touch, localVersion: meta.localVersion + 1 })
        : null,
      tx.done,
    ]);
  }

  async renameProject(id: string, name: string, at: number) {
    const db = await this.db();
    const tx = db.transaction("projects", "readwrite");
    const raw = await tx.store.get(id);
    if (!raw) {
      await tx.done;
      return undefined;
    }
    const meta = normalizeMeta(raw);
    const next = { ...meta, name, updatedAt: at, localVersion: meta.localVersion + 1 };
    await Promise.all([tx.store.put(next), tx.done]);
    return next;
  }

  async deleteProject(id: string, options: { tombstone?: boolean } = {}) {
    const db = await this.db();
    const tx = db.transaction(
      ["projects", "scenes", "files", "thumbnails", "deletions"],
      "readwrite",
    );
    const meta = await tx.objectStore("projects").get(id);
    const fileKeys = await tx.objectStore("files").index("byProject").getAllKeys(id);
    await Promise.all([
      tx.objectStore("projects").delete(id),
      tx.objectStore("scenes").delete(id),
      tx.objectStore("thumbnails").delete(id),
      ...fileKeys.map((key) => tx.objectStore("files").delete(key)),
      options.tombstone && meta
        ? tx.objectStore("deletions").put({ id, deletedAt: Date.now() })
        : null,
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

  // --- sync support ---

  async listDeletions() {
    return (await this.db()).getAll("deletions");
  }

  async clearDeletion(id: string) {
    await (await this.db()).delete("deletions", id);
  }

  async markSynced(id: string, pushedVersion: number, revision: number) {
    const db = await this.db();
    const tx = db.transaction("projects", "readwrite");
    const raw = await tx.store.get(id);
    if (raw) {
      const meta = normalizeMeta(raw);
      await tx.store.put({
        ...meta,
        syncedVersion: Math.max(meta.syncedVersion, pushedVersion),
        remoteRevision: revision,
      });
    }
    await tx.done;
  }

  async applyRemoteProject(
    incoming: IncomingProject,
    { expectedLocalVersion, dirty }: { expectedLocalVersion: number | null; dirty: boolean },
  ) {
    const db = await this.db();
    const tx = db.transaction(["projects", "scenes"], "readwrite");
    const raw = await tx.objectStore("projects").get(incoming.id);
    const meta = raw ? normalizeMeta(raw) : null;
    if (expectedLocalVersion !== null && (meta?.localVersion ?? null) !== expectedLocalVersion) {
      tx.abort();
      await tx.done.catch(() => {});
      return false;
    }
    const scene = await tx.objectStore("scenes").get(incoming.id);
    // Keep this device's own viewport; take everything else from the cloud.
    const appState: Record<string, unknown> = { ...incoming.appState };
    for (const key of DEVICE_ONLY_APP_STATE_KEYS) {
      const local = scene?.appState?.[key];
      if (local !== undefined) appState[key] = local;
      else delete appState[key];
    }
    const localVersion = meta ? (dirty ? meta.localVersion + 1 : meta.localVersion) : 1;
    await Promise.all([
      tx.objectStore("projects").put({
        id: incoming.id,
        name: incoming.name,
        createdAt: incoming.createdAt,
        updatedAt: incoming.updatedAt,
        localVersion,
        syncedVersion: dirty ? (meta?.syncedVersion ?? 0) : localVersion,
        remoteRevision: incoming.revision,
      }),
      tx.objectStore("scenes").put({
        projectId: incoming.id,
        elements: incoming.elements,
        appState: appState as PersistedAppState,
        savedAt: Date.now(),
      }),
      tx.done,
    ]);
    return true;
  }

  async putFiles(projectId: string, files: readonly BinaryFileData[], uploaded: boolean) {
    if (files.length === 0) return;
    const db = await this.db();
    const tx = db.transaction("files", "readwrite");
    await Promise.all([
      ...files.map((file) => tx.store.put({ ...file, projectId, uploaded })),
      tx.done,
    ]);
  }

  async listPendingUploads(projectId: string) {
    const files = await (await this.db()).getAllFromIndex("files", "byProject", projectId);
    return files
      .filter((f) => !f.uploaded)
      .map(({ projectId: _p, uploaded: _u, ...file }) => file as BinaryFileData);
  }

  async markFilesUploaded(projectId: string, fileIds: readonly string[]) {
    if (fileIds.length === 0) return;
    const db = await this.db();
    const tx = db.transaction("files", "readwrite");
    for (const id of fileIds) {
      const file = await tx.store.get([projectId, id]);
      if (file) await tx.store.put({ ...file, uploaded: true });
    }
    await tx.done;
  }

  async getFileIds(projectId: string) {
    const keys = await (await this.db()).getAllKeysFromIndex("files", "byProject", projectId);
    return new Set(keys.map(([, id]) => id));
  }

  async resetSyncState() {
    const db = await this.db();
    const tx = db.transaction(["projects", "files", "deletions"], "readwrite");
    for (const raw of await tx.objectStore("projects").getAll()) {
      const meta = normalizeMeta(raw);
      await tx.objectStore("projects").put({
        ...meta,
        syncedVersion: meta.localVersion - 1,
        remoteRevision: null,
      });
    }
    for (const file of await tx.objectStore("files").getAll()) {
      if (file.uploaded) await tx.objectStore("files").put({ ...file, uploaded: false });
    }
    await tx.objectStore("deletions").clear();
    await tx.done;
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
  for (const { projectId: _projectId, uploaded: _uploaded, ...file } of files) {
    result[file.id] = file;
  }
  return result;
}

export function createProjectStorage(dbName = "mindboard"): ProjectStorage {
  return new IndexedDBProjectStorage(dbName);
}

export const projectStorage: ProjectStorage = createProjectStorage();
