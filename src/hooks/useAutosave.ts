/**
 * Debounced, race-free autosave for a single project.
 *
 * Guarantees:
 *  - Saves are serialized: at most one write is in flight per project, and each
 *    write snapshots the *latest* scene at the moment it starts, so an older
 *    async save can never land after (and overwrite) a newer one.
 *  - Edits made while a save is in flight are picked up by the same save loop.
 *  - No-op onChange calls (cursor moves, selection, hover) don't trigger writes:
 *    we diff element versions, the persisted appState subset, and file ids.
 *  - Pending changes are flushed on unmount (switching projects / going back),
 *    when the tab is hidden, and on pagehide/beforeunload.
 *  - Failed saves keep the changes dirty and retry with backoff.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { hashElementsVersion } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { projectStorage, ProjectNotFoundError } from "../services/projectStorage";
import { pickPersistedAppState } from "../services/projectService";
import { updateThumbnail } from "../services/thumbnailService";
import { notifyProjectsChanged } from "../lib/projectEvents";
import { clearUnloadBackup, writeUnloadBackup } from "../services/unloadBackup";
import type { PersistedAppState, SaveStatus } from "../types/project";

const SAVE_DEBOUNCE_MS = 800;
const THUMBNAIL_INTERVAL_MS = 5000;
const RETRY_DELAYS_MS = [2000, 5000, 10000, 30000];

interface Snapshot {
  elements: readonly ExcalidrawElement[];
  appState: PersistedAppState;
  files: BinaryFiles;
}

interface AutosaveState {
  baselineSet: boolean;
  elementsHash: number;
  appStateKey: string;
  savedFileIds: Set<string>;
  latest: Snapshot | null;
  dirty: boolean;
  contentDirty: boolean;
  saving: Promise<void> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryCount: number;
  thumbnailDirty: boolean;
  thumbnailRunning: boolean;
  lastThumbnailAt: number;
  projectGone: boolean;
}

export function useAutosave(projectId: string, initialFiles: BinaryFiles) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const ref = useRef<AutosaveState>(null as unknown as AutosaveState);
  if (ref.current === null) {
    ref.current = {
      baselineSet: false,
      elementsHash: 0,
      appStateKey: "",
      savedFileIds: new Set(Object.keys(initialFiles)),
      latest: null,
      dirty: false,
      contentDirty: false,
      saving: null,
      debounceTimer: null,
      retryTimer: null,
      retryCount: 0,
      thumbnailDirty: false,
      thumbnailRunning: false,
      lastThumbnailAt: 0,
      projectGone: false,
    };
  }

  const mountedRef = useRef(true);
  const safeSet = useCallback(<T,>(setter: (v: T) => void, value: T) => {
    if (mountedRef.current) setter(value);
  }, []);

  const refreshThumbnail = useCallback(
    async (force: boolean) => {
      const s = ref.current;
      if (!s.thumbnailDirty || s.thumbnailRunning || !s.latest || s.projectGone) return;
      if (!force && Date.now() - s.lastThumbnailAt < THUMBNAIL_INTERVAL_MS) return;
      s.thumbnailRunning = true;
      s.thumbnailDirty = false;
      s.lastThumbnailAt = Date.now();
      const { elements, appState, files } = s.latest;
      try {
        await updateThumbnail(projectId, elements, appState, files);
      } catch (err) {
        console.warn("Thumbnail generation failed", err);
        s.thumbnailDirty = true;
      } finally {
        s.thumbnailRunning = false;
      }
    },
    [projectId],
  );

  // Lets retry timers call the latest flush without the callback referencing itself.
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const flush = useCallback((): Promise<void> => {
    const s = ref.current;
    if (s.debounceTimer) {
      clearTimeout(s.debounceTimer);
      s.debounceTimer = null;
    }
    if (s.saving) return s.saving;
    if (!s.dirty || !s.latest || s.projectGone) return Promise.resolve();
    if (s.retryTimer) {
      clearTimeout(s.retryTimer);
      s.retryTimer = null;
    }

    safeSet(setStatus, "saving");

    const run = async () => {
      let touched = false;
      // Keep writing until no edits arrived during the previous write.
      while (s.dirty && s.latest) {
        const snapshot = s.latest;
        const touch = s.contentDirty ? Date.now() : null;
        s.dirty = false;
        s.contentDirty = false;

        const newFiles = Object.values(snapshot.files).filter(
          (file) => !s.savedFileIds.has(file.id),
        );
        try {
          await projectStorage.saveScene(
            {
              projectId,
              elements: snapshot.elements,
              appState: snapshot.appState,
              savedAt: Date.now(),
            },
            newFiles,
            touch,
          );
        } catch (err) {
          // Put the work back so the next attempt includes it.
          s.dirty = true;
          if (touch !== null) s.contentDirty = true;
          throw err;
        }
        for (const file of newFiles) s.savedFileIds.add(file.id);
        if (touch !== null) touched = true;
      }
      if (touched) notifyProjectsChanged();
    };

    const promise = run()
      .then(() => {
        // Everything is in IndexedDB now; an emergency copy would be stale.
        if (!s.dirty) clearUnloadBackup(projectId);
        s.retryCount = 0;
        safeSet(setError, null);
        safeSet(setStatus, "saved");
        safeSet(setLastSavedAt, Date.now());
        void refreshThumbnail(false);
      })
      .catch((err: unknown) => {
        console.error("Autosave failed", err);
        safeSet(setStatus, "error");
        if (err instanceof ProjectNotFoundError) {
          s.projectGone = true;
          safeSet(setError, "This project was deleted.");
          return;
        }
        const quota = err instanceof DOMException && err.name === "QuotaExceededError";
        safeSet(
          setError,
          quota
            ? "Browser storage is full. Free up space or export your drawing."
            : "Couldn't save your latest changes. Retrying…",
        );
        const delay = RETRY_DELAYS_MS[Math.min(s.retryCount, RETRY_DELAYS_MS.length - 1)];
        s.retryCount += 1;
        s.retryTimer = setTimeout(() => {
          s.retryTimer = null;
          void flushRef.current();
        }, delay);
      })
      .finally(() => {
        s.saving = null;
        // An edit may have scheduled a save while we were busy; honour it.
        if (s.dirty && !s.debounceTimer && !s.retryTimer && !s.projectGone) {
          s.debounceTimer = setTimeout(() => void flushRef.current(), SAVE_DEBOUNCE_MS);
        }
      });

    s.saving = promise;
    return promise;
  }, [projectId, refreshThumbnail, safeSet]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  /** Wire this to Excalidraw's onChange. Cheap when nothing persisted changed. */
  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      const s = ref.current;
      const elementsHash = hashElementsVersion(elements);
      const persisted = pickPersistedAppState(appState as unknown as Record<string, unknown>);
      const appStateKey = JSON.stringify(persisted);

      if (!s.baselineSet) {
        // First onChange fires during initialization — it is the saved state.
        s.baselineSet = true;
        s.elementsHash = elementsHash;
        s.appStateKey = appStateKey;
        s.latest = { elements: liveElements(elements), appState: persisted, files };
        return;
      }

      const contentChanged = elementsHash !== s.elementsHash;
      const hasNewFiles = Object.keys(files).some((id) => !s.savedFileIds.has(id));
      const viewChanged = appStateKey !== s.appStateKey;
      if (!contentChanged && !hasNewFiles && !viewChanged) return;

      s.elementsHash = elementsHash;
      s.appStateKey = appStateKey;
      s.latest = { elements: liveElements(elements), appState: persisted, files };
      s.dirty = true;
      if (contentChanged || hasNewFiles) {
        s.contentDirty = true;
        s.thumbnailDirty = true;
        // Only content edits show "Saving…"; viewport-only saves stay silent.
        setStatus((prev) => (prev === "error" ? prev : "saving"));
      }

      if (s.debounceTimer) clearTimeout(s.debounceTimer);
      s.debounceTimer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  // Flush when the tab is hidden or the page is being unloaded.
  useEffect(() => {
    const flushAll = () => {
      void flush().then(() => refreshThumbnail(true));
    };
    // Synchronous safety net for edits whose async save may not finish before unload.
    const backupPending = () => {
      const s = ref.current;
      if ((s.dirty || s.saving) && s.latest && !s.projectGone) {
        writeUnloadBackup(projectId, {
          elements: s.latest.elements,
          appState: s.latest.appState,
          contentChanged: s.contentDirty || !!s.saving,
          writtenAt: Date.now(),
        });
      }
    };
    const onPageHide = () => {
      backupPending();
      flushAll();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushAll();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const s = ref.current;
      backupPending();
      if (s.dirty || s.saving) {
        void flush();
      }
      // Only warn when changes genuinely failed to persist.
      if (s.retryTimer && s.dirty) {
        event.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [flush, refreshThumbnail, projectId]);

  // Flush on unmount (navigating back, switching projects).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const s = ref.current;
      if (s.retryTimer) clearTimeout(s.retryTimer);
      void flush()
        .catch(() => {})
        .then(() => refreshThumbnail(true));
    };
  }, [flush, refreshThumbnail]);

  /**
   * The editor just took in a scene from another device, and the sync engine
   * persists it. Treat it as already saved, so it isn't written (and synced)
   * straight back. Any pending local edits are part of that merged scene.
   */
  const adoptBaseline = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      const s = ref.current;
      if (s.debounceTimer) {
        clearTimeout(s.debounceTimer);
        s.debounceTimer = null;
      }
      const persisted = pickPersistedAppState(appState as unknown as Record<string, unknown>);
      s.baselineSet = true;
      s.elementsHash = hashElementsVersion(elements);
      s.appStateKey = JSON.stringify(persisted);
      s.latest = { elements: liveElements(elements), appState: persisted, files };
      for (const id of Object.keys(files)) s.savedFileIds.add(id);
      s.dirty = false;
      s.contentDirty = false;
      s.thumbnailDirty = true;
    },
    [],
  );

  return { onChange, flush, adoptBaseline, status, error, lastSavedAt };
}

/**
 * Deleted elements are kept as tombstones (isDeleted: true): when two devices'
 * scenes are merged, a tombstone with a higher version is what makes a delete
 * win over a stale copy of the element. They're excluded from exports/previews.
 */
function liveElements(elements: readonly ExcalidrawElement[]) {
  return elements;
}
