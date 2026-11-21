import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createProjectStorage, isDirty, type ProjectStorage } from "../projectStorage";
import { MemoryRemote } from "./memoryRemote";
import { SyncEngine, type MergeElements } from "./syncEngine";
import type { BinaryFileData, ExcalidrawElement } from "../../types/project";

/**
 * Same rule as Excalidraw's reconcileElements (which needs a browser to import):
 * per element, the higher version wins; ties go to the lower versionNonce.
 */
const mergeSync = (
  local: readonly ExcalidrawElement[],
  remote: readonly ExcalidrawElement[],
): readonly ExcalidrawElement[] => {
  const byId = new Map<string, ExcalidrawElement>();
  for (const el of remote) byId.set(el.id, el);
  for (const el of local) {
    const other = byId.get(el.id);
    if (
      !other ||
      el.version > other.version ||
      (el.version === other.version && el.versionNonce < other.versionNonce)
    ) {
      byId.set(el.id, el);
    }
  }
  return [...byId.values()];
};
const merge: MergeElements = mergeSync;

let nonce = 1;
function rect(id: string, version = 1, extra: Partial<ExcalidrawElement> = {}) {
  return {
    id,
    type: "rectangle",
    version,
    versionNonce: nonce++,
    isDeleted: false,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    ...extra,
  } as unknown as ExcalidrawElement;
}
function bump(el: ExcalidrawElement, changes: Partial<ExcalidrawElement> = {}) {
  return { ...el, ...changes, version: el.version + 1, versionNonce: nonce++ } as ExcalidrawElement;
}

let dbCounter = 0;
function device(remote: MemoryRemote) {
  const storage = createProjectStorage(`test-db-${++dbCounter}`);
  const engine = new SyncEngine({ storage, remote, merge });
  return { storage, engine };
}

async function create(storage: ProjectStorage, id: string, elements: ExcalidrawElement[], name = id) {
  const now = Date.now();
  await storage.createProject({ id, name, createdAt: now, updatedAt: now, elements, appState: {}, files: {} });
}

async function edit(storage: ProjectStorage, id: string, elements: readonly ExcalidrawElement[]) {
  const project = await storage.loadProject(id);
  await storage.saveScene(
    { projectId: id, elements, appState: project!.appState, savedAt: Date.now() },
    [],
    Date.now(),
  );
}

async function elementsOf(storage: ProjectStorage, id: string) {
  return (await storage.loadProject(id))?.elements ?? null;
}
const liveIds = (els: readonly ExcalidrawElement[] | null) =>
  (els ?? []).filter((e) => !e.isDeleted).map((e) => e.id).sort();

describe("SyncEngine", () => {
  let remote: MemoryRemote;
  let laptop: ReturnType<typeof device>;
  let ipad: ReturnType<typeof device>;

  beforeEach(() => {
    remote = new MemoryRemote();
    laptop = device(remote);
    ipad = device(remote);
  });

  it("uploads a new project and downloads it on another device", async () => {
    await create(laptop.storage, "p1", [rect("a")], "Ideas");
    await laptop.engine.syncOnce();
    expect(remote.projects.get("p1")?.revision).toBe(1);
    expect(isDirty((await laptop.storage.getProjectMeta("p1"))!)).toBe(false);

    await ipad.engine.syncOnce();
    const onIpad = await ipad.storage.loadProject("p1");
    expect(onIpad?.name).toBe("Ideas");
    expect(liveIds(onIpad!.elements)).toEqual(["a"]);
    expect(isDirty(onIpad!)).toBe(false);
  });

  it("propagates edits and renames", async () => {
    const a = rect("a");
    await create(laptop.storage, "p1", [a]);
    await laptop.engine.syncOnce();
    await ipad.engine.syncOnce();

    await edit(ipad.storage, "p1", [bump(a, { x: 50 } as Partial<ExcalidrawElement>), rect("b")]);
    await ipad.storage.renameProject("p1", "Renamed on iPad", Date.now());
    await ipad.engine.syncOnce();
    await laptop.engine.syncOnce();

    const onLaptop = await laptop.storage.loadProject("p1");
    expect(onLaptop?.name).toBe("Renamed on iPad");
    expect(liveIds(onLaptop!.elements)).toEqual(["a", "b"]);
    expect(onLaptop!.elements.find((e) => e.id === "a")?.x).toBe(50);
  });

  it("merges concurrent edits to different shapes on two devices", async () => {
    const a = rect("a");
    const b = rect("b");
    await create(laptop.storage, "p1", [a, b]);
    await laptop.engine.syncOnce();
    await ipad.engine.syncOnce();

    // Both devices edit while "offline" from each other.
    await edit(laptop.storage, "p1", [bump(a, { x: 100 } as Partial<ExcalidrawElement>), b, rect("fromLaptop")]);
    await edit(ipad.storage, "p1", [a, bump(b, { y: 200 } as Partial<ExcalidrawElement>), rect("fromIpad")]);

    await laptop.engine.syncOnce(); // wins the race
    await ipad.engine.syncOnce(); // conflict → merge → push
    await laptop.engine.syncOnce(); // picks up the merge

    for (const dev of [laptop, ipad]) {
      const els = await elementsOf(dev.storage, "p1");
      expect(liveIds(els)).toEqual(["a", "b", "fromIpad", "fromLaptop"]);
      expect(els!.find((e) => e.id === "a")?.x).toBe(100);
      expect(els!.find((e) => e.id === "b")?.y).toBe(200);
    }
    expect(liveIds(remote.projects.get("p1")!.elements)).toEqual(["a", "b", "fromIpad", "fromLaptop"]);
  });

  it("deleting a shape on one device removes it everywhere, even after concurrent edits", async () => {
    const a = rect("a");
    const b = rect("b");
    await create(laptop.storage, "p1", [a, b]);
    await laptop.engine.syncOnce();
    await ipad.engine.syncOnce();

    await edit(laptop.storage, "p1", [bump(a, { isDeleted: true } as Partial<ExcalidrawElement>), b]);
    await edit(ipad.storage, "p1", [a, rect("c")]);
    await laptop.engine.syncOnce();
    await ipad.engine.syncOnce();
    await laptop.engine.syncOnce();

    expect(liveIds(await elementsOf(laptop.storage, "p1"))).toEqual(["b", "c"]);
    expect(liveIds(await elementsOf(ipad.storage, "p1"))).toEqual(["b", "c"]);
  });

  it("deleting a project syncs as a delete", async () => {
    await create(laptop.storage, "p1", [rect("a")]);
    await laptop.engine.syncOnce();
    await ipad.engine.syncOnce();
    expect(await ipad.storage.getProjectMeta("p1")).toBeDefined();

    await ipad.storage.deleteProject("p1", { tombstone: true });
    await ipad.engine.syncOnce();
    expect(remote.projects.get("p1")?.deleted).toBe(true);
    expect(await ipad.storage.listDeletions()).toEqual([]);

    await laptop.engine.syncOnce();
    expect(await laptop.storage.getProjectMeta("p1")).toBeUndefined();
  });

  it("does not let a stale device resurrect a deleted project", async () => {
    await create(laptop.storage, "p1", [rect("a")]);
    await laptop.engine.syncOnce();
    await ipad.engine.syncOnce();

    await laptop.storage.deleteProject("p1", { tombstone: true });
    await laptop.engine.syncOnce();
    await edit(ipad.storage, "p1", [rect("a"), rect("late")]);
    await ipad.engine.syncOnce();

    expect(remote.projects.get("p1")?.deleted).toBe(true);
    expect(await ipad.storage.getProjectMeta("p1")).toBeUndefined();
  });

  it("syncs images once and downloads them where they are referenced", async () => {
    const file: BinaryFileData = {
      id: "img1" as BinaryFileData["id"],
      mimeType: "image/png",
      dataURL: "data:image/png;base64,AAAA" as BinaryFileData["dataURL"],
      created: 1,
    };
    const image = { ...rect("i"), type: "image", fileId: "img1", status: "saved" } as unknown as ExcalidrawElement;
    const now = Date.now();
    await laptop.storage.createProject({
      id: "p1",
      name: "With image",
      createdAt: now,
      updatedAt: now,
      elements: [image],
      appState: {},
      files: { img1: file },
    });
    await laptop.engine.syncOnce();
    expect(remote.files.has("p1/img1")).toBe(true);
    expect(await laptop.storage.listPendingUploads("p1")).toEqual([]);

    await ipad.engine.syncOnce();
    const onIpad = await ipad.storage.loadProject("p1");
    expect(onIpad?.files.img1?.dataURL).toBe(file.dataURL);
  });

  it("keeps each device's own viewport but syncs canvas settings", async () => {
    const now = Date.now();
    await laptop.storage.createProject({
      id: "p1",
      name: "View",
      createdAt: now,
      updatedAt: now,
      elements: [rect("a")],
      appState: { scrollX: 500, zoom: { value: 2 } as never, viewBackgroundColor: "#ffc9c9" },
      files: {},
    });
    await laptop.engine.syncOnce();
    expect(remote.projects.get("p1")!.appState.scrollX).toBeUndefined();

    await ipad.engine.syncOnce();
    const onIpad = await ipad.storage.loadProject("p1");
    expect(onIpad!.appState.viewBackgroundColor).toBe("#ffc9c9");
    expect(onIpad!.appState.scrollX).toBeUndefined();
  });

  it("works offline and catches up later", async () => {
    await create(laptop.storage, "p1", [rect("a")]);
    remote.offline = true;
    await expect(laptop.engine.syncOnce()).rejects.toThrow("Network unavailable");
    expect(isDirty((await laptop.storage.getProjectMeta("p1"))!)).toBe(true);

    remote.offline = false;
    await laptop.engine.syncOnce();
    await ipad.engine.syncOnce();
    expect(liveIds(await elementsOf(ipad.storage, "p1"))).toEqual(["a"]);
  });

  it("does not ping-pong: a synced pair of devices stops writing", async () => {
    await create(laptop.storage, "p1", [rect("a")]);
    for (let i = 0; i < 3; i++) {
      await laptop.engine.syncOnce();
      await ipad.engine.syncOnce();
    }
    expect(remote.writes).toBe(1);
  });

  it("uploads projects created before signing in, and merges with an account that already has data", async () => {
    await create(laptop.storage, "local-only", [rect("x")]);
    await create(ipad.storage, "ipad-only", [rect("y")]);
    await laptop.engine.syncOnce();
    await ipad.engine.syncOnce();
    await laptop.engine.syncOnce();

    const ids = async (s: ProjectStorage) => (await s.listProjects()).map((p) => p.id).sort();
    expect(await ids(laptop.storage)).toEqual(["ipad-only", "local-only"]);
    expect(await ids(ipad.storage)).toEqual(["ipad-only", "local-only"]);
  });

  it("merges live edits through the open editor and keeps unsaved local work", async () => {
    const a = rect("a");
    await create(laptop.storage, "p1", [a]);
    await laptop.engine.syncOnce();
    await ipad.engine.syncOnce();

    // The iPad has p1 open with an edit that only exists in the editor so far.
    let live: readonly ExcalidrawElement[] = [a, rect("typing")];
    let renamed: string | null = null;
    const ipadEngine = new SyncEngine({
      storage: ipad.storage,
      remote,
      merge,
      getActiveEditor: (id) =>
        id === "p1"
          ? {
              flush: async () => {},
              mergeRemote: (remoteEls) => (live = mergeSync(live, remoteEls)),
              onRemoteRename: (name) => (renamed = name),
            }
          : undefined,
    });

    await edit(laptop.storage, "p1", [a, rect("fromLaptop")]);
    await laptop.storage.renameProject("p1", "New name", Date.now() + 1000);
    await laptop.engine.syncOnce();
    await ipadEngine.syncOnce();

    expect(liveIds(live)).toEqual(["a", "fromLaptop", "typing"]);
    expect(renamed).toBe("New name");
    // The merged scene (with the iPad's unsaved shape) went back to the cloud.
    expect(liveIds(remote.projects.get("p1")!.elements)).toEqual(["a", "fromLaptop", "typing"]);
  });
});
