/**
 * Two-way sync between this device's IndexedDB (the source of truth for the UI)
 * and the cloud.
 *
 * One sync pass:
 *   1. push local deletes (tombstones)
 *   2. pull: for every cloud project whose revision is newer than what we last
 *      saw, download it and either replace the local copy (no local edits) or
 *      merge element-by-element with local edits
 *   3. push: upload images, then write each project with local edits using
 *      optimistic concurrency (only succeeds if the cloud is still at the
 *      revision we last saw; otherwise pull+merge and retry)
 *
 * Merging is per tab (see mergeTabs) and, within a tab, uses Excalidraw's own
 * per-element reconciliation (newer element version wins; deletes are
 * tombstones with a higher version), so edits to different shapes or tabs on
 * two devices both survive.
 */
import type {
  BinaryFileData,
  ExcalidrawElement,
  PersistedAppState,
  ProjectTab,
} from "../../types/project";
import { DEVICE_ONLY_APP_STATE_KEYS } from "../../types/project";
import { isDirty, type IncomingProject, type ProjectStorage } from "../projectStorage";
import type { RemoteProject, RemoteProjectWrite, RemoteStore } from "./remote";
import { mergeTabs, tabsSignature, type MergeElements } from "./mergeTabs";

export type { MergeElements } from "./mergeTabs";
export { sceneSignature } from "./mergeTabs";

/** An editor that currently has a project open and must take part in merges. */
export interface ActiveEditorHandle {
  /** Persist any pending local edits. */
  flush(): Promise<void>;
  /**
   * Bring merged tabs into the live editor: merge the open tab with the live
   * canvas (picking up edits made since the flush) and update the tab list.
   * Returns the tabs with the open tab's canvas replaced by the live result.
   */
  mergeRemote(tabs: ProjectTab[], files: BinaryFileData[]): ProjectTab[];
  /** The cloud copy was renamed. */
  onRemoteRename(name: string): void;
  /** The project was deleted on another device. */
  onRemoteDelete?(): void;
}

export interface SyncEngineDeps {
  storage: ProjectStorage;
  remote: RemoteStore;
  merge: MergeElements;
  getActiveEditor?: (projectId: string) => ActiveEditorHandle | undefined;
  /** Called after a project was created/changed/deleted locally because of the cloud. */
  onLocalChange?: (projectId: string, kind: "updated" | "deleted") => void;
}

const MAX_PUSH_ATTEMPTS = 3;

function cloudAppState(appState: PersistedAppState): PersistedAppState {
  const copy: Record<string, unknown> = { ...appState };
  for (const key of DEVICE_ONLY_APP_STATE_KEYS) delete copy[key];
  return copy as PersistedAppState;
}

/** Tabs as sent to the cloud: without this device's scroll/zoom. */
function cloudTabs(tabs: readonly ProjectTab[]): ProjectTab[] {
  return tabs.map((tab) => ({ ...tab, appState: cloudAppState(tab.appState) }));
}

function referencedFileIds(tabs: readonly ProjectTab[]) {
  const ids = new Set<string>();
  for (const tab of tabs) {
    for (const el of tab.elements as readonly ExcalidrawElement[]) {
      if (el.type === "image" && !el.isDeleted && el.fileId) ids.add(el.fileId);
    }
  }
  return ids;
}

export class SyncEngine {
  private readonly deps: SyncEngineDeps;

  constructor(deps: SyncEngineDeps) {
    this.deps = deps;
  }

  /** Runs one full sync pass. Throws on network/remote errors; safe to retry. */
  async syncOnce() {
    await this.pushDeletions();
    await this.pullAll();
    await this.pushAll();
  }

  private async pushDeletions() {
    const { storage, remote } = this.deps;
    for (const deletion of await storage.listDeletions()) {
      await remote.markDeleted(deletion.id);
      await remote.deleteFiles(deletion.id);
      await storage.clearDeletion(deletion.id);
    }
  }

  private async pullAll() {
    const { storage, remote } = this.deps;
    const [summaries, locals] = await Promise.all([remote.listProjects(), storage.listProjects()]);
    const localById = new Map(locals.map((m) => [m.id, m]));
    const pendingDeletes = new Set((await storage.listDeletions()).map((d) => d.id));

    for (const summary of summaries) {
      if (pendingDeletes.has(summary.id)) continue;
      const local = localById.get(summary.id);
      if (summary.deleted) {
        if (local) await this.deleteLocally(summary.id);
        continue;
      }
      const isNewer =
        !local || local.remoteRevision === null || summary.revision > local.remoteRevision;
      if (isNewer) {
        const project = await remote.getProject(summary.id);
        if (project) await this.applyRemote(project);
      }
    }
  }

  private async pushAll() {
    const { storage } = this.deps;
    for (const meta of await storage.listProjects()) {
      if (isDirty(meta) || meta.remoteRevision === null) {
        await this.pushProject(meta.id);
      }
    }
  }

  private async deleteLocally(id: string) {
    await this.deps.storage.deleteProject(id, { tombstone: false });
    this.deps.getActiveEditor?.(id)?.onRemoteDelete?.();
    this.deps.onLocalChange?.(id, "deleted");
  }

  /** Downloads images the scene references that this device doesn't have yet. */
  private async fetchMissingFiles(projectId: string, tabs: readonly ProjectTab[]) {
    const { storage, remote } = this.deps;
    const have = await storage.getFileIds(projectId);
    const files: BinaryFileData[] = [];
    for (const fileId of referencedFileIds(tabs)) {
      if (have.has(fileId)) continue;
      const file = await remote.downloadFile(projectId, fileId);
      if (file) files.push(file);
    }
    return files;
  }

  /** Brings a cloud version of a project into local storage (and the open editor). */
  private async applyRemote(project: RemoteProject) {
    const { storage, merge, getActiveEditor } = this.deps;
    if (project.deleted) {
      await this.deleteLocally(project.id);
      return;
    }

    const files = await this.fetchMissingFiles(project.id, project.tabs);
    const active = getActiveEditor?.(project.id);
    if (active) await active.flush();

    const local = await storage.loadProject(project.id);
    // Projects deleted locally while we were downloading stay deleted.
    if (!local && (await storage.listDeletions()).some((d) => d.id === project.id)) return;

    const localDirty = !!local && isDirty(local);
    const name =
      local && localDirty && local.updatedAt > project.updatedAt ? local.name : project.name;

    let tabs: ProjectTab[];
    if (local && (localDirty || active)) {
      tabs = await mergeTabs(local.tabs, project.tabs, merge);
    } else {
      tabs = project.tabs;
    }
    if (active) tabs = active.mergeRemote(tabs, files);

    const dirty = tabsSignature(tabs) !== tabsSignature(project.tabs) || name !== project.name;

    const incoming: IncomingProject = {
      id: project.id,
      name,
      createdAt: project.createdAt,
      updatedAt: dirty ? Math.max(project.updatedAt, local?.updatedAt ?? 0) : project.updatedAt,
      tabs,
      revision: project.revision,
    };

    await storage.putFiles(project.id, files, true);
    const applied = await storage.applyRemoteProject(incoming, {
      // An open editor merged its live state; otherwise only write if nothing changed meanwhile.
      expectedLocalVersion: active || !local ? null : local.localVersion,
      dirty,
    });
    if (!applied) return; // edited while we were working — the next pass will merge

    if (active && name !== local?.name) active.onRemoteRename(name);
    this.deps.onLocalChange?.(project.id, "updated");
  }

  private async uploadPendingFiles(projectId: string) {
    const { storage, remote } = this.deps;
    const pending = await storage.listPendingUploads(projectId);
    for (const file of pending) await remote.uploadFile(projectId, file);
    await storage.markFilesUploaded(
      projectId,
      pending.map((f) => f.id),
    );
  }

  private async pushProject(id: string) {
    const { storage, remote } = this.deps;
    for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt++) {
      const project = await storage.loadProject(id);
      if (!project) return;
      await this.uploadPendingFiles(id);

      const write: RemoteProjectWrite = {
        id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        tabs: cloudTabs(project.tabs),
      };

      const result =
        project.remoteRevision === null
          ? await remote.insertProject(write)
          : await remote.updateProject(write, project.remoteRevision);

      if (result.ok) {
        await storage.markSynced(id, project.localVersion, result.revision);
        return;
      }

      // Someone else wrote first. Fetch their version and merge, then retry.
      const current = await remote.getProject(id);
      if (!current) {
        // Our record of it is stale (e.g. removed in the cloud) — upload it fresh.
        const inserted = await remote.insertProject(write);
        if (inserted.ok) await storage.markSynced(id, project.localVersion, inserted.revision);
        return;
      }
      await this.applyRemote(current); // deletes locally if the cloud copy was deleted
    }
  }
}
