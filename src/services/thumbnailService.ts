import { loadExcalidraw } from "../lib/excalidraw";
import { notifyProjectsChanged } from "../lib/projectEvents";
import { projectStorage } from "./projectStorage";
import type { BinaryFiles, ExcalidrawElement, PersistedAppState } from "../types/project";

const THUMBNAIL_MAX_SIZE = 480;

/** Renders a small PNG preview of the drawing using Excalidraw's own exporter. */
export async function renderThumbnail(
  elements: readonly ExcalidrawElement[],
  appState: PersistedAppState,
  files: BinaryFiles,
): Promise<Blob | null> {
  const visible = elements.filter((el) => !el.isDeleted);
  if (visible.length === 0) return null;
  const { exportToBlob } = await loadExcalidraw();
  return exportToBlob({
    elements: visible,
    appState: {
      viewBackgroundColor: appState.viewBackgroundColor ?? "#ffffff",
      exportBackground: true,
      exportWithDarkMode: false,
    },
    files,
    maxWidthOrHeight: THUMBNAIL_MAX_SIZE,
    exportPadding: 24,
    mimeType: "image/png",
  });
}

export async function updateThumbnail(
  projectId: string,
  elements: readonly ExcalidrawElement[],
  appState: PersistedAppState,
  files: BinaryFiles,
) {
  const blob = await renderThumbnail(elements, appState, files);
  if (blob) {
    await projectStorage.saveThumbnail({ projectId, blob, updatedAt: Date.now() });
  } else {
    await projectStorage.deleteThumbnail(projectId);
  }
  notifyProjectsChanged();
}
