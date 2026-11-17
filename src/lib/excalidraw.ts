/**
 * Lazily loads the Excalidraw runtime. The dashboard only needs it for
 * import/export/thumbnail work, so keep it out of the dashboard's initial bundle.
 */
let modulePromise: Promise<typeof import("@excalidraw/excalidraw")> | null = null;

export function loadExcalidraw() {
  modulePromise ??= import("@excalidraw/excalidraw");
  return modulePromise;
}
