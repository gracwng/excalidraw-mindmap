/**
 * The cloud side of sync, as an interface so the engine can be tested against
 * an in-memory fake and so the backend could be swapped later.
 */
import type {
  BinaryFileData,
  ExcalidrawElement,
  PersistedAppState,
} from "../../types/project";

export interface RemoteProjectSummary {
  id: string;
  revision: number;
  deleted: boolean;
}

export interface RemoteProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  elements: readonly ExcalidrawElement[];
  appState: PersistedAppState;
  revision: number;
  deleted: boolean;
}

export type RemoteProjectWrite = Omit<RemoteProject, "revision" | "deleted">;

export type WriteResult = { ok: true; revision: number } | { ok: false; reason: "conflict" };

export interface RemoteStore {
  listProjects(): Promise<RemoteProjectSummary[]>;
  getProject(id: string): Promise<RemoteProject | null>;
  /** Creates the project at revision 1. Conflict if it already exists. */
  insertProject(project: RemoteProjectWrite): Promise<WriteResult>;
  /**
   * Overwrites the project only if it is still at `expectedRevision` and not
   * deleted; the new revision is `expectedRevision + 1`.
   */
  updateProject(project: RemoteProjectWrite, expectedRevision: number): Promise<WriteResult>;
  /** Marks a project deleted (a tombstone other devices will see) and drops its data. */
  markDeleted(id: string): Promise<void>;
  uploadFile(projectId: string, file: BinaryFileData): Promise<void>;
  downloadFile(projectId: string, fileId: string): Promise<BinaryFileData | null>;
  deleteFiles(projectId: string): Promise<void>;
  /** Calls `onChange` when any of the user's projects change in the cloud. */
  subscribe(onChange: () => void): () => void;
}
