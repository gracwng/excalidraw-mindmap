/** Development/test-only RemoteStore that talks to scripts/dev-sync-server.mjs. */
import type { BinaryFileData } from "../../types/project";
import type {
  RemoteProject,
  RemoteProjectSummary,
  RemoteProjectWrite,
  RemoteStore,
  WriteResult,
} from "./remote";

export class HttpRemote implements RemoteStore {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async call<T>(method: string, ...args: unknown[]): Promise<T> {
    const res = await fetch(`${this.baseUrl}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, args }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body.result as T;
  }

  listProjects() {
    return this.call<RemoteProjectSummary[]>("listProjects");
  }
  getProject(id: string) {
    return this.call<RemoteProject | null>("getProject", id);
  }
  insertProject(project: RemoteProjectWrite) {
    return this.call<WriteResult>("insertProject", project);
  }
  updateProject(project: RemoteProjectWrite, expectedRevision: number) {
    return this.call<WriteResult>("updateProject", project, expectedRevision);
  }
  async markDeleted(id: string) {
    await this.call("markDeleted", id);
  }
  async uploadFile(projectId: string, file: BinaryFileData) {
    await this.call("uploadFile", projectId, file);
  }
  downloadFile(projectId: string, fileId: string) {
    return this.call<BinaryFileData | null>("downloadFile", projectId, fileId);
  }
  async deleteFiles(projectId: string) {
    await this.call("deleteFiles", projectId);
  }
  subscribe(onChange: () => void) {
    const source = new EventSource(`${this.baseUrl}/events`);
    source.onmessage = () => onChange();
    return () => source.close();
  }
}
