/** In-memory RemoteStore with the same semantics as the Supabase one. Used by tests. */
import type { BinaryFileData } from "../../types/project";
import type { RemoteProject, RemoteProjectWrite, RemoteStore, WriteResult } from "./remote";

export class MemoryRemote implements RemoteStore {
  readonly projects = new Map<string, RemoteProject>();
  readonly files = new Map<string, BinaryFileData>();
  private listeners = new Set<() => void>();
  /** Set to make every call fail, to simulate being offline. */
  offline = false;
  writes = 0;

  private check() {
    if (this.offline) throw new Error("Network unavailable");
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  async listProjects() {
    this.check();
    return [...this.projects.values()].map(({ id, revision, deleted }) => ({ id, revision, deleted }));
  }

  async getProject(id: string) {
    this.check();
    const project = this.projects.get(id);
    return project ? structuredClone(project) : null;
  }

  async insertProject(project: RemoteProjectWrite): Promise<WriteResult> {
    this.check();
    if (this.projects.has(project.id)) return { ok: false, reason: "conflict" };
    this.projects.set(project.id, structuredClone({ ...project, revision: 1, deleted: false }));
    this.writes++;
    this.notify();
    return { ok: true, revision: 1 };
  }

  async updateProject(project: RemoteProjectWrite, expectedRevision: number): Promise<WriteResult> {
    this.check();
    const current = this.projects.get(project.id);
    if (!current || current.deleted || current.revision !== expectedRevision) {
      return { ok: false, reason: "conflict" };
    }
    const revision = expectedRevision + 1;
    this.projects.set(project.id, structuredClone({ ...project, revision, deleted: false }));
    this.writes++;
    this.notify();
    return { ok: true, revision };
  }

  async markDeleted(id: string) {
    this.check();
    const current = this.projects.get(id);
    if (current) {
      this.projects.set(id, { ...current, deleted: true, tabs: [] });
      this.notify();
    }
  }

  async uploadFile(projectId: string, file: BinaryFileData) {
    this.check();
    this.files.set(`${projectId}/${file.id}`, structuredClone(file));
  }

  async downloadFile(projectId: string, fileId: string) {
    this.check();
    const file = this.files.get(`${projectId}/${fileId}`);
    return file ? structuredClone(file) : null;
  }

  async deleteFiles(projectId: string) {
    this.check();
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(`${projectId}/`)) this.files.delete(key);
    }
  }

  subscribe(onChange: () => void) {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }
}
