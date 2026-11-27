import type { SupabaseClient } from "@supabase/supabase-js";
import { RemoteError } from "./syncErrors";
import type { BinaryFileData, ExcalidrawElement, PersistedAppState } from "../../types/project";
import { defaultTab } from "../../lib/tabs";
import type {
  RemoteProject,
  RemoteProjectSummary,
  RemoteProjectWrite,
  RemoteStore,
  WriteResult,
} from "./remote";

const TABLE = "projects";
const BUCKET = "mindboard-files";
const PAGE_SIZE = 1000;

interface ProjectRow {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  tabs: RemoteProject["tabs"] | null;
  /** Pre-tabs rows kept a single canvas in these columns. */
  elements: readonly ExcalidrawElement[] | null;
  app_state: PersistedAppState | null;
  revision: number;
  deleted: boolean;
}

function fromRow(row: ProjectRow): RemoteProject {
  return {
    id: row.id,
    name: row.name,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    tabs: row.tabs?.length ? row.tabs : [defaultTab(row.elements ?? [], row.app_state ?? {})],
    revision: Number(row.revision),
    deleted: row.deleted,
  };
}

function toRow(project: RemoteProjectWrite) {
  return {
    id: project.id,
    name: project.name,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
    tabs: project.tabs,
    elements: [],
    app_state: {},
  };
}

/** RemoteStore backed by Supabase Postgres (rows) and Storage (images). RLS scopes everything to `userId`. */
export class SupabaseRemote implements RemoteStore {
  private readonly client: SupabaseClient;
  private readonly userId: string;

  constructor(client: SupabaseClient, userId: string) {
    this.client = client;
    this.userId = userId;
  }

  async listProjects(): Promise<RemoteProjectSummary[]> {
    const all: RemoteProjectSummary[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await this.client
        .from(TABLE)
        .select("id, revision, deleted")
        .order("id")
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new RemoteError("listing your mindboards", error);
      all.push(...data.map((r) => ({ id: r.id, revision: Number(r.revision), deleted: r.deleted })));
      if (data.length < PAGE_SIZE) return all;
    }
  }

  async getProject(id: string) {
    const { data, error } = await this.client.from(TABLE).select("*").eq("id", id).maybeSingle();
    if (error) throw new RemoteError("downloading a mindboard", error);
    return data ? fromRow(data as ProjectRow) : null;
  }

  async insertProject(project: RemoteProjectWrite): Promise<WriteResult> {
    const { error } = await this.client.from(TABLE).insert({ ...toRow(project), revision: 1 });
    if (error) {
      if (error.code === "23505") return { ok: false, reason: "conflict" };
      throw new RemoteError("uploading a new mindboard", error);
    }
    return { ok: true, revision: 1 };
  }

  async updateProject(project: RemoteProjectWrite, expectedRevision: number): Promise<WriteResult> {
    const revision = expectedRevision + 1;
    const { data, error } = await this.client
      .from(TABLE)
      .update({ ...toRow(project), revision })
      .eq("id", project.id)
      .eq("revision", expectedRevision)
      .eq("deleted", false)
      .select("revision");
    if (error) throw new RemoteError("uploading changes", error);
    return data.length === 1 ? { ok: true, revision } : { ok: false, reason: "conflict" };
  }

  async markDeleted(id: string) {
    const { error } = await this.client
      .from(TABLE)
      .update({ deleted: true, tabs: [], elements: [], app_state: {} })
      .eq("id", id);
    if (error) throw new RemoteError("deleting a mindboard", error);
  }

  private path(projectId: string, fileId?: string) {
    return fileId ? `${this.userId}/${projectId}/${fileId}` : `${this.userId}/${projectId}`;
  }

  async uploadFile(projectId: string, file: BinaryFileData) {
    const body = new Blob([JSON.stringify(file)], { type: "application/json" });
    const { error } = await this.client.storage
      .from(BUCKET)
      .upload(this.path(projectId, file.id), body, { upsert: true, contentType: "application/json" });
    if (error) throw new RemoteError("uploading an image", error);
  }

  async downloadFile(projectId: string, fileId: string) {
    const { data, error } = await this.client.storage
      .from(BUCKET)
      .download(this.path(projectId, fileId));
    if (error) {
      const status = (error as { status?: number; statusCode?: string }).status;
      if (status === 400 || status === 404 || /not found/i.test(error.message)) return null;
      throw new RemoteError("downloading an image", error);
    }
    return JSON.parse(await data.text()) as BinaryFileData;
  }

  async deleteFiles(projectId: string) {
    const { data, error } = await this.client.storage.from(BUCKET).list(this.path(projectId));
    if (error) throw new RemoteError("deleting images", error);
    if (!data.length) return;
    const { error: removeError } = await this.client.storage
      .from(BUCKET)
      .remove(data.map((f) => this.path(projectId, f.name)));
    if (removeError) throw new RemoteError("deleting images", removeError);
  }

  subscribe(onChange: () => void) {
    const channel = this.client
      .channel(`mindboard-projects-${this.userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLE, filter: `user_id=eq.${this.userId}` },
        () => onChange(),
      )
      .subscribe();
    return () => {
      void this.client.removeChannel(channel);
    };
  }
}
