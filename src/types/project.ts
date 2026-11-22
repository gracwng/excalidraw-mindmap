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

/**
 * Tab metadata. `version`/`versionNonce` work like Excalidraw's element
 * versions: when two devices change the same tab's name/order/deleted flag,
 * the higher version wins. Deleted tabs are kept as tombstones so the delete
 * reaches other devices.
 */
export interface TabMeta {
  id: string;
  name: string;
  order: number;
  version: number;
  versionNonce: number;
  deleted?: boolean;
}

/** One canvas within a project. */
export interface ProjectTab extends TabMeta {
  elements: readonly ExcalidrawElement[];
  appState: PersistedAppState;
}

/** Id of the first tab. Fixed so that projects from before tabs existed migrate identically on every device. */
export const DEFAULT_TAB_ID = "default";

/** The drawing itself, stored separately from metadata so the dashboard stays fast. */
export interface ProjectScene {
  projectId: string;
  tabs: ProjectTab[];
  savedAt: number;
}

/** A complete project: metadata + tabs + binary files (images, shared by all tabs). */
export interface Project extends ProjectMeta {
  tabs: ProjectTab[];
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
