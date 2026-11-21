import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";

/**
 * The subset of Excalidraw's AppState we persist per project.
 * Covers the viewport (so reopening feels continuous), canvas settings and
 * the "current item" styles (so the next shape you draw keeps your last style).
 */
export const PERSISTED_APP_STATE_KEYS = [
  "scrollX",
  "scrollY",
  "zoom",
  "viewBackgroundColor",
  "gridSize",
  "gridStep",
  "gridModeEnabled",
  "zenModeEnabled",
  "objectsSnapModeEnabled",
  "currentItemStrokeColor",
  "currentItemBackgroundColor",
  "currentItemFillStyle",
  "currentItemStrokeWidth",
  "currentItemStrokeStyle",
  "currentItemRoughness",
  "currentItemOpacity",
  "currentItemFontFamily",
  "currentItemFontSize",
  "currentItemTextAlign",
  "currentItemStartArrowhead",
  "currentItemEndArrowhead",
  "currentItemRoundness",
  "currentItemArrowType",
] as const satisfies readonly (keyof AppState)[];

export type PersistedAppState = Partial<
  Pick<AppState, (typeof PERSISTED_APP_STATE_KEYS)[number]>
>;

/** Lightweight project record — everything the dashboard needs. */
export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  /** Last time the drawing content or name changed. */
  updatedAt: number;
  /** Bumped on every local content or name change. */
  localVersion: number;
  /** The localVersion that was last pushed to / pulled from the cloud. Dirty when they differ. */
  syncedVersion: number;
  /** Cloud revision this device last saw, or null if never synced. */
  remoteRevision: number | null;
}

/** Appstate keys that describe *this device's* view and are never synced. */
export const DEVICE_ONLY_APP_STATE_KEYS = ["scrollX", "scrollY", "zoom"] as const;

/** The drawing itself, stored separately from metadata so the dashboard stays fast. */
export interface ProjectScene {
  projectId: string;
  elements: readonly ExcalidrawElement[];
  appState: PersistedAppState;
  savedAt: number;
}

/** A complete project: metadata + scene + binary files (images). */
export interface Project extends ProjectMeta {
  elements: readonly ExcalidrawElement[];
  appState: PersistedAppState;
  files: BinaryFiles;
}

export interface ProjectThumbnail {
  projectId: string;
  blob: Blob;
  updatedAt: number;
}

export type { BinaryFileData, BinaryFiles, ExcalidrawElement };

export type SortKey = "updatedAt" | "createdAt" | "name";

export type SaveStatus = "idle" | "saving" | "saved" | "error";
